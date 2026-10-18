// Start the site, then run: node tests/study-files.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const baseURL = process.env.TEST_BASE_URL || 'http://127.0.0.1:8000';
const key = 'nuet-math-studio-v1';
const pdf = fs.readFileSync(path.join(__dirname, '../resources/NUET 2026 Math Specification.pdf'));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jYxoAAAAASUVORK5CYII=', 'base64');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function downloadBytes(download) {
  const stream = await download.createReadStream(), chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium' });
  try {
    const context = await browser.newContext({ acceptDownloads: true, reducedMotion: 'reduce', timezoneId: 'Asia/Qyzylorda' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const stored = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
    const navigate = view => page.locator(`.nav-btn[data-nav="${view}"]`).click();
    const waitIdle = () => page.waitForFunction(() => !fileOperationBusy);
    const dbCount = () => page.evaluate(async () => {
      const db = await openFileDatabase();
      return new Promise((resolve, reject) => {
        const request = db.transaction('files').objectStore('files').count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = reject;
      });
    });
    const addStudy = async (hours, minutes, date) => {
      if (!await page.locator('#studyLogDetails').getAttribute('open').then(value => value !== null)) await page.locator('#studyLogDetails summary').click();
      await page.locator('#studyHours').fill(String(hours));
      await page.locator('#studyMinutes').fill(String(minutes));
      if (date) await page.locator('#studyDate').fill(date);
      await page.locator('#studyNote').fill('Reviewing geometry <img src=x onerror="window.injected=true">');
      await page.locator('#studyTimeForm button[type="submit"]').click();
    };
    const upload = async files => {
      await page.locator('#resourceFiles').setInputFiles(files);
      await page.locator('#resourceUploadForm button[type="submit"]').click();
      await waitIdle();
    };
    const importBackup = async (backup, accept = true) => {
      await page.evaluate(() => document.getElementById('toast').textContent = '');
      if (accept !== null) page.once('dialog', dialog => accept ? dialog.accept() : dialog.dismiss());
      await page.locator('#importFile').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
      await waitIdle();
      await page.waitForFunction(() => /Backup imported|Import failed/.test(document.getElementById('toast').textContent) || !fileOperationBusy);
    };
    await page.goto(baseURL);
    const dates = await page.evaluate(() => [0, 1, 8].map(offset => {
      const date = new Date(); date.setDate(date.getDate() - offset);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    }));
    await addStudy(0, 0);
    assert.equal((await stored())?.studySessions?.length || 0, 0);
    await addStudy(1, 15, dates[0]);
    assert.equal((await stored()).studySessions[0].minutes, 75);
    assert.equal(await page.locator('.bar[data-tip="75 min"]').count(), 1);
    await addStudy(0, 30, dates[1]);
    await addStudy(0, 20, dates[2]);
    assert.match(await page.locator('#content').innerText(), /105 \/ 180 min/);
    assert.equal(await page.locator('.study-history img').count(), 0);
    await page.reload();
    assert.match(await page.locator('#content').innerText(), /105 \/ 180 min/);
    assert.match(await page.locator('.stat').nth(3).innerText(), /2\s+days/);
    console.log('PASS: manual durations, weekly window, streak, persistence, and safe notes');

    await navigate('practice');
    await page.locator('#practiceForm button[type="submit"]').click();
    await navigate('mocks');
    await page.locator('#mockScore').fill('21');
    await page.locator('#mockForm button[type="submit"]').click();
    await waitIdle();
    await navigate('overview');
    assert.match(await page.locator('#content').innerText(), /185 \/ 180 min/);
    await navigate('analytics');
    assert.match(await page.locator('.stat').nth(3).innerText(), /185/);
    assert.equal((await stored()).sessions.length, 1);
    console.log('PASS: study, practice, and mock minutes combine without duplicate records');

    await navigate('resources');
    for (const href of await page.locator('a[href^="resources/"]').evaluateAll(links => links.map(link => link.getAttribute('href')))) {
      assert.equal((await context.request.get(`${baseURL}/${href}`)).status(), 200);
    }
    await upload([{ name: 'My geometry.pdf', mimeType: 'application/pdf', buffer: pdf }, { name: 'notes.html', mimeType: 'text/html', buffer: Buffer.from('<script>window.fileInjected=true</script>') }]);
    assert.equal((await stored()).uploads.length, 2);
    assert.equal(await dbCount(), 2);
    await page.reload();
    await page.locator('[data-open-upload]').first().click();
    assert.equal(await page.locator('#filePreview iframe').count(), 0);
    assert.equal(await page.locator('#openUploadTab').isHidden(), true);
    assert.equal(await page.evaluate(() => window.fileInjected), undefined);
    await page.locator('#closeFileViewer').click();
    const geometryButton = page.locator('.uploaded-resource').filter({ hasText: 'My geometry.pdf' }).locator('[data-open-upload]');
    await geometryButton.click();
    await page.locator('#pdfCanvas[data-rendered="true"]').waitFor();
    const pagePixels = await page.locator('#pdfCanvas').evaluate(canvas => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let ink = 0, paper = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] < 100 && pixels[i + 1] < 100 && pixels[i + 2] < 100) ink++;
        if (pixels[i] > 240 && pixels[i + 1] > 240 && pixels[i + 2] > 240) paper++;
      }
      return { ink, paper };
    });
    assert.equal(pagePixels.ink > 100 && pagePixels.paper > 1000, true);
    await page.locator('[data-pdf-action="next"]').click();
    await page.waitForFunction(() => document.getElementById('pdfCanvas').dataset.rendered === 'true' && document.getElementById('pdfStatus').textContent.startsWith('Page 2 of'));
    const initialWidth = await page.locator('#pdfCanvas').evaluate(canvas => canvas.style.width);
    await page.locator('#pdfZoom').selectOption('1.5');
    await page.locator('#pdfCanvas[data-rendered="true"]').waitFor();
    assert.equal(await page.locator('#pdfCanvas').evaluate((canvas, initial) => parseFloat(canvas.style.width) > parseFloat(initial), initialWidth), true);
    await page.locator('[data-pdf-action="previous"]').click();
    await page.waitForFunction(() => document.getElementById('pdfCanvas').dataset.rendered === 'true' && document.getElementById('pdfStatus').textContent.startsWith('Page 1 of'));
    await page.locator('#pdfPageNumber').fill('2');
    await page.locator('#pdfPageNumber').press('Enter');
    await page.waitForFunction(() => document.getElementById('pdfCanvas').dataset.rendered === 'true' && document.getElementById('pdfStatus').textContent.startsWith('Page 2 of'));
    const [original] = await Promise.all([page.waitForEvent('download'), page.locator('#downloadUpload').click()]);
    assert.equal(digest(await downloadBytes(original)), digest(pdf));
    await page.keyboard.press('Escape');
    console.log('PASS: built-in resources, persistent uploads, actual PDF page rendering/navigation/zoom, safe preview, and exact download');

    const beforeInvalid = (await stored()).uploads.length;
    await upload({ name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') });
    assert.equal((await stored()).uploads.length, beforeInvalid);
    await upload({ name: 'too-large.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(26 * 1024 * 1024) });
    assert.equal((await stored()).uploads.length, beforeInvalid);
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function(name, value) { if (window.blockProgress && name === 'nuet-math-studio-v1') throw new DOMException('Quota exceeded', 'QuotaExceededError'); return original.call(this, name, value); };
      window.blockProgress = true;
    });
    await upload({ name: 'quota-check.pdf', mimeType: 'application/pdf', buffer: pdf });
    assert.equal((await stored()).uploads.length, beforeInvalid);
    assert.equal(await dbCount(), beforeInvalid);
    assert.match(await page.locator('#toast').innerText(), /Could not save progress/);
    await page.evaluate(() => window.blockProgress = false);
    console.log('PASS: invalid/oversized files rejected; metadata storage failure rolls back new blobs');

    const largePDF = Buffer.concat([pdf, Buffer.alloc(6 * 1024 * 1024 - pdf.length, 32)]);
    await upload({ name: 'Large worked paper.pdf', mimeType: 'application/pdf', buffer: largePDF });
    assert.equal((await stored()).uploads.length, 3);
    assert.equal(await page.evaluate(key => localStorage.getItem(key).length < 20000, key), true);
    await page.reload();
    assert.equal(await page.evaluate(async () => (await readStoredFile(state.uploads.find(file => file.name === 'Large worked paper.pdf').id)).size), largePDF.length);
    console.log('PASS: files larger than localStorage capacity persist as original browser blobs');

    await navigate('mocks');
    await page.locator('#mockScore').fill('');
    await page.locator('#mockMinutes').fill('45');
    await page.locator('#mockFiles').setInputFiles({ name: 'Full solution.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.locator('#mockForm button[type="submit"]').click();
    await waitIdle();
    assert.equal((await stored()).mocks.length, 2);
    assert.equal((await stored()).mocks[1].score, null);
    assert.equal(await page.locator('.mock-record').filter({ hasText: 'Not scored' }).count(), 1);
    assert.match(await page.locator('.mini-kpi').nth(1).innerText(), /21\.0/);
    const originalMock = (await stored()).mocks[0];
    await page.locator(`[data-attach-mock="${originalMock.id}"]`).setInputFiles({ name: 'Written steps.png', mimeType: 'image/png', buffer: png });
    await waitIdle();
    const imageButton = page.getByRole('button', { name: 'Open solution Written steps.png', exact: true });
    await imageButton.click();
    await page.waitForFunction(() => { const image = document.querySelector('#filePreview img'); return image?.complete && image.naturalWidth > 0; });
    await page.locator('#closeFileViewer').click();
    await page.locator('[data-mock-score-form] input').fill('0');
    await page.locator('[data-mock-score-form] button').click();
    assert.equal((await stored()).mocks[1].score, 0);
    assert.match(await page.locator('.mini-kpi').nth(1).innerText(), /10\.5/);
    await page.reload();
    assert.equal(await page.getByRole('button', { name: 'Open solution Full solution.pdf', exact: true }).count(), 1);
    await navigate('overview');
    assert.match(await page.locator('#content').innerText(), /230 \/ 180 min/);
    console.log('PASS: PDF-only mock result, attachments on existing mocks, image preview, and later zero score');

    await navigate('settings');
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#exportBtn').click()]);
    const backup = JSON.parse((await downloadBytes(download)).toString());
    await waitIdle();
    assert.equal(backup.version, 2);
    assert.equal(backup.state.studySessions.length, 3);
    assert.equal(backup.files.length, 5);
    for (const file of backup.state.uploads) {
      const bytes = Buffer.from(backup.files.find(record => record.id === file.id).base64, 'base64');
      assert.equal(bytes.length, file.size);
      if (file.name === 'Large worked paper.pdf') assert.equal(digest(bytes), digest(largePDF));
      if (file.name === 'Full solution.pdf') assert.equal(digest(bytes), digest(pdf));
    }
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#resetBtn').click();
    await waitIdle();
    assert.equal((await stored()).uploads.length, 0);
    assert.equal((await stored()).studySessions.length, 0);
    assert.equal(await dbCount(), 0);
    await importBackup(backup);
    assert.equal((await stored()).uploads.length, 5);
    assert.equal((await stored()).studySessions.length, 3);
    assert.equal(await dbCount(), 5);
    for (const file of (await stored()).uploads) {
      const restoredDigest = await page.evaluate(async id => {
        const hash = await crypto.subtle.digest('SHA-256', await (await readStoredFile(id)).arrayBuffer());
        return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
      }, file.id);
      const exported = backup.state.uploads.find(entry => entry.name === file.name);
      assert.equal(restoredDigest, digest(Buffer.from(backup.files.find(entry => entry.id === exported.id).base64, 'base64')));
    }
    console.log('PASS: all original bytes, solution links, and study time survive reset and backup restore');

    const goodState = await stored();
    await importBackup({ ...backup, files: [] }, null);
    assert.deepEqual(await stored(), goodState);
    assert.equal(await dbCount(), 5);
    const badSize = JSON.parse(JSON.stringify(backup));
    badSize.state.uploads[0].size++;
    await importBackup(badSize, null);
    assert.deepEqual(await stored(), goodState);
    const badDate = JSON.parse(JSON.stringify(backup));
    badDate.state.uploads[0].date = '<img src=x onerror="window.injected=true">';
    await importBackup(badDate, null);
    assert.deepEqual(await stored(), goodState);
    await importBackup(backup, false);
    assert.deepEqual(await stored(), goodState);
    console.log('PASS: incomplete/corrupt backups and cancelled imports preserve current progress and files');

    await navigate('mocks');
    const linked = (await stored()).mocks.find(mock => mock.score === 0);
    page.once('dialog', dialog => dialog.accept());
    await page.locator(`[data-delete-mock="${linked.id}"]`).click();
    await waitIdle();
    assert.equal((await stored()).mocks.length, 1);
    assert.equal((await stored()).uploads.some(file => file.mockId === linked.id), false);
    assert.equal(await dbCount(), 4);
    await navigate('resources');
    const generic = (await stored()).uploads.find(file => file.name === 'notes.html');
    page.once('dialog', dialog => dialog.accept());
    await page.locator(`[data-delete-upload="${generic.id}"]`).click();
    await waitIdle();
    assert.equal(await dbCount(), 3);
    await navigate('overview');
    await page.locator('#studyLogDetails summary').click();
    page.once('dialog', dialog => dialog.accept());
    await page.locator('[data-delete-study]').first().click();
    assert.equal((await stored()).studySessions.length, 2);
    assert.match(await page.locator('#content').innerText(), /110 \/ 180 min/);
    console.log('PASS: deleting results cleans attachments; deleting study time updates activity');

    await navigate('settings');
    await importBackup({ state: { topics: {}, sessions: [], mocks: [], mistakes: [], settings: { weeklyGoal: 200 } } });
    assert.equal((await stored()).uploads.length, 0);
    assert.equal((await stored()).studySessions.length, 0);
    assert.equal(await dbCount(), 0);
    console.log('PASS: legacy backups restore with empty study/file collections and clean up replaced files');

    await page.setViewportSize({ width: 390, height: 844 });
    for (const view of ['overview','mocks','resources']) {
      await page.evaluate(view => nav(view), view);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${view} fits mobile`);
      await page.screenshot({ path: `/tmp/nuet-${view}-uploads-mobile.png`, fullPage: true });
    }
    assert.deepEqual(errors, []);
    console.log('PASS: mobile layouts and no uncaught browser exceptions');
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
