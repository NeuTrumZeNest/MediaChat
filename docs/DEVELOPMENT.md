# Development and deployment

This guide preserves operational details separately from the project overview. It describes the current custom-server architecture, not a production certification.

## Environment

Create `.env` from the root `.env.example` on a fresh checkout. Retain existing secrets and database settings when updating an installation. Standalone scripts and Prisma load `.env` through dotenv; keep required settings there rather than relying only on Next.js-specific `.env.local` loading.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Private PostgreSQL connection string |
| `SESSION_SECRET` | Random JWT signing secret; generate with `openssl rand -base64 48` |
| `PORT` | HTTP and Socket.IO port; defaults to `3000` |
| `HOST` | Listening interface; defaults to `0.0.0.0`; the sharing script uses loopback |
| `APP_ORIGIN` | Exact external HTTP(S) origin; required for the usual HTTPS deployment |
| `APP_ALLOWED_ORIGINS` | Additional exact origins separated by commas |
| `APP_ALLOW_LAN` | Set to `false` to disable automatic development LAN origins |
| `FFMPEG_PATH`, `FFPROBE_PATH` | Optional executable paths instead of lookup on `PATH` |
| `MEDIA_CHAT_DIST_DIR` | Optional isolated Next.js build directory |
| `MEDIA_CLEANUP_ENABLED` | Set to `false` to disable scheduled orphan cleanup and startup retries; explicit message deletion still cleans unused files |

Origins must include the protocol and any non-default port, without a trailing slash, path, credentials, or wildcard. Production has no automatic localhost/LAN allowlist. Do not use arbitrary Host or forwarded headers as trusted origin configuration. See [LAN access](LOCAL-NETWORK.md) for the full policy, including missing-Origin requests.

## Database workflow

The project uses `@prisma/orm-postgres` 8 RC contracts and `@prisma/cli-engine`, not the classic generated Prisma Client workflow. The `@prisma/client` dependency version does not describe the active database runtime. `src/prisma/contract.prisma`, `contract.json`, and `contract.d.ts` define the schema contract; `migrations/` holds snapshots, migration packages, and refs.

Use the locked dependencies and inspect the installed CLI's help before changing contracts. Do not substitute `prisma migrate dev`, `db push`, or `db reset`.

For an existing database, inspect without applying changes:

```sh
npx prisma db verify
npx prisma migration status
npx prisma migration check
npx prisma db migrate --show
```

A new empty database can be advanced through the committed graph with `npx prisma db migrate` after reviewing the preview and migration DDL. Never run `db init` on an existing database.

For a schema change, establish the actual previous contract and database state, emit the updated contract with `npm run contract:emit`, and plan from the verified starting hash using `prisma migration plan --from <hash>`. Review the generated DDL and graph before applying the intended target with `prisma db migrate --to <hash> --advance-ref db`. These are maintenance steps requiring a matching live state, not routine installation commands. Back up existing data before applying schema changes; never reset a populated database to resolve drift.

## Media storage and validation

Keep `uploads/` outside `public/` and deny direct static access. PostgreSQL stores message references such as `Message.documentUrl`; filesystem JSON metadata stores original names, MIME types, sizes, and owners. Images, audio, videos, documents, and avatars share access policies but have separate storage and processing modules.

- Images: 25 MiB and at most 40 million input pixels; originals and optimized previews are separate.
- Audio: 50 MiB; MP3/WAV/FLAC signature checks. Codec playback remains browser-dependent.
- Video: 50 MiB; supported MP4/WebM containers and codecs, up to 30 minutes and 4K. FFprobe inspection and full FFmpeg decoding validate inputs; thumbnails are separate and originals are not transcoded.
- Avatars: JPEG/PNG/WebP up to 10 MiB, cropped and converted to 512 × 512 WebP.
- Documents: 2 GiB per file through streamed uploads. Supported TXT/CSV/PDF/ZIP/Open XML files up to 25 MiB receive format-specific inspection. Large or opaque fallback files are stored and downloaded without complete content inspection.

Small ZIP inspection limits archives to 4,096 entries and 100 MiB total uncompressed content, rejecting unsafe paths, encryption, multi-volume archives, and ZIP64. Open XML inspection rejects `vbaProject.bin`. Files are not extracted to disk. PDF checks are structural, not a complete PDF parser. Explicit opaque fallback can preserve unsupported or unparseable content as download-only data; successful upload does not certify a file as safe or valid.

Downloads use attachment/nosniff headers where applicable; opaque files additionally use restrictive sandbox headers. Ownership is checked when attaching files, and current conversation access is checked when reading them. See [large files](LARGE-FILES.md), [video](VIDEO.md), and [attachment batches](ATTACHMENT-BATCHES.md).

## Integration checks

Run automated tests with `npm test`. These use isolated temporary fixtures, including real FFmpeg processing, rather than a live PostgreSQL database.

For application-level checks, use a disposable test database configured with the committed migrations. In a dedicated terminal:

```sh
PORT=3102 APP_ORIGIN=http://localhost:3102 MEDIA_CHAT_DIST_DIR=.next/verification MEDIA_CLEANUP_ENABLED=false npm run dev
```

In another terminal, against the same test database:

```sh
node scripts/verify-origin-lan.mjs
node scripts/verify-direct-messages.mjs
# Restart the verification server before the next registration-heavy scenario.
node scripts/verify-groups-avatars.mjs
```

The direct/group scripts accept `VERIFY_URL`; the Origin script checks port 3102 on localhost, loopback, and a detected `192.168.*` interface. It requires such an interface to be available.

Browser scenarios require Google Chrome and an existing Playwright Core installation outside application dependencies. Set `PLAYWRIGHT_MODULE` to its `index.mjs`. The direct/group scripts currently use `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`; their default Playwright path is specific to the original macOS verification environment. Adapt these local tool paths if needed. Playwright and Chrome are not installed by `npm ci`.

Scripts create temporary accounts, messages, conversations, and files, then clean up their own fixtures. Registration limits intentionally remain active; restart the test server between registration-heavy runs. The direct/group scripts support `VERIFY_FIXTURES_VIA_DB=1` for repeated runs that create test users directly without changing application rate limits. Never run these scripts against production.

The document-specific script uses port 3101 by default; follow its source/configuration rather than assuming every verifier shares the same defaults. The 2 GiB upload verifier transfers real data and needs sufficient disk space and time. Feature guides record scenario details. [V1-PROGRESS.md](V1-PROGRESS.md) contains dated results; earlier entries describe earlier stages and may be superseded by later ones.

## Deployment and maintenance

Build and run the custom server:

```sh
npm run build -- --webpack
# Configure APP_ORIGIN for your HTTPS reverse proxy first.
npm start
```

`npm start` sets production mode and starts `server.js`; `next start` alone omits Socket.IO initialization. Turbopack is the default Next.js builder; Webpack is the verified alternative used here. The current Google font setup in `app/layout.tsx` requires network access during a build. These shell scripts use POSIX environment variable syntax.

Use one persistent Node.js process behind an HTTPS reverse proxy with WebSocket Upgrade support. Preserve the explicitly allowed Host, set the correct external origin, and use HTTPS for production Secure cookies. Provide persistent private PostgreSQL and upload storage with restricted permissions and coordinated backups. Never expose PostgreSQL publicly or commit secrets, uploads, or database dumps.

Configure proxy upload limits and timeouts per route: approximately 55 MiB for the audio/video routes, and up to 2 GiB with request buffering disabled for streamed documents. A document upload can run for up to one hour; the application allows one document upload per user and two per process. Provider/CDN limits can be lower. See the nginx example in [LARGE-FILES.md](LARGE-FILES.md). Uploads currently cannot resume from a byte offset.

Rate limits and realtime coordination are process-local. IP-based authentication limits use the immediate connection address, so clients behind a proxy can share a limit. Before scaling or public release, implement explicitly trusted proxy/client-IP handling, shared rate limiting, realtime coordination across instances, and storage quotas. Device/browser and deployment validation remain necessary.

Message deletion removes unused original and derived files while retaining files referenced by other live messages. Scheduled cleanup handles orphaned uploads older than 24 hours and retries failed deletion jobs. Inspect manually before applying maintenance:

```sh
npm run media:cleanup
npm run media:cleanup -- --apply
```

See [deletion and cleanup](MESSAGE-DELETION.md) for reference handling and failure behavior. Existing detailed guides remain the source for subsystem-specific operational limits.

For temporary demos only, use `npm run build:share` followed by `npm run share`. Both use `.next/groups-release`; stop any other server on port 3000 first. The script obtains a localhost.run HTTPS address, sets `APP_ORIGIN`, and binds the application to loopback. Addresses can rotate, connections can fail, and the host must remain online. See [internet access](INTERNET-ACCESS.md); the tunnel is not a production hosting solution.
