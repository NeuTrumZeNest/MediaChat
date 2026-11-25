// Tests only its own accounts/files; orphan sweep is restricted to an isolated temp root.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, lstat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { io } from 'socket.io-client';
import { db } from '../src/prisma/db.ts';
import { cleanupMedia, mediaFiles, processCleanupJobs, sweepOrphanMedia, ORPHAN_GRACE_MS } from '../src/lib/media-cleanup.ts';
import { lockResources, mediaResource } from '../src/lib/media-locks.ts';
const base = process.env.VERIFY_URL || 'http://localhost:3102';
const root = await mkdtemp(join(tmpdir(), 'mediachat-delete-')), users = [], sockets = [], uploads = new Set(), conversations = [];
let browser;
const suffix = randomUUID().slice(0, 8);
const json = (path, body) => fetch(base + path, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const get = (url, cookie) => fetch(base + url, { headers: cookie ? { cookie } : {} });
const emit = (socket, event, payload) => new Promise((resolve, reject) => socket.timeout(20000).emit(event, payload, (error, result) => error ? reject(error) : resolve(result)));
async function until(check, label, timeout = 25000) { const started = Date.now(); while (Date.now() - started < timeout) { if (await check()) return; await new Promise((r) => setTimeout(r, 100)); } throw new Error(`Timed out: ${label}`); }
async function exists(path) { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function multipart(kind, bytes, name, type, cookie) {
  const form = new FormData(); form.append(kind, new File([bytes], name, { type }));
  const endpoint = kind === 'image' ? '/api/upload' : kind === 'audio' ? '/api/audio/upload' : '/api/documents/upload';
  const response = await fetch(base + endpoint, { method: 'POST', headers: { cookie, origin: base }, body: form });
  const data = await response.json(); assert.equal(response.status, 201, JSON.stringify(data));
  const url = data[`${kind}Url`]; uploads.add(url); return url;
}
async function send(socket, payload) { const result = await emit(socket, 'chat-message', payload); assert(result.ok, JSON.stringify(result)); return result.message; }
async function remove(socket, id) { const result = await emit(socket, 'delete-message', { id }); assert(result.ok, JSON.stringify(result)); return result; }
try {
  for (let i = 0; i < 2; i++) {
    const username = `delete_${suffix}_${i}`, password = 'Deletion-check-123!';
    const registered = await json('/api/register', { username, password }); assert.equal(registered.status, 201, await registered.clone().text());
    const { user } = await registered.json(); users.push(user);
    const login = await json('/api/login', { username, password }); assert.equal(login.status, 200); user.cookie = login.headers.get('set-cookie').split(';')[0];
    const socket = io(base, { transports: ['websocket'], extraHeaders: { Cookie: user.cookie, Origin: base }, reconnection: false }); sockets.push(socket);
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  }
  const [a, b] = users, [sa, sb] = sockets;
  const payload = { text: `Delete me ${suffix}`, clientMessageId: randomUUID() };
  const original = await send(sa, payload), reply = await send(sb, { text: `Answer ${suffix}`, replyToId: original.id, clientMessageId: randomUUID() });
  assert.equal((await emit(sb, 'delete-message', { id: original.id, userId: a.id })).ok, false);
  const conversation = await db.orm.public.Conversation.create({}); conversations.push(conversation.id);
  await db.orm.public.ConversationMember.create({ conversationId: conversation.id, userId: a.id });
  const secret = await db.orm.public.Message.create({ text: 'private fixture', userId: a.id, conversationId: conversation.id });
  assert.equal((await emit(sa, 'delete-message', { id: secret.id })).ok, false);
  for (const id of [0, -1, '1', {}, 999999999]) assert.equal((await emit(sa, 'delete-message', { id })).ok, false);
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/private/tmp/mediachat-video-browser/node_modules/playwright-core/index.mjs');
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const pages = [], errors = [];
  for (const user of users) {
    const context = await browser.newContext({ viewport: { width: 1100, height: 850 } });
    await context.addCookies([{ name: 'mediachat_session', value: user.cookie.split('=')[1], url: base, httpOnly: true, sameSite: 'Lax' }]);
    await context.addInitScript(() => {
      window.__testSockets = [];
      const Original = window.WebSocket;
      window.WebSocket = class extends Original { constructor(...args) { super(...args); window.__testSockets.push(this); } };
    });
    const page = await context.newPage(); pages.push(page); page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(base); await page.getByText('Соединение установлено', { exact: true }).waitFor({ timeout: 45000 });
  }
  const [pa, pb] = pages, row = (page, id) => page.locator(`#message-${id}`);
  const menu = (page) => page.getByRole('menu', { name: 'Действия сообщения', exact: true });
  await row(pb, original.id).click({ button: 'right' }); assert(await menu(pb).getByRole('menuitem', { name: 'Удалить', exact: true }).isDisabled());
  await pb.keyboard.press('Escape'); await menu(pb).waitFor({ state: 'detached' });
  await row(pa, original.id).click({ button: 'right' }); await menu(pa).getByRole('menuitem', { name: 'Удалить', exact: true }).click();
  await pa.getByRole('alertdialog').waitFor(); await pa.getByRole('alertdialog').getByRole('button', { name: 'Отмена', exact: true }).click();
  assert.equal(await row(pa, original.id).count(), 1);
  await row(pa, original.id).click({ button: 'right' }); await menu(pa).getByRole('menuitem', { name: 'Удалить', exact: true }).click();
  await pa.context().setOffline(true);
  await pa.evaluate(() => { for (const socket of window.__testSockets) if (socket.url.includes('/socket.io/')) socket.close(); });
  await pa.getByText('Нет соединения', { exact: true }).waitFor();
  await pa.getByRole('alertdialog').getByRole('button', { name: 'Удалить у всех', exact: true }).click();
  await pa.getByRole('alertdialog').getByRole('alert').filter({ hasText: 'Нет соединения' }).waitFor();
  assert.equal(await row(pa, original.id).count(), 1);
  await pa.context().setOffline(false);
  await pa.getByText('Соединение установлено', { exact: true }).waitFor({ timeout: 30000 });
  await pa.getByRole('alertdialog').getByRole('button', { name: 'Удалить у всех', exact: true }).click();
  await row(pa, original.id).waitFor({ state: 'detached' }); await row(pb, original.id).waitFor({ state: 'detached' });
  assert((await row(pb, reply.id).innerText()).includes('Сообщение удалено'));
  for (const page of pages) { await page.reload(); await row(page, reply.id).waitFor(); assert.equal(await row(page, original.id).count(), 0); assert((await row(page, reply.id).innerText()).includes('Сообщение удалено')); }
  const tombstone = await db.orm.public.Message.where({ id: original.id }).include('images').first();
  assert(tombstone.deletedAt); assert.equal(tombstone.text, ''); assert.equal(tombstone.images.length, 0);
  assert.equal((await emit(sa, 'edit-message', { id: original.id, text: 'resurrect', expectedText: '' })).ok, false);
  const replay = await emit(sa, 'chat-message', payload); assert(replay.ok && replay.deleted); assert.equal(replay.id, original.id);
  await remove(sa, original.id);
  const history = await (await get('/api/messages', b.cookie)).json(); assert(history.deletedMessageIds.includes(original.id)); assert(!history.messages.some((m) => m.id === original.id));
  const refusedReply = await emit(sb, 'chat-message', { text: 'new answer', replyToId: original.id, clientMessageId: randomUUID() }); assert.equal(refusedReply.ok, false); assert.equal(refusedReply.code, 'REPLY_UNAVAILABLE');
  console.log('PASS Chrome delete/cancel/confirmation, author/private/invalid-ID checks, two-account realtime, deleted quote, reload, cleared tombstone, edit/reply rejection, idempotent delete and stale-send replay without resurrection');

  const png = await sharp({ create: { width: 100, height: 80, channels: 3, background: 'purple' } }).png().toBuffer();
  const imageUrls = [await multipart('image', png, 'one.png', 'image/png', a.cookie), await multipart('image', png, 'two.png', 'image/png', a.cookie)];
  const albumPayload = { imageUrls, clientMessageId: randomUUID() }, album = await send(sa, albumPayload);
  const neighbourUrl = await multipart('image', png, 'neighbour.png', 'image/png', a.cookie);
  const neighbour = await send(sa, { imageUrls: [neighbourUrl], clientMessageId: randomUUID() });
  await row(pb, album.id).getByRole('button', { name: 'Открыть изображение', exact: true }).first().click();
  await pb.keyboard.press('ArrowRight'); await pb.keyboard.press('ArrowRight');
  await until(async () => await pb.getByRole('dialog', { name: 'Просмотр изображения', exact: true }).locator('img').getAttribute('src') === neighbourUrl, 'navigated to another message image');
  await remove(sa, neighbour.id); await pb.getByRole('dialog', { name: 'Просмотр изображения', exact: true }).waitFor({ state: 'detached' });
  for (const path of mediaFiles(neighbourUrl).files) assert(!await exists(path));

  await row(pb, album.id).getByRole('button', { name: 'Открыть изображение', exact: true }).first().click(); await pb.getByRole('dialog', { name: 'Просмотр изображения', exact: true }).waitFor();
  await remove(sa, album.id); await pb.getByRole('dialog', { name: 'Просмотр изображения', exact: true }).waitFor({ state: 'detached' });
  for (const url of imageUrls) { for (const path of mediaFiles(url).files) assert(!await exists(path)); assert.equal((await get(url, a.cookie)).status, 404); }
  assert.equal((await emit(sa, 'chat-message', albumPayload)).deleted, true, 'Deleted originals are not needed to deduplicate old sends');
  console.log('PASS image album removal deletes every original/preview/metadata and closes another account viewer');

  const documentUrl = await multipart('document', Buffer.from('shared bytes'), 'shared.unknown', 'application/octet-stream', a.cookie);
  const first = await send(sa, { documentUrl, clientMessageId: randomUUID() }), second = await send(sa, { documentUrl, clientMessageId: randomUUID() });
  await db.orm.public.MediaCleanupJob.create({ url: documentUrl, ownerId: a.id });
  await remove(sa, first.id); assert.equal((await get(documentUrl, b.cookie)).status, 200);
  await remove(sa, second.id); for (const path of mediaFiles(documentUrl).files) assert(!await exists(path));
  console.log('PASS shared document retained until its last message reference is removed');

  const audioPath = join(root, 'sound.wav'), videoPath = join(root, 'clip.mp4');
  execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '15', '-c:a', 'pcm_s16le', audioPath]);
  execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x120:rate=10', '-t', '15', '-threads', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', videoPath]);
  const audioUrl = await multipart('audio', await readFile(audioPath), 'sound.wav', 'audio/wav', a.cookie), audio = await send(sa, { audioUrl, clientMessageId: randomUUID() });
  await row(pb, audio.id).getByRole('button', { name: 'Воспроизвести sound.wav', exact: true }).click();
  const player = pb.getByLabel('Музыкальный плеер', { exact: true }); await player.waitFor();
  const audioElement = await player.locator('audio').elementHandle(); await until(() => audioElement.evaluate((node) => !node.paused), 'audio started');
  await remove(sa, audio.id); await player.waitFor({ state: 'detached' }); assert(await audioElement.evaluate((node) => node.paused));
  for (const path of mediaFiles(audioUrl).files) assert(!await exists(path));
  const videoResponse = await fetch(base + '/api/videos/upload?name=clip.mp4', { method: 'POST', headers: { cookie: a.cookie, origin: base, 'content-type': 'video/mp4' }, body: await readFile(videoPath) });
  const videoData = await videoResponse.json(); assert.equal(videoResponse.status, 201, JSON.stringify(videoData)); uploads.add(videoData.videoUrl);
  const video = await send(sa, { videoUrl: videoData.videoUrl, clientMessageId: randomUUID() });
  await row(pb, video.id).getByRole('button', { name: 'Открыть видео clip.mp4', exact: true }).click();
  await pb.locator('dialog[open]').waitFor();
  const videoElement = await pb.locator('dialog[open] video').elementHandle(); await until(() => videoElement.evaluate((node) => !node.paused), 'video playing');
  await remove(sa, video.id); await pb.locator('dialog[open]').waitFor({ state: 'detached' }); assert(await videoElement.evaluate((node) => node.paused));
  for (const path of mediaFiles(videoData.videoUrl).files) assert(!await exists(path));
  console.log('PASS audio/video removal stops playback/closes viewer and deletes audio originals, video originals/posters and metadata');

  // Durable retry: inconsistent metadata must not authorize deleting an unrelated owner's file.
  const retryUrl = await multipart('document', Buffer.from('retry bytes'), 'retry.bin', 'application/octet-stream', a.cookie), retryMessage = await send(sa, { documentUrl: retryUrl, clientMessageId: randomUUID() });
  const paths = mediaFiles(retryUrl), metadata = JSON.parse(await readFile(paths.metadata, 'utf8'));
  await writeFile(paths.metadata, JSON.stringify({ ...metadata, ownerId: b.id }));
  await remove(sa, retryMessage.id); assert(await exists(paths.original));
  const pending = await db.orm.public.MediaCleanupJob.where({ url: retryUrl }).first(); assert(pending && pending.attempts > 0);
  await writeFile(paths.metadata, JSON.stringify(metadata)); await processCleanupJobs([retryUrl]);
  assert(!await exists(paths.original)); assert.equal(await db.orm.public.MediaCleanupJob.where({ url: retryUrl }).first(), null);
  console.log('PASS cleanup failure preserves file and durable job; correcting metadata permits a safe retry');

  const isolated = join(root, 'isolated-uploads'); await mkdir(join(isolated, 'documents', 'metadata'), { recursive: true }); await mkdir(join(isolated, 'documents', 'staging'), { recursive: true });
  async function fixture(old = true) {
    const id = randomUUID(), url = `/api/documents/${id}.bin`, paths = mediaFiles(url, isolated);
    await writeFile(paths.original, 'orphan bytes'); await writeFile(paths.metadata, JSON.stringify({ id, filename: `${id}.bin`, extension: 'bin', ownerId: a.id }));
    if (old) for (const path of paths.files) await utimes(path, new Date(Date.now() - ORPHAN_GRACE_MS - 60_000), new Date(Date.now() - ORPHAN_GRACE_MS - 60_000));
    return { url, paths };
  }
  const orphan = await fixture(), recent = await fixture(false), protectedFile = await fixture();
  await mkdir(join(isolated, 'metadata'), { recursive: true }); await mkdir(join(isolated, 'previews'), { recursive: true });
  const previewId = randomUUID(), oldPreview = join(isolated, 'previews', `${previewId}.webp`), oldMeta = join(isolated, 'metadata', `${previewId}.json`);
  await writeFile(oldPreview, 'orphan preview'); await writeFile(oldMeta, JSON.stringify({ id: previewId, extension: 'png', ownerId: a.id }));
  for (const path of [oldPreview, oldMeta]) await utimes(path, new Date(0), new Date(0));
  const unknown = join(isolated, 'documents', `${randomUUID()}.bin`); await writeFile(unknown, 'unverified'); await utimes(unknown, new Date(0), new Date(0));

  const protectedMessage = await db.orm.public.Message.create({ text: '', documentUrl: protectedFile.url, userId: a.id, conversationId: conversation.id });
  const legacy = await fixture();
  await db.orm.public.Message.create({ text: '', documentUrl: `/uploads/documents/${legacy.url.split('/').pop()}`, userId: a.id, conversationId: conversation.id });

  const staleStage = join(isolated, 'documents', 'staging', `${randomUUID()}.bin`); await writeFile(staleStage, 'interrupted'); await utimes(staleStage, new Date(0), new Date(0));
  const dry = await sweepOrphanMedia({ root: isolated }); assert(dry.some((item) => item.url === orphan.url && item.status === 'would-delete')); assert(await exists(orphan.paths.original)); assert(await exists(staleStage));
  await sweepOrphanMedia({ root: isolated, apply: true }); assert(!await exists(orphan.paths.original)); assert(!await exists(staleStage)); assert(!await exists(oldPreview)); assert(!await exists(oldMeta)); assert(await exists(unknown)); assert(await exists(recent.paths.original)); assert(await exists(protectedFile.paths.original)); assert(await exists(legacy.paths.original));
  // GC must wait while a new reference is being attached under the same advisory lock.
  const race = await fixture(); let unlock, locked; const held = new Promise((resolve) => { locked = resolve; }), gate = new Promise((resolve) => { unlock = resolve; });
  const attaching = db.transaction(async (tx) => { await lockResources(tx, [mediaResource(race.url)]); locked(); await gate; await tx.orm.public.Message.create({ text: '', documentUrl: race.url, userId: a.id, conversationId: conversation.id }); });
  await held; let finished = false; const cleaning = cleanupMedia(race.url, a.id, { root: isolated, apply: true }).then((result) => { finished = true; return result; });
  await new Promise((resolve) => setTimeout(resolve, 100)); assert.equal(finished, false); unlock(); await attaching;
  assert.equal((await cleaning).status, 'referenced'); assert(await exists(race.paths.original));
  assert.equal((await cleanupMedia('/api/documents/../../outside', a.id, { root: isolated, apply: true })).status, 'unverified');
  assert.deepEqual(errors, []);
  await db.orm.public.Message.where({ id: protectedMessage.id }).delete();
  console.log('PASS isolated dry-run/apply, 24h orphan/staging cleanup, recent and private referenced files retained, cross-transaction attach/GC locking, traversal rejected, zero browser errors');
} finally {
  await browser?.close(); sockets.forEach((socket) => socket.disconnect());
  for (const url of uploads) await db.orm.public.MediaCleanupJob.where({ url }).delete();
  for (const id of conversations) await db.orm.public.Conversation.where({ id }).delete();
  for (const user of users) await db.orm.public.User.where({ id: user.id }).delete();
  for (const url of uploads) { const paths = mediaFiles(url); if (paths) for (const path of paths.files) await rm(path, { force: true }); }
  await rm(root, { recursive: true, force: true }); await db.close();
}
