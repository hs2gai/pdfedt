# pdfedt

English | [日本語](README.ja.md)

A tool for editing PDFs locally, entirely inside your browser, and saving the result. It is aimed mainly at people who want to fill in or edit the kinds of PDFs common in Japan (application forms, requests, approval documents and the like) without Acrobat or similar software. It does not try to cover the full PDF specification; the goal is to add annotations and make simple edits while leaving the original document as intact as possible, and to save them.

- No file is ever sent to a server (the CSP blocks external network traffic from the browser)
- Annotations can be saved as an incremental update, without rewriting the original PDF
- Japanese text annotations are displayed with embedded fonts
- Japanese PDFs without embedded fonts are displayed with the bundled fonts

## Usage

1. Choose a PDF with "Open" or drag & drop it onto the window
2. Pick a tool from the toolbar and write
   - Text / Stamp (approval, done, date stamp, name seal, …) / Image / Note / Highlight / Underline / Strikeout / Pen / Rectangle / Ellipse / Line / Arrow
3. Export with "Save ▾"
   - **Save with annotations** … keeps the original PDF intact and appends only the annotations (default). File name: `original_a.pdf`
   - **Save as new file** … generates a new PDF from the current state (deleted annotations leave no trace). `_n.pdf`
   - **Finalize and export** … burns the content in (annotations can no longer be edited). `_f.pdf`

**Content editing mode** (the pencil at the right end of the toolbar): the "Content" tool lets you move, delete and replace the original text, shapes and images. Annotations keep working during the mode (clicking an annotation switches to the select tool, clicking content switches to the "Content" tool). Because it rewrites the original PDF, the result is saved under a new name. It is unavailable for documents whose digital signature forbids changes. Unless the "Use fonts installed on this PC" option (below) is used, replaced text is embedded with the bundled fonts (gothic / mincho).

**Use fonts installed on this PC** (settings): when enabled, and the same typeface as the document (MS Mincho, Yu Gothic, …) is installed, it is used to display documents without embedded fonts and to embed text replaced in content editing. Japanese fonts on the PC (IPA, Yu, BIZ UD, …) can also be chosen for text annotations and stamps. The browser reads the fonts directly from the PC and never sends them anywhere. Fonts whose license forbids embedding are not embedded.

**Page operations** (thumbnails on the left): click to select and press the `Delete` key to remove, drag to reorder, drop a PDF file onto the thumbnails to insert its pages at that position. After changing pages the document is saved as a new file, just like after content editing.

**Password-protected PDFs**: enter the password when opening (the password is never stored or sent). Saved files keep the same password. "Save ▾" → "Save with password…" creates a new PDF that needs a password to open (AES-256; as a new file or finalized). Note that the password features come with no warranty.

Touch: one finger works the tools (select text / annotations, place stamps), **two fingers scroll, pinch to zoom**. Ctrl + mouse wheel also zooms.

Keyboard: `Delete` remove / `Ctrl+Z` undo / `Ctrl+Y` redo / `Esc` back to the select tool / `Ctrl+Enter` confirms while typing text

## Language

The UI can be switched between Japanese (default) and English (settings ⚙ → "Language / 言語"). Strings live in `src/i18n/ja.json` and `src/i18n/en.json`; to add a language, add one JSON file and register it in `LOCALES` in `src/i18n/index.ts`.

## Supported browsers

| Browser | Status |
|---|---|
| Chrome / Edge (latest, desktop) | Supported. Automated tests run on Chromium |
| Firefox / Safari (latest, desktop) | Expected to work, not verified |
| Smartphones and tablets | Touch input is supported (two-finger scroll, pinch), but testing is limited |

Differences outside Chrome / Edge:

- **"Use fonts installed on this PC" is Chrome / Edge (Chromium) only**, because Firefox and Safari do not implement the Local Font Access API. In those browsers the setting is not shown and replacements use the bundled fonts.
- The save dialog (choosing the file name and location) uses the File System Access API, which is Chromium only. Other browsers always save as a download.

## Supported PDFs

- Opens PDF 1.x and PDF 2.0. Password-protected PDFs open after entering the password.
- Forms: AcroForm fields can be filled in. **XFA forms are not supported**.
- Version of the saved file:
  - Save with annotations: appended after the original bytes, so the original version (and any digital signature) is kept.
  - Save as new file / Finalize: the whole file is rewritten and labeled PDF 1.7, even when the original was PDF 2.0.

## Chrome extension

An extension that uses pdfedt instead of Chrome's built-in PDF viewer. When a PDF is opened in the browser (link, address bar, local file), the tab switches to pdfedt. It is not on the Web Store; a prebuilt copy is included in the repository as `dist-ext/`.

1. Get the repository (`git clone` or "Download ZIP" on GitHub, then extract it)
2. Open `chrome://extensions` and turn on "Developer mode" (top right)
3. "Load unpacked" → choose the `dist-ext/` folder
4. To open local PDFs as well (`file://`, including files opened from the download history), make sure "Allow access to file URLs" is on in the extension's details (usually on for unpacked extensions)

The only request the extension makes is for "the PDF URL the user opened"; there is no other traffic, same as the web build. If you do not want automatic switching, right-click the toolbar icon and uncheck "PDF を自動で pdfedt で開く" — pdfedt then opens only from the icon and from the right-click menu on PDF links.

To build it yourself, run the following and load `dist-ext/` the same way. After rebuilding (or updating the repository), press the reload button in `chrome://extensions`.

```bash
pnpm install
pnpm build:ext    # writes the extension to dist-ext/
```

## Development

```bash
pnpm install
pnpm dev          # http://localhost:5173
pnpm build        # static files in dist/
pnpm build:ext    # Chrome extension in dist-ext/ (used by tests/e2e/extension.spec.ts)
pnpm preview      # production-like preview (strict CSP)
pnpm test         # Vitest (unit tests for pure logic)
pnpm test:e2e     # Playwright (runs against the production build)
python samples/make_samples.py   # regenerate the sample PDFs (reportlab / PyMuPDF)
```

## Tech stack

| Role | Choice | License |
|---|---|---|
| PDF engine | [EmbedPDF](https://www.embedpdf.com/) (WebAssembly build of PDFium) | MIT / Apache-2.0 / BSD |
| UI | React + TypeScript + Vite | MIT |
| Japanese fonts | [BIZ UDPGothic / BIZ UDPMincho](https://github.com/googlefonts/morisawa-biz-ud-gothic), Shippori Mincho, Yuji Syuku, Zen Antique | SIL OFL 1.1 |
| Font subsetting | [harfbuzzjs](https://github.com/harfbuzz/harfbuzzjs) | MIT |

## License

MIT — see [LICENSE](LICENSE). The bundled fonts in `public/fonts/` are under the SIL Open Font License 1.1.
