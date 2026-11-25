// Read-only browser check: synthetic history, no uploads or database writes.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { db } from '../src/prisma/db.ts';
const base = process.env.VERIFY_URL || 'http://localhost:3102';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/private/tmp/mediachat-video-browser/node_modules/playwright-core/index.mjs');
let browser;
try {
  const user = await db.orm.public.User.select('id').first(); assert(user);
  const token = await new SignJWT({ userId: user.id }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('5m').sign(new TextEncoder().encode(process.env.SESSION_SECRET));
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const context = await browser.newContext();
  await context.addCookies([{ name: 'mediachat_session', value: token, url: base, httpOnly: true, sameSite: 'Lax' }]);
  const urls = Array.from({ length: 3 }, (_, i) => `/api/images/00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}.png`);
  await context.route('**/api/messages', (route) => route.fulfill({ json: { messages: [
    { id: 100001, author: 'Viewer fixture', text: '', userId: user.id, imageUrls: urls.slice(0, 2) },
    { id: 100002, author: 'Viewer fixture', text: '', userId: user.id, imageUrl: urls[2] },
  ] } }));
  await context.route('**/api/images/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="purple"/></svg>' }));
  const page = await context.newPage(), errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base); await page.getByText('Соединение установлено', { exact: true }).waitFor({ timeout: 45000 });
  await page.getByLabel('Альбом: 2 фото', { exact: true }).getByRole('button').nth(1).click();
  const dialog = page.getByRole('dialog', { name: 'Просмотр изображения' });
  const current = () => dialog.locator('img').getAttribute('src');
  assert.equal(await current(), urls[1]);
  await page.keyboard.press('ArrowRight'); assert.equal(await current(), urls[2]);
  assert(await dialog.getByRole('button', { name: 'Следующее изображение', exact: true }).isDisabled());
  await page.keyboard.press('ArrowRight'); assert.equal(await current(), urls[2]);
  assert.equal(await dialog.getByRole('link', { name: 'Открыть оригинал', exact: true }).getAttribute('href'), urls[2]);
  assert.equal(await dialog.getByRole('link', { name: 'Скачать оригинал', exact: true }).getAttribute('href'), urls[2].replace('/api/images/', '/api/images/download/'));
  await page.keyboard.press('ArrowLeft'); assert.equal(await current(), urls[1]);
  await dialog.getByRole('button', { name: 'Предыдущее изображение', exact: true }).click(); assert.equal(await current(), urls[0]);
  await page.keyboard.press('ArrowLeft'); assert.equal(await current(), urls[0]);
  assert(await dialog.getByRole('button', { name: 'Предыдущее изображение', exact: true }).isDisabled());
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
  await page.getByLabel('Альбом: 2 фото', { exact: true }).getByRole('button').nth(1).click(); assert.equal(await current(), urls[1]);
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
  await page.getByPlaceholder('Написать сообщение...').fill('abc'); await page.keyboard.press('ArrowLeft');
  assert.equal(await page.getByPlaceholder('Написать сообщение...').evaluate((node) => node.selectionStart), 2);
  assert.deepEqual(errors, []);
  console.log('PASS arrows within/across albums, boundary clamps, navigation buttons, current original/download URLs, Escape/reopen reset, text cursor unaffected, zero page errors');
} finally { await browser?.close(); await db.close(); }
