// Read-only UI check: browser-only media fixtures, no upload or database writes.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SignJWT } from 'jose';
import { db } from '../src/prisma/db.ts';
import { parseRange } from '../src/lib/http-range.ts';
const base = process.env.VERIFY_URL || 'http://localhost:3000';
const root = await mkdtemp(join(tmpdir(), 'mediachat-viewer-'));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/private/tmp/mediachat-video-browser/node_modules/playwright-core/index.mjs');
let browser;
let debugPage;
async function until(check, label) {
  const start = Date.now();
  while (Date.now() - start < 15000) { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 100)); }
  if (debugPage) {
    console.log('UI check failure:', label, await debugPage.evaluate(() => ({ focused: document.hasFocus(), fullscreen: document.fullscreenElement?.tagName || null, dialogOpen: document.querySelector('dialog')?.open || false, errors: [...document.querySelectorAll('[role="alert"]')].map((element) => element.textContent) })));
    await debugPage.screenshot({ path: '/private/tmp/mediachat-viewer-check-failure.png' });
  }
  throw new Error(`Timeout: ${label}`);
}
try {
  const path = join(root, 'clip.mp4'), poster = join(root, 'poster.jpg');
  execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=10', '-t', '2', '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '1', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path]);
  execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', path, '-frames:v', '1', poster]);
  const bytes = await readFile(path), jpeg = await readFile(poster);
  const user = await db.orm.public.User.select('id').first(); assert(user);
  const token = await new SignJWT({ userId: user.id }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('5m').sign(new TextEncoder().encode(process.env.SESSION_SECRET));
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1100, height: 850 } });
  await context.addCookies([{ name: 'mediachat_session', value: token, url: base, httpOnly: true, sameSite: 'Lax' }]);
  const info = { url: '/__viewer_fixture.mp4', posterUrl: '/__viewer_fixture.jpg', originalName: 'Проверка просмотра.mp4', size: bytes.length, mimeType: 'video/mp4', duration: 2, width: 320, height: 180, videoCodec: 'h264', audioCodec: null };
  const messages = [
    { id: 2000000000, author: 'Проверка', userId: user.id, text: '', videoUrl: info.url, video: info },
    ...[1, 2].map((id) => ({ id: 2000000000 + id, author: 'Проверка', userId: user.id, text: '', audioUrl: `/__volume_${id}.wav`, audioName: `Проверка ${id}.wav` })),
  ];
  await context.route('**/api/messages', (route) => route.fulfill({ json: { messages } }));
  const wav = Buffer.alloc(44 + 40 * 16000);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(40 * 16000, 40);
  await context.route(/\/__volume_[12]\.wav$/, (route) => {
    const range = parseRange(route.request().headers().range || null, wav.length);
    return route.fulfill({ status: range?.status || 416, headers: { 'content-type': 'audio/wav', 'accept-ranges': 'bytes', ...(range?.status === 206 ? { 'content-range': `bytes ${range.start}-${range.end}/${wav.length}` } : {}) }, body: range ? wav.subarray(range.start, range.end + 1) : Buffer.alloc(0) });
  });
  await context.route('**/__viewer_fixture.jpg', (route) => route.fulfill({ contentType: 'image/jpeg', body: jpeg }));
  await context.route(/\/__viewer_fixture\.mp4(?:\?.*)?$/, (route) => {
    const range = parseRange(route.request().headers().range || null, bytes.length);
    if (!range) return route.fulfill({ status: 416, headers: { 'content-range': `bytes */${bytes.length}` } });
    return route.fulfill({ status: range.status, headers: { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', ...(range.status === 206 ? { 'content-range': `bytes ${range.start}-${range.end}/${bytes.length}` } : {}) }, body: bytes.subarray(range.start, range.end + 1) });
  });
  const page = await context.newPage(), errors = [];
  debugPage = page;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  const region = page.getByRole('region', { name: `Видео: ${info.originalName}`, exact: true });
  const viewer = page.getByRole('dialog', { name: `Просмотр видео: ${info.originalName}`, exact: true });
  const video = viewer.locator('video');
  async function openVideo() {
    await region.getByRole('button', { name: `Открыть видео ${info.originalName}`, exact: true }).click();
    await until(() => video.evaluate((element) => element.readyState >= 1), 'video ready');
  }
  async function closeVideo() { await viewer.getByRole('button', { name: 'Остановить и закрыть видео', exact: true }).click(); }
  await openVideo();
  assert.equal(await video.evaluate((element) => element.loop), false);
  await viewer.getByRole('button', { name: 'Повтор видео', exact: true }).click();
  assert.equal(await video.evaluate((element) => element.loop), true);
  const slider = viewer.getByRole('slider', { name: 'Громкость видео', exact: true });
  const videoVolumeBox = await slider.boundingBox();
  await page.mouse.click(videoVolumeBox.x + videoVolumeBox.width * .25, videoVolumeBox.y + videoVolumeBox.height / 2);
  const savedVideoVolume = await video.evaluate((element) => element.volume);
  assert(savedVideoVolume > 0 && savedVideoVolume < .5);
  await closeVideo();
  await page.reload();
  await openVideo();
  assert.equal(await video.evaluate((element) => element.volume), savedVideoVolume, 'video volume survives reload before playing');
  assert.equal(await video.evaluate((element) => element.loop), true, 'video repeat survives close/reload');
  assert.equal(await viewer.getByRole('button', { name: 'Повтор видео', exact: true }).getAttribute('aria-pressed'), 'true');

  assert.equal(Number(await slider.inputValue()), savedVideoVolume);
  await closeVideo();

  const audioPlayer = page.getByRole('region', { name: 'Музыкальный плеер', exact: true });
  await page.getByRole('button', { name: 'Воспроизвести Проверка 1.wav', exact: true }).click();
  assert.equal(await audioPlayer.locator('audio').evaluate((element) => element.volume), 1, 'music preference is separate from video');
  const audio = audioPlayer.locator('audio');
  assert.equal(await audio.evaluate((element) => element.loop), false, 'video repeat does not enable music repeat');
  await until(() => audio.evaluate((element) => Number.isFinite(element.duration) && element.duration > 30 && !element.paused), 'music ready');
  await audioPlayer.getByRole('button', { name: 'Пауза', exact: true }).click();
  await audio.evaluate((element) => { element.currentTime = 0; });
  await page.keyboard.press('ArrowRight');
  assert(await audio.evaluate((element) => Math.abs(element.currentTime - 15) < .25), 'music ArrowRight +15');
  await page.keyboard.press('ArrowLeft');
  assert(await audio.evaluate((element) => element.currentTime < .25), 'music ArrowLeft -15');
  await page.keyboard.press('ArrowLeft');
  assert(await audio.evaluate((element) => element.currentTime >= 0), 'music seek clamps at start');
  await audio.evaluate((element) => { element.currentTime = element.duration - 2; });
  await page.keyboard.press('ArrowRight');
  assert(await audio.evaluate((element) => element.currentTime <= element.duration && element.currentTime > element.duration - .25), 'music seek clamps at end');
  await audio.evaluate((element) => { element.currentTime = 15; });
  const messageInput = page.getByPlaceholder('Написать сообщение...');
  await messageInput.fill('проверка'); await messageInput.press('ArrowLeft');
  assert(await audio.evaluate((element) => Math.abs(element.currentTime - 15) < .25), 'typing must not seek music');
  assert.equal(await messageInput.evaluate((element) => element.selectionStart), 'проверка'.length - 1);
  await messageInput.fill('');
  await audioPlayer.getByRole('button', { name: 'Повтор трека', exact: true }).click();
  assert.equal(await audio.evaluate((element) => element.loop), true);
  const audioSlider = audioPlayer.getByRole('slider', { name: 'Громкость', exact: true });
  const audioVolumeBox = await audioSlider.boundingBox();
  await page.mouse.click(audioVolumeBox.x + audioVolumeBox.width * .45, audioVolumeBox.y + audioVolumeBox.height / 2);
  const savedAudioVolume = await audioPlayer.locator('audio').evaluate((element) => element.volume);
  assert(savedAudioVolume > 0 && savedAudioVolume < 1);
  await page.getByRole('button', { name: 'Воспроизвести Проверка 2.wav', exact: true }).click();
  assert.equal(await audioPlayer.locator('audio').evaluate((element) => element.volume), savedAudioVolume, 'music volume survives track switch');
  assert.equal(await audio.evaluate((element) => element.loop), true, 'music repeat survives track switch');
  await page.reload();
  await page.getByRole('button', { name: 'Воспроизвести Проверка 1.wav', exact: true }).click();
  assert.equal(await audioPlayer.locator('audio').evaluate((element) => element.volume), savedAudioVolume, 'music volume survives reload');
  assert.equal(await audio.evaluate((element) => element.loop), true, 'music repeat survives reload');
  assert.equal(await audioPlayer.getByRole('button', { name: 'Повтор трека', exact: true }).getAttribute('aria-pressed'), 'true');
  await audioPlayer.getByRole('button', { name: 'Повтор трека', exact: true }).click();
  assert.equal(Number(await audioSlider.inputValue()), savedAudioVolume);
  await until(() => audio.evaluate((element) => !element.paused), 'music after reload');
  await openVideo();
  assert(await audio.evaluate((element) => element.paused), 'opening video must pause music');
  const musicPosition = await audio.evaluate((element) => element.currentTime);
  assert.equal(await audio.evaluate((element) => element.volume), savedAudioVolume, 'pausing music keeps its volume');
  await page.keyboard.press('ArrowRight');
  assert.equal(await audio.evaluate((element) => element.currentTime), musicPosition, 'video shortcut must not also seek music');
  await closeVideo();
  assert(await audio.evaluate((element) => element.paused), 'music stays paused after video closes');
  await audioPlayer.getByRole('button', { name: 'Воспроизвести', exact: true }).click();
  await until(() => audio.evaluate((element) => !element.paused), 'music can resume manually');
  await audioPlayer.getByRole('button', { name: 'Закрыть плеер', exact: true }).click();
  await openVideo();
  assert.equal(await video.evaluate((element) => element.volume), savedVideoVolume, 'music volume does not overwrite video volume');
  await slider.focus(); await slider.press('Home');
  assert.equal(await video.evaluate((element) => element.volume), 0);
  await closeVideo(); await page.reload(); await openVideo();
  assert.equal(await video.evaluate((element) => element.volume), 0, 'zero is restored, not replaced by default 1');
  assert.equal(Number(await page.evaluate(() => localStorage.getItem('mediachat.volume.audio'))), savedAudioVolume);
  assert.equal(await video.evaluate((element) => element.loop), true, 'music repeat off does not affect video repeat');
  await viewer.getByRole('button', { name: 'Повтор видео', exact: true }).click();
  await closeVideo(); await page.reload(); await openVideo();
  assert.equal(await video.evaluate((element) => element.loop), false, 'video repeat off is also remembered');
  await closeVideo();
  await page.getByRole('button', { name: 'Воспроизвести Проверка 1.wav', exact: true }).click();
  assert.equal(await audio.evaluate((element) => element.loop), false, 'music repeat off survives closing and reopening');

  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('PASS: video volume after reopen/reload, music volume across track switch/reload, independent preferences, zero volume, music ArrowLeft/Right +/-15 and clamps, text cursor unaffected, video shortcuts isolated, video opening pauses music without auto-resume, repeat on/off for both players survives closing/reload/track switch independently, no page errors');
} finally { await browser?.close(); await db.close(); await rm(root, { recursive: true, force: true }); }
