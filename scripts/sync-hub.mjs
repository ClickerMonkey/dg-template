#!/usr/bin/env node
/**
 * Re-copy the vendored hub client from a host checkout into src/hub/.
 *
 *   npm run sync-hub                      # uses ../diffenderfer-games
 *   npm run sync-hub -- ../path/to/host   # or DG_HOST=... npm run sync-hub
 *
 * The hub client is canonical in the host repo's clients/; this keeps the
 * template's snapshot up to date.
 */
import { copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const host = process.argv[2] || process.env.DG_HOST || resolve(root, '..', 'diffenderfer-games');
const src = join(host, 'clients');
const dest = join(root, 'src', 'hub');
const files = ['hub.ts', 'input.ts', 'overlay.ts', 'legacy.ts', 'daily.ts'];

if (!existsSync(src)) {
  console.error(`Host client source not found: ${src}`);
  console.error('Pass the host repo path, e.g.:  npm run sync-hub -- ../diffenderfer-games');
  process.exit(1);
}
await mkdir(dest, { recursive: true });
for (const f of files) {
  await copyFile(join(src, f), join(dest, f));
  console.log('synced', f);
}
console.log(`Hub client synced from ${src}`);
