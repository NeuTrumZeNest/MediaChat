// Integration verification uses only its own three accounts, conversations and uploads.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import bcrypt from 'bcryptjs';
import { io } from 'socket.io-client';
import { db } from '../src/prisma/db.ts';
const base = process.env.VERIFY_URL || 'http://localhost:3102';
const suffix = randomUUID().slice(0, 8), users = [], sockets = [], conversations = new Set(), uploads = [];
const root = await mkdtemp(join(tmpdir(), 'mediachat-direct-'));
let browser;
const uploadResponses = [];
const get = (path, user, headers = {}) => fetch(base + path, { headers: { ...(user ? { cookie: user.cookie } : {}), ...headers } });
const post = (path, body, user) => fetch(base + path, { method: 'POST', headers: { origin: base, 'content-type': 'application/json', ...(user ? { cookie: user.cookie } : {}) }, body: JSON.stringify(body) });
const emit = (socket, event, payload) => new Promise((resolve, reject) => socket.timeout(15000).emit(event, payload, (error, result) => error ? reject(error) : resolve(result)));
async function connect(user) {
  const socket = io(base, { transports: ['websocket'], extraHeaders: { Cookie: user.cookie, Origin: base }, reconnection: false }); sockets.push(socket);
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); }); return socket;
}
async function until(check, label, timeout = 25000) { const started = Date.now(); while (Date.now() - started < timeout) { if (await check()) return; await new Promise((r) => setTimeout(r, 80)); } throw new Error(`Timed out: ${label}`); }
async function create(a, b) {
  const response = await post('/api/conversations', { userId: b.id }, a); const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); conversations.add(data.conversationId); return data.conversationId;
}
async function upload(user, kind, bytes) {
  let response;
  if (kind === 'image' || kind === 'audio') {
    const form = new FormData(); form.append(kind, new File([bytes], kind === 'image' ? 'dm.png' : 'dm.wav', { type: kind === 'image' ? 'image/png' : 'audio/wav' }));
    response = await fetch(base + (kind === 'image' ? '/api/upload' : '/api/audio/upload'), { method: 'POST', headers: { cookie: user.cookie, origin: base }, body: form });
  } else {
    response = await fetch(base + `/api/${kind === 'video' ? 'videos' : 'documents'}/upload?name=${kind === 'video' ? 'dm.mp4' : 'dm.txt'}`, { method: 'POST', headers: { cookie: user.cookie, origin: base, 'content-type': kind === 'video' ? 'video/mp4' : 'text/plain' }, body: bytes });
  }
  const data = await response.json(); assert.equal(response.status, 201, JSON.stringify(data)); const url = data[`${kind === 'image' ? 'image' : kind}Url`]; assert(url, JSON.stringify(data)); uploads.push(url); return url;
}
try {
  for (let i = 0; i < 3; i++) {
    const username = `direct_${suffix}_${i}`, password = 'Direct-messages-123!';
    let user;
    if (process.env.VERIFY_FIXTURES_VIA_DB === '1') {
      const row = await db.orm.public.User.create({ username, passwordHash: await bcrypt.hash(password, 12) });
      user = { id: row.id, username: row.username };
    } else {
      const response = await post('/api/register', { username, password }); assert.equal(response.status, 201, await response.clone().text());
      user = (await response.json()).user;
    }
    users.push(user);
    const login = await post('/api/login', { username, password }); assert.equal(login.status, 200); if (base.startsWith('https:')) { assert.match(login.headers.get('set-cookie'), /; Secure/i); assert.match(login.headers.get('set-cookie'), /; HttpOnly/i); } user.cookie = login.headers.get('set-cookie').split(';')[0];
  }
  const [a, b, c] = users, sa = await connect(a), sb = await connect(b), sc = await connect(c), sa2 = await connect(a);
  const eventsA2 = [], eventsB = [], eventsC = [];
  sa2.on('chat-message', (m) => eventsA2.push(m)); sb.on('chat-message', (m) => eventsB.push(m)); sc.on('chat-message', (m) => eventsC.push(m));
  const ids = await Promise.all([create(a, b), create(b, a), create(a, b), create(b, a)]); assert.equal(new Set(ids).size, 1);
  const ab = ids[0], ac = await create(a, c);
  assert.equal((await db.orm.public.Conversation.where({ directKey: [a.id, b.id].sort((a, b) => a - b).join(':') }).all()).length, 1);
  assert.equal((await post('/api/conversations', { userId: a.id }, a)).status, 400);
  assert.equal((await fetch(base + '/api/conversations', { method: 'POST', headers: { cookie: a.cookie, origin: 'https://untrusted.invalid', 'content-type': 'application/json' }, body: JSON.stringify({ userId: b.id }) })).status, 403);
  assert.equal((await fetch(base + '/api/conversations', { method: 'POST', headers: { cookie: a.cookie, origin: base, 'content-type': 'text/plain' }, body: JSON.stringify({ userId: b.id }) })).status, 415);
  assert.equal((await get('/api/messages?conversationId=2147483648', a)).status, 400);
  assert.equal((await get(`/api/messages?conversationId=${ab}&before=2147483648`, a)).status, 400);
  assert.equal((await post('/api/conversations', { userId: b.id })).status, 401);
  for (const value of [-1, 'abc', {}, 1.2]) assert.equal((await post('/api/conversations', { userId: value }, a)).status, 400);
  for (const user of [a, b]) assert((await emit(user === a ? sa : sb, 'subscribe-conversation', { conversationId: ab })).ok);
  assert.equal((await emit(sc, 'subscribe-conversation', { conversationId: ab })).ok, false);
  assert.equal((await get(`/api/messages?conversationId=${ab}`, c)).status, 403);
  assert.equal((await get(`/api/messages?conversationId=${ab}`)).status, 401);
  assert.equal((await emit(sc, 'chat-message', { conversationId: ab, text: 'intrusion', clientMessageId: randomUUID() })).ok, false);
  const nonce = randomUUID();
  const sent = await emit(sa, 'chat-message', { conversationId: ab, text: `private_${suffix}`, clientMessageId: nonce, userId: c.id, author: 'fake' }); assert(sent.ok, JSON.stringify(sent));
  const original = sent.message; assert.equal(original.userId, a.id); assert.equal(original.conversationId, ab);
  await until(() => eventsB.some((m) => m.id === original.id) && eventsA2.some((m) => m.id === original.id), 'recipient and second own device delivery');
  const retry = await emit(sa, 'chat-message', { conversationId: ab, text: original.text, clientMessageId: nonce }); assert(retry.ok); assert.equal(retry.message.id, original.id);
  assert.equal((await emit(sa, 'chat-message', { conversationId: ac, text: original.text, clientMessageId: nonce })).ok, false);
  const reply = await emit(sb, 'chat-message', { conversationId: ab, text: 'reply', replyToId: original.id, clientMessageId: randomUUID() }); assert(reply.ok, JSON.stringify(reply)); assert.equal(reply.message.replyTo.author, a.username);
  for (const [socket, scope] of [[sc, ac], [sa, null]]) assert.equal((await emit(socket, 'chat-message', { conversationId: scope, text: 'wrong quote', replyToId: original.id, clientMessageId: randomUUID() })).ok, false);
  assert.equal((await emit(sb, 'edit-message', { conversationId: ab, id: original.id, text: 'foreign', expectedText: original.text })).ok, false);
  assert.equal((await emit(sc, 'edit-message', { conversationId: ab, id: original.id, text: 'intrusion', expectedText: original.text })).ok, false);
  const editsB = []; sb.on('message-edited', (m) => editsB.push(m));
  let edited = await emit(sa, 'edit-message', { conversationId: ab, id: original.id, text: 'edited private', expectedText: original.text, expectedEditedAt: null }); assert(edited.ok, JSON.stringify(edited));
  await until(() => editsB.some((e) => e.id === original.id && e.conversationId === ab), 'scoped edit');
  const competingEdits = await Promise.all([sa, sa2].map((socket, i) => emit(socket, 'edit-message', { conversationId: ab, id: original.id, text: `concurrent private ${i}`, expectedText: edited.message.text, expectedEditedAt: edited.message.editedAt })));
  assert.equal(competingEdits.filter((result) => result.ok).length, 1, JSON.stringify(competingEdits));
  edited = competingEdits.find((result) => result.ok);
  assert.equal(eventsB.filter((m) => m.id === original.id).length, 1);
  assert.equal((await emit(sc, 'delete-message', { conversationId: ab, id: original.id })).ok, false);
  const userSearch = await (await get(`/api/users?q=${b.username}`, a)).json(); assert.equal(userSearch.users.length, 1); assert.deepEqual(Object.keys(userSearch.users[0]).sort(), ['avatarUrl', 'id', 'username']);
  console.log('PASS concurrent A-B/B-A creation, one DB pair, self/anonymous rejection, author integrity, membership, private room/history/send/edit/delete/reply isolation, multi-device delivery and ack retry');

  const png = await sharp({ create: { width: 180, height: 100, channels: 3, background: 'purple' } }).png().toBuffer();
  const wavPath = join(root, 'fixture.wav'), mp4Path = join(root, 'fixture.mp4');
  execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '2', wavPath]);
  execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=240x160:rate=10', '-t', '2', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', mp4Path]);
  const bytes = { image: png, audio: await readFile(wavPath), video: await readFile(mp4Path), document: Buffer.from('Direct message document') };
  const media = [];
  for (const [owner, socket] of [[a, sa], [b, sb]]) {
    for (const kind of ['image', 'audio', 'video', 'document']) {
      const url = await upload(owner, kind, bytes[kind]);
      assert.equal((await get(url, c)).status, 404);
      const payload = { conversationId: ab, [`${kind}Url`]: url, clientMessageId: randomUUID() };
      const result = await emit(socket, 'chat-message', payload); assert(result.ok, JSON.stringify(result)); media.push({ kind, url, message: result.message, owner });
      for (const user of [a, b]) {
        const response = await get(url, user); assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes[kind]);
      }
      assert.equal((await get(url, c)).status, 404); assert.equal((await get(url)).status, 401);
      assert.equal((await emit(sa, 'chat-message', { ...payload, conversationId: ac, clientMessageId: randomUUID() })).ok, false);
      assert.equal((await emit(socket, 'chat-message', { ...payload, conversationId: null, clientMessageId: randomUUID() })).ok, false);
      assert.equal((await emit(sc, 'chat-message', { conversationId: ac, [`${kind}Url`]: url, clientMessageId: randomUUID() })).ok, false);
      if (kind === 'video') {
        const ranged = await get(url, b, { range: 'bytes=0-15' }); assert.equal(ranged.status, 206); assert.equal((await ranged.arrayBuffer()).byteLength, 16);
        assert.equal((await get(url + '/poster', c)).status, 404);
      }
      if (kind === 'image') assert.equal((await get(url.replace('/images/', '/images/previews/').replace(/\.(png|jpg|gif)$/, '.webp'), c)).status, 404);
    }
  }
  const photo = media.find((m) => m.kind === 'image' && m.owner === a);
  const secondImage = await upload(a, 'image', png);
  const album = await emit(sa, 'chat-message', { conversationId: ab, imageUrls: [photo.url, secondImage], clientMessageId: randomUUID() });
  assert(album.ok, JSON.stringify(album)); assert.equal(album.message.imageUrls.length, 2);
  const caption = await emit(sa, 'edit-message', { conversationId: ab, id: photo.message.id, text: 'private image caption', expectedText: '', expectedEditedAt: null }); assert(caption.ok, JSON.stringify(caption));
  for (const user of [a, b]) {
    const history = await (await get(`/api/messages?conversationId=${ab}`, user)).json();
    assert.equal(history.messages.filter((m) => m.id === original.id).length, 1); assert.equal(history.messages.find((m) => m.id === original.id).text, edited.message.text);
    for (const item of media) assert(history.messages.some((m) => m.id === item.message.id));
    assert.deepEqual(history.messages.find((m) => m.id === album.message.id).imageUrls, [photo.url, secondImage]);
  }
  assert(!JSON.stringify(await (await get('/api/messages', c)).json()).includes(`private_${suffix}`));
  assert.equal(eventsC.filter((m) => m.conversationId === ab).length, 0);
  console.log('PASS image/audio/video/document in BOTH directions, exact original bytes, reload persistence, caption editing, protected originals/previews/posters/Range and cross-chat republishing denial');

  // A second dialog must have its own last message and sort by activity.
  const acSent = await emit(sa, 'chat-message', { conversationId: ac, text: 'only AC', clientMessageId: randomUUID() }); assert(acSent.ok);
  const listA = (await (await get('/api/conversations', a)).json()).conversations;
  assert.equal(listA[0].id, ac); assert.equal(listA.find((c) => c.id === ac).preview, 'only AC');
  assert(listA.find((c) => c.id === ab).lastMessageId); assert.equal((await (await get('/api/conversations', b)).json()).conversations.some((c) => c.id === ac), false);
  // Seed only test-owned messages in the DB to avoid the intentional per-user rate limit.
  for (let i = 0; i < 61; i++) await db.orm.public.Message.create({ userId: a.id, conversationId: ac, text: `page-${i}` });
  const allIds = [], pages = [];
  let before = '';
  do {
    const page = await (await get(`/api/messages?conversationId=${ac}${before ? `&before=${before}` : ''}`, a)).json(); pages.push(page);
    assert(page.messages.length <= 50); allIds.push(...page.messages.map((m) => m.id)); before = page.nextCursor;
  } while (before);
  assert.equal(new Set(allIds).size, 62); assert.equal(allIds.length, 62); assert.equal(pages.length, 2);
  const deepReply = await emit(sc, 'chat-message', { conversationId: ac, text: 'quote across pages', replyToId: acSent.message.id, clientMessageId: randomUUID() }); assert(deepReply.ok);
  sb.disconnect(); sb.connect(); await new Promise((resolve, reject) => { sb.once('connect', resolve); sb.once('connect_error', reject); });
  assert((await emit(sb, 'subscribe-conversation', { conversationId: ab })).ok);
  const reconnectMsg = await emit(sa, 'chat-message', { conversationId: ab, text: 'after reconnect', clientMessageId: randomUUID() }); assert(reconnectMsg.ok);
  await until(() => eventsB.some((m) => m.id === reconnectMsg.message.id), 'reconnect room restoration');
  console.log('PASS independent dialog previews/activity ordering, cursor pages without gaps/duplicates, reconnect subscription restoration');

  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/private/tmp/mediachat-direct-browser/node_modules/playwright-core/index.mjs');
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const contexts = [], browserPages = [], browserErrors = [];
  for (const user of users) {
    const context = await browser.newContext({ viewport: { width: 1100, height: 850 }, permissions: ['clipboard-read', 'clipboard-write'] }); contexts.push(context);
    context.setDefaultNavigationTimeout(base.startsWith('https:') ? 120000 : 30000);
    await context.addCookies([{ name: 'mediachat_session', value: user.cookie.split('=')[1], url: base, httpOnly: true, sameSite: 'Lax' }]);
    const page = await context.newPage(); browserPages.push(page); page.on('pageerror', (e) => browserErrors.push(e.message));
    await page.goto(base, { waitUntil: 'domcontentloaded' }); await page.getByText('Соединение установлено', { exact: true }).waitFor({ timeout: 60000 });
  }
  const [pa, pb, pc] = browserPages;
  for (const page of [pa, pb]) page.on('response', (response) => {
    if (response.request().method() !== 'POST' || !/\/api\/(upload|audio\/upload|videos\/upload|documents\/upload)/.test(response.url()) || response.status() !== 201) return;
    uploadResponses.push(response.json().then((data) => { const url = data.imageUrl || data.audioUrl || data.videoUrl || data.documentUrl; if (url) uploads.push(url); }));
  });
  await pa.getByRole('button', { name: 'Найти пользователя', exact: true }).click();
  const dialog = pa.getByRole('dialog', { name: 'Поиск пользователей' });
  await dialog.getByRole('textbox', { name: 'Имя пользователя' }).fill(b.username);
  await dialog.getByRole('button', { name: b.username, exact: true }).click();
  await pa.getByRole('dialog', { name: 'Профиль пользователя' }).getByRole('button', { name: 'Написать', exact: true }).click();
  await pa.waitForURL(`**/?chat=${ab}`); await pa.locator(`#message-${original.id}`).waitFor();
  await pb.getByRole('navigation', { name: 'Переписки' }).getByRole('button', { name: new RegExp(a.username) }).click();
  await pb.locator(`#message-${original.id}`).waitFor();
  await pc.goto(`${base}/?chat=${ab}`); await pc.getByRole('alert').filter({ hasText: /недоступна/ }).waitFor({ timeout: 60000 });
  assert.equal(await pc.locator('[data-message-id]').count(), 0); assert(await pc.getByRole('button', { name: 'Отправить сообщение', exact: true }).isDisabled());
  const extraTab = await contexts[0].newPage(); extraTab.on('pageerror', (error) => browserErrors.push(error.message));
  await extraTab.goto(`${base}/?chat=${ab}`); await extraTab.locator(`#message-${original.id}`).waitFor();
  await pa.getByPlaceholder('Написать сообщение...').fill(`browser private ${suffix}`); await pa.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
  await pb.getByLabel('Сообщения чата').getByText(`browser private ${suffix}`, { exact: true }).waitFor();
  await extraTab.getByLabel('Сообщения чата').getByText(`browser private ${suffix}`, { exact: true }).waitFor();
  assert.equal(await extraTab.locator('[data-message-id]').filter({ hasText: `browser private ${suffix}` }).count(), 1);
  const row = pb.locator('[data-message-id]').filter({ hasText: `browser private ${suffix}` });
  await row.click({ button: 'right' }); await pb.getByRole('menuitem', { name: 'Ответить', exact: true }).click();
  await pb.getByPlaceholder('Написать сообщение...').fill('browser reply'); await pb.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
  await pa.getByLabel('Сообщения чата').getByText('browser reply', { exact: true }).waitFor();
  const own = pa.locator('[data-message-id]').filter({ hasText: `browser private ${suffix}` }).filter({ hasNotText: 'browser reply' });
  await own.click({ button: 'right' }); await pa.getByRole('menuitem', { name: 'Изменить', exact: true }).click();
  await pa.getByRole('textbox', { name: 'Редактирование сообщения' }).fill('browser edited private'); await pa.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await pb.getByText('browser edited private', { exact: true }).first().waitFor();
  await extraTab.getByLabel('Сообщения чата').getByText('browser edited private', { exact: true }).first().waitFor();
  await pa.reload(); await pa.getByText('browser edited private', { exact: true }).first().waitFor(); assert(new URL(pa.url()).searchParams.get('chat') === String(ab));
  await pb.bringToFront();
  const imageRow = pb.locator(`#message-${photo.message.id}`);
  await imageRow.getByRole('button', { name: 'Открыть изображение', exact: true }).click();
  await pb.getByRole('dialog', { name: 'Просмотр изображения' }).waitFor();
  await pb.keyboard.press('Escape'); await pb.getByRole('dialog', { name: 'Просмотр изображения' }).waitFor({ state: 'detached' });
  const track = media.find((m) => m.kind === 'audio' && m.owner === a);
  await pb.locator(`#message-${track.message.id}`).getByRole('button', { name: 'Воспроизвести dm.wav', exact: true }).click();
  await until(() => pb.locator('audio').evaluateAll((items) => items.some((audio) => audio.readyState >= 2 && !audio.paused)), 'private audio playback');
  const film = media.find((m) => m.kind === 'video' && m.owner === a);
  await pb.locator(`#message-${film.message.id}`).getByRole('button', { name: 'Открыть видео dm.mp4', exact: true }).click();
  const viewer = pb.getByRole('dialog', { name: 'Просмотр видео: dm.mp4', exact: true });
  await viewer.waitFor(); await until(() => viewer.locator('video').evaluate((v) => v.readyState >= 2 && !v.paused), 'private video playback');
  assert(await pb.locator('audio').evaluateAll((items) => items.every((audio) => audio.paused)));
  await viewer.getByRole('button', { name: 'Остановить и закрыть видео', exact: true }).click(); await viewer.waitFor({ state: 'detached' });
  const doc = media.find((m) => m.kind === 'document' && m.owner === a);
  const download = pb.waitForEvent('download'); await pb.locator(`#message-${doc.message.id}`).getByRole('link', { name: 'Скачать dm.txt', exact: true }).click(); assert.equal((await download).suggestedFilename(), 'dm.txt');
  for (const [page, owner, recipient] of [[pa, a, pb], [pb, b, pa]]) {
    const marker = `ui-batch-${owner.id}-${suffix}`;
    for (const [kind, label, name, mimeType] of [['image', 'Изображение', 'ui.png', 'image/png'], ['audio', 'Музыка', 'ui.wav', 'audio/wav'], ['video', 'Видео', 'ui.mp4', 'video/mp4'], ['document', 'Документ или архив', 'ui.txt', 'text/plain']]) {
      await page.getByRole('button', { name: 'Прикрепить вложение', exact: true }).click();
      const chosen = page.waitForEvent('filechooser'); await page.getByRole('menuitem', { name: label, exact: true }).click();
      await (await chosen).setFiles({ name, mimeType, buffer: bytes[kind] });
    }
    await page.getByPlaceholder('Написать сообщение...').fill(marker);
    await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
    await recipient.getByLabel('Сообщения чата').getByText(marker, { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).waitFor({ state: 'visible' });
    await until(async () => await page.getByPlaceholder('Написать сообщение...').isEnabled() && await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).isDisabled(), 'entire UI attachment batch saved');
    const saved = await (await get(`/api/messages?conversationId=${ab}`, owner)).json();
    for (const kind of ['image', 'audio', 'video', 'document']) assert(saved.messages.some((m) => m.userId === owner.id && m[`${kind}Url`] && (kind === 'image' ? m.text === marker : kind === 'audio' ? m.audioName === 'ui.wav' : m[kind]?.originalName === `ui.${kind === 'video' ? 'mp4' : 'txt'}`)));
  }
  console.log('PASS real Chrome private image viewer, audio/video playback, music pause on video, original document download and all four UI upload pickers/batches in BOTH directions');
  // HTTP LAN is not a secure context: exercise the real execCommand fallback.
  await pa.evaluate(() => {
    const original = document.execCommand.bind(document);
    document.execCommand = (...args) => {
      const value = document.activeElement?.value;
      const result = original(...args);
      if (args[0] === 'copy') window.__copyResult = { value, result };
      return result;
    };
  });
  await pa.locator(`#message-${original.id}`).click({ button: 'right' });
  await pa.getByRole('menuitem', { name: 'Скопировать', exact: true }).click();
  await pa.getByText('Текст скопирован', { exact: true }).waitFor();
  const copied = await pa.evaluate(async () => navigator.clipboard ? { value: await navigator.clipboard.readText(), result: true } : window.__copyResult);
  assert.deepEqual(copied, { value: edited.message.text, result: true });
  await pb.locator(`#message-${original.id}`).click({ button: 'right' }); assert(await pb.getByRole('menuitem', { name: 'Изменить', exact: true }).isDisabled()); await pb.keyboard.press('Escape');
  const deletedB = []; sb.on('message-deleted', (m) => deletedB.push(m));
  const removed = await emit(sa, 'delete-message', { conversationId: ab, id: doc.message.id }); assert(removed.ok, JSON.stringify(removed));
  await until(() => deletedB.some((m) => m.id === doc.message.id && m.conversationId === ab), 'private deletion delivery');
  assert.equal((await emit(sa, 'chat-message', { conversationId: ac, documentUrl: doc.url, clientMessageId: (await db.orm.public.Message.where({ id: doc.message.id }).first()).clientMessageId.split(':')[1] })).ok, false);
  assert.equal((await get(doc.url, b)).status, 404); assert.equal((await get(doc.url, a)).status, 404);
  assert.equal((await emit(sa, 'delete-message', { conversationId: ab, id: doc.message.id })).ok, true);
  assert.equal((await emit(sa, 'chat-message', { conversationId: ac, documentUrl: doc.url, clientMessageId: randomUUID() })).ok, false);
  const storedDeleted = await db.orm.public.Message.where({ id: doc.message.id }).first(); assert(storedDeleted.deletedAt); assert.equal(storedDeleted.documentUrl, null);
  console.log('PASS private copy/foreign edit disabled, scoped deletion/idempotency, original file cleanup and replay rejection');

  await pa.getByPlaceholder('Написать сообщение...').fill('saved private draft');
  await pa.getByRole('navigation', { name: 'Переписки' }).getByRole('button', { name: 'Общий чат', exact: true }).click();
  await pa.getByText('Соединение установлено', { exact: true }).waitFor(); assert.equal(await pa.getByText('browser edited private', { exact: true }).count(), 0);
  await pa.getByRole('navigation', { name: 'Переписки' }).getByRole('button', { name: new RegExp(b.username) }).click();
  await pa.getByText('browser edited private', { exact: true }).first().waitFor();
  assert.equal(await pa.getByPlaceholder('Написать сообщение...').inputValue(), 'saved private draft');
  await pa.getByRole('navigation', { name: 'Переписки' }).getByRole('button', { name: new RegExp(c.username) }).click();
  await pa.getByRole('button', { name: 'Загрузить предыдущие сообщения', exact: true }).waitFor();
  await pa.getByRole('button', { name: 'Загрузить предыдущие сообщения', exact: true }).click(); await pa.getByText('only AC', { exact: true }).last().waitFor();
  assert.equal(await pa.getByText('browser edited private', { exact: true }).count(), 0);
  await pa.reload(); await pa.getByRole('button', { name: `Перейти к исходному сообщению ${acSent.message.id}`, exact: true }).click();
  await pa.locator(`#message-${acSent.message.id}`).waitFor();
  await pb.setViewportSize({ width: 390, height: 844 });
  const overflow = await pb.evaluate(() => document.documentElement.scrollWidth > innerWidth); assert(!overflow);
  assert.deepEqual(browserErrors, []);
  console.log('PASS real Chrome search→profile→Write, private realtime/reply/edit, URL restoration, general/private switching, paginated history UI, forbidden third-account UI, two tabs without duplicates, draft restoration, cross-page quote navigation, mobile width, zero JS exceptions');
} finally {
  await Promise.allSettled(uploadResponses);
  await browser?.close(); sockets.forEach((socket) => socket.disconnect());
  for (const id of conversations) await db.orm.public.Conversation.where({ id }).delete();
  for (const user of users) await db.orm.public.User.where({ id: user.id }).delete();
  for (const url of uploads) {
    await db.orm.public.MediaCleanupJob.where({ url }).delete();
    const name = url.split('/').pop(), id = name.split('.')[0];
    const folder = url.includes('/audio/') ? 'audio' : url.includes('/videos/') ? 'videos' : url.includes('/documents/') ? 'documents' : '';
    await rm(join(process.cwd(), 'uploads', folder, name), { force: true });
    await rm(join(process.cwd(), 'uploads', folder, 'metadata', `${id}.json`), { force: true });
    await rm(join(process.cwd(), 'uploads', 'previews', `${id}.webp`), { force: true });
    await rm(join(process.cwd(), 'uploads', 'videos', 'posters', `${id}.jpg`), { force: true });
  }
  await rm(root, { recursive: true, force: true }); await db.close();
}
