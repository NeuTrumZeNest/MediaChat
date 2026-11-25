// Read-only Chrome checks over the Mac's LAN address. No accounts/messages/files are created.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { networkInterfaces } from 'node:os';
import { SignJWT } from 'jose';
import { db } from '../src/prisma/db.ts';
const lan = Object.values(networkInterfaces()).flat().find((address) => address?.family === 'IPv4' && address.address.startsWith('192.168.'))?.address;
const base = process.env.VERIFY_URL || `http://${lan}:3102`;
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/private/tmp/mediachat-video-browser/node_modules/playwright-core/index.mjs');
let browser;
try {
  const user = await db.orm.public.User.select('id', 'username').first(); assert(user);
  const token = await new SignJWT({ userId: user.id }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('5m').sign(new TextEncoder().encode(process.env.SESSION_SECRET));
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  async function context(authenticated) {
    const result = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await result.route((url) => url.origin !== new URL(base).origin, (route) => route.abort());
    await result.route('**/api/messages', (route) => route.fulfill({ json: { messages: [], deletedMessageIds: [] } }));
    if (authenticated) await result.addCookies([{ name: 'mediachat_session', value: token, url: base, httpOnly: true, sameSite: 'Lax' }]);
    return result;
  }
  const anonymous = await context(false), publicPage = await anonymous.newPage();
  const blocked = [], errors = [];
  const watch = (page) => { page.on('response', (response) => { if (response.url().includes('/_next/') && response.status() === 403) blocked.push(response.url()); }); page.on('pageerror', (error) => errors.push(error.message)); };
  watch(publicPage);
  await publicPage.goto(base); await publicPage.waitForURL('**/login', { timeout: 45000 }); await publicPage.getByPlaceholder('Имя пользователя').waitFor();
  assert.deepEqual(blocked, []); await anonymous.close();
  console.log('PASS LAN mobile page loads JavaScript without 403 and redirects a fresh phone session to login');
  const signed = await context(true), signedPage = await signed.newPage(); watch(signedPage);
  await signedPage.goto(base); await signedPage.getByText('Соединение установлено', { exact: true }).waitFor({ timeout: 45000 });
  assert.deepEqual(blocked, []); await signed.close();
  console.log('PASS authenticated LAN mobile session enters chat and connects Socket.IO');
  const unavailable = await context(true); let outage = true;
  await unavailable.route('**/api/me', (route) => outage ? route.fulfill({ status: 503, json: { error: 'temporary server failure' } }) : route.continue());
  const retry = await unavailable.newPage(); watch(retry); await retry.goto(base);
  await retry.getByRole('alert').filter({ hasText: 'Сервер не смог проверить сессию' }).waitFor();
  assert.equal(new URL(retry.url()).pathname, '/');
  assert((await unavailable.cookies()).some((cookie) => cookie.name === 'mediachat_session'));
  outage = false;
  await retry.getByRole('button', { name: 'Повторить проверку', exact: true }).click(); await retry.getByText('Соединение установлено', { exact: true }).waitFor({ timeout: 30000 }); await unavailable.close();
  console.log('PASS temporary session-server error displays retry UI and preserves the login cookie');
  const stalled = await context(true); let stall = true;
  await stalled.route('**/api/me', async (route) => {
    if (!stall) return route.continue();
    await new Promise((resolve) => setTimeout(resolve, 20000));
    await route.fulfill({ json: { user } }).catch(() => {});
  });
  const waiting = await stalled.newPage(); watch(waiting); await waiting.goto(base);
  await waiting.getByRole('alert').filter({ hasText: '15 секунд' }).waitFor({ timeout: 22000 });
  stall = false;
  await waiting.getByRole('button', { name: 'Повторить проверку', exact: true }).click(); await waiting.getByText('Соединение установлено', { exact: true }).waitFor({ timeout: 30000 });
  assert.deepEqual(blocked, []); assert.deepEqual(errors, []); await stalled.close();
  console.log('PASS stalled session check times out after 15 seconds and retries successfully; zero uncaught page errors');
} finally { await browser?.close(); await db.close(); }
