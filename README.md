# nuet-ecosystem

NUET Math Studio is a standalone study tracker. Open `index.html` in a browser,
or serve this directory with Python:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

No application dependencies or build step are required.

## Vocabulary

Open **Vocabulary** in the sidebar to add words or phrases and their definitions.
Use **Table** to review, search, edit, delete, or mark words as known. Use **Cards**
to recall a definition before revealing it, then select **Still learning** or
**I know this**. Cards support previous/next navigation and shuffle; search and
the learning/known filter apply to both views.

On phones, the study area appears first. The **Add word** shortcut takes you
straight to the entry form, and table entries adapt to readable stacked rows.

Words and learning status save in this browser's local storage. Export them with
your other progress under **Settings & backup**. Importing an older backup without
vocabulary restores the original progress with an empty word list.

## Browser regression check

With the HTTP server running, execute:

```sh
node tests/vocabulary.cjs
```

This check requires Playwright and Chromium, both provided by the cloud environment.
It uses an isolated browser context to verify word management, study controls,
storage migration, backups, and mobile layouts without changing your browser data.
