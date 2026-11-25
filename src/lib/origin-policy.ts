import { networkInterfaces } from 'node:os';
export function parseOrigin(value: string): string | null {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.hostname.includes('*') && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash && value === url.origin ? url.origin : null; } catch { return null; }
}
export function allowedOrigins(env: NodeJS.ProcessEnv = process.env, addresses?: string[]) {
  const allowed = new Set<string>();
  const configured = [env.APP_ORIGIN, ...(env.APP_ALLOWED_ORIGINS || '').split(',')];
  for (const value of configured) if (value?.trim()) { const origin = parseOrigin(value.trim()); if (!origin) throw new Error('APP_ORIGIN/APP_ALLOWED_ORIGINS должны содержать точные HTTP(S) origins без путей'); allowed.add(origin); }
  if (env.NODE_ENV !== 'production') {
    const port = env.PORT || '3000';
    for (const host of ['localhost', '127.0.0.1', '[::1]']) allowed.add(`http://${host}:${port}`);
    if (env.APP_ALLOW_LAN !== 'false') {
      const hosts = addresses ?? Object.values(networkInterfaces()).flatMap((list) => list || []).filter((item) => item.family === 'IPv4' && !item.internal).map((item) => item.address);
      for (const host of hosts) if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) allowed.add(`http://${host}:${port}`);
    }
  }
  return allowed;
}
export function permittedOrigin(origin: string | null | undefined, host: string | null | undefined, allowed: Set<string>) {
  if (!host || ![...allowed].some((value) => new URL(value).host === host)) return false;
  return Boolean(origin && parseOrigin(origin) && allowed.has(origin));
}
