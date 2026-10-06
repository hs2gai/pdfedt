# pdfugu 開発計画

ブラウザ完結型（サーバー送信ゼロ）の PDF 注釈・編集ツール。日本の業務文書（官公庁様式・社内文書）を主対象とし、無料・OSS（MIT）で提供する。

作成日: 2026-09-20

---

## 1. 目的と設計原則

| # | 原則 | 意味 |
|---|---|---|
| P1 | **通信ゼロを検証可能にする** | ソース公開 + CSP ヘッダーで外部通信を物理的に遮断 + 静的ファイルのみで社内配布可能 |
| P2 | **元文書を変えない（既定）** | 注釈は `/Annots` に追加し、保存は増分更新。元のバイト列はファイル内に無傷で残る |
| P3 | **元文書を変える操作は明示的に** | 本文編集は別モード。文書ごとにゲート（確認）を通し、別名保存を強制 |
| P4 | **Acrobat / Chrome / Edge / Firefox / macOS プレビューで同じに見える** | 全注釈に `/AP`（外観ストリーム）を生成。日本語は OFL フォントをサブセット埋め込み |
| P5 | **印刷される** | 全注釈に Print フラグ（`/F` bit 3）を立てる |

### 非目標（やらないこと）
- Acrobat 相当の段落リフロー付き本文編集
- クラウド保存・アカウント・共同編集
- 広告・トラッキング・アナリティクス（P1 と矛盾する）
- サーバーサイド処理全般

---

## 2. 技術スタック

| レイヤー | 採用 | ライセンス | 備考 |
|---|---|---|---|
| PDF エンジン | `@embedpdf/pdfium` 2.15（PDFium WASM 4.6MB） | MIT / BSD | 編集・注釈・増分保存・署名検出まで生 API で可能 |
| ビューア基盤 | `@embedpdf/core` + `@embedpdf/engines` + プラグイン（viewport / render / zoom / scroll / selection / annotation / form / history） | MIT | ヘッドレスで利用し UI は自前 |
| UI | React 19 + TypeScript + Vite | MIT | EmbedPDF の第一級アダプタ |
| 日本語フォント | BIZ UDPゴシック / BIZ UDP明朝 / しっぽり明朝 / Yuji Syuku / Zen Antique | OFL | 動的サブセット化して埋め込み。設定で PC のフォント（Local Font Access API）も使える |
| フォントサブセット | `harfbuzzjs`（hb-subset WASM） | MIT | 必要グリフのみ抽出 |
| 配信 | Cloudflare Workers 静的アセット（`_headers` で CSP / COOP / COEP） | 無料 | 静的ファイルだけなので社内サーバーにも置ける |
| テスト | Playwright（本番ビルド + 厳格 CSP に対して E2E） | MIT | 保存した PDF を再読込して構造検証、外部通信ゼロを assert |

**避けるもの**: MuPDF（AGPL）、iText（AGPL）。pdf-lib は使わない（PDFium と二重書き込みになり整合性が崩れる）。

---

## 3. アーキテクチャ

```
┌─────────────────────────────────────────────────────────┐
│ React UI                                                  │
│  ├─ 記入・注釈モード（既定）   ├─ 本文編集モード（ゲート付）  │
│  └─ エクスポート（注釈付き保存 / 新ファイル / 確定）          │
├─────────────────────────────────────────────────────────┤
│ ドメイン層（自前・純 TS）                                  │
│  ├─ DocumentInspector  署名 / タグ / フォーム / PDF-A 検出   │
│  ├─ JapaneseFreeText   フォントサブセット + /AP 生成         │
│  ├─ StampFactory       印鑑・承認スタンプの外観生成           │
│  ├─ SaveStrategy       増分更新 / フル書き出し / フラット化   │
│  └─ ContentEditor      ページオブジェクト選択・移動・削除・置換 │
├─────────────────────────────────────────────────────────┤
│ EmbedPDF（core / engines / plugins）  ← 表示・座標・選択    │
├─────────────────────────────────────────────────────────┤
│ @embedpdf/pdfium（生 PDFium API）      ← 自前部分はここを直接 │
└─────────────────────────────────────────────────────────┘
```

方針: **表示・ズーム・スクロール・ヒットテストは EmbedPDF に任せ、「PDF に何をどう書くか」は自前で PDFium を直接叩く**。EmbedPDF の注釈プラグインは Helvetica 前提の外観生成をするため、日本語を含む注釈は自前パイプラインで書く。

---

## 4. 保存戦略

| 出力 | 方式 | PDFium API | 用途 |
|---|---|---|---|
| 注釈付きで保存（既定） | 増分更新 | `FPDF_SaveWithVersion(flags=FPDF_INCREMENTAL)` | 元バイト列を保持。署名（DocMDP≥3）を維持 |
| 新ファイルで保存 | フル書き出し | `FPDF_SaveAsCopy(flags=FPDF_NO_INCREMENTAL)` | 現在の状態から生成。削除済み注釈の残骸を消す（黒塗り事故防止） |
| 確定して書き出し | 注釈を本文へ焼き込み | `FPDFPage_Flatten` → フル書き出し | 注釈を編集できない形で渡す |
| 本文編集・ページ操作後の保存 | フル書き出し + **別名強制** | `FPDF_SaveAsCopy` | 元ファイルを温存。増分保存は無効 |

ファイル書き出し先:
- Chromium 系（Chrome / Edge）: File System Access API で元ファイルへの上書き可（増分保存時のみ）
- Firefox / Safari: 常にダウンロード（別名）

---

## 5. モード設計

### 記入・注釈モード（既定・メイン画面）
- ページ内容は**選択不可**（クリックは注釈レイヤーのみに効く）
- ツール: テキスト（FreeText）/ 付箋（Text）/ ハイライト・下線・取消線 / 図形（矩形・楕円・線・矢印）/ 手書き（Ink）/ スタンプ（Stamp）
- 既存注釈の選択・移動・リサイズ・削除・プロパティ編集
- AcroForm 検出時: フォーム入力を優先提示

### 本文編集モード（ゲート付き）
- 入口で文書ごとに確認ダイアログ。内容は検査結果で変わる:
  - 常時: 元の内容が書き換わる / 保存は別名
  - 署名あり: 署名が無効になる（DocMDP 1〜2 なら**禁止**を検討）
  - タグ付き PDF: 編集ページのタグ構造が失われる
- ヘッダーを赤系に変え「本文編集モード」を常時表示
- 「本文」ツールでページオブジェクトを選択。ほかのツールでは注釈を通常どおり扱える（クリックした対象に応じてツールが切り替わる）
- 操作: クリック / 矩形選択 → 移動 / 削除。テキストはダブルクリックで置換（元のフォントは使えないため同梱または PC のフォントに置き換わる。置換ダイアログは赤系で注釈の編集と区別）
- モード中は Undo 可。保存後は不可逆（ダイアログに明記）

---

## 6. フェーズ計画

### Phase 0 — スパイク（技術検証。各 1〜2 日、判定基準つき）

| # | 検証項目 | 判定基準 | 失敗時の代替 |
|---|---|---|---|
| S1 | EmbedPDF ヘッドレス + React で表示・ズーム・座標変換 | 日本語 PDF が正しく描画され、クリック座標 → PDF 座標が取れる | PDF.js 表示 + PDFium 書き込みの二本立て |
| S2 | **日本語 FreeText の `/AP` 生成** | Noto Sans JP サブセットを埋め込んだ FreeText が Acrobat / Chrome / Edge / Firefox / プレビューで同一表示 | (a) `EPDFAnnot_SetAppearanceFromPage` で一時ページから外観生成 (b) FreeText を諦め Stamp 注釈で代替 |
| S3 | 増分更新保存 | 保存後ファイルの先頭 N バイトが元と完全一致。`qpdf --check` 通過。Acrobat で開ける | フル書き出しに切替（P2 を「元ファイル温存」に弱める） |
| S4 | 注釈のみ編集時にページ内容ストリームが無変更か | `FPDFPage_GenerateContent` 呼び出し後もコンテンツストリームのバイト列が一致 | 注釈編集時は GenerateContent を呼ばない経路を作る |
| S5 | フォントサブセットのサイズと速度 | 100 文字の注釈でフォント < 50KB、サブセット化 < 200ms | サブセットを文書単位で共有（全注釈のグリフ和集合） |
| S6 | ページオブジェクト削除・移動 | `FPDFPage_RemoveObject` → 保存 → 再読込で消えている。移動後の座標が正しい | — （v2 以降なので v1 はブロックしない） |
| S7 | CSP `connect-src 'none'` 下で WASM とフォントが動く | DevTools ネットワークタブに外部リクエストなし | `self` のみ許可 |

**Phase 0 の出口条件**: S1〜S5 が通ること。S2 が (b) に落ちた場合は仕様書に明記して進む。

> **結果（2026-09-20）**: S1〜S7 すべて通過。S2 は (b) Stamp 経路を採用（`@embedpdf/pdfium` 2.15.1 の FreeText 外観生成に不具合、runtime main では修正済み）。

### Phase 1 — v1: 注釈エディタ（公開可能な最小製品）

> **進捗（2026-09-20）**: 下記をすべて実装（サムネイルも追加済み）。非埋め込み和文フォントの表示フォールバック（同梱フォント）も追加。テキスト注釈は EmbedPDF の注釈プラグイン経由で Stamp として作成（外観は自前生成の 1 ページ PDF）。
- ファイルを開く（ドラッグ&ドロップ / ファイル選択）、ページ表示・サムネイル・ズーム
- 書体の選択（2026-09-21 追加）: 同梱フォントを 5 書体に（`src/pdf/fonts/catalog.ts`。すべて OFL、`public/fonts/` にライセンス同梱）。ゴシック（BIZ UDPGothic）/ 明朝（BIZ UDPMincho）/ 明朝（しっぽり明朝）/ 毛筆（Yuji Syuku）/ 古印体風（Zen Antique）。テキスト・引き出し線はポップオーバーの「書体」、スタンプは文字要素ごとに指定（作例の丸印は古印体風・毛筆）。外観生成は複数書体対応（`AppearanceSpec.fonts`）。ゴシック以外は選ばれたときに取得し Service Worker が実行時キャッシュ（事前キャッシュから除外）
- 引き出し線付きテキスト（2026-09-21 追加）: Acrobat のコールアウト相当。「引き出し線」ツールで 矢印の先 → 文字の位置 の 2 クリックで置く。外観は枠付き文字＋辺の中央から矢印の先への線＋塗り三角（`buildCalloutAppearance`）。テキスト注釈と同じ Stamp で、`custom.pdfa.callout` に枠と先の相対位置を保存。選択メニューに「矢印の先を変更」
- フォーム入力（2026-09-21 追加）: `@embedpdf/plugin-form` を登録し、widget 注釈をロック（`DEFAULT_LOCK`: form カテゴリ）して入力欄として動かす。テキスト・チェック・ラジオ・コンボ・リストに対応、値は PDFium 側に書かれるので注釈付き保存・新ファイル保存の両方に残る（暗号化文書も可）。自動サイズ（DA 0）の欄は EmbedPDF が font-size 0 にして打てないため CSS（cqh）で補正。権限ビット（注釈禁止・変更禁止）を見て注釈ツール・本文編集を無効化し、フォーム入力だけ許す。既知: AES 暗号化文書の増分保存は IV が毎回変わりスリム化が効かないため元の 2 倍程度になる（新ファイルで保存の方が小さい）
- 表示設定（2026-09-21 追加）: ツールバー右端の ⚙ から「ページ移動をアニメーションする」（既定オフ。長い文書で待たされる感を避ける）と「フォームの入力欄を強調表示する」（既定オン。Acrobat と同じ薄い青。`FormHighlightLayer`）を切替
- 最近使ったファイル（2026-09-21 追加）: 開いた文書の作業中の状態を IndexedDB に自動保存（注釈・本文編集のたび、上限 20 件）。「開く」横のドロップダウンと、空画面の「前回の作業を再開」から復元。文書を開いている間は離脱前に確認ダイアログ
- 注釈ツール一式（§5 記入・注釈モード）と `/AP` 生成、Print フラグ
- DocumentInspector（署名・フォーム・タグ・暗号化の検出とバッジ表示）
- エクスポート 3 種（増分 / 確定 / フラット化）
- PWA（オフライン動作）、`_headers`（CSP / COOP / COEP）
- 4 ビューアでの表示確認手順を `docs/INTEROP.md` に記録

### Phase 2 — スタンプ

> **進捗（2026-09-20）**: 実装済み。プリセット 12 種（承認・確認・受領・回覧・社外秘・至急・案・済・写・却下・日付印・認印）、日付形式（令和 / 西暦 / スラッシュ / なし）、氏名・部署、朱・青・黒。外観はベクター（`src/pdf/appearance.ts` の図形＋埋め込みフォント）で、縦横比固定のリサイズ可。PNG / JPEG の画像スタンプはプラグインの stamp ツールをそのまま利用。
- 承認・回覧スタンプ（「承認」「済」「社外秘」「回覧」+ 日付 + 氏名。令和・西暦）
- 印影スタンプ（氏名から丸印生成、または PNG 取り込み）
- カスタムスタンプの保存（`localStorage`。文書には含めない）
- 作成時に描画確定（Acrobat のダイナミックスタンプ JS は使わない）

> **改訂（2026-09-21）**: プリセット 12 種をやめ、テンプレート方式に変更。
> - 作例は 4 種（四角=上段・日付・下段 / 丸・横書き / 丸・縦書き / データ印）。それ以外はユーザーが自作する
> - テンプレート = 固定サイズの枠 ＋ 図形（四角・角丸・楕円・線）と文字。文字は `{上段}` `{上段:承認}` `{日付}` `{短い日付}` `{氏名}` `{部署}` の差し込み記法で、押印時はその項目だけが入力欄になる（`src/annotations/stamps/template.ts`）
> - 自作スタンプは IndexedDB に保存し、JSON 書き出し / 読み込みで別 PC へ持ち運べる（`template-store.ts`）
> - 作成画面は `#/stamps`（別タブで開く。`src/stamp-editor/`）。キャンバスはドラッグ移動・ハンドルでリサイズ、下に PDFium で描いた実物プレビュー（`src/pdf/render-appearance.ts`）
> - 押印時の設定（氏名・部署・日付形式・色・最後に使ったテンプレート）は localStorage
> - 日付は 令和 / 西暦 / スラッシュ / なし に加え、Excel 風のカスタム書式（`yyyy-mm-dd aaa`、`ggge年m月d日` など。`src/shared/dates.ts` の formatDateCustom）
> - 文字要素の「空なら段を詰める」: 差し込み結果が空の段を取り除いてスタンプを縮める（作例の四角の 2 段目で使用）

### Phase 3 — 本文編集モード

> **進捗（2026-09-21）**: 実装済み。ゲート（署名 DocMDP 1〜2 は禁止、タグ付き・XFA の警告）→ 赤いバナーのモード。クリック / Shift / 矩形で選択、ドラッグで移動、Delete で削除、文字はダブルクリックで置換（同梱フォントに置き換わる旨を表示）。編集後は増分保存を無効化し「新ファイルで保存」（`_n` の別名）に限られる（注釈の扱いは §5 のとおり、モード中も編集可）。未実装: テキスト置換 B（同一グリフ内の置換で元フォントを維持）
> **置換時の書体推定（2026-09-21 追加）**: 元のフォント名（`FPDFFont_GetBaseFontName`）と Serif フラグから、明朝系なら明朝、それ以外はゴシックを初期選択（`src/pdf/fonts/match.ts`）。ダイアログで書体を変更可。太字（名前に Bold 等）は塗り＋縁取りの疑似ボールド。IPA・原ノ味などは同梱していないので同系統の BIZ UD で代替
> **Undo/Redo（2026-09-21 追加）**: 移動・削除・置換を Ctrl+Z / Ctrl+Y とツールバーの「元に戻す / やり直す」で戻せる（`src/content-edit/history.ts`。外したオブジェクトは破棄せず保持し、Undo で元の index に戻す）。注釈の履歴プラグインとは独立
> **PC のフォントで置換（2026-09-21 追加）**: 設定「PC のフォントを使う」をオンにすると Local Font Access API（Chrome / Edge のみ）でフォントを読み、元の BaseFont と同名の書体があれば「元と同じ」を既定選択にして埋め込む（`src/pdf/fonts/local-fonts.ts`, `sfnt.ts`）。TTC は書体を特定、OS/2 fsType で埋め込み禁止のものは使わない。フォントは外部に送らず、必要な文字のサブセットだけ埋め込む
> **非埋め込みフォントの表示（2026-09-21 追加）**: EmbedPDF の `fontFallback` は文字集合だけで選びフォント名を見ないため、自前の `FPDF_SYSFONTINFO`（`src/pdf/fonts/font-provider.ts`）に置き換えた。文書を開く前に生 API で非埋め込みフォントを列挙し（`display-fonts.ts`）、名前が一致する PC のフォント（設定オン時）→ 明朝系なら同梱の明朝 → ゴシックの順で先読みして返す。PDFium は置換結果を書体名でキャッシュするので、走査中は何も返さず、`GetFaceName` で供給元をキーに含める
> **ページ操作（2026-09-21 追加）**: サムネイルで選んで Delete で削除（確認あり）、ドラッグで並べ替え、PDF を落として取り込み（`src/pdf/pages.ts`: `FPDFPage_Delete` / `FPDF_MovePages` / `FPDF_ImportPagesByIndex`）。EmbedPDF の各プラグイン状態を個別に合わせるのは壊れやすいので、操作後は新ファイル保存相当のバイト列で文書を開き直す（`src/app/usePageOperations.tsx`）。本文編集と同じ「編集済み」扱いで追記保存は不可・新ファイルで保存は別名。Undo なし。署名で変更禁止の文書と本文編集モード中は不可
>
> **ページの回転（2026-10-03 追加）**: ツールバーの左右の回転ボタンで表示中のページを 90° 回す（`rotatePage`: `FPDFPage_SetRotation` で /Rotate を書き換え）。他のページ操作と同じく開き直し・追記保存不可。EmbedPDF の `Scroller` は回転後の大きさで枠を取るだけなので、`PdfPages.tsx` でページ要素に CSS の回転を掛ける（/Rotate 付きの PDF を開いたときの表示崩れも同時に直る）。開き直し直後は現在ページが 1 になるため、対象ページへ戻るまで次のページ操作は受け付けない
>
> **検索・印刷・ページ番号（2026-10-03 追加）**: 検索は `@embedpdf/plugin-search`（PDFium の FPDFText_Find。入力から 250ms 後に全ページ検索、`SearchLayer` でハイライト、現在の一致へスクロール）。Ctrl+F / Ctrl+P はブラウザ標準を止めて自前の機能を開く。印刷は `@embedpdf/plugin-print` を使わない（PDF を blob の iframe に入れてブラウザの PDF ビューアで印刷する方式で、CSP の `object-src 'none'` と frame の制限に掛かる）。代わりに各ページを 150dpi の PNG に描画して `#print-pages` に並べ、`@media print` でそれだけを 1 ページ 1 枚に収めて `window.print()`（`src/viewer/print.ts`）。注釈・フォーム値・/Rotate を反映し、CSP は変えない。文字は画像として印刷される。ページ番号はツールバーの入力欄（全角数字可、範囲外は端に寄せる）
- ゲートダイアログ、モード表示、選択制御（§5）
- 矩形選択 → 移動 / 削除（S6 の成果を製品化）
- テキスト置換 A → B → C の順に実装。フォント状況の事前判定 UI
- 別名保存の強制

### Phase 4 — 公開・運用
- README / ランディング（「なぜ注釈として保存するのか」の言語化）
- GitHub 公開（MIT）、Cloudflare Workers で配信（`wrangler.jsonc`）
- 社内配布用ビルド（マーケティングなし・静的ファイル一式）
- Issue テンプレート、貢献ガイド

### Phase 5 — Chrome 拡張（2026-09-22 着手。ストア非公開、ビルド済みの `dist-ext/` をリポジトリに同梱）
Web 版と同じ `src/` を `vite build --mode extension` で `dist-ext/` に出し、`extension/manifest.json`（MV3）と `extension/background.ts` を足したもの。Chrome の内蔵 PDF ビューワを無効化する API は無いので、開かれた PDF を `index.html#src=<元 URL>` に付け替える:
1. `.pdf` で終わる http(s) → declarativeNetRequest の動的ルールで要求ごとリダイレクト（内蔵ビューワは起動しない。サーバーに届く要求はビューワからの 1 回だけ）
2. URL から分からないもの → `webRequest.onHeadersReceived` で Content-Type を見て `tabs.update`
3. `file://` → `webNavigation.onBeforeNavigate` で `tabs.update`（拡張の「ファイルの URL へのアクセスを許可する」が必要）

ビューワ側（`src/app/useOpenFromUrl.ts`）は元 URL を fetch し、先頭 1KB に `%PDF-` があれば開く。開けたら `#src=` を URL から外し、再読み込みで作業中の内容を取り直さない。拡張の CSP は MV3 の制約で `worker-src` に `blob:` を書けないため Web 版と差がある（Worker は使っていない）。`connect-src` は `* file:` — CSP の `*` は http(s)/ws(s) にしか一致せず `file:` を明示しないとローカル PDF の fetch が「Failed to fetch」になる（2026-09-22 に実機で判明）。自動転送はアイコンの右クリックメニューで OFF にできる（`storage.local`）。
E2E は `tests/e2e/extension.spec.ts`（Playwright の永続コンテキストに `--load-extension`）。未パッケージの拡張は「ファイルの URL へのアクセス」が既定で許可されるので `file://` の経路もここで通る。
ストア公開は当面しない（`<all_urls>` + `webRequest` の権限が「どこにも送らない」という売りと相性が悪い。出すなら乗っ取りなし版を別途）。

---

## 7. 主要リスクと対策

| リスク | 影響 | 対策 |
|---|---|---|
| 日本語 FreeText の外観生成が想定より困難 | v1 の核が揺らぐ | S2 で早期判定。代替 (a)(b) を用意 |
| `FPDFPage_GenerateContent` が注釈編集でも本文を書き換える | P2 違反、タグ消失 | S4 で検証し、呼ばない経路を確保 |
| フォントサイズで文書が肥大 | 1 注釈で数 MB | 文書単位でサブセット共有（S5） |
| Word 由来 PDF でテキストが細切れ | 本文編集の UX 崩壊 | 矩形選択でまとめて扱う。単体クリック移動は提供しない |
| Firefox / Safari で上書き保存不可 | UX 差 | 仕様として明記。常に別名保存 |
| フォントの埋め込み許諾 | 法的 | OFL フォントのみ同梱。ユーザー PC のフォントはオプトイン（設定 + ブラウザの許可）で読み、OS/2 fsType が埋め込み禁止のものは使わない |
| WASM 4.6MB の初回ロード | 体感速度 | Service Worker でキャッシュ、Brotli 配信、ローディング表示 |

---

## 8. ディレクトリ構成（予定）

```
pdfugu/
├─ docs/
│  ├─ PLAN.md          ← 本書
│  └─ INTEROP.md       ← ビューア互換性の確認手順と結果
├─ public/
│  ├─ fonts/           ← 同梱フォント（OFL、ライセンスファイル同梱）
│  └─ _headers         ← CSP / COOP / COEP / Cache-Control
├─ src/
│  ├─ app/             ← ルート・レイアウト・設定・最近使ったファイル・ページ操作
│  ├─ viewer/          ← EmbedPDF 統合（表示・サムネイル・フォーム強調）
│  ├─ annotations/     ← 注釈ツール UI と外観生成（text-ja / stamps）
│  ├─ stamp-editor/    ← スタンプ作成画面（#/stamps）
│  ├─ content-edit/    ← 本文編集モード
│  ├─ pdf/             ← 生 PDFium 操作（inspector / export / fonts / appearance / pages）
│  └─ shared/          ← 型・ユーティリティ（日付書式・IndexedDB）
├─ extension/          ← Chrome 拡張（manifest.json / background.ts。`pnpm build:ext` → dist-ext/）
├─ tests/e2e/          ← Playwright（保存した PDF の構造検証を含む）
├─ samples/            ← 検証用 PDF（make_samples.py で生成: 和文フォーム・署名付き・暗号化・非埋め込みフォント など）
└─ scripts/            ← release.py（git-cliff によるバージョン管理）
```

---

## 9. 検証方法

- **構造検証（自動）**: 保存した PDF を PDFium で再読込し、注釈数・種別・`/AP` の有無・`/F` フラグを assert。増分保存は元バイト列の前方一致を assert
- **互換性（手動、INTEROP.md）**: Acrobat Reader / Chrome / Edge / Firefox / macOS プレビューで開き、表示・印刷プレビュー・注釈の選択可否を確認
- **通信ゼロ（自動）**: Playwright でネットワークリクエストを記録し、`self` 以外が 0 件であることを assert
- **サンプル文書**: `samples/make_samples.py` で生成（和文フォーム、AcroForm、署名付き、暗号化、非埋め込みフォント、複数ページ、巨大 FontBBox のフォント）

---

## 10. 未決事項

- [ ] **FreeText 経路の再評価**（2026-09-20 決定）: v1 のテキスト注釈は Stamp 方式で確定。`@embedpdf/pdfium` の次リリースで `src/pdf/spikes/text-annot-ja.ts` の FreeText 経路を再検証し、日本語が通れば「テキスト」ツールの FreeText 化（Acrobat / Edge で文字として再編集可能）を検討する。他ツール製 FreeText の書き換えは `/RC` 互換が必要なため当面やらない

- [ ] 本文編集モードで DocMDP 1〜2 の署名文書を「警告」にするか「禁止」にするか（現状は禁止）
- [ ] 縦書きテキスト注釈を入れるか（`/Rotate` と縦組みは別問題）
- [x] UI 上の名称は「テキスト」のまま（内部は Stamp。利用者にとっての意味は同じ）
- [x] 同梱フォントは BIZ UD 2 書体 + 3 書体（すべて OFL）。ゴシック以外は選ばれたときに取得
- [x] プロジェクト名 → **pdfugu**（2026-09-26）
