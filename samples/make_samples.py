"""検証用サンプル PDF の生成（開発用。配布物には含めない）
- sample-ja-form.pdf : 官公庁様式風。BIZ UDゴシックをサブセット埋め込み（Word/一太郎出力の典型）
"""
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.pagesizes import A4

pdfmetrics.registerFont(TTFont("BIZUD", r"C:\Windows\Fonts\BIZ-UDGothicR.ttc", subfontIndex=0))
W, H = A4

c = canvas.Canvas("samples/sample-ja-form.pdf", pagesize=A4)
c.setTitle("交付申請書（サンプル）")
for page in range(2):
    c.setFont("BIZUD", 16)
    c.drawCentredString(W / 2, H - 60, "交付申請書" if page == 0 else "添付書類一覧")
    c.setFont("BIZUD", 10)
    c.drawRightString(W - 50, H - 90, "令和　年　月　日")
    c.drawString(50, H - 120, "○○市長　殿")
    y = H - 170
    for label in ["氏名", "住所", "電話番号", "申請理由"]:
        c.rect(50, y - 30, W - 100, 30)
        c.drawString(58, y - 20, label)
        c.line(150, y - 30, 150, y)
        y -= 30
    c.drawString(50, y - 30, "上記のとおり申請します。")
    c.setFont("BIZUD", 8)
    c.drawString(50, 40, f"様式第1号（第2条関係）　{page + 1}/2")
    c.showPage()
c.save()
print("ok")


# ---- sample-form.pdf: AcroForm 付き（入力欄あり） ----
import fitz  # PyMuPDF（開発用）

doc = fitz.open("samples/sample-ja-form.pdf")
page = doc[0]
for i, name in enumerate(["name", "address", "phone", "reason"]):
    w = fitz.Widget()
    w.field_name = name
    w.field_type = fitz.PDF_WIDGET_TYPE_TEXT
    w.rect = fitz.Rect(155, 171.9 + i * 30, 540, 199.9 + i * 30)
    w.text_fontsize = 11
    page.add_widget(w)
doc.save("samples/sample-form.pdf", garbage=0)
doc.close()

# ---- sample-signed.pdf: DocMDP=3（注釈可）の署名フィールドを持つ文書 ----
# 暗号学的に有効な署名ではなく、構造の検出（署名数・DocMDP レベル）を試すためのもの
doc = fitz.open("samples/sample-ja-form.pdf")
page = doc[0]
sig_xref = doc.get_new_xref()
doc.update_object(sig_xref, (
    "<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached "
    "/ByteRange [0 0 0 0] /Contents <00> /M (D:20260920120000+09'00') "
    "/Reference [ << /Type /SigRef /TransformMethod /DocMDP "
    "/TransformParams << /Type /TransformParams /P 3 /V /1.2 >> >> ] >>"
))
widget_xref = doc.get_new_xref()
doc.update_object(widget_xref, (
    f"<< /Type /Annot /Subtype /Widget /FT /Sig /T (Signature1) /F 132 "
    f"/Rect [400 40 560 80] /P {page.xref} 0 R /V {sig_xref} 0 R >>"
))
# ページの /Annots と AcroForm を結線
annots = doc.xref_get_key(page.xref, "Annots")
doc.xref_set_key(page.xref, "Annots", f"[{widget_xref} 0 R]")
cat = doc.pdf_catalog()
doc.xref_set_key(cat, "AcroForm", f"<< /Fields [{widget_xref} 0 R] /SigFlags 3 >>")
doc.xref_set_key(cat, "Perms", f"<< /DocMDP {sig_xref} 0 R >>")
doc.save("samples/sample-signed.pdf", garbage=0)
doc.close()
print("ok (form, signed)")


# ---- sample-noembed.pdf: 和文フォント非埋め込み（古い和文 PDF・プレビュー製注釈の典型） ----
from reportlab.pdfbase.cidfonts import UnicodeCIDFont

pdfmetrics.registerFont(UnicodeCIDFont("HeiseiMin-W3"))
c = canvas.Canvas("samples/sample-noembed.pdf", pagesize=A4)
c.setFont("HeiseiMin-W3", 18)
c.drawString(60, H - 80, "フォント非埋め込みの和文テキスト")
c.setFont("HeiseiMin-W3", 11)
c.drawString(60, H - 110, "このページの文字は Adobe-Japan1 の CID フォント（HeiseiMin-W3）を参照だけしています。")
c.save()
print("ok (noembed)")


# ---- sample-msmincho.pdf: MS 明朝を非埋め込みで参照（Distiller 時代の官公庁 PDF の典型。ローカルフォント照合の確認用） ----
c = canvas.Canvas("samples/sample-msmincho.pdf", pagesize=A4)
c.setFont("HeiseiMin-W3", 18)
c.drawString(60, H - 80, "見本の文書（明朝）")
c.setFont("HeiseiMin-W3", 11)
c.drawString(60, H - 110, "この行は表示確認のための見本です。")
c.save()
doc = fitz.open("samples/sample-msmincho.pdf")
for xref in range(1, doc.xref_length()):
    obj = doc.xref_object(xref, compressed=False)
    if "/HeiseiMin-W3" in obj:
        doc.update_object(xref, obj.replace("/HeiseiMin-W3", "/MS-Mincho"))
doc.save("samples/_tmp.pdf")  # 同名への上書き保存はできないので一時ファイル経由
doc.close()
import os
os.replace("samples/_tmp.pdf", "samples/sample-msmincho.pdf")
print("ok (msmincho)")


# ---- sample-mixed-lines.pdf: 和文フォントで組んだ欧文が混じる 2 行（字形の箱が行をまたぐ現象の確認用） ----
c = canvas.Canvas("samples/sample-mixed-lines.pdf", pagesize=A4)
c.setFont("BIZUD", 10)
c.drawString(60, H - 100, "この見本は、Web ブラウザの中だけで注釈を付ける仕組みを確かめるための文書です。")
c.drawString(60, H - 112, "同じ行に Latin の単語と和文が混ざると、字形の箱の高さが行をまたぐことがあります。")
c.drawString(60, H - 124, "この文書はハイライトや下線の動作確認にだけ使います。内容に意味はありません。")
c.save()
# 原ノ味ゴシック（LaTeX / Asciidoctor 製 PDF で多い）と同じ巨大な FontBBox にする。
# PDFium のゆるい文字ボックスはこれを元に作られ、10pt の文字に 28pt の箱が付いて隣の行と重なる
doc = fitz.open("samples/sample-mixed-lines.pdf")
for xref in range(1, doc.xref_length()):
    if "/FontDescriptor" in doc.xref_object(xref, compressed=False) and doc.xref_get_key(xref, "FontBBox")[0] != "null":
        doc.xref_set_key(xref, "FontBBox", "[-1002 -1048 2928 1808]")
doc.save("samples/_tmp.pdf")
doc.close()
os.replace("samples/_tmp.pdf", "samples/sample-mixed-lines.pdf")
print("ok (mixed-lines)")


# ---- sample-scaled-tf.pdf: 「1 Tf」＋テキスト行列で 12pt にする組み方（Word + Acrobat PDFMaker 製 PDF の典型） ----
# PDFium のゆるい文字ボックスは Tf の値だけで高さを決めるので、12pt の文字に 1pt の箱が付く
c = canvas.Canvas("samples/sample-scaled-tf.pdf", pagesize=A4)
for i, line in enumerate(["この行は、文字の箱の高さを確かめるための見本です。", "二行目は、一行目と重ならないことを確かめます。"]):
    t = c.beginText()
    t.setFont("BIZUD", 1)
    t.setTextTransform(12, 0, 0, 12, 60, H - 100 - i * 18)
    t.textOut(line)
    c.drawText(t)
c.save()
print("ok (scaled-tf)")


# ---- sample-watermark.pdf: /Artifact でマークした斜めの透かし（Word の透かしの残骸の再現。本文編集モードの背景扱いの確認用） ----
c = canvas.Canvas("samples/sample-watermark.pdf", pagesize=A4)
c.setFont("BIZUD", 12)
c.drawString(60, H - 100, "透かしの上にある本文です。")
c._code.append("/Artifact <</Type /Pagination /Subtype /Watermark>> BDC")  # reportlab に marked content の API はない
c.setStrokeGray(0.95)
c.setLineWidth(20)
c.line(100, 200, 500, 700)
c._code.append("EMC")
c.save()
print("ok (watermark)")


# ---- sample-pages.pdf: 3 ページ（ページ操作の確認用。各ページに識別用の文字） ----
c = canvas.Canvas("samples/sample-pages.pdf", pagesize=A4)
for label in ["ページA", "ページB", "ページC"]:
    c.setFont("BIZUD", 36)
    c.drawString(80, H - 120, label)
    c.showPage()
c.save()
print("ok (pages)")


# ---- sample-encrypted.pdf: パスワード付き（開くパスワード 1234、注釈は許可） ----
doc = fitz.open("samples/sample-ja-form.pdf")
doc.save(
    "samples/sample-encrypted.pdf",
    encryption=fitz.PDF_ENCRYPT_AES_256,
    user_pw="1234",
    owner_pw="owner-secret",
    permissions=fitz.PDF_PERM_PRINT | fitz.PDF_PERM_ANNOTATE | fitz.PDF_PERM_COPY | fitz.PDF_PERM_FORM,
)
doc.close()
print("ok (encrypted)")


# ---- sample-vertical.pdf: 縦書き（Type0 / Identity-V = WMode 1。書籍・縦書き様式の典型） ----
# 同梱の BIZ UDPゴシック（OFL）をサブセット埋め込み。正立の字は GSUB vert の縦書き用の字形を使う。
# 列 1 は「1 Tf」＋テキスト行列で 12pt（InDesign 製の書籍 PDF の組み方）、列 2・3 は「12 Tf」。最後に横書き（Identity-H）の行を 1 つ置く。
# 座標（左上原点、pt）: 列の中心 x = 500 / 480 / 460、列の上端 y = 100。横書きの行はベースライン y = 400、x = 60 から
# 列 4（中心 x = 440）は縦中横: 「第」の下に半角の「12」を横に並べ（Identity-H、y 112–124）、その下に「回です」
from fontTools.ttLib import TTFont as FTFont
from fontTools import subset as ftsubset

V_COLUMNS = ["縦書きの見本です。「テスト」用ー", "二列目の文章を、ここに置きます", "三列目（予備）の行", "第", "回です"]
V_LINE = "横書きの行です"
TCY = "12"
full = FTFont("public/fonts/BIZUDPGothic-Regular.ttf")
cmap = full.getBestCmap()
vert = {}
for fr in full["GSUB"].table.FeatureList.FeatureRecord:
    if fr.FeatureTag == "vert":
        for li in fr.Feature.LookupListIndex:
            for st in full["GSUB"].table.LookupList.Lookup[li].SubTable:
                vert.update(getattr(st, "mapping", {}) or {})
# 縦は vert の字形（無ければそのまま）、横は cmap の字形。glyph 名 → 元の文字（ToUnicode 用）
v_names = [[vert.get(cmap[ord(ch)], cmap[ord(ch)]) for ch in col] for col in V_COLUMNS]
h_names = [cmap[ord(ch)] for ch in V_LINE]
tcy_names = [cmap[ord(ch)] for ch in TCY]
to_unicode = {}
for names, text in [*zip(v_names, V_COLUMNS), (h_names, V_LINE), (tcy_names, TCY)]:
    for n, ch in zip(names, text):
        to_unicode[n] = ch
opts = ftsubset.Options()
opts.notdef_outline = True
opts.layout_features = []
sub = ftsubset.Subsetter(opts)
sub.populate(glyphs=sorted(to_unicode))
font = FTFont("public/fonts/BIZUDPGothic-Regular.ttf")
sub.subset(font)
buf = __import__("io").BytesIO()
font.save(buf)
font_bytes = buf.getvalue()
# The subset keeps the original glyph order (.notdef first), so the new GID is the rank of the old one
kept = sorted({0, *(full.getGlyphID(n) for n in to_unicode)})
gid = {n: kept.index(full.getGlyphID(n)) for n in to_unicode}
upm = full["head"].unitsPerEm
hexs = lambda names: "".join(f"{gid[n]:04X}" for n in names)

doc = fitz.open()
page = doc.new_page(width=595, height=842)
ff = doc.get_new_xref()
doc.update_object(ff, "<<>>")
doc.update_stream(ff, font_bytes)
doc.xref_set_key(ff, "Length1", str(len(font_bytes)))
fd = doc.get_new_xref()
head = full["head"]
doc.update_object(
    fd,
    f"<</Type/FontDescriptor/FontName/AAAAAA+BIZUDPGothic-Regular/Flags 4"
    f"/FontBBox[{head.xMin * 1000 // upm} {head.yMin * 1000 // upm} {head.xMax * 1000 // upm} {head.yMax * 1000 // upm}]"
    f"/ItalicAngle 0/Ascent 880/Descent -120/CapHeight 700/StemV 80/FontFile2 {ff} 0 R>>",
)
widths = " ".join(f"{gid[n]}[{full['hmtx'][n][0] * 1000 // upm}]" for n in sorted(to_unicode, key=lambda n: gid[n]))
cid = doc.get_new_xref()
doc.update_object(
    cid,
    f"<</Type/Font/Subtype/CIDFontType2/BaseFont/AAAAAA+BIZUDPGothic-Regular"
    f"/CIDSystemInfo<</Registry(Adobe)/Ordering(Identity)/Supplement 0>>/FontDescriptor {fd} 0 R"
    f"/CIDToGIDMap/Identity/DW 1000/W[{widths}]>>",
)
bfchars = "\n".join(f"<{gid[n]:04X}> <{ord(ch):04X}>" for n, ch in sorted(to_unicode.items(), key=lambda kv: gid[kv[0]]))
cmap_src = (
    "/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n"
    "/CIDSystemInfo <</Registry (Adobe) /Ordering (UCS) /Supplement 0>> def\n"
    "/CMapName /Adobe-Identity-UCS def /CMapType 2 def\n"
    "1 begincodespacerange <0000> <FFFF> endcodespacerange\n"
    f"{len(to_unicode)} beginbfchar\n{bfchars}\nendbfchar\n"
    "endcmap CMapName currentdict /CMap defineresource pop end end"
)
tu = doc.get_new_xref()
doc.update_object(tu, "<<>>")
doc.update_stream(tu, cmap_src.encode())
fonts = {}
for name, enc in [("FV", "Identity-V"), ("FH", "Identity-H")]:
    x = doc.get_new_xref()
    doc.update_object(
        x,
        f"<</Type/Font/Subtype/Type0/BaseFont/AAAAAA+BIZUDPGothic-Regular/Encoding/{enc}"
        f"/DescendantFonts[{cid} 0 R]/ToUnicode {tu} 0 R>>",
    )
    fonts[name] = x
PH = 842
ops = [
    f"BT /FV 1 Tf 12 0 0 12 500 {PH - 100} Tm <{hexs(v_names[0])}> Tj ET",
    f"BT /FV 12 Tf 1 0 0 1 480 {PH - 100} Tm <{hexs(v_names[1])}> Tj ET",
    f"BT /FV 12 Tf 1 0 0 1 460 {PH - 100} Tm <{hexs(v_names[2])}> Tj ET",
    f"BT /FH 12 Tf 1 0 0 1 60 {PH - 400} Tm <{hexs(h_names)}> Tj ET",
    f"BT /FV 12 Tf 1 0 0 1 440 {PH - 100} Tm <{hexs(v_names[3])}> Tj ET",
    # Squeezed to 75% (Tz) to fit the column and centered in it, its em box on y 112–124 (baseline 0.88 em below the top)
    f"BT /FH 12 Tf 75 Tz 1 0 0 1 {440 - sum(full['hmtx'][n][0] for n in tcy_names) * 12 * 0.75 / upm / 2:.3f} {PH - 112 - 12 * 0.88:.3f} Tm <{hexs(tcy_names)}> Tj ET",
    f"BT /FV 12 Tf 1 0 0 1 440 {PH - 124} Tm <{hexs(v_names[4])}> Tj ET",
]
contents = doc.get_new_xref()
doc.update_object(contents, "<<>>")
doc.update_stream(contents, "\n".join(ops).encode())
doc.update_object(
    page.xref,
    f"<</Type/Page/Parent {doc.xref_get_key(page.xref, 'Parent')[1]}/MediaBox[0 0 595 {PH}]"
    f"/Resources<</Font<</FV {fonts['FV']} 0 R/FH {fonts['FH']} 0 R>>>>/Contents {contents} 0 R>>",
)
doc.save("samples/sample-vertical.pdf", garbage=1, deflate=True)
doc.close()
print("ok (vertical)")


# ---- sample-form-xobject.pdf: ページ全体を入れ子の Form XObject で包んだ文書（書籍 PDF・面付け・PDF の貼り込みの典型） ----
# sample-vertical.pdf の 1 ページ目を 2 ページに貼り込む。PyMuPDF の show_pdf_page は「ページを包む Form」の中に
# 「元のページの Form」を入れる 2 段の入れ子にし、2 ページ目も同じ Form を共有する（片方の編集が他方に及ばないことの確認用）
src = fitz.open("samples/sample-vertical.pdf")
doc = fitz.open()
for _ in range(2):
    doc.new_page(width=595, height=PH).show_pdf_page(fitz.Rect(0, 0, 595, PH), src, 0)
doc.save("samples/sample-form-xobject.pdf", garbage=1, deflate=True)
doc.close()
src.close()
print("ok (form xobject)")


# ---- sample-vertical-r2l.pdf: 右綴じ（/ViewerPreferences /Direction /R2L）の縦書き（和書の典型） ----
# sample-vertical.pdf に、かぎ括弧で始まって終わる列（中心 x = 420、上端 y = 100）を足し、カタログに右綴じを付ける。
# PDFium の文字の取り出しは R2L を双方向テキストの基準方向にするため、列の両端の括弧が入れ替わって反転する（「テスト「 になる）
R2L_COLUMN = "「テスト」"
doc = fitz.open("samples/sample-vertical.pdf")
page = doc[0]
extra = doc.get_new_xref()
doc.update_object(extra, "<<>>")
r2l_names = [vert.get(cmap[ord(ch)], cmap[ord(ch)]) for ch in R2L_COLUMN]
doc.update_stream(extra, f"BT /FV 12 Tf 1 0 0 1 420 {PH - 100} Tm <{hexs(r2l_names)}> Tj ET".encode())
doc.xref_set_key(page.xref, "Contents", f"[{page.get_contents()[0]} 0 R {extra} 0 R]")
doc.xref_set_key(doc.pdf_catalog(), "ViewerPreferences", "<</Direction/R2L>>")
doc.save("samples/sample-vertical-r2l.pdf", garbage=1, deflate=True)
doc.close()
print("ok (vertical r2l)")
