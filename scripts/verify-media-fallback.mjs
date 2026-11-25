// End-to-end Chrome check with real unsupported media and temporary accounts/files.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { db } from '../src/prisma/db.ts';
const base = process.env.VERIFY_URL || 'http://localhost:3102';
const root = await mkdtemp(join(tmpdir(), 'mediachat-fallback-')), suffix = randomUUID().slice(0, 8);
const users = [], uploads = new Set(); let browser;
const json = (path, body) => fetch(base + path, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const get = (path, cookie) => fetch(base + path, { headers: cookie ? { cookie } : {} });
async function until(check, label) { const start = Date.now(); while (Date.now() - start < 45000) { if (await check()) return; await new Promise((r) => setTimeout(r, 100)); } throw new Error(`Timed out: ${label}`); }
try {
  for (let i = 0; i < 2; i++) {
    const username = `fallback_${suffix}_${i}`, password = 'Fallback-check-123!';
    const response = await json('/api/register', { username, password }); assert.equal(response.status, 201, await response.clone().text());
    const { user } = await response.json(); users.push(user);
    const login = await json('/api/login', { username, password }); assert.equal(login.status, 200); user.cookie = login.headers.get('set-cookie').split(';')[0];
  }
  const [a, b] = users;
  const video = join(root, '006 りされこTV　第六回（20070817） [JMyRrg30YbE].mp4');
  execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x120:rate=10', '-t', '1', '-threads', '1', '-c:v', 'mpeg4', video]);
  const first = join(root, 'first.png'), broken = join(root, 'broken.png'), last = join(root, 'last.png'), audio = join(root, 'broken.wav'), pdf = join(root, 'broken.pdf');
  for (const path of [first, last]) await sharp({ create: { width: 80, height: 60, channels: 3, background: 'purple' } }).png().toFile(path);
  for (const path of [broken, audio, pdf]) await writeFile(path, 'not valid media');
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/private/tmp/mediachat-video-browser/node_modules/playwright-core/index.mjs');
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const context = await browser.newContext(); await context.addCookies([{ name: 'mediachat_session', value: a.cookie.split('=')[1], url: base, httpOnly: true, sameSite: 'Lax' }]);
  const page = await context.newPage(), errors = [], mediaResponses = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.request().method() === 'POST' && /\/api\/(upload|audio\/upload|videos\/upload|documents\/upload)/.test(response.url())) {
      mediaResponses.push({ url: response.url(), status: response.status() });
      if (response.ok()) void response.json().then((data) => { for (const key of ['imageUrl', 'documentUrl', 'audioUrl', 'videoUrl']) if (data[key]) uploads.add(data[key]); }).catch(() => {});
    }
  });
  const history = async () => (await (await get('/api/messages', b.cookie)).json()).messages.filter((m) => m.userId === a.id);
  async function choose(label, paths) {
    await until(async () => await page.getByRole('button', { name: 'Прикрепить вложение', exact: true }).isEnabled(), 'composer ready');
    await page.getByRole('button', { name: 'Прикрепить вложение', exact: true }).click();
    const waiting = page.waitForEvent('filechooser'); await page.getByRole('menuitem', { name: label, exact: true }).click(); await (await waiting).setFiles(paths);
  }
  async function sendAndWait(count) { await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click(); await until(async () => (await history()).length === count, `${count} saved messages`); }
  await page.goto(base); await page.getByText('Соединение установлено', { exact: true }).waitFor({ timeout: 45000 });
  await choose('Видео', [video]); await sendAndWait(1);
  let messages = await history(); assert(messages[0].documentUrl); assert.equal(messages[0].videoUrl, null);
  assert.equal(messages[0].document.originalName, video.split('/').pop());
  const download = await get(messages[0].documentUrl, b.cookie); assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), await readFile(video));
  assert(mediaResponses.some((r) => r.url.includes('/api/videos/upload') && r.status === 415));
  console.log('PASS genuine unsupported MPEG-4 codec -> ordinary file automatically, original Japanese filename and exact bytes, recipient access');
  await choose('Изображение', [first, broken, last]);
  await page.getByPlaceholder('Написать сообщение...').fill('caption once'); await sendAndWait(4);
  messages = await history();
  assert.deepEqual(messages.slice(1).map((m) => m.imageUrl ? 'image' : 'document'), ['image', 'document', 'image']);
  assert.equal(messages[1].text, 'caption once'); assert.equal(messages[2].text, ''); assert.equal(messages[3].text, '');
  assert.equal(messages[2].document.originalName, 'broken.png');
  console.log('PASS unsupported image within album -> separate file, surrounding images and order/caption preserved');
  await choose('Музыка', [audio]); await choose('Документ или архив', [pdf]); await sendAndWait(6);
  messages = await history(); assert(messages.slice(4).every((m) => m.documentUrl && m.document.mimeType === 'application/octet-stream'));
  for (const message of [messages[2], ...messages.slice(4)]) {
    const response = await get(message.documentUrl, b.cookie); assert.equal(response.status, 200); assert.match(response.headers.get('content-disposition'), /^attachment;/);
    assert.equal(await response.text(), 'not valid media');
  }
  await page.reload(); await page.getByRole('link', { name: 'Скачать broken.pdf', exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: 'Скачать broken.pdf', exact: true }).locator('..').locator('svg[fill="white"]').count(), 1);
  console.log('PASS unsupported audio/document -> downloadable opaque files, white paper icon, original contents, history after reload');
  await page.route('**/api/videos/upload?*', (route) => route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'test server busy' }) }));
  await choose('Видео', [video]); const before = mediaResponses.filter((r) => r.url.includes('/api/documents/upload')).length;
  await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click(); await page.getByRole('alert').filter({ hasText: 'test server busy' }).waitFor();
  assert.equal((await history()).length, 6); assert.equal(mediaResponses.filter((r) => r.url.includes('/api/documents/upload')).length, before);
  assert.equal(await page.getByLabel('Выбранные вложения').getByRole('button').count(), 1);
  assert.deepEqual(errors, []);
  console.log('PASS temporary/rate-limit failure keeps media draft for retry without file fallback or duplicate; zero page errors');
} finally {
  await browser?.close();
  for (const user of users) {
    const messages = await db.orm.public.Message.where({ userId: user.id }).include('images').all();
    for (const m of messages) for (const url of [m.imageUrl, m.documentUrl, ...m.images.map((i) => i.imageUrl)]) if (url) uploads.add(url);
    await db.orm.public.User.where({ id: user.id }).delete();
  }
  for (const url of uploads) {
    const match = /^\/api\/(images|documents)\/([0-9a-f-]{36})\.(png|bin|pdf)$/.exec(url); if (!match) continue;
    const [, kind, id, ext] = match, directory = kind === 'images' ? '' : 'documents';
    await rm(join(process.cwd(), 'uploads', directory, `${id}.${ext}`), { force: true });
    await rm(join(process.cwd(), 'uploads', directory, 'metadata', `${id}.json`), { force: true });
    if (kind === 'images') await rm(join(process.cwd(), 'uploads', 'previews', `${id}.webp`), { force: true });
  }
  await rm(root, { recursive: true, force: true }); await db.close();
}
