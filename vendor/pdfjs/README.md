# Bundled PDF reader

PDF.js / pdfjs-dist **6.4.299**, from Mozilla's npm distribution:
https://www.npmjs.com/package/pdfjs-dist/v/6.4.299

The npm tarball was verified against its registry SHA-512 integrity value:

```
sha512-AVl138zALtfaAPvADulE0PZThbYzCBS79nL4pOSL/6Sm/4AH5A21BD9VHt97OlCuzJuCpmeZtAtkinisF4Vb1g==
```

These are unmodified distribution assets: the minified browser library/worker,
character maps, standard fonts, and image-decoder WebAssembly files. Licenses
are retained in this directory and its asset directories. PDF rendering is
loaded on demand and uses the bundled files, without a CDN or document upload.
No npm installation or build is needed to run the website.
