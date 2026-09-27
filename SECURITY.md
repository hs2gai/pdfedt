# Security Policy

## Supported versions

Only the latest release (the version running at https://pdfedt.hs2g.com and the latest tag in this repository) receives security fixes.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately via GitHub: **[Report a vulnerability](https://github.com/hs2gai/pdfedt/security/advisories/new)**
(the "Security" tab of this repository → "Report a vulnerability").

Please include:

- what is affected (web app / Chrome extension, browser and version)
- steps to reproduce, and a sample PDF if one is needed (strip any personal data from it)
- the impact you expect

This is a small project maintained in spare time, so responses may take a while and no response time is guaranteed. Progress will be shared in the advisory, and I am happy to credit you there unless you prefer otherwise.

## Scope

pdfedt processes PDFs entirely in the browser and never sends them anywhere. Issues that break this are especially important, for example:

- a crafted PDF that runs script in the page (XSS) or bypasses the Content Security Policy
- the app or the Chrome extension sending document data, or any request, to a third-party origin
- the Chrome extension exposing its pages or permissions to other sites

Out of scope: problems that require a compromised browser or device, and reports from automated scanners without a demonstrated impact.

---

## 日本語

脆弱性は公開の Issue ではなく、上記の **[Report a vulnerability](https://github.com/hs2gai/pdfedt/security/advisories/new)**（リポジトリの Security タブ）から非公開でご報告ください。日本語で構いません。個人で空き時間に運営しているため、お返事までお時間をいただくことがあります。
