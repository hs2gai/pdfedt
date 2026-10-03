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
for i, line in enumerate(["上記著作物にかかる出版その他の利用等について、", "著作権者を甲とし、出版権者を乙とする。"]):
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
