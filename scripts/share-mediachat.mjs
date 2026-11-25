// Temporary HTTPS sharing; no system DNS/VPN changes and no personal SSH keys.
import { createConnection } from 'node:net';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const dist = process.env.MEDIA_CHAT_DIST_DIR || '.next';
if (!existsSync(resolve(dist, 'BUILD_ID'))) {
  console.error('Сначала выполните npm run build -- --webpack'); process.exit(1);
}
const occupied = await new Promise((resolve) => {
  const socket = createConnection({ host: '127.0.0.1', port: 3000 });
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('error', () => resolve(false));
});
if (occupied) { console.error('Порт 3000 занят. Остановите прежний сервер перед запуском.'); process.exit(1); }
let app, tunnel, origin;
let restarting = false;
let closing = false;
function stop() { if (closing) return; closing = true; app?.kill('SIGTERM'); tunnel?.kill('SIGTERM'); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
tunnel = spawn('ssh', ['-F', '/dev/null', '-i', '/dev/null', '-o', 'IdentityAgent=none', '-o', 'IdentitiesOnly=yes',
  '-o', 'StrictHostKeyChecking=accept-new', '-o', `UserKnownHostsFile=${resolve('.next/tunnel-known-hosts')}`,
  '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3', '-o', 'ExitOnForwardFailure=yes',
  '-o', 'ConnectTimeout=15', '-T', '-R', '80:127.0.0.1:3000', 'nokey@localhost.run'], { stdio: ['ignore', 'pipe', 'pipe'] });
const deadline = setTimeout(() => { console.error('Туннель не выдал адрес за 60 секунд. Повторите запуск.'); stop(); }, 60000);
deadline.unref();
let buffer = '';
function startApp() {
  app = spawn(process.execPath, ['server.js'], { stdio: 'inherit', env: { ...process.env,
    NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '3000', APP_ORIGIN: origin, MEDIA_CHAT_DIST_DIR: dist, MEDIA_CLEANUP_ENABLED: 'false' } });
  app.on('error', (error) => { console.error(error.message); stop(); });
  app.on('exit', () => { app = undefined; if (closing) return; if (restarting) { restarting = false; startApp(); } else stop(); });
}
function receive(chunk) {
  const text = chunk.toString(); buffer = (buffer + text).slice(-20000);
  const matches = [...buffer.matchAll(/https:\/\/[a-z0-9-]+\.app\.lhr\.life\b/g)];
  const nextOrigin = matches.at(-1)?.[0];
  if (nextOrigin && nextOrigin !== origin && !closing) {
    origin = nextOrigin; clearTimeout(deadline);
    console.log(`\nMediaChat HTTPS: ${origin}\nНе закрывайте терминал. Остановка: Ctrl+C.`);
    if (app) { restarting = true; app.kill('SIGTERM'); } else startApp();
  }
  if (/permission denied|connection refused|could not resolve|timed out/i.test(text) && !text.includes('Welcome to localhost.run')) console.error(text.trim());
}

tunnel.stdout.on('data', receive); tunnel.stderr.on('data', receive);
tunnel.on('error', (error) => { console.error(error.message); stop(); process.exitCode = 1; });
tunnel.on('exit', () => { stop(); if (!origin) console.error('Туннель не запущен. Проверьте интернет/VPN и повторите.'); });
