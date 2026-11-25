import { allowedOrigins, permittedOrigin } from './origin-policy.ts';
export function validMutationOrigin(request: Request) {
  const allowed = allowedOrigins();
  const host = request.headers.get('host');
  const origin = request.headers.get('origin');
  if (origin !== null) return permittedOrigin(origin, host, allowed);
  // Browser requests must prove their origin, including older browsers via Referer.
  const site = request.headers.get('sec-fetch-site');
  if (site === 'cross-site' || site === 'same-site') return false;
  const referer = request.headers.get('referer');
  if (referer) { try { return permittedOrigin(new URL(referer).origin, host, allowed); } catch { return false; } }
  // Native/API clients without browser fetch metadata still need normal route auth.
  const type = request.headers.get('content-type')?.split(';')[0].trim();
  return !site && (type === 'application/json' || type === 'application/octet-stream') &&
    Boolean(host && [...allowed].some((value) => new URL(value).host === host));
}
