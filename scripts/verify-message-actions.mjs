// HTTP + Socket.IO + real Chrome. Only its own temporary accounts/messages/files are removed.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { io } from 'socket.io-client';
import { SignJWT } from 'jose';
import { db } from '../src/prisma/db.ts';
const base = process.env.VERIFY_URL || 'http://localhost:3102';
const suffix = randomUUID().slice(0, 8), users = [], sockets = [], conversations = [], uploads = [];
let browser;
const post = (path, body) => fetch(base + path, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const get = (path, cookie) => fetch(base + path, { headers: cookie ? { cookie } : {} });
const emit = (socket, event, payload) => new Promise((resolve, reject) => socket.timeout(15000).emit(event, payload, (error, result) => error ? reject(error) : resolve(result)));
async function connect(cookie) {
  const socket = io(base, { transports: ['websocket'], extraHeaders: { Cookie: cookie, Origin: base }, reconnection: false }); sockets.push(socket);
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); }); return socket;
}
async function until(check, label) { const start = Date.now(); while (Date.now() - start < 20000) { if (await check()) return; await new Promise((r) => setTimeout(r, 100)); } throw new Error(`Timed out: ${label}`); }
try {
  for (let i = 0; i < 2; i++) {
    const username = `actions_${suffix}_${i}`, password = 'Message-actions-check-123!';
    const registration = await post('/api/register', { username, password }); assert.equal(registration.status, 201, await registration.clone().text());
    const { user } = await registration.json(); users.push(user);
    const login = await post('/api/login', { username, password }); assert.equal(login.status, 200); user.cookie = login.headers.get('set-cookie').split(';')[0];
  }
  const [a, b] = users, sa = await connect(a.cookie), sb = await connect(b.cookie);
  let original = await emit(sa, 'chat-message', { text: `Original ${suffix}`, clientMessageId: randomUUID(), userId: b.id, author: 'spoof' });
  assert(original.ok, JSON.stringify(original)); original = original.message; assert.equal(original.userId, a.id); assert.equal(original.author, a.username);
  let changed = await emit(sa, 'edit-message', { id: original.id, text: `Backend edit ${suffix}`, expectedText: original.text, expectedEditedAt: null });
  assert(changed.ok, JSON.stringify(changed)); assert(changed.message.editedAt);
  const repeatedEdit = await emit(sa, 'edit-message', { id: original.id, text: changed.message.text, expectedText: original.text, expectedEditedAt: null });
  assert(repeatedEdit.ok); assert.equal(repeatedEdit.message.editedAt, changed.message.editedAt);
  const competing = await Promise.all([
    emit(sa, 'edit-message', { id: original.id, text: `Concurrent A ${suffix}`, expectedText: changed.message.text, expectedEditedAt: changed.message.editedAt }),
    emit(sa, 'edit-message', { id: original.id, text: `Concurrent B ${suffix}`, expectedText: changed.message.text, expectedEditedAt: changed.message.editedAt }),
  ]);
  assert.equal(competing.filter((result) => result.ok).length, 1, JSON.stringify(competing));
  changed = competing.find((result) => result.ok);
  assert.equal((await emit(sb, 'edit-message', { id: original.id, text: 'forbidden', expectedText: changed.message.text, userId: a.id })).ok, false);
  assert.equal((await emit(sa, 'edit-message', { id: original.id, text: 'stale overwrite', expectedText: original.text, expectedEditedAt: null })).ok, false);
  for (const text of ['', 'x'.repeat(4001)]) assert.equal((await emit(sa, 'edit-message', { id: original.id, text, expectedText: changed.message.text, expectedEditedAt: changed.message.editedAt })).ok, false);
  const nonce = randomUUID(), replyPayload = { text: `Reply ${suffix}`, replyToId: original.id, clientMessageId: nonce };
  const replies = await Promise.all([emit(sb, 'chat-message', replyPayload), emit(sb, 'chat-message', replyPayload)]);
  assert(replies.every((reply) => reply.ok), JSON.stringify(replies)); assert.equal(replies[0].message.id, replies[1].message.id);
  assert.equal(replies[0].message.replyTo.author, a.username); assert.equal(replies[0].message.replyTo.preview, changed.message.text);
  assert.equal((await emit(sb, 'chat-message', { ...replyPayload, replyToId: replies[0].message.id })).ok, false);
  const conversation = await db.orm.public.Conversation.create({}); conversations.push(conversation.id);
  await db.orm.public.ConversationMember.create({ conversationId: conversation.id, userId: a.id });
  const secret = await db.orm.public.Message.create({ userId: a.id, conversationId: conversation.id, text: `SECRET_${suffix}` });
  for (const socket of [sa, sb]) {
    assert.equal((await emit(socket, 'chat-message', { text: 'leak', replyToId: secret.id, clientMessageId: randomUUID() })).ok, false);
    assert.equal((await emit(socket, 'edit-message', { id: secret.id, text: 'bad', expectedText: secret.text })).ok, false);
  }
  for (const replyToId of [-1, '1', {}, 999999999]) assert.equal((await emit(sa, 'chat-message', { text: 'bad reply', replyToId })).ok, false);
  // Even a corrupt DB link must not serialize a private quote into general history.
  const badLink = await db.orm.public.Message.create({ userId: a.id, text: 'corrupt link fixture', replyToId: secret.id });
  let history = await (await get('/api/messages', b.cookie)).json();
  assert.equal(history.messages.find((m) => m.id === badLink.id).replyTo, null);
  assert(!JSON.stringify(history).includes(`SECRET_${suffix}`));
  assert.equal((await get('/api/messages')).status, 401);
  console.log('PASS author/session checks, idempotent edit/reply, concurrent deduplication, stale edit conflict, invalid input, cross-chat reply/edit denial, private quote serialization guard');

  const png = await sharp({ create: { width: 100, height: 80, channels: 3, background: 'purple' } }).png().toBuffer();
  const form = new FormData(); form.append('image', new File([png], 'fixture.png', { type: 'image/png' }));
  const uploaded = await fetch(base + '/api/upload', { method: 'POST', headers: { cookie: a.cookie, origin: base }, body: form });
  const image = await uploaded.json(); assert.equal(uploaded.status, 201); uploads.push(image.imageUrl);
  const imageResult = await emit(sa, 'chat-message', { imageUrls: [image.imageUrl], clientMessageId: randomUUID() }); assert(imageResult.ok);
  const imageMessage = imageResult.message;
  const addedCaption = await emit(sa, 'edit-message', { id: imageMessage.id, text: 'caption', expectedText: '', expectedEditedAt: null }); assert(addedCaption.ok, JSON.stringify(addedCaption));
  const clearedCaption = await emit(sa, 'edit-message', { id: imageMessage.id, text: '', expectedText: 'caption', expectedEditedAt: addedCaption.message.editedAt }); assert(clearedCaption.ok, JSON.stringify(clearedCaption));
  const storedImage = await db.orm.public.Message.where({ id: imageMessage.id }).include('images').first();
  assert.equal(storedImage.imageUrl, image.imageUrl); assert.equal(storedImage.images.length, 1);
  assert.equal((await emit(sb, 'edit-message', { id: imageMessage.id, text: 'foreign caption', expectedText: '', expectedEditedAt: storedImage.editedAt.toString() })).ok, false);
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/private/tmp/mediachat-video-browser/node_modules/playwright-core/index.mjs');
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const contexts = [], pages = [], pageErrors = [];
  for (const user of users) {
    const context = await browser.newContext({ viewport: { width: 1100, height: 850 }, permissions: ['clipboard-read', 'clipboard-write'] }); contexts.push(context);
    await context.addCookies([{ name: 'mediachat_session', value: user.cookie.split('=')[1], url: base, httpOnly: true, sameSite: 'Lax' }]);
    const page = await context.newPage(); pages.push(page); page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(base); await page.getByText('Соединение установлено', { exact: true }).waitFor({ timeout: 45000 });
  }
  const [pa, pb] = pages;
  const row = (page, id) => page.locator(`#message-${id}`);
  const menu = (page) => page.getByRole('menu', { name: 'Действия сообщения', exact: true });
  const menuItem = (page, name) => menu(page).getByRole('menuitem', { name, exact: true });
  await pa.bringToFront();
  await row(pa, original.id).click({ button: 'right' }); await menu(pa).waitFor();
  await menuItem(pa, 'Скопировать').click(); await pa.getByRole('status').filter({ hasText: 'Текст скопирован' }).waitFor();
  assert.equal(await pa.evaluate(() => navigator.clipboard.readText()), changed.message.text);
  await menu(pa).waitFor({ state: 'detached' });
  await row(pb, original.id).click({ button: 'right' }); assert(await menuItem(pb, 'Изменить').isDisabled());
  await pb.keyboard.press('Escape'); await menu(pb).waitFor({ state: 'detached' });
  await row(pa, imageMessage.id).click({ button: 'right' }); assert(await menuItem(pa, 'Скопировать').isDisabled()); assert(await menuItem(pa, 'Изменить').isEnabled());
  await menuItem(pa, 'Ответить').click(); await menu(pa).waitFor({ state: 'detached' });
  await pa.getByLabel('Ответ на сообщение', { exact: true }).getByText('Изображение', { exact: true }).waitFor();
  await pa.getByRole('button', { name: 'Отменить ответ', exact: true }).click();
  await row(pb, original.id).focus(); await pb.keyboard.press('Shift+F10'); await menu(pb).waitFor();
  await pb.keyboard.press('Home'); await pb.keyboard.press('ArrowDown'); await pb.keyboard.press('Enter');
  await pb.getByLabel('Ответ на сообщение', { exact: true }).waitFor();
  const text = `UI reply ${suffix}`; await pb.getByPlaceholder('Написать сообщение...').fill(text);
  await pb.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
  let uiReply;
  await until(async () => { history = await (await get('/api/messages', b.cookie)).json(); uiReply = history.messages.find((m) => m.text === text); return Boolean(uiReply); }, 'UI reply saved');
  assert.equal(uiReply.replyToId, original.id);
  await row(pa, uiReply.id).waitFor();
  await row(pb, uiReply.id).getByRole('button', { name: `Перейти к исходному сообщению ${original.id}`, exact: true }).click();
  assert.equal(await pb.evaluate(() => document.activeElement?.id), `message-${original.id}`);
  // Editing uses a separate form and leaves a composed message untouched.
  await pa.getByPlaceholder('Написать сообщение...').fill('unsent draft');
  await row(pa, original.id).click({ button: 'right' }); await menuItem(pa, 'Изменить').click();
  const editor = pa.getByLabel('Редактирование сообщения', { exact: true }); await editor.waitFor();
  assert.equal(await editor.inputValue(), changed.message.text);
  await editor.fill('cancelled edit'); await pa.getByRole('button', { name: 'Отмена', exact: true }).click();
  assert.equal(await pa.getByPlaceholder('Написать сообщение...').inputValue(), 'unsent draft');
  await row(pa, original.id).click({ button: 'right' }); await menuItem(pa, 'Изменить').click();
  const newText = `UI edited ${suffix}`; await editor.fill(newText); await pa.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await until(async () => (await row(pb, original.id).innerText()).includes(newText), 'realtime edit in second account');
  assert((await row(pb, original.id).innerText()).includes('изменено'));
  assert((await row(pb, uiReply.id).innerText()).includes(newText), 'Quote follows original edit');
  for (const page of pages) { await page.reload(); await row(page, uiReply.id).waitFor(); assert((await row(page, original.id).innerText()).includes(newText)); assert((await row(page, uiReply.id).innerText()).includes(newText)); }
  // Long image caption is editable, while the image remains byte-for-byte unchanged.
  const longCaption = ('Длинная подпись к изображению. ').repeat(18);
  await row(pa, imageMessage.id).click({ button: 'right' }); await menuItem(pa, 'Изменить').click();
  await pa.getByLabel('Редактирование сообщения', { exact: true }).fill(longCaption);
  await pa.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await until(async () => (await row(pb, imageMessage.id).innerText()).includes('Длинная подпись'), 'caption realtime');
  const assertCentered = async (page) => {
    const target = row(page, imageMessage.id), thumbnail = target.locator('img').first();
    await thumbnail.scrollIntoViewIfNeeded();
    await until(() => thumbnail.evaluate((node) => node.complete && node.naturalWidth > 0), 'image loaded');
    const imageBounds = await thumbnail.boundingBox(), bubble = await target.locator(':scope > div').first().boundingBox();
    assert(Math.abs(imageBounds.x + imageBounds.width / 2 - bubble.x - bubble.width / 2) < 2, JSON.stringify({ imageBounds, bubble }));
  };
  for (const page of pages) {
    await assertCentered(page);
    await page.setViewportSize({ width: 390, height: 844 }); await assertCentered(page);
    await page.reload(); await row(page, imageMessage.id).waitFor(); await assertCentered(page);
    assert((await row(page, imageMessage.id).innerText()).includes('Длинная подпись'));
    await page.setViewportSize({ width: 1100, height: 850 });
  }
  const afterCaption = await db.orm.public.Message.where({ id: imageMessage.id }).include('images').first();
  assert.equal(afterCaption.imageUrl, image.imageUrl); assert.equal(afterCaption.images[0].imageUrl, image.imageUrl);
  assert.deepEqual(Buffer.from(await (await get(image.imageUrl, b.cookie)).arrayBuffer()), png);
  await row(pa, imageMessage.id).click({ button: 'right' }); await menuItem(pa, 'Изменить').click();
  await pa.getByLabel('Редактирование сообщения', { exact: true }).fill('');
  await pa.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await until(async () => !(await row(pb, imageMessage.id).innerText()).includes('Длинная подпись'), 'caption removal realtime');
  assert.equal(await row(pb, imageMessage.id).locator('img').count(), 1);
  console.log('PASS caption add/edit/remove, foreign caption edit denied, image URL/album relation/original bytes preserved, owner/recipient centering on desktop and 390px, reload');

  // Window clamping and outside close, with the native contextmenu coordinates near an edge.
  await row(pa, original.id).evaluate((node) => node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: innerWidth - 1, clientY: innerHeight - 1 })));
  const bounds = await menu(pa).boundingBox(); assert(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 1100 && bounds.y + bounds.height <= 850);
  await pa.locator('header').click(); await menu(pa).waitFor({ state: 'detached' });
  console.log('PASS Chrome right click, clipboard/feedback, textless/foreign disabled actions, keyboard navigation/Escape, replies to text/image, quote jump, edit/cancel, preserved draft, two-account realtime, reload, menu clamping/outside close');

  const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await touch.addCookies([{ name: 'mediachat_session', value: a.cookie.split('=')[1], url: base, httpOnly: true, sameSite: 'Lax' }]);
  const mobile = await touch.newPage(); mobile.on('pageerror', (error) => pageErrors.push(error.message));
  await mobile.goto(base); await row(mobile, imageMessage.id).scrollIntoViewIfNeeded();
  const target = row(mobile, imageMessage.id).getByRole('button', { name: 'Открыть изображение', exact: true });
  const rect = await target.boundingBox(), x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
  const cdp = await touch.newCDPSession(mobile);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await mobile.waitForTimeout(650); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await menu(mobile).waitFor(); assert.equal(await mobile.getByRole('dialog', { name: 'Просмотр изображения' }).count(), 0, 'Long press does not also open the image');
  await mobile.keyboard.press('Escape'); await menu(mobile).waitFor({ state: 'detached' });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 40 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await mobile.waitForTimeout(650); assert.equal(await menu(mobile).count(), 0, 'Scrolling cancels long press');
  console.log('PASS emulated mobile touch long press opens message menu without media click; touch movement cancels long press');
  const exp = await new SignJWT({ userId: a.id }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime(Math.floor(Date.now() / 1000) + 2).sign(new TextEncoder().encode(process.env.SESSION_SECRET));
  const expiring = await connect(`mediachat_session=${exp}`);
  await new Promise((resolve) => expiring.once('disconnect', resolve)); assert(!expiring.connected);
  assert.deepEqual(pageErrors, []);
  console.log('PASS expired socket session disconnected; zero browser errors. Physical macOS two-finger click and real iOS/Safari not exercised.');
} finally {
  await browser?.close(); sockets.forEach((socket) => socket.disconnect());
  for (const id of conversations) await db.orm.public.Conversation.where({ id }).delete();
  for (const user of users) await db.orm.public.User.where({ id: user.id }).delete();
  for (const url of uploads) {
    const filename = url.split('/').pop(), id = filename.split('.')[0];
    await rm(join(process.cwd(), 'uploads', filename), { force: true });
    await rm(join(process.cwd(), 'uploads', 'metadata', `${id}.json`), { force: true });
    await rm(join(process.cwd(), 'uploads', 'previews', `${id}.webp`), { force: true });
  }
  await db.close();
}
