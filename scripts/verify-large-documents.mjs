// Real Chrome + HTTP/Socket.IO boundary check. Creates sparse fixtures, removes only its own data.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { db } from '../src/prisma/db.ts';
import { MAX_DOCUMENT_SIZE } from '../src/lib/document-types.ts';
const base = process.env.VERIFY_URL || 'http://localhost:3102';
const root = await mkdtemp(join(tmpdir(), 'mediachat-large-documents-'));
const suffix = randomUUID().slice(0, 8), users = [], uploads = new Set();
let browser;
const json = (path, body, cookie) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: base, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const get = (path, cookie) => fetch(base + path, { headers: cookie ? { cookie } : {} });
async function until(check, label, timeout = 180000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 250)); }
  throw new Error(`Timed out: ${label}`);
}
async function hashStream(stream) { const hash = createHash('sha256'); for await (const chunk of stream) hash.update(chunk); return hash.digest('hex'); }
try {
  for (let i = 0; i < 2; i++) {
    const username = `large_${suffix}_${i}`, password = 'Large-file-check-123!';
    const response = await json('/api/register', { username, password }); assert.equal(response.status, 201, await response.clone().text());
    const { user } = await response.json(); users.push(user);
    const login = await json('/api/login', { username, password }); assert.equal(login.status, 200);
    user.cookie = login.headers.get('set-cookie').split(';')[0];
  }
  const [a, b] = users;
  const fixture = join(root, 'Граница 2 ГБ.rar'), file = await open(fixture, 'wx');
  try { await file.truncate(MAX_DOCUMENT_SIZE); await file.write(Buffer.from('boundary-start'), 0, 14, 0); await file.write(Buffer.from('boundary-end'), 0, 12, MAX_DOCUMENT_SIZE - 12); } finally { await file.close(); }
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/private/tmp/mediachat-video-browser/node_modules/playwright-core/index.mjs');
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const context = await browser.newContext();
  await context.addCookies([{ name: 'mediachat_session', value: a.cookie.split('=')[1], url: base, httpOnly: true, sameSite: 'Lax' }]);
  await context.addInitScript(() => {
    window.__documentUploads = [];
    const original = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function(...args) {
      this.addEventListener('load', () => { if (this.response?.documentUrl) window.__documentUploads.push(this.response); });
      return original.apply(this, args);
    };
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base); await page.getByText('Соединение установлено', { exact: true }).waitFor({ timeout: 45000 });
  await page.getByRole('button', { name: 'Прикрепить вложение', exact: true }).click();
  const choosing = page.waitForEvent('filechooser'); await page.getByRole('menuitem', { name: 'Документ или архив', exact: true }).click();
  await (await choosing).setFiles(fixture);
  await page.getByLabel('Выбранные вложения').getByText('2.00 ГБ', { exact: true }).waitFor();
  const uploading = page.waitForResponse((response) => response.url().includes('/api/documents/upload') && response.request().method() === 'POST', { timeout: 180000 });
  await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
  const response = await uploading;
  await until(async () => await page.evaluate(() => window.__documentUploads.length > 0), 'upload metadata in client');
  const data = await page.evaluate(() => window.__documentUploads[0]);
  assert.equal(response.status(), 201, JSON.stringify(data)); uploads.add(data.documentUrl);
  assert.equal(data.document.size, MAX_DOCUMENT_SIZE); assert.equal(data.document.mimeType, 'application/octet-stream');
  let saved;
  await until(async () => { const history = await (await get('/api/messages', b.cookie)).json(); saved = history.messages.find((m) => m.documentUrl === data.documentUrl); return Boolean(saved); }, '2 GiB message saved');
  assert.equal(saved.document.originalName, 'Граница 2 ГБ.rar'); assert.equal(saved.document.size, MAX_DOCUMENT_SIZE);
  const download = await get(data.documentUrl, b.cookie); assert.equal(download.status, 200);
  assert.equal(Number(download.headers.get('content-length')), MAX_DOCUMENT_SIZE); assert.match(download.headers.get('content-disposition'), /^attachment;/);
  const [downloadHash, originalHash] = await Promise.all([hashStream(download.body), hashStream(createReadStream(fixture))]);
  assert.equal(downloadHash, originalHash);
  await page.reload(); await page.getByRole('link', { name: 'Скачать Граница 2 ГБ.rar', exact: true }).waitFor();
  console.log('PASS actual 2 GiB upload from Chrome, progress/size display, Socket.IO publication, second-account history, exact SHA-256 streamed download, reload');
  const overStatus = await new Promise((resolve, reject) => {
    const req = httpRequest(new URL('/api/documents/upload?name=too-big.rar', base), { method: 'POST', headers: { Cookie: a.cookie, Origin: base, 'Content-Type': 'application/octet-stream', 'Content-Length': String(MAX_DOCUMENT_SIZE + 1) } }, (res) => { res.resume(); res.on('end', () => { resolve(res.statusCode); req.destroy(); }); });
    req.on('error', reject); req.flushHeaders();
  });
  assert.equal(overStatus, 413);
  assert.equal((await get(data.documentUrl)).status, 401);
  const small = new FormData(); small.append('document', new File(['legacy'], 'legacy.txt'));
  const legacy = await fetch(base + '/api/documents/upload', { method: 'POST', headers: { cookie: a.cookie, origin: base }, body: small });
  const legacyData = await legacy.json(); assert.equal(legacy.status, 201); uploads.add(legacyData.documentUrl);
  assert.equal((await get(legacyData.documentUrl, b.cookie)).status, 404);
  console.log('PASS 2 GiB + 1 rejected before body, unauthenticated download denied, legacy small multipart preserved, unpublished file private');
  const payload = join(root, 'payload.bin'), handle = await open(payload, 'wx'); await handle.truncate(32 * 1024 * 1024); await handle.close();
  const archive = join(root, 'archive.zip'); execFileSync('/usr/bin/zip', ['-q', '-0', archive, 'payload.bin'], { cwd: root });
  const zipStat = (await import('node:fs/promises')).stat; const size = (await zipStat(archive)).size;
  const largeZip = await fetch(base + '/api/documents/upload?name=archive.zip', { method: 'POST', headers: { cookie: a.cookie, origin: base, 'content-type': 'application/octet-stream', 'content-length': String(size) }, body: createReadStream(archive), duplex: 'half' });
  const zip = await largeZip.json(); assert.equal(largeZip.status, 201, JSON.stringify(zip)); uploads.add(zip.documentUrl);
  assert.equal(zip.document.size, size); assert.equal(zip.document.mimeType, 'application/octet-stream');
  const restored = await get(zip.documentUrl, a.cookie); assert.equal(restored.status, 200);
  assert.equal(await hashStream(restored.body), await hashStream(createReadStream(archive)));
  assert.deepEqual(errors, []);
  console.log('PASS genuine ZIP over 25 MiB streams without unpacking, exact original download, zero browser errors');
} finally {
  await browser?.close();
  for (const user of users) {
    const messages = await db.orm.public.Message.where({ userId: user.id }).all(); for (const m of messages) if (m.documentUrl) uploads.add(m.documentUrl);
    await db.orm.public.User.where({ id: user.id }).delete();
  }
  for (const url of uploads) {
    const match = /^\/api\/documents\/([0-9a-f-]{36})\.(bin|zip|txt)$/.exec(url); if (!match) continue;
    await rm(join(process.cwd(), 'uploads', 'documents', `${match[1]}.${match[2]}`), { force: true });
    await rm(join(process.cwd(), 'uploads', 'documents', 'metadata', `${match[1]}.json`), { force: true });
  }
  await rm(root, { recursive: true, force: true }); await db.close();
}
