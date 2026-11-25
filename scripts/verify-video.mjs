// Полная проверка HTTP + Socket.IO + реального Chrome. Только собственные временные фикстуры.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { io } from 'socket.io-client';
import { db } from '../src/prisma/db.ts';

const base = process.env.VERIFY_URL || 'http://localhost:3102';
const root = await mkdtemp(join(tmpdir(), 'mediachat-video-browser-'));
const suffix = randomUUID().slice(0, 8);
const users = [], sockets = [], uploads = [], conversations = [];
let browser;
const json = (path, body, cookie) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: base, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const get = (path, cookie, headers = {}) => fetch(base + path, { headers: { ...(cookie ? { cookie } : {}), ...headers } });
const emit = (socket, message) => new Promise((resolve, reject) => socket.timeout(15000).emit('chat-message', message, (error, response) => error ? reject(error) : resolve(response)));
async function until(check, label, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 100)); }
  throw new Error(`Timed out: ${label}`);
}
async function upload(bytes, name, type, cookie) {
  const response = await fetch(`${base}/api/videos/upload?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { cookie, origin: base, 'content-type': type }, body: bytes });
  const data = await response.json();
  if (response.status === 201) uploads.push(data.videoUrl);
  return { response, data };
}
function fixture(path, codec, extra = []) {
  execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=10', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', codec === 'libx264' ? '40' : '2', '-threads', '2', '-c:v', codec, '-pix_fmt', 'yuv420p', ...extra, '-c:a', codec === 'libvpx-vp9' ? 'libopus' : 'aac', path], { timeout: 60000 });
}
try {
  const mp4Path = join(root, `Видео ${suffix}.mp4`), webmPath = join(root, `Видео ${suffix}.webm`), unsupportedPath = join(root, 'unsupported.mp4');
  fixture(mp4Path, 'libx264', ['-preset', 'ultrafast', '-crf', '30', '-movflags', '+faststart']);
  fixture(webmPath, 'libvpx-vp9', ['-deadline', 'realtime', '-cpu-used', '8']);
  fixture(unsupportedPath, 'mpeg4');
  const portraitPath = join(root, "portrait.mp4");
  execFileSync("ffmpeg", ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=180x320:rate=10", "-t", "2", "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", portraitPath]);
  const mp4 = await readFile(mp4Path), webm = await readFile(webmPath);
  for (let i = 0; i < 2; i++) {
    const username = `video_verify_${suffix}_${i}`, password = 'Video-verify-123!';
    const registration = await json('/api/register', { username, password });
    assert.equal(registration.status, 201, await registration.clone().text());
    const { user } = await registration.json(); users.push(user);
    const login = await json('/api/login', { username, password }); assert.equal(login.status, 200);
    user.cookie = login.headers.get('set-cookie').split(';')[0];
    const socket = io(base, { transports: ['websocket'], extraHeaders: { Cookie: user.cookie, Origin: base }, reconnection: false });
    sockets.push(socket);
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  }
  const [a, b] = users;
  const privateUpload = await upload(mp4, 'private.mp4', 'video/mp4', a.cookie);
  assert.equal(privateUpload.response.status, 201, JSON.stringify(privateUpload.data));
  const privateUrl = privateUpload.data.videoUrl;
  assert.equal((await get(privateUrl)).status, 401);
  assert.equal((await get(privateUrl, b.cookie)).status, 404);
  assert.equal((await get(privateUrl + '/poster', b.cookie)).status, 404);
  assert.equal((await emit(sockets[1], { videoUrl: privateUrl })).ok, false);
  const conversation = await db.orm.public.Conversation.create({}); conversations.push(conversation.id);
  await db.orm.public.ConversationMember.create({ conversationId: conversation.id, userId: a.id });
  const privateMessage = await db.orm.public.Message.create({ userId: a.id, text: '', videoUrl: privateUrl, conversationId: conversation.id });
  assert.equal((await get(privateUrl, b.cookie, { range: 'bytes=0-15' })).status, 404);
  await db.orm.public.ConversationMember.create({ conversationId: conversation.id, userId: b.id });
  assert.equal((await get(privateUrl, b.cookie, { range: 'bytes=0-15' })).status, 206);
  assert.equal((await get(privateUrl + '/poster', b.cookie)).status, 200);
  assert.equal((await emit(sockets[1], { videoUrl: privateUrl })).ok, false);
  assert.equal((await get('/api/videos/not-a-uuid.mp4', a.cookie)).status, 404);
  assert.equal((await get(`/api/videos/${privateUrl.split('/').pop()}%2f..%2fsecret`, a.cookie)).status, 404);
  console.log('PASS: unpublished/private video and poster ACL, member access, foreign attach rejection, unsafe paths');

  const full = await get(privateUrl, a.cookie); assert.equal(full.status, 200); assert.equal(full.headers.get('accept-ranges'), 'bytes');
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), mp4);
  for (const [range, start, end] of [['bytes=0-15', 0, 15], ['bytes=10-', 10, mp4.length - 1], ['bytes=-10', mp4.length - 10, mp4.length - 1], ['bytes=0-99999999', 0, mp4.length - 1]]) {
    const response = await get(privateUrl, a.cookie, { range });
    assert.equal(response.status, 206); assert.equal(response.headers.get('content-range'), `bytes ${start}-${end}/${mp4.length}`);
    assert.equal(Number(response.headers.get('content-length')), end - start + 1);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), mp4.subarray(start, end + 1));
  }
  for (const range of ['bytes=-0', 'bytes=9-2', `bytes=${mp4.length}-`, 'bytes=0-1,3-4', 'bytes=0-99999999999999999999']) {
    const response = await get(privateUrl, a.cookie, { range }); assert.equal(response.status, 416); assert.equal(response.headers.get('content-range'), `bytes */${mp4.length}`);
  }
  const head = await fetch(base + privateUrl, { method: 'HEAD', headers: { cookie: a.cookie } }); assert.equal(head.status, 200); assert.equal(Number(head.headers.get('content-length')), mp4.length);
  const download = await get(privateUrl + '?download=1', a.cookie); assert.match(download.headers.get('content-disposition'), /^attachment;/); assert.deepEqual(Buffer.from(await download.arrayBuffer()), mp4);
  for (const [bytes, name, type, status] of [[Buffer.from('fake'), 'fake.mp4', 'video/mp4', 415], [Buffer.alloc(0), 'empty.mp4', 'video/mp4', 400], [webm, 'wrong.mp4', 'video/webm', 415], [await readFile(unsupportedPath), 'codec.mp4', 'video/mp4', 415], [mp4.subarray(0, 400), 'broken.mp4', 'video/mp4', 415]]) {
    const result = await upload(bytes, name, type, a.cookie); assert.equal(result.response.status, status, JSON.stringify(result.data));
  }
  const oversized = await new Promise((resolve, reject) => {
    const req = httpRequest(`${base}/api/videos/upload?name=huge.mp4`, { method: 'POST', headers: { cookie: a.cookie, 'content-type': 'video/mp4', 'content-length': 50 * 1024 * 1024 + 1 } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.setTimeout(10000, () => req.destroy(new Error('oversized request timeout'))); req.on('error', reject); req.end();
  });
  assert.equal(oversized, 413);
  console.log('PASS: Range 200/206/416, HEAD, original download bytes, invalid/corrupt/empty/MIME/codec/oversized rejection');

  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/private/tmp/mediachat-video-browser/node_modules/playwright-core/index.mjs');
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const contextA = await browser.newContext({ viewport: { width: 1100, height: 850 } });
  const contextB = await browser.newContext({ viewport: { width: 1100, height: 850 } });
  for (const [context, user] of [[contextA, a], [contextB, b]]) await context.addCookies([{ name: 'mediachat_session', value: user.cookie.slice('mediachat_session='.length), url: base, httpOnly: true, sameSite: 'Lax' }]);
  const pageA = await contextA.newPage(), pageB = await contextB.newPage();
  const errors = []; pageA.on('pageerror', (error) => errors.push(error.message)); pageB.on('pageerror', (error) => errors.push(error.message));
  await Promise.all([pageA.goto(base), pageB.goto(base)]);
  await pageA.getByText('Соединение установлено', { exact: true }).waitFor(); await pageB.getByText('Соединение установлено', { exact: true }).waitFor();
  await pageA.getByRole('button', { name: 'Прикрепить вложение', exact: true }).click();
  const chooserPromise = pageA.waitForEvent('filechooser');
  await pageA.getByRole('menuitem', { name: 'Видео', exact: true }).click();
  await (await chooserPromise).setFiles(mp4Path);
  await pageA.getByRole('button', { name: 'Убрать видео', exact: true }).waitFor();
  await pageA.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
  const fileName = `Видео ${suffix}.mp4`;
  const regionA = pageA.getByRole('region', { name: `Видео: ${fileName}`, exact: true });
  const regionB = pageB.getByRole('region', { name: `Видео: ${fileName}`, exact: true });
  await regionA.waitFor({ timeout: 45000 }); await regionB.waitFor({ timeout: 45000 });
  assert.equal(await pageB.getByRole('dialog').count(), 0);
  const history = await (await get('/api/messages', b.cookie)).json();
  assert(!history.messages.some((message) => message.id === privateMessage.id));
  const saved = history.messages.find((message) => message.video?.originalName === fileName); assert(saved?.video); assert.equal(saved.text, ''); uploads.push(saved.videoUrl);
  console.log('PASS: Chrome attachment menu, video-only upload, preview, Socket.IO delivery to second browser, message previews are silent and controls open only in viewer');

  await regionB.getByRole('button', { name: `Открыть видео ${fileName}`, exact: true }).click();
  const viewer = pageB.getByRole('dialog', { name: `Просмотр видео: ${fileName}`, exact: true });
  const element = viewer.locator('video');
  await until(() => element.evaluate((video) => !video.paused && video.readyState >= 2 && video.currentTime > 0), 'MP4 playing');
  assert(await element.evaluate((video) => video.playsInline && video.disablePictureInPicture && !video.controls));
  await regionB.getByRole('button', { name: 'Пауза видео', exact: true }).click();
  assert(await element.evaluate((video) => video.paused));
  await element.evaluate((video) => { video.currentTime = 0; });
  await regionB.getByRole('button', { name: 'Видео вперёд на 15 секунд', exact: true }).click();
  assert(await element.evaluate((video) => Math.abs(video.currentTime - 15) < .25));
  await regionB.getByRole('button', { name: 'Видео назад на 15 секунд', exact: true }).click();
  assert(await element.evaluate((video) => video.currentTime < .25));
  await regionB.getByRole('button', { name: 'Видео назад на 15 секунд', exact: true }).click();
  assert(await element.evaluate((video) => video.currentTime >= 0));
  const slider = regionB.getByRole('slider', { name: 'Позиция видео', exact: true }); const box = await slider.boundingBox();
  await pageB.mouse.click(box.x + box.width * .6, box.y + box.height / 2);
  assert(await element.evaluate((video) => video.currentTime > 20 && video.currentTime < 28));
  const volume = regionB.getByRole('slider', { name: 'Громкость видео', exact: true }); await volume.focus(); await volume.press('Home'); await volume.press('ArrowRight');
  assert(await element.evaluate((video) => video.volume > 0 && video.volume < .1));
  await regionB.getByRole('button', { name: 'Выключить звук видео', exact: true }).click(); assert(await element.evaluate((video) => video.muted));
  await regionB.getByRole('button', { name: 'Включить звук видео', exact: true }).click(); assert(await element.evaluate((video) => !video.muted));
  await regionB.getByRole('button', { name: 'Повтор видео', exact: true }).click(); assert(await element.evaluate((video) => video.loop));
  await regionB.getByRole('button', { name: 'Продолжить видео', exact: true }).click();
  await element.evaluate((video) => { video.currentTime = video.duration - .2; });
  await until(() => element.evaluate((video) => video.currentTime < 5 && !video.paused), 'loop restarts video');
  await regionB.getByRole('button', { name: 'Повтор видео', exact: true }).click(); assert(await element.evaluate((video) => !video.loop));
  await regionB.getByRole('button', { name: 'Остановить и закрыть видео', exact: true }).click(); assert.equal(await pageB.getByRole('dialog').count(), 0);
  await pageB.reload(); await regionB.waitFor(); assert.equal(await pageB.getByRole('dialog').count(), 0);
  await pageB.setViewportSize({ width: 620, height: 850 });
  await regionB.getByRole('button', { name: `Открыть видео ${fileName}`, exact: true }).click();
  await until(() => viewer.locator('video').evaluate((video) => video.readyState >= 2), 'narrow video');
  await viewer.screenshot({ path: process.env.VERIFY_SCREENSHOT || join(root, 'video-narrow.png') });
  assert(await regionB.evaluate((section) => section.scrollWidth <= section.clientWidth + 1), 'player overflows narrow message');
  console.log('PASS: real Chrome MP4 play/pause, +/-15, scrub, volume, mute, loop, close, reload, inline/PiP restrictions, narrow layout');
  const browserDownload = pageB.waitForEvent('download');
  await regionB.getByRole('link', { name: `Скачать видео ${fileName}`, exact: true }).click();
  const downloaded = await browserDownload; const downloadedPath = join(root, 'downloaded.mp4');
  await downloaded.saveAs(downloadedPath); assert.deepEqual(await readFile(downloadedPath), mp4);
  await regionB.getByRole('button', { name: 'Остановить и закрыть видео', exact: true }).click();
  await pageB.route(base + saved.videoUrl, (route) => route.fulfill({ status: 404, body: 'Not found' }));
  await regionB.getByRole('button', { name: `Открыть видео ${fileName}`, exact: true }).click();
  await regionB.getByRole('alert').waitFor();
  await regionB.getByRole('button', { name: 'Остановить и закрыть видео', exact: true }).click();
  await pageB.unroute(base + saved.videoUrl);
  const portrait = await upload(await readFile(portraitPath), `portrait-${suffix}.mp4`, 'video/mp4', a.cookie);
  assert.equal(portrait.response.status, 201, JSON.stringify(portrait.data)); assert(portrait.data.video.width < portrait.data.video.height);
  assert((await emit(sockets[0], { videoUrl: portrait.data.videoUrl, clientMessageId: randomUUID() })).ok);
  const portraitRegion = pageB.getByRole('region', { name: `Видео: portrait-${suffix}.mp4`, exact: true });
  await portraitRegion.getByRole('button', { name: `Открыть видео portrait-${suffix}.mp4`, exact: true }).click();
  await until(() => pageB.getByRole('dialog').locator('video').evaluate((video) => video.videoHeight > video.videoWidth && video.readyState >= 2), 'portrait aspect ratio');
  assert(await portraitRegion.evaluate((section) => section.scrollWidth <= section.clientWidth + 1));
  console.log('PASS: Chrome original download, handled 404 playback error, portrait MP4 with moov at end');


  const webmUpload = await upload(webm, `Видео ${suffix}.webm`, 'video/webm', b.cookie); assert.equal(webmUpload.response.status, 201, JSON.stringify(webmUpload.data));
  const nonce = randomUUID(); const message = { videoUrl: webmUpload.data.videoUrl, clientMessageId: nonce };
  const replies = await Promise.all([emit(sockets[1], message), emit(sockets[1], message)]); assert(replies.every((result) => result.ok)); assert.equal(replies[0].message.id, replies[1].message.id);
  const webmRegion = pageA.getByRole('region', { name: `Видео: Видео ${suffix}.webm`, exact: true });
  await webmRegion.waitFor(); await webmRegion.getByRole('button', { name: `Открыть видео Видео ${suffix}.webm`, exact: true }).click();
  await until(() => pageA.getByRole('dialog').locator('video').evaluate((video) => !video.paused && video.currentTime > 0), 'WebM playing');
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('PASS: real Chrome WebM play, video idempotency, no uncaught page errors');
} finally {
  await browser?.close(); for (const socket of sockets) socket.disconnect();
  for (const id of conversations) await db.orm.public.Conversation.where({ id }).delete();
  for (const user of users) await db.orm.public.User.where({ id: user.id }).delete();
  for (const url of new Set(uploads)) {
    const filename = url.split('/').pop(), id = filename.split('.')[0];
    await Promise.all([rm(join(process.cwd(), 'uploads/videos', filename), { force: true }), rm(join(process.cwd(), 'uploads/videos/metadata', `${id}.json`), { force: true }), rm(join(process.cwd(), 'uploads/videos/posters', `${id}.jpg`), { force: true })]);
  }
  await db.close(); await rm(root, { recursive: true, force: true });
  console.log('Cleaned only this run\'s temporary accounts, messages and video files. Existing user data retained.');
}
