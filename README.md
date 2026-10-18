# nuet-ecosystem

NUET Math Studio is a standalone study tracker. Open `index.html` in a browser,
or serve this directory with Python:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

No application dependencies or build step are required.

## Study time

On **Overview**, expand **Log study time** below the weekly activity chart.
Enter a date, hours/minutes and an optional note for theory, critical thinking,
vocabulary or revision. These entries count toward the chart, weekly goal,
study streak and analytics. Practice and mock-test time already count automatically;
log only additional study to avoid counting the same time twice.

## Resources and worked solutions

Open **Resources** to upload PDFs, images, notes and other study files. In **Mock
tests**, attach PDFs or images of your complete working to a new or existing
result. A file-only result can be saved without a score; add the score later.
Unscored results contribute their study time but are excluded from score averages.

Open saved PDFs and images in the file viewer, or download the original.
The PDF reader supports previous/next pages, jumping to a page, and zoom.
It uses a locally bundled PDF.js reader, so your documents are never sent to a
third-party viewer. Use the hosted website or the HTTP server above for the reader.
Other file types are available as downloads. The limits are **25 MB per file**
and **100 MB per upload**.

Progress and files stay in the current browser on the current device. Original
files are stored in IndexedDB, so large PDFs do not fill the small localStorage
area used for progress. This static site does not upload private files to GitHub
or sync them across devices.

**Settings & backup → Export** includes study time and the original uploaded files
in the JSON backup. Import that backup to restore everything on another device.
Large files make backups larger. Older backups still work and restore with empty
study-time and upload collections. Deleting a mock removes its attached files;
resetting the tracker clears uploaded files too.

## Checks

With the local HTTP server running, use the cloud environment's Playwright and
Chromium installations to run the browser checks:

```sh
node tests/study-files.cjs
node tests/vocabulary.cjs
```

