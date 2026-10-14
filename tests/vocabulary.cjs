// Run against the local site: node tests/vocabulary.cjs
// Requires Playwright and Chromium (provided by the cloud environment).
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const baseURL = process.env.TEST_BASE_URL || 'http://127.0.0.1:8000';
const key = 'nuet-math-studio-v1';
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true });
  try {
    const context = await browser.newContext({ acceptDownloads: true, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const stored = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
    const table = () => page.locator('[data-vocab-view="table"]').click();
    const cards = () => page.locator('[data-vocab-view="cards"]').click();
    const add = async (word, definition) => {
      await page.locator('#vocabWord').fill(word);
      await page.locator('#vocabDefinition').fill(definition);
      await page.locator('#vocabularyForm button[type="submit"]').click();
    };
    const importBackup = async (backup, accept = true) => {
      await page.evaluate(() => document.querySelector('#toast').textContent = '');
      if (accept !== null) page.once('dialog', dialog => accept ? dialog.accept() : dialog.dismiss());
      await page.locator('#importFile').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
      await page.waitForFunction(() => document.querySelector('#toast').textContent.startsWith('Backup imported') || document.querySelector('#toast').textContent.startsWith('Import failed'));
    };
    await page.goto(`${baseURL}/#vocabulary`);
    await page.getByRole('heading', { name: 'Vocabulary', exact: true }).waitFor();
    assert.match(await page.locator('#content').innerText(), /Your vocabulary starts here/);
    await add('   ', '    ');
    assert.equal(await page.locator('.vocab-table tbody tr').count(), 0);
    console.log('PASS: empty list and whitespace validation');

    await add('  abundant  ', '  Existing in large quantities.  ');
    assert.equal((await stored()).vocabulary[0].word, 'abundant');
    await page.reload();
    assert.equal(await page.locator('.vocab-table tbody tr').count(), 1);
    assert.match(await page.locator('.vocab-table').innerText(), /Existing in large quantities\./);
    console.log('PASS: add, trim, and persistence after reload');

    await cards();
    assert.equal(await page.locator('.vocab-definition').count(), 0);
    assert.equal(await page.locator('[data-vocab-action="known"]').isDisabled(), true);
    assert.equal(await page.locator('[data-vocab-action="next"]').isDisabled(), true);
    await page.locator('[data-vocab-action="flip"]').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.vocab-definition').innerText(), 'Existing in large quantities.');
    await page.locator('[data-vocab-action="known"]').click();
    assert.equal((await stored()).vocabulary[0].known, true);
    assert.equal(await page.locator('.vocab-definition').count(), 0);
    console.log('PASS: keyboard reveal, single-card controls, and learning progress');

    await table();
    await page.getByRole('button', { name: 'Edit abundant', exact: true }).click();
    await page.locator('#vocabDefinition').fill('More than enough.\nPlentiful.');
    await cards();
    assert.equal(await page.locator('#vocabDefinition').inputValue(), 'More than enough.\nPlentiful.');
    await page.locator('#vocabularyForm button[type="submit"]').click();
    assert.equal((await stored()).vocabulary[0].known, false);
    await table();
    assert.match(await page.locator('.vocab-table').innerText(), /More than enough/);
    await page.getByRole('button', { name: 'Edit abundant', exact: true }).click();
    await page.locator('#vocabWord').fill('Discard this edit');
    await page.getByRole('button', { name: 'Cancel edit' }).click();
    assert.equal((await stored()).vocabulary[0].word, 'abundant');
    console.log('PASS: editing, draft preservation across views, and cancel');

    await add('concise', 'Brief but clear.');
    await add('<img src=x onerror="window.vocabInjected=true">', '<script>window.vocabInjected=true</script>');
    assert.equal(await page.locator('.vocab-table tbody tr').count(), 3);
    assert.equal(await page.locator('.vocab-table img, .vocab-table script').count(), 0);
    assert.equal(await page.evaluate(() => window.vocabInjected), undefined);
    await page.locator('#vocabSearch').fill('BRIEF');
    assert.equal(await page.locator('.vocab-table tbody tr').count(), 1);
    assert.match(await page.locator('.vocab-table').innerText(), /concise/);
    await page.locator('#vocabSearch').fill('not in this word list');
    assert.match(await page.locator('#content').innerText(), /No matching words/);
    await page.locator('#vocabSearch').fill('');
    console.log('PASS: multiple entries, safe text rendering, and definition search');

    await cards();
    const firstWord = await page.locator('.vocab-word').innerText();
    await page.locator('[data-vocab-action="flip"]').click();
    await page.locator('[data-vocab-action="next"]').click();
    assert.notEqual(await page.locator('.vocab-word').innerText(), firstWord);
    assert.equal(await page.locator('.vocab-definition').count(), 0);
    await page.locator('[data-vocab-action="previous"]').click();
    assert.equal(await page.locator('.vocab-word').innerText(), firstWord);
    await page.locator('[data-vocab-action="shuffle"]').click();
    const seen = new Set();
    for (let i = 0; i < 3; i++) {
      seen.add(await page.locator('.vocab-word').innerText());
      await page.locator('[data-vocab-action="next"]').click();
    }
    assert.equal(seen.size, 3);
    assert.deepEqual([...seen].sort(), (await stored()).vocabulary.map(entry => entry.word).sort());
    await page.locator('#vocabFilter').selectOption('learning');
    for (let i = 0; i < 3; i++) {
      await page.locator('[data-vocab-action="flip"]').click();
      await page.locator('[data-vocab-action="known"]').click();
    }
    assert.match(await page.locator('#content').innerText(), /No matching words/);
    await page.locator('#vocabFilter').selectOption('known');
    assert.match(await page.locator('.vocab-card-nav').innerText(), /of 3/);
    console.log('PASS: deck navigation, shuffle coverage, and filtered study completion');

    await page.locator('.nav-btn[data-nav="settings"]').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#exportBtn').click()]);
    const stream = await download.createReadStream(), chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const backup = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(backup.state.vocabulary.length, 3);
    assert.equal(backup.state.vocabulary.every(entry => entry.known), true);
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#resetBtn').click();
    assert.equal((await stored()).vocabulary.length, 0);
    await importBackup(backup);
    assert.deepEqual((await stored()).vocabulary, backup.state.vocabulary);
    const beforeInvalid = await stored();
    await importBackup({ state: { ...backup.state, vocabulary: [{ word: 'broken' }] } }, null);
    assert.deepEqual(await stored(), beforeInvalid);
    console.log('PASS: JSON backup round trip, reset, and invalid import protection');

    await page.locator('#importFile').setInputFiles([]);
    const oldBackup = { state: { topics: { 'M1.1': { status: 'learning' } }, sessions: [], mocks: [], mistakes: [], settings: { weeklyGoal: 300 } } };
    await importBackup(oldBackup);
    assert.equal((await stored()).vocabulary.length, 0);
    assert.equal((await stored()).topics['M1.1'].status, 'learning');
    assert.equal((await stored()).settings.weeklyGoal, 300);
    console.log('PASS: compatibility with backups created before vocabulary');

    const legacyState = { ...oldBackup.state, sessions: [{ id: 'legacy-session', topic: 'M1.1', date: '2026-10-14', attempted: 10, correct: 8, minutes: 20 }] };
    await page.evaluate(({ key, legacyState }) => localStorage.setItem(key, JSON.stringify(legacyState)), { key, legacyState });
    await page.reload();
    await page.locator('.nav-btn[data-nav="vocabulary"]').click();
    await add('migration', 'Keeping existing progress while adding a new feature.');
    assert.deepEqual((await stored()).sessions, legacyState.sessions);
    assert.deepEqual((await stored()).topics, legacyState.topics);
    assert.equal((await stored()).vocabulary[0].word, 'migration');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Delete migration', exact: true }).click();
    console.log('PASS: existing browser progress preserved during storage migration');

    await page.locator('.nav-btn[data-nav="vocabulary"]').click();
    await add('persistent', 'Continuing despite difficulty.');
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: 'Delete persistent', exact: true }).click();
    assert.equal((await stored()).vocabulary.length, 1);
    await page.getByRole('button', { name: 'Edit persistent', exact: true }).click();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Delete persistent', exact: true }).click();
    assert.equal((await stored()).vocabulary.length, 0);
    assert.equal(await page.locator('#vocabWord').inputValue(), '');
    console.log('PASS: confirmed deletion and cleanup of an active edit');

    await add('responsive', 'Adapting to different screen sizes.');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.getElementById('sidebar').getBoundingClientRect().right <= 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.evaluate(() => document.querySelector('.vocab-collection').getBoundingClientRect().top < document.querySelector('.vocab-editor').getBoundingClientRect().top), true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('[data-vocab-action="add"]').click();
    assert.equal(await page.locator('#vocabWord').evaluate(input => input === document.activeElement), true);
    assert.equal(await page.locator('#vocabWord').evaluate(input => input.getBoundingClientRect().top >= 68 && input.getBoundingClientRect().bottom <= innerHeight), true);
    await page.locator('#menuBtn').click();
    assert.equal(await page.locator('#menuBtn').getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('main').evaluate(main => main.inert), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#menuBtn').getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('#menuBtn').evaluate(button => button === document.activeElement), true);
    await page.locator('#menuBtn').click();
    await page.locator('#navBackdrop').click({ position: { x: 350, y: 200 } });
    assert.equal(await page.locator('#navBackdrop').isHidden(), true);
    await page.locator('#menuBtn').click();
    await page.locator('.nav-btn[data-nav="practice"]').click();
    assert.equal(await page.locator('#navBackdrop').isHidden(), true);
    assert.equal(await page.locator('main').evaluate(main => main.inert), false);
    await page.locator('#menuBtn').click();
    await page.locator('.nav-btn[data-nav="vocabulary"]').click();
    console.log('PASS: mobile study-first layout, add shortcut, and accessible navigation dismissal');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: '/tmp/nuet-vocabulary-table-mobile.png', fullPage: true });
    await cards();
    await page.locator('[data-vocab-action="flip"]').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: '/tmp/nuet-vocabulary-cards-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: '/tmp/nuet-vocabulary-cards-desktop.png', fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS: mobile table/cards layout and no uncaught JavaScript errors');
    await context.close();
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
