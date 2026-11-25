// Полная проверка API + Socket.IO. Создаёт только собственные тестовые записи и удаляет их в finally.
// Запускать с отдельным server.js: PORT=3101 MEDIA_CHAT_DIST_DIR=.next/verification npm run dev
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { io } from 'socket.io-client';
import { SignJWT } from 'jose';
import sharp from 'sharp';
import { db } from '../src/prisma/db.ts';

const base = process.env.VERIFY_URL || 'http://localhost:3101';
const prefix = `verify_${randomUUID().slice(0, 8)}`;
const users = [], sockets = [], uploaded = [], conversations = [];
const password = 'Verify-test-123!';
const origin = new URL(base).origin;
const json = async (path, body, cookie) => fetch(`${base}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', origin, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
});
const get = (path, cookie, headers = {}) => fetch(`${base}${path}`, { headers: { ...(cookie ? { cookie } : {}), ...headers } });
const emit = (socket, data) => new Promise((resolve, reject) => socket.timeout(15_000).emit('chat-message', data, (error, response) => error ? reject(error) : resolve(response)));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function connect(cookie, customOrigin = origin) {
  const socket = io(base, { transports: ['websocket'], reconnection: false, extraHeaders: { Cookie: cookie, Origin: customOrigin }, timeout: 8000 });
  sockets.push(socket);
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  return socket;
}
async function upload(kind, bytes, name, mime, cookie) {
  const paths = { document: '/api/documents/upload', image: '/api/upload', audio: '/api/audio/upload' };
  const form = new FormData(); form.append(kind, new File([bytes], name, { type: mime }));
  const response = await fetch(base + paths[kind], { method: 'POST', headers: { cookie, origin }, body: form });
  const result = await response.json();
  assert.equal(response.status, 201, JSON.stringify(result));
  const url = result[`${kind}Url`];
  assert(url); uploaded.push({ kind, url });
  return { ...result, url };
}

try {
  for (let i = 0; i < 2; i++) {
    const username = `${prefix}_${i}`;
    const response = await json('/api/register', { username, password });
    assert.equal(response.status, 201, await response.clone().text());
    const { user } = await response.json(); users.push(user);
    const login = await json('/api/login', { username, password });
    assert.equal(login.status, 200);
    user.cookie = login.headers.get('set-cookie').split(';')[0];
    assert.match(login.headers.get('set-cookie'), /HttpOnly/i);
    assert.equal((await get('/api/me', user.cookie)).status, 200);
  }
  const [a, b] = users;
  assert.equal((await json('/api/register', { username: a.username, password })).status, 409);
  assert.equal((await fetch(base + '/api/register', { method: 'POST', body: '{' })).status, 400);
  assert.equal((await json('/api/register', { username: `${prefix}_bad`, password: '        ' })).status, 400);
  assert.equal((await json('/api/register', { username: `${prefix}_limit`, password })).status, 429);
  assert.equal((await json('/api/login', null)).status, 400);
  assert.equal((await json('/api/login', { username: a.username, password: 'wrong' })).status, 401);
  assert.equal((await get('/api/messages')).status, 401);
  const socketA = await connect(a.cookie), socketB = await connect(b.cookie);
  const events = []; socketB.on('chat-message', (message) => events.push(message));
  await assert.rejects(connect(a.cookie, 'https://untrusted.invalid'));
  console.log('PASS registration, login, duplicate, malformed JSON, blank password, rate limit, unauthorized history, WebSocket Origin');

  const original = Buffer.from('Проверка оригинального документа\n1,2,3\n');
  const document = await upload('document', original, 'Проверка.txt', 'text/plain', a.cookie);
  assert.equal((await get(document.url)).status, 401);
  assert.equal((await get(document.url, b.cookie)).status, 404);
  assert.equal((await emit(socketB, { documentUrl: document.url })).ok, false);
  // Проверяем ACL личного вложения существующей моделью, не внедряя пока UI диалогов.
  const conversation = await db.orm.public.Conversation.create({}); conversations.push(conversation.id);
  await db.orm.public.ConversationMember.create({ conversationId: conversation.id, userId: a.id });
  const privateMessage = await db.orm.public.Message.create({ text: '', userId: a.id, conversationId: conversation.id, documentUrl: document.url });
  assert.equal((await get(document.url, b.cookie)).status, 404);
  await db.orm.public.ConversationMember.create({ conversationId: conversation.id, userId: b.id });
  assert.equal((await get(document.url, b.cookie)).status, 200);
  assert.equal((await emit(socketB, { documentUrl: document.url })).ok, false);
  const nonce = randomUUID();
  const payload = { text: 'document integration test', documentUrl: document.url, clientMessageId: nonce };
  const results = await Promise.all([emit(socketA, payload), emit(socketA, payload)]);
  assert(results.every((result) => result.ok)); assert.equal(results[0].message.id, results[1].message.id);
  assert.equal(results[0].message.document.originalName, 'Проверка.txt');
  await sleep(150);
  assert.equal(events.filter((event) => event.id === results[0].message.id).length, 1);
  const download = await get(document.url, b.cookie);
  assert.equal(download.status, 200); assert.match(download.headers.get('content-disposition'), /^attachment;/);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), original);
  const history = await (await get('/api/messages', b.cookie)).json();
  assert.equal(history.messages.find((message) => message.id === results[0].message.id).document.originalName, 'Проверка.txt');
  assert.equal(history.messages.some((message) => message.id === privateMessage.id), false);
  const changed = await emit(socketA, { ...payload, text: 'different' }); assert.equal(changed.ok, false);
  assert.equal((await emit(socketB, { text: 'forbidden', conversationId: conversation.id })).ok, false);
  console.log('PASS document upload, private ACL, foreign publish rejection, concurrent idempotency, single realtime event, history, exact download bytes');

  for (const [bytes, name, expected] of [[Buffer.alloc(0), 'empty.txt', 400], [Buffer.from('not pdf'), 'fake.pdf', 415], [Buffer.alloc(25 * 1024 * 1024 + 1), 'large.txt', 413]]) {
    const form = new FormData(); form.append('document', new File([bytes], name));
    const response = await fetch(base + '/api/documents/upload', { method: 'POST', headers: { cookie: a.cookie, origin }, body: form });
    assert.equal(response.status, expected, await response.text());
  }
  assert.equal((await get('/api/documents/not-a-uuid.txt', a.cookie)).status, 404);
  console.log('PASS empty, spoofed PDF, prohibited extension, oversized upload, invalid filename');

  const imageBytes = await sharp({ create: { width: 12, height: 12, channels: 3, background: '#6753dc' } }).png().toBuffer();
  const image = await upload('image', imageBytes, 'test.png', 'image/png', a.cookie);
  assert.equal((await get(image.url, b.cookie)).status, 404);
  assert.equal((await emit(socketB, { imageUrl: image.url })).ok, false);
  assert.equal((await emit(socketA, { imageUrl: image.url, clientMessageId: randomUUID() })).ok, true);
  assert.deepEqual(Buffer.from(await (await get(image.url, b.cookie)).arrayBuffer()), imageBytes);
  const audioBytes = Buffer.alloc(44 + 16000);
  audioBytes.write('RIFF'); audioBytes.writeUInt32LE(audioBytes.length - 8, 4); audioBytes.write('WAVEfmt ', 8);
  audioBytes.writeUInt32LE(16, 16); audioBytes.writeUInt16LE(1, 20); audioBytes.writeUInt16LE(1, 22); audioBytes.writeUInt32LE(8000, 24);
  audioBytes.writeUInt32LE(16000, 28); audioBytes.writeUInt16LE(2, 32); audioBytes.writeUInt16LE(16, 34); audioBytes.write('data', 36); audioBytes.writeUInt32LE(16000, 40);
  const audio = await upload('audio', audioBytes, 'Тест.wav', 'audio/wav', a.cookie);
  assert.equal((await emit(socketB, { audioUrl: audio.url })).ok, false);
  const audioSent = await emit(socketA, { audioUrl: audio.url, clientMessageId: randomUUID() }); assert(audioSent.ok); assert.equal(audioSent.message.audioName, 'Тест.wav');
  const range = await get(audio.url, b.cookie, { range: 'bytes=0-15' }); assert.equal(range.status, 206);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), audioBytes.subarray(0, 16));
  const text = await emit(socketA, { text: 'plain text test', clientMessageId: randomUUID() }); assert(text.ok);
  console.log('PASS existing image, audio filename, foreign image/audio rejection, audio HTTP Range, ordinary text');

  const token = await new SignJWT({ userId: a.id }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime(Math.floor(Date.now() / 1000) + 2).sign(new TextEncoder().encode(process.env.SESSION_SECRET));
  const expiring = await connect(`mediachat_session=${token}`);
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('JWT socket did not expire')), 5000); expiring.once('disconnect', () => { clearTimeout(timer); resolve(); }); });
  assert.equal((await get('/api/messages', `mediachat_session=${token}`)).status, 401);
  const logout = await json('/api/logout', {}, b.cookie); assert.equal(logout.status, 200); assert.match(logout.headers.get('set-cookie'), /Max-Age=0/i);
  console.log('PASS JWT expiry disconnect, expired HTTP session, logout clears cookie');
} finally {
  for (const socket of sockets) socket.disconnect();
  for (const id of conversations) await db.orm.public.Conversation.where({ id }).delete();
  for (const user of users) await db.orm.public.User.where({ id: user.id }).delete();
  for (const { kind, url } of uploaded) {
    const filename = url.split('/').pop(), id = filename.split('.')[0];
    const directory = kind === 'document' ? 'documents' : kind === 'audio' ? 'audio' : '';
    await rm(join(process.cwd(), 'uploads', directory, filename), { force: true });
    await rm(join(process.cwd(), 'uploads', directory, 'metadata', `${id}.json`), { force: true });
    if (kind === 'image') await rm(join(process.cwd(), 'uploads', 'previews', `${id}.webp`), { force: true });
  }
  await db.close();
  console.log('Removed only records and files created by this verification run.');
}
