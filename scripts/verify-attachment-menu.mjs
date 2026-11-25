// Read-only проверка: существующий пользователь, короткий тестовый JWT, без отправки сообщений/файлов.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { db } from '../src/prisma/db.ts';
const base = process.env.VERIFY_URL || 'http://localhost:3000';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/private/tmp/mediachat-video-browser/node_modules/playwright-core/index.mjs');
let browser;
try {
  const user = await db.orm.public.User.select('id').first();
  assert(user, 'Нужен хотя бы один существующий пользователь для read-only проверки меню');
  const token = await new SignJWT({ userId: user.id }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('5m').sign(new TextEncoder().encode(process.env.SESSION_SECRET));
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  modes: for (const safariFocus of [true, false]) {
    const context = await browser.newContext();
    await context.addCookies([{ name: 'mediachat_session', value: token, url: base, httpOnly: true, sameSite: 'Lax' }]);
    if (safariFocus) await context.addInitScript(() => {
      // В Safari на macOS mouse click не обязательно фокусирует button.
      // Воспроизводим blur с relatedTarget=null до click выбранного пункта.
      document.addEventListener('mousedown', (event) => {
        if (event.target instanceof Element && event.target.closest('[role="menuitem"]')) {
          event.preventDefault();
          document.activeElement?.blur();
        }
      }, true);
    });
    const page = await context.newPage();
    await page.goto(base);
    await page.getByText('Соединение установлено', { exact: true }).waitFor({ timeout: 30000 });
    for (const [name, expected] of [['Изображение', 'image/png'], ['Видео', 'video/mp4'], ['Музыка', '.mp3'], ['Документ или архив', '']]) {
      await page.getByRole('button', { name: 'Прикрепить вложение', exact: true }).click();
      if (process.env.VERIFY_EXPECT_BROKEN === '1') {
        let opened = false; page.once('filechooser', () => { opened = true; });
        await page.getByRole('menuitem', { name, exact: true }).click();
        await page.waitForTimeout(500);
        assert.equal(opened, false);
        assert.equal(await page.getByRole('menu').count(), 0);
        console.log('CONFIRMED: null relatedTarget closes menu before click; no file chooser');
        break modes;
      }
      const chooserPromise = page.waitForEvent('filechooser', { timeout: 5000 });
      await page.getByRole('menuitem', { name, exact: true }).click();
      const chooser = await chooserPromise;
      assert((await chooser.element().getAttribute('accept')).includes(expected));
      await chooser.setFiles([]);
      assert.equal(await page.getByRole('menu').count(), 0);
    }
    console.log(`PASS all four file choosers (${safariFocus ? 'Safari-like null focus transition' : 'normal Chrome pointer'})`);
    await page.getByRole('button', { name: 'Прикрепить вложение', exact: true }).click();
    await page.keyboard.press('Escape'); assert.equal(await page.getByRole('menu').count(), 0);
    await page.getByRole('button', { name: 'Прикрепить вложение', exact: true }).click();
    const chooserPromise = page.waitForEvent('filechooser');
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    await (await chooserPromise).setFiles([]);
    console.log('PASS Escape and keyboard selection');
    await context.close();
  }
} finally { await browser?.close(); await db.close(); }
