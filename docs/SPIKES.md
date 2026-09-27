# Phase 0 スパイク記録

判定基準は `docs/PLAN.md` §6 Phase 0 を参照。

## S1 — EmbedPDF ヘッドレス + React で表示・座標変換 ✅（2026-09-20）

- 構成: `@embedpdf/core` + `engines` + `plugin-{document-manager,viewport,scroll,render,zoom}`、Direct エンジン（メインスレッド）
- `createPdfiumEngine` を自前で再実装し（`src/pdf/engine.ts`）、`WrappedPdfiumModule` と `PdfiumNative` を保持 → 生 PDFium API を同じ文書に対して呼べる
- 文書ポインタは `PdfiumNative.cache`（TS 上 private）経由で取得（`src/pdf/raw.ts`）。**暫定ブリッジ**
- サンプル `samples/sample-ja-form.pdf`（BIZ UDゴシック サブセット埋め込み）が正しく描画された
- クリック → pt 変換: 「氏名」欄クリックで BL(155.0, 656.3)。行の範囲 641.9〜671.9 に一致
- `FPDF_GetPageCount=2`, `FPDF_GetSignatureCount=0` を生 API で取得
- 外部通信: なし（localhost のみ。WASM は Vite 経由で同一オリジン配信）

### 判明したこと
- `@embedpdf/pdfium` の WASM は `@embedpdf/pdfium/pdfium.wasm` でエクスポートされている（`dist/...` 直指定は不可）
- `fontFallback` を指定しないと **既定で CDN からフォントを取得**する → `null` を明示（P1）。非埋め込み和文フォントの描画は後で自己ホストのフォールバックを検討
- dev サーバーの CSP に `script-src 'unsafe-inline'` が必要（Vite の React Refresh プリアンブル）。preview / 本番は厳格なまま

## S7 — CSP 下で WASM とフォントが動く（S1 と同時に部分確認）
- `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'` + COOP/COEP で WASM 初期化・描画とも問題なし
- フォント（S2 以降）は未確認

## S2 — 日本語テキスト注釈の `/AP` 生成 ✅（条件付き、2026-09-20）

### 結果
- **Stamp 経路（`FPDFAnnot_AppendObject`）で成功**。BIZ UDPGothic のサブセットを `FPDFText_LoadFont` で埋め込み、テキストオブジェクトを注釈に追加 → PDFium が `/AP` と `/Resources`（Font, ExtGState）を正しく生成
- 検証: MuPDF / Poppler / Ghostscript / Chrome(PDFium) の 4 レンダラで日本語が正しく表示（`_spike-out/*.png`）。**Acrobat Reader / Edge も手動確認済み（問題なし）**。Firefox は未確認
- 出力構造: `/Subtype /Stamp`, `/F 4`（印刷）, `/Contents`（UTF-16BE, テキスト抽出用）, `/AP /N` = Form XObject（BBox = /Rect, Type0 / CIDFontType2 / Identity-H / FontFile2 / ToUnicode）
- 注釈辞書は **`EPDFPage_CreateAnnot`** で作ること。`FPDFPage_CreateAnnot` は直接オブジェクトを `/Annots` に入れるため MuPDF（PyMuPDF）が注釈を読めない

### FreeText 経路（`EPDFAnnot_SetAppearanceFromPage`）は 2.15.1 では不可 ❌
- 外側の `/AP` ストリームに「内側 XObject(EPDFWRAP) の内容のコピー」が書かれ、`/Resources` には EPDFWRAP しか無い → フォント名 `FXF1` が解決できず **全ビューアで文字が消える**（Chrome でも不可視）
- `embedpdf/runtime` main では 2026-09-17 のコミット "Reuse wrapped AP; detach shared normal appearance" で外側を `q 1 0 0 1 0 0 cm /EPDFWRAP Do Q` に書くよう修正済み。2.15.1（2026-09-16 公開）には未収録
- `FPDFAnnot_SetAP` で外側を書き換える回避策は不可（既存ストリームを保持せず、Resources なしの新規ストリームを作る）
- `FPDFAnnot_AppendObject` は Ink / Stamp 専用（upstream の制限）
- **判断**: v1 のテキスト注釈は Stamp 経路で実装する。`@embedpdf/pdfium` の次リリースで FreeText 経路を再検証し、通れば「Acrobat でテキストとして再編集可能」なオプションとして追加する
- UI 上の名称は「テキスト」のままにする（ユーザーにとっての意味は同じ）。Acrobat では「スタンプ」として選択・移動・削除できる

### 実装ファイル
- `src/pdf/annots/text-annot-ja.ts`（両経路を実装、既定は stamp）
- `src/pdf/fonts/subset.ts`（harfbuzz-subset.wasm の生 API ラッパ）
- `src/pdf/wasm-utils.ts`

## S5 — フォントサブセットのサイズと速度 ✅
- BIZ UDPGothic-Regular.ttf 4,669,688 bytes → 23 文字で **6,340 bytes、10〜14ms**（判定基準 50KB / 200ms を大幅にクリア）
- `harfbuzzjs/dist/harfbuzz-subset.wasm`（623KB）を直接 instantiate。JS ラッパ（`harfbuzzjs` の index.mjs）にはサブセット API が無いため自前ラッパ
- 未対応: 注釈ごとに `FPDFText_LoadFont` を呼ぶと文書内にフォントオブジェクトが増える。保存時に 1 回だけサブセット化して共有する設計は Phase 1 で実装

## S3 — 増分更新保存 ✅（ただし肥大化あり）
- `PDFiumExt_OpenFileWriter` + `FPDF_SaveWithVersion(doc, writer, FPDF_INCREMENTAL, 17)` で動作
- 保存後ファイルの先頭 24,935 bytes は元ファイルと **完全一致**（P2 達成）。Chrome / MuPDF / Poppler / Ghostscript で開ける
- ⚠️ PDFium の増分保存は **メモリにロード済みの旧オブジェクトを全て書き直す**（元 13 オブジェクト全部 + 新規）。増分 37KB（元 25KB）。大きな文書では保存のたびにファイルが約 2 倍になる
- 改善案（Phase 1 以降）: 開いた直後に基準の増分保存を取り、実保存との差分で「変化のないオブジェクト」を落として xref/trailer を自前で組み直す（PDFium の直列化は決定的なので比較可能）

## S4 — 注釈のみ編集時にページ内容ストリームが無変更か ✅
- 増分保存・フル保存とも、両ページの `/Contents` ストリームは **エンコード済みバイト列まで一致**（`xref_stream_raw` 比較）。GenerateContent をページに対して呼ばない経路で問題なし

## メモ: テスト環境の注意
- 非表示のタブでは ResizeObserver が発火せず、EmbedPDF の Viewport が 0×0 のままページを描画しない。自動テストはヘッドレスの Playwright で行う（アプリの不具合ではない）

## S6 — ページオブジェクトの削除・移動 ✅（2026-09-20）
- `FPDFPage_CountObjects` / `GetObject` / `FPDFPageObj_GetBounds` でヒットテスト → `FPDFPage_RemoveObject`（＋`FPDFPageObj_Destroy`）/ `FPDFPageObj_Transform` → `FPDFPage_GenerateContent` → フル保存
- 「○○市長　殿」の削除、「上記のとおり申請します。」の (+30, −20) 移動が MuPDF のテキスト抽出で確認できた。**編集していない 2 ページ目の内容ストリームは無変更**
- 編集したページの内容ストリームは PDFium が全面的に再生成する（リソース名が `FXF1`/`FXE1` 等に振り直される）。タグ構造消失の警告は PLAN §5 のとおり必要
- 実装: `src/pdf/spikes/s6.ts`

## S7 — CSP 下で WASM とフォントが動く ✅
- `connect-src 'self'` のもとで PDFium WASM（4.6MB）、harfbuzz-subset WASM（623KB）、BIZ UDPGothic（4.6MB）を同一オリジンから取得して動作。外部リクエストなし
- 本番の `public/_headers` は `script-src 'self' 'wasm-unsafe-eval'`。dev のみ `'unsafe-inline'` 追加

---

## Phase 0 総括

| # | 結果 | 備考 |
|---|---|---|
| S1 | ✅ | React StrictMode は外した（理由は `src/main.tsx` コメント） |
| S2 | ✅ 条件付き | **Stamp 経路**で全ビューア表示 OK。FreeText 経路は `@embedpdf/pdfium` 次リリース待ち |
| S3 | ✅ 肥大化あり | 元バイト列は保持。増分が「全オブジェクト書き直し」になるため改善余地 |
| S4 | ✅ | 注釈のみ編集でページ内容は無変更 |
| S5 | ✅ | 6KB / 12ms |
| S6 | ✅ | v2 の基盤として成立 |
| S7 | ✅ | |

**出口条件（S1〜S5）を満たした。Phase 1 に進める。**

### Phase 1 に持ち越す技術課題
1. テキスト注釈は Stamp として書く（`/Subj` や `/NM` で自前識別子を付け、自アプリでは再編集可能にする）
2. フォントの共有: 保存時に文書内の全テキスト注釈のグリフ和集合で 1 サブセットを作り直す
3. 増分保存の肥大化対策（基準保存との差分でスリム化）
4. 注釈追加後の再描画: EmbedPDF のレンダキャッシュを無効化する経路（`pageRefreshVersions`）を確認する
5. `PdfiumNative.cache` への private アクセス（`src/pdf/raw.ts`）を公開 API に置き換えられるか EmbedPDF に確認

---

## Phase 1 実装中に判明したこと（2026-09-20）

- **テキスト注釈は注釈プラグイン経由で作れる**: Stamp 作成時に `ctx.data` として 1 ページの PDF（埋め込みサブセットフォント入り）を渡すと、`EPDFAnnot_SetAppearanceFromPage` → `EPDFAnnot_UpdateAppearanceToRect` の順で処理され、外側 `/AP` も正しく `q ... cm /EPDFWRAP Do Q` になる（S2 の不具合は Stamp では回避される）。追跡・選択・移動・Undo・commit をプラグインに任せられるので、生 API で `/Annots` を直接触る必要がなくなった（`src/pdf/appearance.ts`, `src/annotations/text-ja/`）
- **ページ画像のネイティブドラッグ**: RenderLayer の `<img>` をドラッグすると画像のドラッグ＆ドロップが始まり pointer イベントが途切れ、図形・手書きツールが成立しない。`.page img { pointer-events: none; user-select: none; -webkit-user-drag: none }` で解決
- **既定ツールの一部は Print フラグを立てない**（ハイライト等）。`setToolDefaults(id, { flags: ['print'] })` を全ツールに適用（P5）
- `EPDFCustom` キーに JSON を入れるとプラグインの `annotation.custom` として読める。テキスト注釈の本文・サイズ・色はここに保存し、再編集に使う
- React StrictMode は Viewport の二重登録を招くため外した（`src/main.tsx`）
- **既存 FreeText（Acrobat 等で作成）のリサイズ・本文編集は禁止**: EmbedPDF は FreeText の更新時に外観を Helvetica で作り直すため、日本語が消え `/C` が背景色として塗られる（手元の Acrobat 製 FreeText を含む文書で再現、2026-09-20）。`FrozenFreeText` レンダラで元の `/AP` を表示し、移動（外観保持）と削除だけ許可する。EmbedPDF が CJK 対応の外観生成を実装したら見直す
- **非埋め込み和文フォントの表示**（2026-09-20）: EmbedPDF の `fontFallback` は PDFium の `FPDF_SYSFONTINFO` 経由で同期的にフォントを要求する。メインスレッド（Direct エンジン）では同期 XHR で arraybuffer を取得できず失敗するため、起動時に同梱フォントを先読みし `fontLoader` から返す（`src/pdf/engine.ts`）。`sample-noembed.pdf`（HeiseiMin-W3 非埋め込み）が BIZ UDPゴシックで描画されることを E2E で確認。外部通信なし
- **増分保存のスリム化**（2026-09-20）: 開いた直後に全ページの内容・注釈を読み込んでから基準の増分を取り、保存時の増分と比較して同一オブジェクトを落とす（`src/pdf/slim-increment.ts`, `src/pdf/incremental.ts`）。xref はクラシック / 非圧縮 xref ストリームを PDFium と同じ形式で書き直す。結果: `sample-ja-form.pdf` 31KB → **5.5KB**、手元の 32 ページの文書（1.38MB, xref ストリーム）→ **85KB**。MuPDF / Poppler / PDFium（本アプリで再オープン）で検証済み。解析に失敗したときは PDFium の増分にフォールバック
- **本文編集モード**（2026-09-21）: interaction-manager の exclusive モードで全ページのポインタを受け、`FPDFPage_RemoveObject` / `FPDFPageObj_Transform` / テキスト差し替え（同梱フォント）→ `FPDFPage_GenerateContent` → `refreshPages` で再描画。バナーを `.viewer` の中に置くとレイアウトが変わり座標がずれるので、ツールバー直下に置く
- **本文編集に PC のフォントを使う**（2026-09-21）: Local Font Access API（`window.queryLocalFonts`、Chrome / Edge 103+）でフォントファイルのバイト列を受け取り、同梱フォントと同じ経路（harfbuzz サブセット → `FPDFText_LoadFont`）で埋め込む。WASM の PDFium は OS のフォントを見られないので `FPDF_SetSystemFontInfo` は使えず、ブラウザ側で取る形になる（`src/pdf/fonts/local-fonts.ts`, `sfnt.ts`）。要点: (1) Windows の和文フォントは TTC（`msmincho.ttc` = MS-Mincho + MS-PMincho）で `blob()` はファイル全体を返すため、name テーブルの PostScript 名で書体を特定し `hb_face_create(blob, index)` でサブセット化する (2) OS/2 `fsType` を見て Restricted License（下位 4 ビット = 2）・ビットマップのみ・サブセット禁止は使わない (3) PDF の BaseFont は `ABCDEF+MS-Mincho` / `MS-Gothic,Bold` の形なので接頭辞・スタイル接尾辞を外して照合。結果: `sample-msmincho.pdf` の置換で MS-Mincho の 16 グリフ・4KB のサブセットが埋め込まれ、出力 6KB（E2E `local-fonts.spec.ts` は許可ダイアログを自動化できないため `queryLocalFonts` を差し替えて本物の TTC を流す）。一覧の取得はユーザー操作の中で呼ぶ必要がある（設定トグルのクリック）。表示への適用は次項
- **非埋め込みフォントの表示をフォント名で選ぶ**（2026-09-21）: EmbedPDF の `FontFallbackManager` は `MapFont` で受け取る face 名を捨てて文字集合（Shift_JIS 等）だけで選ぶため、HeiseiMin も MS-Mincho も一律ゴシックになっていた。`fontFallback` を渡さず、自前で `FPDF_SYSFONTINFO` を登録（`src/pdf/fonts/font-provider.ts`。`addFunction` で 8 個のコールバック、構造体 36 バイト）。分かったこと: (1) PDFium が渡す face 名は BaseFont そのまま（`MS-Mincho`, `HeiseiMin-W3`）。Serif フラグは `pitchFamily` の `FXFONT_FF_ROMAN`(0x10) で来る (2) フォントは同期的に要求されるので、開く前に生 API（`FPDF_LoadMemDocument` → 全ページの text オブジェクト → `FPDFFont_GetIsEmbedded`）で非埋め込みフォントを列挙して先読みする (3) **その走査自体が置換を起こし、PDFium は結果を (書体名, weight, italic) で永続キャッシュする**ので、走査中に仮のフォントを返すと後から差し替わらない → 走査中は `MapFont` で 0 を返す（内蔵フォントに落ち、キャッシュされない）。設定変更後の開き直しでも同じ問題が出るため、`GetFaceName` で `local:msmincho` / `mincho:heiseiminw3` のように供給元込みの名前を返してキャッシュキーを分ける (4) TTC を渡すと常に 1 書体目になるので、`sfnt.ts` の `extractSfntFace` で該当書体だけの単体 TTF にして渡す（テーブルをコピーするだけ）。結果: `sample-noembed.pdf`（HeiseiMin-W3）が BIZ UDP明朝、`sample-msmincho.pdf` は設定オンで PC の MS 明朝で描画。外部通信なし（privacy E2E で確認）
- **ハイライト・下線・取消線が複数行で巨大になる**（2026-09-21）: EmbedPDF の文字矩形は `FPDFText_GetLooseCharBox` で、PDFium はこれを FontDescriptor の **FontBBox** から作る。原ノ味ゴシック（LaTeX / Asciidoctor 製 PDF に多い）は FontBBox が [-1002 -1048 2928 1808]（縦 2.85 em）なので 10pt の文字に 29pt の箱が付き、隣の行と縦に重なる → 選択プラグインの行結合（縦の重なりで判定）が隣の行を巻き込み、下線も次の行に掛かる。reportlab 製の PDF は FontBBox が 1 em なので再現しない。対策: `engine.getPageGeometry` を包み、文字サイズの 1.6 倍を超える箱だけ `FPDFText_GetCharOrigin`（ベースライン）基準の 1 em（上 0.88 / 下 0.12）に置き換える（`src/pdf/text-geometry.ts`）。`samples/sample-mixed-lines.pdf` は FontBBox を書き換えて再現させたもの。E2E `text-markup.spec.ts`
- **パスワードを付けて保存**（2026-09-26）: PDFium 本体に暗号化の書き出しは無いが、EmbedPDF が `EPDF_SetEncryption(doc, user, owner, flags)`（AES-256 = V5/R6）を足している。自前の `FPDF_SaveWithVersion`（NO_INCREMENTAL）でも効く（EmbedPDF の `saveAsCopy` を通す必要はない）。分かったこと: (1) 設定は文書に残り続け、以後の保存がすべて暗号化される → 作業中の文書には掛けず、全体保存したバイト列を別の文書として開き直して暗号化する（`src/pdf/encrypt.ts`。最近使ったファイルへの自動保存を平文のまま保つため） (2) パスワード付きで開いた文書は、全体保存・増分保存とも元の暗号化（パスワード）を保つ (3) 別の文書として開き直す処理（確定保存の `flattenCopy`、暗号化のコピー、ページ操作後の開き直し）は開くパスワードが要る → 開いたときのパスワードをメモリだけに覚えておく（`src/pdf/export.ts` の `rememberPassword`）。以前は確定保存がパスワード付き文書で失敗していた (4) 所有者パスワードは開くパスワードと同じにし、権限はすべて許可（権限ビットは守らないビューアが多く、保護として約束できないため）。E2E `protect.spec.ts`
