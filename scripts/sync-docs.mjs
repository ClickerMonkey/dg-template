#!/usr/bin/env node
/**
 * Re-copy the shared docs from a host checkout.
 *
 *   npm run sync-docs                      # uses ../diffenderfer-games
 *   npm run sync-docs -- ../path/to/host   # or DG_HOST=... npm run sync-docs
 *
 * The host repo is the single source of truth for these; never edit the copies
 * here (they are overwritten on every sync):
 *
 *   docs/hub.md, docs/multiplayer.md, HANDOFF.md → same paths here
 *
 * The hub client itself is the npm package @diffenderfer-games/hub (update it
 * with npm). Own-server games get server/hub-server.mjs from
 * `npm run sync-hub-server` instead.
 */
import { copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const host = resolve(process.argv[2] || process.env.DG_HOST || resolve(root, '..', 'diffenderfer-games'));
const sharedDocs = ['docs/hub.md', 'docs/multiplayer.md', 'HANDOFF.md'];

const missing = sharedDocs.filter((doc) => !existsSync(join(host, doc)));
if (missing.length > 0) {
  console.error(`Not a host checkout (missing ${missing.join(', ')}): ${host}`);
  console.error('Pass the host repo path, e.g.:  npm run sync-docs -- ../diffenderfer-games');
  process.exit(1);
}

for (const doc of sharedDocs) {
  const dest = join(root, doc);
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(join(host, doc), dest);
  console.log('synced', doc);
}
console.log(`Docs synced from ${host}`);
