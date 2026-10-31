# DOCX round trip in LibreOffice

The writer of «Analizza documento» (spec `docs/superpowers/specs/2026-10-31-document-hyperlinks-design.md`, L4)
writes a copy of a Word file with links on the citations. The Vitest suite proves the round trip on the XML; this
script proves that the copies open: it converts every copy and its input with LibreOffice headless to HTML and PDF.

```bash
node tools/e2e/docx-roundtrip/run.mjs [folder]   # SOFFICE=/path/to/soffice if it is not on the PATH
```

It fails on a conversion error, on a copy whose HTML does not hold exactly the links the writer reported, on a PDF
without each address, and on a copy whose text differs from its input's. Run by hand and in the browser pass: CI has
no LibreOffice. Word is stricter than LibreOffice (the order of a run's properties, for one): an owner opens the
copies in Word on a Mac once per writer PR and says so in the PR.
