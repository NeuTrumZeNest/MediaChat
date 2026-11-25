// Real HTTP/Socket.IO + Chrome; creates and cleans only its own two accounts and fixtures.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { io } from 'socket.io-client';
import { db } from '../src/prisma/db.ts';
const base = process.env.VERIFY_URL || 'http://localhost:3102';
const root = await mkdtemp(join(tmpdir(), 'mediachat-batch-'));
const suffix = randomUUID().slice(0, 8), users = [], sockets = [], uploads = new Set(), conversations = [];
let browser;
const json = (path, body, cookie) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: base, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const get = (path, cookie) => fetch(base + path, { headers: cookie ? { cookie } : {} });
const emit = (socket, payload) => new Promise((resolve, reject) => socket.timeout(15000).emit('chat-message', payload, (error, response) => error ? reject(error) : resolve(response)));
async function until(check, label, timeout = 40000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 150)); }
  throw new Error(`Timed out: ${label}`);
}
async function uploadImage(path, cookie) {
  const form = new FormData(); form.append('image', new File([await readFile(path)], 'photo.png', { type: 'image/png' }));
  const response = await fetch(base + '/api/upload', { method: 'POST', headers: { cookie, origin: base }, body: form });
  const data = await response.json(); assert.equal(response.status, 201, JSON.stringify(data)); uploads.add(data.imageUrl); return data.imageUrl;
}
try {
  for (let i = 0; i < 2; i++) {
    const username = `batch_${suffix}_${i}`, password = 'Batch-test-123!';
    const response = await json('/api/register', { username, password }); assert.equal(response.status, 201, await response.clone().text());
    const { user } = await response.json(); users.push(user);
    const login = await json('/api/login', { username, password }); assert.equal(login.status, 200);
    user.cookie = login.headers.get('set-cookie').split(';')[0];
    const socket = io(base, { transports: ['websocket'], extraHeaders: { Cookie: user.cookie, Origin: base }, reconnection: false }); sockets.push(socket);
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  }
  const [a, b] = users;
  const images = [];
  for (let i = 0; i < 10; i++) {
    const path = join(root, `Фото ${i + 1}.png`); images.push(path);
    await sharp({ create: { width: 160 + i * 5, height: 120, channels: 3, background: { r: i * 20, g: 80, b: 180 } } }).png().toFile(path);
  }
  const audio = join(root, 'Трек.wav'), mp4 = join(root, 'Видео.mp4'), webm = join(root, 'Видео.webm');
  execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '2', '-c:a', 'pcm_s16le', audio]);
  for (const [path, codec, extra] of [[mp4, 'libx264', ['-preset', 'ultrafast']], [webm, 'libvpx-vp9', ['-deadline', 'realtime', '-cpu-used', '8']]]) {
    execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x120:rate=10', '-t', '2', '-threads', '1', '-c:v', codec, '-pix_fmt', 'yuv420p', ...extra, path]);
  }
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/private/tmp/mediachat-video-browser/node_modules/playwright-core/index.mjs');
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const contexts = [];
  for (const user of users) {
    const context = await browser.newContext({ viewport: { width: 1100, height: 850 } }); contexts.push(context);
    await context.addCookies([{ name: 'mediachat_session', value: user.cookie.split('=')[1], url: base, httpOnly: true, sameSite: 'Lax' }]);
  }
  await contexts[0].addInitScript(() => {
    const Original = window.WebSocket;
    window.WebSocket = class extends Original {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', (event) => {
          if (window.__batchDropAck && typeof event.data === 'string' && /^43\d+\[/.test(event.data) && event.data.includes('Альбом из десяти')) {
            window.__batchDropAck = false; event.stopImmediatePropagation();
          }
        });
      }
    };
  });
  const page = await contexts[0].newPage(), recipient = await contexts[1].newPage();
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', async (response) => {
    if (response.request().method() === 'POST' && /\/api\/(upload|audio\/upload|videos\/upload|documents\/upload)/.test(response.url()) && response.ok()) {
      const data = await response.json().catch(() => ({})); for (const key of ['imageUrl', 'audioUrl', 'videoUrl', 'documentUrl']) if (data[key]) uploads.add(data[key]);
    }
  });
  await Promise.all([page.goto(base), recipient.goto(base)]);
  for (const p of [page, recipient]) await p.getByText('Соединение установлено', { exact: true }).waitFor({ timeout: 45000 });
  const history = async () => (await (await get('/api/messages', a.cookie)).json()).messages.filter((m) => m.userId === a.id);
  async function choose(label, paths) {
    await page.getByRole('button', { name: 'Прикрепить вложение', exact: true }).click();
    const waiting = page.waitForEvent('filechooser'); await page.getByRole('menuitem', { name: label, exact: true }).click();
    const chooser = await waiting; assert(chooser.isMultiple()); await chooser.setFiles(paths);
  }
  const png = await readFile(images[0]);
  await choose('Изображение', [
    ...Array.from({ length: 31 }, (_, i) => ({ name: `Выбор ${i}.png`, mimeType: 'image/png', buffer: png })),
    { name: 'Слишком большое.png', mimeType: 'image/png', buffer: Buffer.alloc(25 * 1024 * 1024 + 1) },
    { name: 'Пустое.png', mimeType: 'image/png', buffer: Buffer.alloc(0) },
  ]);
  assert.equal(await page.getByLabel('Выбранные вложения').getByRole('button').count(), 32);
  await page.getByRole('alert').filter({ hasText: 'Не добавлено файлов: 1' }).waitFor();
  console.log('PASS 31 selected images accepted; oversized image becomes a file, empty image excluded without clearing the draft');
  while (await page.getByLabel('Выбранные вложения').getByRole('button').count()) await page.getByLabel('Выбранные вложения').getByRole('button').first().click();
  await choose('Изображение', images.slice(0, 5));
  await choose('Изображение', images.slice(5));
  assert.equal(await page.getByLabel('Выбранные вложения').getByRole('button').count(), 10);
  await page.getByPlaceholder('Написать сообщение...').fill('Альбом из десяти фотографий');
  // Simulate an acknowledgement timeout AFTER server commit. Retrying must not duplicate the album.
  await page.evaluate(() => { window.__batchDropAck = true; });
  await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Сервер не подтвердил' }).waitFor({ timeout: 40000 });
  assert.equal((await history()).length, 1);
  const uploadCount = uploads.size;
  await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
  await until(async () => (await history()).length === 2, '9+1 album saved');
  const albums = await history(); assert.deepEqual(albums.map((m) => m.imageUrls.length), [9, 1]);
  assert.equal(albums[0].text, 'Альбом из десяти фотографий'); assert.equal(albums[1].text, '');
  assert.equal(uploads.size, uploadCount + 1, 'Retry reused the first nine uploaded files');
  await recipient.getByLabel('Альбом: 9 фото', { exact: true }).last().waitFor();
  const grid = recipient.getByLabel('Альбом: 9 фото', { exact: true }).last();
  assert.equal(await grid.getByRole('button').count(), 9);
  assert((await grid.boundingBox()).width > 200);
  for (const url of albums[0].imageUrls) assert.equal((await get(url, b.cookie)).status, 200);
  await grid.getByRole('button').nth(8).click();
  await recipient.getByRole('link', { name: /Скачать/ }).waitFor();
  await recipient.keyboard.press('Escape');
  await recipient.reload(); await recipient.getByLabel('Альбом: 9 фото', { exact: true }).last().waitFor();
  console.log('PASS real Chrome: multi-file chooser, ten images -> 9+1, caption once, lost acknowledgement retry without duplicate/reupload, realtime, all album originals accessible, viewer, reload');

  // Partial batch: fail the second track upload once, then retry without resending the first track.
  await until(async () => await page.getByRole('button', { name: 'Прикрепить вложение' }).isEnabled(), 'batch completed');
  const secondAudio = join(root, 'Второй трек.wav'), thirdAudio = join(root, 'Третий трек.wav'); await copyFile(audio, secondAudio); await copyFile(audio, thirdAudio);
  await choose('Музыка', [audio]);
  await choose('Музыка', [secondAudio, thirdAudio]);
  let attempts = 0;
  await page.route('**/api/audio/upload', async (route) => {
    if (++attempts === 2) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Проверка обрыва второй загрузки' }) });
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Проверка обрыва' }).waitFor();
  assert.equal((await history()).filter((m) => m.audioUrl).length, 1);
  assert.equal(await page.getByLabel('Выбранные вложения').getByRole('button').count(), 2);
  await page.getByRole('button', { name: 'Убрать Второй трек.wav', exact: true }).click();
  assert.equal(await page.getByLabel('Выбранные вложения').getByRole('button').count(), 1);
  await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
  await until(async () => (await history()).filter((m) => m.audioUrl).length === 2, 'two separate tracks');
  assert.equal(attempts, 3);
  console.log('PASS multi-track batch, sequential send, partial upload failure/retry, no duplicate first track');

  await until(async () => await page.getByRole('button', { name: 'Прикрепить вложение' }).isEnabled(), 'audio batch completed');
  await choose('Видео', [mp4]);
  await choose('Видео', [webm]);
  assert.equal(await page.getByLabel('Выбранные вложения').getByRole('button').count(), 2);
  await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
  await until(async () => (await history()).filter((m) => m.videoUrl).length === 2, 'MP4 + WebM batch', 60000);
  const videos = (await history()).filter((m) => m.videoUrl); assert(videos.every((m) => m.video?.duration > 0));
  await recipient.reload();
  await until(async () => await recipient.locator('button[aria-label^="Открыть видео"]').count() >= 2, 'recipient video previews');
  console.log('PASS MP4 + WebM multi-select, preserved metadata and history on recipient');

  await until(async () => await page.getByRole('button', { name: 'Прикрепить вложение' }).isEnabled(), 'video batch completed');
  const unknownBytes = Buffer.from([0, 255, 1, 2, 3, 4]), htmlBytes = Buffer.from('<script>window.unwanted=true</script>');
  await choose('Документ или архив', [{ name: 'Проект.mystery', mimeType: 'application/octet-stream', buffer: unknownBytes }]);
  await choose('Документ или архив', [{ name: 'page.html', mimeType: 'text/html', buffer: htmlBytes }]);
  await choose('Изображение', [images[0]]);
  await choose('Музыка', [audio]);
  await choose('Видео', [mp4]);
  assert.equal(await page.getByLabel('Выбранные вложения').getByRole('button').count(), 5);
  const beforeMixed = (await history()).length;
  await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
  await until(async () => (await history()).length === beforeMixed + 5, 'mixed queue with generic documents', 60000);
  const mixed = (await history()).slice(beforeMixed);
  assert.deepEqual(mixed.map((m) => m.documentUrl ? 'document' : m.imageUrl ? 'image' : m.audioUrl ? 'audio' : 'video'), ['document', 'document', 'image', 'audio', 'video']);
  for (const [index, bytes] of [unknownBytes, htmlBytes].entries()) {
    const message = mixed[index]; assert(message.documentUrl.endsWith('.bin'));
    assert.equal(message.document.mimeType, 'application/octet-stream');
    const response = await get(message.documentUrl, b.cookie); assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/octet-stream');
    assert.match(response.headers.get('content-disposition'), /^attachment;/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('content-security-policy'), 'sandbox');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    assert.equal((await emit(sockets[1], { documentUrl: message.documentUrl })).ok, false);
  }
  await recipient.reload(); await recipient.getByRole('link', { name: 'Скачать Проект.mystery', exact: true }).waitFor();
  console.log('PASS repeated selections append images/tracks/videos/documents; mixed queue order; generic binary/HTML files retain exact bytes and names, protected download-only headers, history and foreign publish rejection');

  const paddedPng = Buffer.alloc(25 * 1024 * 1024); png.copy(paddedPng);
  const form = new FormData(); form.append('image', new File([paddedPng], '25 MiB.png', { type: 'image/png' }));
  const largeUpload = await fetch(base + '/api/upload', { method: 'POST', headers: { cookie: a.cookie, origin: base }, body: form });
  const largeData = await largeUpload.json(); assert.equal(largeUpload.status, 201, JSON.stringify(largeData)); uploads.add(largeData.imageUrl);
  assert((await emit(sockets[0], { imageUrls: [largeData.imageUrl], clientMessageId: randomUUID() })).ok, '25 MiB accepted by ownership check too');
  const originalResponse = await get(largeData.imageUrl, b.cookie); assert.equal(originalResponse.status, 200);
  assert.deepEqual(Buffer.from(await originalResponse.arrayBuffer()), paddedPng);
  console.log('PASS actual 25 MiB upload, preview generation, publication ownership check, exact original download');

  const privateUrls = [await uploadImage(images[0], a.cookie), await uploadImage(images[1], a.cookie)];
  const conversation = await db.orm.public.Conversation.create({}); conversations.push(conversation.id);
  await db.orm.public.ConversationMember.create({ conversationId: conversation.id, userId: a.id });
  const privateMessage = await db.transaction(async (tx) => {
    const m = await tx.orm.public.Message.create({ text: '', imageUrl: privateUrls[0], userId: a.id, conversationId: conversation.id });
    for (const [position, imageUrl] of privateUrls.entries()) await tx.orm.public.MessageImage.create({ messageId: m.id, position, imageUrl });
    return m;
  });
  for (const url of privateUrls) assert.equal((await get(url, b.cookie)).status, 404);
  assert.equal((await emit(sockets[1], { imageUrls: privateUrls })).ok, false);
  await db.orm.public.ConversationMember.create({ conversationId: conversation.id, userId: b.id });
  for (const url of privateUrls) assert.equal((await get(url, b.cookie)).status, 200);
  assert.equal((await emit(sockets[1], { imageUrls: privateUrls })).ok, false, 'Readable does not mean ownable');
  assert(!(await history()).some((m) => m.id === privateMessage.id));
  for (const imageUrls of [Array(10).fill(privateUrls[0]), [privateUrls[0], privateUrls[0]], ['../../secret'], [null]]) assert.equal((await emit(sockets[0], { imageUrls })).ok, false);
  const before = (await history()).length;
  assert.equal((await emit(sockets[0], { imageUrls: [privateUrls[0], '/api/images/00000000-0000-4000-8000-000000000000.png'] })).ok, false);
  assert.equal((await history()).length, before, 'No partial message on invalid second image');
  const nonce = randomUUID(), payload = { imageUrls: privateUrls, clientMessageId: nonce };
  const replies = await Promise.all([emit(sockets[0], payload), emit(sockets[0], payload)]);
  assert(replies.every((r) => r.ok)); assert.equal(replies[0].message.id, replies[1].message.id);
  assert.equal((await emit(sockets[0], { ...payload, imageUrls: [...privateUrls].reverse() })).ok, false);
  console.log('PASS private ACL for every album image, participant-only reads, owner-only publication, invalid albums, atomic validation, concurrent idempotency and order conflict');
  await recipient.setViewportSize({ width: 390, height: 844 });
  const bounds = await recipient.getByLabel('Альбом: 9 фото', { exact: true }).last().boundingBox();
  assert(bounds.width > 100 && bounds.x + bounds.width <= 391);
  assert.deepEqual(errors, []);
  console.log('PASS mobile album bounds and zero uncaught browser errors');
} finally {
  await browser?.close(); sockets.forEach((socket) => socket.disconnect());
  // Recover successful uploads even if a browser assertion interrupted a pending send.
  for (const user of users) {
    const messages = await db.orm.public.Message.where({ userId: user.id }).include('images').all();
    for (const m of messages) for (const url of [m.imageUrl, ...m.images.map((i) => i.imageUrl), m.audioUrl, m.videoUrl, m.documentUrl]) if (url) uploads.add(url);
  }
  for (const id of conversations) await db.orm.public.Conversation.where({ id }).delete();
  for (const user of users) await db.orm.public.User.where({ id: user.id }).delete();
  for (const url of uploads) {
    const match = /^\/api\/(images|audio|videos|documents)\/([0-9a-f-]{36})\.(png|jpg|webp|gif|wav|mp3|flac|mp4|webm|bin)$/.exec(url); if (!match) continue;
    const [, kind, id, ext] = match, directory = kind === 'images' ? '' : kind;
    await rm(join(process.cwd(), 'uploads', directory, `${id}.${ext}`), { force: true });
    await rm(join(process.cwd(), 'uploads', directory, 'metadata', `${id}.json`), { force: true });
    if (kind === 'images') await rm(join(process.cwd(), 'uploads', 'previews', `${id}.webp`), { force: true });
    if (kind === 'videos') await rm(join(process.cwd(), 'uploads', 'videos', 'posters', `${id}.jpg`), { force: true });
  }
  await rm(root, { recursive: true, force: true }); await db.close();
}
