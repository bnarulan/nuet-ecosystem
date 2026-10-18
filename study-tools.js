/* Study-time logging and local file storage. No server or account is required. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_BATCH_BYTES = 100 * 1024 * 1024;
let studyLogOpen = false;
let fileOperationBusy = false;
let fileDatabase;
let viewerURL;
let uploadPreviewFocus;
let pdfModule, pdfDocument, pdfLoadingTask, pdfRenderTask;
let pdfPage = 1, pdfZoom = 1, pdfSession = 0, pdfResizeTimer;

function validStudyDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !isNaN(parseDate(value)) && value <= getToday() &&
    parseDate(value).getFullYear() === Number(value.slice(0, 4)) &&
    parseDate(value).getMonth() + 1 === Number(value.slice(5, 7)) &&
    parseDate(value).getDate() === Number(value.slice(8, 10));
}

function studyTimePanel() {
  const recent = [...state.studySessions].sort((a, b) => b.date.localeCompare(a.date));
  return `<details class="study-log" id="studyLogDetails" ${studyLogOpen ? 'open' : ''}>
    <summary>＋ Log study time <span>Theory, revision, vocabulary & more</span></summary>
    <div class="study-log-body">
      <p class="data-note">Practice and mock-test minutes are counted automatically. Log your additional study time here.</p>
      <form id="studyTimeForm">
        <div class="split-inputs"><div class="field-block"><label class="field-label" for="studyDate">Date</label><input class="field" type="date" id="studyDate" required max="${getToday()}" value="${getToday()}"></div>
        <div class="field-block"><label class="field-label" for="studySubject">Activity</label><select class="field" id="studySubject"><option>NUET mathematics</option><option>Critical thinking</option><option>Vocabulary</option><option>Revision</option><option>Other NUET study</option></select></div></div>
        <div class="split-inputs"><div class="field-block"><label class="field-label" for="studyHours">Hours</label><input class="field" id="studyHours" type="number" min="0" max="24" step="1" value="0" required></div><div class="field-block"><label class="field-label" for="studyMinutes">Minutes</label><input class="field" id="studyMinutes" type="number" min="0" max="59" step="1" value="30" required></div></div>
        <div class="field-block"><label class="field-label" for="studyNote">What did you work on? (optional)</label><input class="field" id="studyNote" maxlength="500" placeholder="e.g. reviewing geometry and formulas"></div>
        <button class="btn" type="submit">Save study time</button>
      </form>
      ${recent.length ? `<h3 class="subsection">Your additional study sessions</h3><div class="study-history">${recent.map(session => `<div class="list-row"><div class="row-flex"><strong>${esc(session.subject)}</strong><small>${fmtDate(session.date)} · ${session.minutes} min</small>${session.note ? `<small>${esc(session.note)}</small>` : ''}</div><button class="btn small danger" data-delete-study="${esc(session.id)}" aria-label="Delete study session from ${fmtDate(session.date)}">Delete</button></div>`).join('')}</div>` : ''}
    </div></details>`;
}

function saveStudyTime(form) {
  const hours = Number(form.querySelector('#studyHours').value);
  const minutes = Number(form.querySelector('#studyMinutes').value);
  const total = hours * 60 + minutes;
  const date = form.querySelector('#studyDate').value;
  if (!Number.isInteger(hours) || hours < 0 || !Number.isInteger(minutes) || minutes < 0 || minutes > 59 || total < 1 || total > 1440 || !validStudyDate(date)) {
    toast('Use a valid past or current date and a duration from 1 minute to 24 hours.');
    return;
  }
  const entry = { id: randomId(), date, minutes: total, subject: form.querySelector('#studySubject').value, note: form.querySelector('#studyNote').value.trim() };
  try {
    persistProgress({ ...state, studySessions: [...state.studySessions, entry] });
    studyLogOpen = true;
    if (currentView === 'overview') render();
    toast(`${total} minutes added to your study activity`);
  } catch (error) { toast(error.message); }
}

function persistProgress(next) {
  try { localStorage.setItem(KEY, JSON.stringify(next)); }
  catch { throw new Error('Could not save progress. Check browser storage space and permissions.'); }
  state = next;
}

function openFileDatabase() {
  if (!fileDatabase) fileDatabase = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('File storage is unavailable in this browser.')); return; }
    const request = indexedDB.open('nuet-study-files', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'id' });
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); fileDatabase = undefined; };
      resolve(db);
    };
    request.onerror = () => reject(new Error('Could not open file storage. Check browser storage permissions.'));
    request.onblocked = () => reject(new Error('Close other NUET tabs, then try again.'));
  }).catch(error => { fileDatabase = undefined; throw error; });
  return fileDatabase;
}

async function readStoredFile(id) {
  const db = await openFileDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('files', 'readonly').objectStore('files').get(id);
    request.onsuccess = () => resolve(request.result?.blob);
    request.onerror = () => reject(new Error('Could not read the saved file.'));
  });
}

async function changeStoredFiles({ put = [], remove = [], clear = false } = {}) {
  const db = await openFileDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('files', 'readwrite');
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(new Error('Could not save files. Check browser storage space and permissions.'));
    transaction.onabort = () => reject(new Error('File storage was interrupted. Your existing files are unchanged.'));
    const store = transaction.objectStore('files');
    if (clear) store.clear();
    remove.forEach(id => store.delete(id));
    put.forEach(record => store.put(record));
  });
}

async function fileOperation(action, button) {
  if (fileOperationBusy) { toast('Please wait for the current file operation to finish.'); return; }
  fileOperationBusy = true;
  if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
  try { await action(); }
  catch (error) { toast(error.message || 'The file operation failed. Please try again.'); }
  finally {
    fileOperationBusy = false;
    if (button?.isConnected) { button.disabled = false; button.removeAttribute('aria-busy'); }
  }
}

function formatFileSize(bytes) {
  if (!bytes) return '0 KB';
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

async function previewType(blob) {
  const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const text = String.fromCharCode(...bytes);
  if (text.startsWith('%PDF-')) return 'application/pdf';
  if (bytes[0] === 0x89 && text.slice(1, 4) === 'PNG') return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (text.startsWith('GIF87a') || text.startsWith('GIF89a')) return 'image/gif';
  if (text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP') return 'image/webp';
  return 'application/octet-stream';
}

async function prepareUploads(files, mockId = null, note = '') {
  const selected = [...files];
  if (!selected.length) throw new Error('Choose at least one file.');
  if (selected.reduce((sum, file) => sum + file.size, 0) > MAX_BATCH_BYTES) throw new Error('Choose up to 100 MB of files at a time.');
  if (selected.some(file => !file.size || file.size > MAX_UPLOAD_BYTES)) throw new Error('Each file must contain data and be no larger than 25 MB.');
  const metadata = [], records = [];
  for (const file of selected) {
    const mime = await previewType(file);
    if (/\.pdf$/i.test(file.name) && mime !== 'application/pdf') throw new Error(`${file.name} does not contain a valid PDF file.`);
    if (mockId && mime === 'application/octet-stream') throw new Error('Attach a PDF or a PNG, JPEG, GIF, or WebP image of your solution.');
    const id = globalThis.crypto?.randomUUID?.() || randomId();
    metadata.push({ id, name: file.name, size: file.size, mime, date: getToday(), mockId, note });
    records.push({ id, blob: file.slice(0, file.size, mime) });
  }
  return { metadata, records };
}

// Write new blobs before metadata. Failed metadata writes leave existing progress intact.
async function commitUploadedFiles(next, records) {
  if (records.length) await changeStoredFiles({ put: records });
  try { persistProgress(next); }
  catch (error) {
    if (records.length) await changeStoredFiles({ remove: records.map(record => record.id) }).catch(() => {});
    throw error;
  }
}

function uploadedFileCard(file) {
  const mock = file.mockId && state.mocks.find(mock => mock.id === file.mockId);
  return `<article class="card resource-card uploaded-resource"><div class="resource-icon" aria-hidden="true">${file.mime === 'application/pdf' ? 'PDF' : file.mime.startsWith('image/') ? 'IMG' : 'FILE'}</div><span class="chip">${mock ? 'Worked solution' : 'Your upload'}</span><h3>${esc(file.name)}</h3><p>${file.note ? `${esc(file.note)}<br>` : ''}${formatFileSize(file.size)} · ${esc(fmtDate(file.date))}${mock ? `<br>${esc(mock.source)} · ${esc(fmtDate(mock.date))}` : ''}</p><div class="file-actions"><button class="btn outline" data-open-upload="${esc(file.id)}">${file.mime === 'application/octet-stream' ? 'View file' : 'Open file'}</button><button class="btn small danger" data-delete-upload="${esc(file.id)}" aria-label="Delete ${esc(file.name)}">Delete</button></div></article>`;
}

function uploadLibrary() {
  return `<section class="card card-pad upload-panel"><div class="card-header"><div><h2>Upload your study resources</h2><p>Keep PDFs, notes, images and other study files together.</p></div></div><form id="resourceUploadForm"><div class="field-block"><label class="field-label" for="resourceFiles">Choose files</label><input class="field file-input" id="resourceFiles" type="file" multiple required aria-describedby="resourceFileHelp"><p class="data-note" id="resourceFileHelp">Up to 25 MB per file, 100 MB per upload. PDF and image previews are available; other files can be downloaded.</p></div><div class="field-block"><label class="field-label" for="resourceNote">Description (optional)</label><input class="field" id="resourceNote" maxlength="500" placeholder="e.g. algebra revision notes"></div><button class="btn" type="submit">Upload resources</button></form><p class="data-note">Uploads stay in this browser on this device. Export a backup in Settings & backup to keep the original files safe.</p></section><section class="uploaded-library" aria-label="Your uploaded resources"><div class="section-toolbar"><h2 class="subsection">Your files</h2><span class="tiny muted">${state.uploads.length} files · ${formatFileSize(state.uploads.reduce((sum, file) => sum + file.size, 0))}</span></div>${state.uploads.length ? `<div class="resource-grid">${[...state.uploads].reverse().map(uploadedFileCard).join('')}</div>` : `<div class="card">${empty('▤', 'Your files will appear here', 'Upload a study resource or attach a worked solution to a mock result.')}</div>`}</section>`;
}

function mockAttachments(mockId) {
  const files = state.uploads.filter(file => file.mockId === mockId);
  return `<div class="mock-attachments">${files.map(file => `<button class="btn small outline" data-open-upload="${esc(file.id)}" aria-label="Open solution ${esc(file.name)}"><span aria-hidden="true">▤</span> ${esc(file.name)}</button>`).join('')}<label class="btn small outline attach-label">＋ Attach solution<input type="file" class="visually-hidden" data-attach-mock="${esc(mockId)}" accept=".pdf,.png,.jpg,.jpeg,.gif,.webp" multiple aria-label="Attach solution to ${esc(mockId)}"></label></div>`;
}

function closeFileViewer() {
  pdfSession++;
  clearTimeout(pdfResizeTimer);
  pdfRenderTask?.cancel();
  pdfLoadingTask?.destroy().catch(() => {});
  pdfRenderTask = pdfLoadingTask = pdfDocument = undefined;
  const dialog = document.getElementById('fileViewer');
  if (dialog?.open) dialog.close();
  if (viewerURL) { URL.revokeObjectURL(viewerURL); viewerURL = undefined; }
  document.getElementById('filePreview')?.replaceChildren();
  uploadPreviewFocus?.focus({ preventScroll: true });
}

async function openUpload(id, trigger) {
  const metadata = state.uploads.find(file => file.id === id);
  if (!metadata) return;
  try {
    const blob = await readStoredFile(id);
    if (!blob) throw new Error('This file is missing from browser storage. Restore a backup that includes the file.');
    if (!document.getElementById('fileViewer')) {
      document.body.insertAdjacentHTML('beforeend', `<dialog class="file-viewer" id="fileViewer" aria-labelledby="fileViewerTitle"><div class="file-viewer-header"><div><h2 id="fileViewerTitle"></h2><p class="tiny muted" id="fileViewerInfo"></p></div><button class="btn outline" id="closeFileViewer" aria-label="Close file preview">Close</button></div><div class="file-viewer-toolbar"><a class="btn" id="downloadUpload">Download original</a><a class="btn outline" id="openUploadTab" target="_blank" rel="noopener noreferrer">Open in new tab</a></div><div id="filePreview" class="file-preview"></div><p class="data-note">If your browser cannot display the preview, download the original file to view it.</p></dialog>`);
      document.getElementById('closeFileViewer').addEventListener('click', closeFileViewer);
      const dialog = document.getElementById('fileViewer');
      dialog.addEventListener('cancel', event => { event.preventDefault(); closeFileViewer(); });
      dialog.addEventListener('click', event => { if (event.target === dialog) { const box = dialog.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeFileViewer(); } });
      dialog.addEventListener('click', handlePdfControl);
      dialog.addEventListener('change', handlePdfControl);
      dialog.addEventListener('keydown', event => {
        if (event.target.id === 'pdfPageNumber' && event.key === 'Enter') {
          event.preventDefault();
          handlePdfControl({ type: 'change', target: event.target });
        }
      });
    }
    closeFileViewer();
    uploadPreviewFocus = trigger;
    const mime = await previewType(blob);
    viewerURL = URL.createObjectURL(blob.slice(0, blob.size, mime));
    document.getElementById('fileViewerTitle').textContent = metadata.name;
    document.getElementById('fileViewerInfo').textContent = `${formatFileSize(blob.size)} · ${metadata.mockId ? 'Your worked solution' : 'Your uploaded resource'}`;
    const download = document.getElementById('downloadUpload');
    download.href = viewerURL;
    download.download = metadata.name;
    const newTab = document.getElementById('openUploadTab');
    newTab.href = viewerURL;
    newTab.hidden = mime === 'application/octet-stream';
    const preview = document.getElementById('filePreview');
    if (mime === 'application/pdf') {
      preview.innerHTML = `<div class="pdf-reader"><div class="pdf-controls" role="group" aria-label="PDF navigation"><button class="btn small outline" data-pdf-action="previous" disabled>← Previous</button><label class="pdf-page-label">Page <input class="field" id="pdfPageNumber" type="number" min="1" value="1" aria-label="PDF page number" disabled> <span id="pdfPageCount"></span></label><button class="btn small outline" data-pdf-action="next" disabled>Next →</button><label class="pdf-zoom-label"><span class="visually-hidden">PDF zoom</span><select class="field" id="pdfZoom" aria-label="PDF zoom" disabled><option value="0.75">75%</option><option value="1" selected>Fit width</option><option value="1.25">125%</option><option value="1.5">150%</option><option value="2">200%</option></select></label></div><p id="pdfStatus" class="data-note" role="status">Loading PDF…</p><div class="pdf-canvas-wrap" tabindex="0" aria-label="PDF page, scroll to see your working"><canvas id="pdfCanvas" role="img" aria-label="PDF page"></canvas></div></div>`;
    } else if (mime.startsWith('image/')) {
      const image = document.createElement('img');
      image.alt = metadata.name;
      image.src = viewerURL;
      preview.append(image);
    } else {
      const message = document.createElement('p');
      message.textContent = 'A preview is not available for this file type. Download the original to open it in a suitable app.';
      preview.append(message);
    }
    document.getElementById('fileViewer').showModal();
    if (mime === 'application/pdf') await loadPdfPreview(blob);
  } catch (error) { toast(error.message); }
}

async function loadPdfPreview(blob) {
  const session = pdfSession;
  try {
    pdfModule ||= import('./vendor/pdfjs/build/pdf.min.mjs');
    const library = await pdfModule;
    if (session !== pdfSession) return;
    library.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/build/pdf.worker.min.mjs', document.baseURI).href;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (session !== pdfSession) return;
    const task = library.getDocument({ data: bytes, cMapUrl: new URL('vendor/pdfjs/cmaps/', document.baseURI).href, standardFontDataUrl: new URL('vendor/pdfjs/standard_fonts/', document.baseURI).href, wasmUrl: new URL('vendor/pdfjs/wasm/', document.baseURI).href, isEvalSupported: false, enableXfa: false });
    pdfLoadingTask = task;
    const loaded = await task.promise;
    if (session !== pdfSession) { await task.destroy(); return; }
    pdfDocument = loaded; pdfPage = 1; pdfZoom = 1;
    document.getElementById('pdfPageNumber').max = loaded.numPages;
    document.getElementById('pdfPageCount').textContent = `/ ${loaded.numPages}`;
    await renderPdfPage();
  } catch (error) {
    if (session !== pdfSession) return;
    const status = document.getElementById('pdfStatus');
    if (status) status.textContent = error.name === 'PasswordException' ? 'This PDF is password protected. Open the original in a PDF app to unlock it.' : 'This PDF could not be rendered here. Open it in a new tab or download the original.';
  }
}

async function renderPdfPage() {
  const session = pdfSession, loaded = pdfDocument;
  if (!loaded) return;
  const status = document.getElementById('pdfStatus');
  document.querySelectorAll('.pdf-controls button, .pdf-controls input, .pdf-controls select').forEach(control => control.disabled = true);
  status.textContent = `Loading page ${pdfPage}…`;
  pdfRenderTask?.cancel();
  const canvas = document.getElementById('pdfCanvas');
  canvas.removeAttribute('data-rendered');
  try {
    const page = await loaded.getPage(pdfPage);
    if (session !== pdfSession) return;
    const container = document.querySelector('.pdf-canvas-wrap');
    const natural = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.max(0.1, (container.clientWidth - 24) / natural.width) * pdfZoom });
    const density = Math.min(devicePixelRatio || 1, 2, 4096 / Math.max(viewport.width, viewport.height));
    canvas.width = Math.ceil(viewport.width * density);
    canvas.height = Math.ceil(viewport.height * density);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    canvas.setAttribute('aria-label', `Page ${pdfPage} of ${loaded.numPages}`);
    pdfRenderTask = page.render({ canvas, viewport, transform: density === 1 ? null : [density, 0, 0, density, 0, 0] });
    await pdfRenderTask.promise;
    if (session !== pdfSession) return;
    canvas.dataset.rendered = 'true';
    container.scrollTop = container.scrollLeft = 0;
    document.getElementById('pdfPageNumber').value = pdfPage;
    status.textContent = `Page ${pdfPage} of ${loaded.numPages}`;
    document.getElementById('pdfPageNumber').disabled = false;
    document.getElementById('pdfZoom').disabled = false;
    document.querySelector('[data-pdf-action="previous"]').disabled = pdfPage <= 1;
    document.querySelector('[data-pdf-action="next"]').disabled = pdfPage >= loaded.numPages;
  } catch (error) {
    if (session === pdfSession && error.name !== 'RenderingCancelledException') status.textContent = 'This page could not be rendered. Download the original to view it.';
  }
}

async function handlePdfControl(event) {
  if (!pdfDocument) return;
  const button = event.target.closest('[data-pdf-action]');
  if (event.type === 'click' && button && !button.disabled) pdfPage += button.dataset.pdfAction === 'next' ? 1 : -1;
  else if (event.type === 'change' && event.target.id === 'pdfPageNumber') {
    const page = Number(event.target.value);
    if (!Number.isInteger(page) || page < 1 || page > pdfDocument.numPages) { event.target.value = pdfPage; return; }
    pdfPage = page;
  } else if (event.type === 'change' && event.target.id === 'pdfZoom') pdfZoom = Number(event.target.value);
  else return;
  await renderPdfPage();
}

addEventListener('resize', () => {
  clearTimeout(pdfResizeTimer);
  if (pdfDocument) pdfResizeTimer = setTimeout(() => renderPdfPage(), 150);
});

async function cleanupFiles(ids) {
  if (!ids.length) return;
  try { await changeStoredFiles({ remove: ids }); }
  catch { toast('Removed from your records, but browser file cleanup failed. Check storage permissions.'); }
}

async function saveMockWithFiles(form) {
  const scoreInput = form.querySelector('#mockScore').value;
  const score = scoreInput.trim() === '' ? null : Number(scoreInput);
  const minutes = Number(form.querySelector('#mockMinutes').value);
  const selected = [...form.querySelector('#mockFiles').files];
  if ((score !== null && (!Number.isInteger(score) || score < 0 || score > 30)) || (!selected.length && score === null) || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
    toast('Add a score from 0 to 30 or a solution file, and a valid number of minutes.'); return;
  }
  const mock = { id: randomId(), source: form.querySelector('#mockSource').value, score, minutes, date: form.querySelector('#mockDate').value, notes: form.querySelector('#mockNotes').value.trim() };
  if (!validStudyDate(mock.date)) { toast('Choose a valid past or current mock-test date.'); return; }
  await fileOperation(async () => {
    const files = selected.length ? await prepareUploads(selected, mock.id) : { metadata: [], records: [] };
    await commitUploadedFiles({ ...state, mocks: [...state.mocks, mock], uploads: [...state.uploads, ...files.metadata] }, files.records);
    if (currentView === 'mocks') render();
    toast('Mock result and solutions saved');
  }, form.querySelector('button[type="submit"]'));
}

function blobAsBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.slice(reader.result.indexOf(',') + 1));
    reader.onerror = () => reject(new Error('Could not read a file for the backup.'));
    reader.readAsDataURL(blob);
  });
}

async function exportStudyBackup() {
  await fileOperation(async () => {
    const snapshot = JSON.parse(JSON.stringify(state));
    const files = [];
    for (const file of snapshot.uploads) {
      const blob = await readStoredFile(file.id);
      if (!blob) throw new Error(`Backup stopped: ${file.name} is missing from browser storage. Restore it or remove its record, then export again.`);
      files.push({ id: file.id, base64: await blobAsBase64(blob) });
    }
    const backup = new Blob([JSON.stringify({ app: 'NUET Math Studio', version: 2, exportedAt: new Date().toISOString(), state: snapshot, files }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(backup), link = document.createElement('a');
    link.href = url; link.download = `nuet-math-progress-${getToday()}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Progress and original files exported');
  }, document.getElementById('exportBtn'));
}

async function decodeBackup(data) {
  const loaded = data?.state || data;
  if (!loaded || typeof loaded !== 'object' || !Array.isArray(loaded.sessions) || !Array.isArray(loaded.mocks) || !Array.isArray(loaded.mistakes) || !loaded.topics || typeof loaded.topics !== 'object') throw new Error('Invalid backup format');
  if (loaded.vocabulary !== undefined && (!Array.isArray(loaded.vocabulary) || loaded.vocabulary.some(entry => !entry || typeof entry.word !== 'string' || !entry.word.trim() || typeof entry.definition !== 'string' || !entry.definition.trim()))) throw new Error('Invalid vocabulary format');
  const studySessions = loaded.studySessions === undefined ? [] : loaded.studySessions;
  if (!Array.isArray(studySessions) || studySessions.some(entry => !entry || typeof entry.id !== 'string' || !validStudyDate(entry.date) || !Number.isInteger(entry.minutes) || entry.minutes < 1 || entry.minutes > 1440 || typeof entry.subject !== 'string' || (entry.note !== undefined && typeof entry.note !== 'string'))) throw new Error('Invalid study sessions');
  const uploads = loaded.uploads === undefined ? [] : loaded.uploads;
  const backupFiles = data.files === undefined ? [] : data.files;
  if (!Array.isArray(uploads) || !Array.isArray(backupFiles) || uploads.length !== backupFiles.length) throw new Error('Incomplete files');
  const byId = new Map();
  for (const file of backupFiles) {
    if (!file || typeof file.id !== 'string' || typeof file.base64 !== 'string' || byId.has(file.id)) throw new Error('Invalid file data');
    byId.set(file.id, file.base64);
  }
  const metadata = [], records = [], ids = new Set();
  for (const file of uploads) {
    if (!file || typeof file.id !== 'string' || !file.id || ids.has(file.id) || typeof file.name !== 'string' || !file.name.trim() || !Number.isInteger(file.size) || file.size < 1 || file.size > MAX_UPLOAD_BYTES || !byId.has(file.id) || !validStudyDate(file.date) || (file.note !== undefined && typeof file.note !== 'string') || (file.mockId != null && !loaded.mocks.some(mock => mock.id === file.mockId))) throw new Error('Invalid file metadata');
    ids.add(file.id);
    const encoded = byId.get(file.id);
    if (encoded.length > Math.ceil(MAX_UPLOAD_BYTES / 3) * 4) throw new Error('File too large');
    const binary = atob(encoded);
    if (binary.length !== file.size) throw new Error('Incorrect file size');
    const blob = new Blob([Uint8Array.from(binary, character => character.charCodeAt(0))]);
    const mime = await previewType(blob);
    if (/\.pdf$/i.test(file.name) && mime !== 'application/pdf') throw new Error('Invalid PDF data');
    const id = globalThis.crypto?.randomUUID?.() || randomId();
    metadata.push({ id, name: file.name, size: blob.size, mime, date: typeof file.date === 'string' ? file.date : getToday(), mockId: file.mockId || null, note: file.note || '' });
    records.push({ id, blob: blob.slice(0, blob.size, mime) });
  }
  return { next: { topics: loaded.topics, sessions: loaded.sessions, mocks: loaded.mocks, mistakes: loaded.mistakes, vocabulary: normalizeVocabulary(loaded.vocabulary), studySessions, uploads: metadata, settings: { ...initial().settings, ...(loaded.settings || {}) } }, records };
}

async function importStudyBackup(file) {
  if (!file) return;
  await fileOperation(async () => {
    let backup;
    try { backup = await decodeBackup(JSON.parse(await file.text())); }
    catch { toast('Import failed: not a valid tracker backup or some original files are missing.'); return; }
    if (!confirm('Import this backup? It will replace your current progress, vocabulary and uploaded files.')) return;
    const oldIds = state.uploads.map(file => file.id);
    await commitUploadedFiles(backup.next, backup.records);
    closeFileViewer(); resetVocabularyUI(); studyLogOpen = false;
    render();
    toast('Backup imported successfully, including original files');
    await cleanupFiles(oldIds);
  }, document.getElementById('importBtn'));
  const input = document.getElementById('importFile');
  if (input) input.value = '';
}

async function resetStudyData() {
  await fileOperation(async () => {
    const hadFiles = state.uploads.length > 0;
    persistProgress(initial());
    closeFileViewer(); resetVocabularyUI(); studyLogOpen = false;
    render();
    toast('Tracker and uploaded files reset');
    if (hadFiles) {
      try { await changeStoredFiles({ clear: true }); }
      catch { toast('Progress reset, but stored files could not be cleared. Check browser storage permissions.'); }
    }
  });
}

async function handleStudySubmit(event) {
  const form = event.target;
  if (form.id === 'studyTimeForm') { event.preventDefault(); saveStudyTime(form); }
  if (form.id === 'mockForm') { event.preventDefault(); await saveMockWithFiles(form); }
  if (form.id === 'resourceUploadForm') {
    event.preventDefault();
    const selected = [...form.querySelector('#resourceFiles').files], note = form.querySelector('#resourceNote').value.trim();
    await fileOperation(async () => {
      const files = await prepareUploads(selected, null, note);
      await commitUploadedFiles({ ...state, uploads: [...state.uploads, ...files.metadata] }, files.records);
      if (currentView === 'resources') render();
      toast(`${files.metadata.length} resource files saved`);
    }, form.querySelector('button[type="submit"]'));
  }
  if (form.matches('[data-mock-score-form]')) {
    event.preventDefault();
    const score = Number(form.elements.score.value), id = form.dataset.mockScoreForm;
    if (!Number.isInteger(score) || score < 0 || score > 30 || form.elements.score.value.trim() === '') return;
    try { persistProgress({ ...state, mocks: state.mocks.map(mock => mock.id === id ? { ...mock, score } : mock) }); render(); toast('Mock score saved'); }
    catch (error) { toast(error.message); }
  }
}

async function handleStudyClick(event) {
  const preview = event.target.closest('[data-open-upload]');
  if (preview) { await openUpload(preview.dataset.openUpload, preview); return; }
  const removeFile = event.target.closest('[data-delete-upload]');
  if (removeFile) {
    const file = state.uploads.find(file => file.id === removeFile.dataset.deleteUpload);
    if (!file || !confirm(`Delete "${file.name}" from this browser?`)) return;
    await fileOperation(async () => {
      persistProgress({ ...state, uploads: state.uploads.filter(entry => entry.id !== file.id) });
      render(); toast('File deleted'); await cleanupFiles([file.id]);
    }); return;
  }
  const removeMock = event.target.closest('[data-delete-mock]');
  if (removeMock) {
    if (!confirm('Delete this mock result and its attached solution files?')) return;
    const id = removeMock.dataset.deleteMock;
    await fileOperation(async () => {
      const fileIds = state.uploads.filter(file => file.mockId === id).map(file => file.id);
      persistProgress({ ...state, mocks: state.mocks.filter(mock => mock.id !== id), uploads: state.uploads.filter(file => file.mockId !== id) });
      render(); toast('Mock result deleted'); await cleanupFiles(fileIds);
    }); return;
  }
  const removeStudy = event.target.closest('[data-delete-study]');
  if (removeStudy && confirm('Delete this study-time entry?')) {
    try { persistProgress({ ...state, studySessions: state.studySessions.filter(entry => entry.id !== removeStudy.dataset.deleteStudy) }); render(); toast('Study time deleted'); }
    catch (error) { toast(error.message); }
  }
}

async function attachExistingMock(event) {
  if (!event.target.matches('[data-attach-mock]')) return;
  const input = event.target, id = input.dataset.attachMock, selected = [...input.files];
  if (!selected.length || !state.mocks.some(mock => mock.id === id)) return;
  await fileOperation(async () => {
    const files = await prepareUploads(selected, id);
    await commitUploadedFiles({ ...state, uploads: [...state.uploads, ...files.metadata] }, files.records);
    if (currentView === 'mocks') render();
    toast('Worked solutions attached');
  }, input);
  input.value = '';
}

document.addEventListener('submit', handleStudySubmit);
document.addEventListener('click', handleStudyClick);
document.addEventListener('change', attachExistingMock);
document.addEventListener('toggle', event => { if (event.target.id === 'studyLogDetails') studyLogOpen = event.target.open; }, true);
