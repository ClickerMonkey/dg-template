#!/usr/bin/env node
/**
 * Re-copy the vendored hub client AND the shared docs from a host checkout.
 *
 *   npm run sync-hub                      # uses ../diffenderfer-games
 *   npm run sync-hub -- ../path/to/host   # or DG_HOST=... npm run sync-hub
 *
 * The host repo is the single source of truth for all of these; never edit the
 * copies here (they are overwritten on every sync):
 *
 *   clients/{hub,input,overlay,legacy,daily,uistack}.ts  → src/hub/
 *   clients/social/rt-types.ts                           → src/hub/social/rt-types.ts
 *   clients/server/hub-server.mjs                        → server/hub-server.mjs
 *                                                          (only if this game has a server/ dir —
 *                                                           own-server multiplayer, docs/multiplayer.md §9)
 *   docs/hub.md, docs/multiplayer.md, HANDOFF.md         → same paths here
 */
import { copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const host = resolve(process.argv[2] || process.env.DG_HOST || resolve(root, '..', 'diffenderfer-games'));
const clients = join(host, 'clients');

if (!existsSync(clients)) {
  console.error(`Host client source not found: ${clients}`);
  console.error('Pass the host repo path, e.g.:  npm run sync-hub -- ../diffenderfer-games');
  process.exit(1);
}

/** [host-relative source, game-relative destination, required?] */
const files = [
  ...['hub.ts', 'input.ts', 'overlay.ts', 'legacy.ts', 'daily.ts', 'uistack.ts']
    .map((f) => [`clients/${f}`, `src/hub/${f}`, true]),
  ['clients/social/rt-types.ts', 'src/hub/social/rt-types.ts', true],
  ['docs/hub.md', 'docs/hub.md', false],
  ['docs/multiplayer.md', 'docs/multiplayer.md', false],
  ['HANDOFF.md', 'HANDOFF.md', false],
];

// The game-server SDK only matters to own-server (process) games, which keep
// their server code in server/. Static games don't get a stray server file.
if (existsSync(join(root, 'server'))) {
  files.push(['clients/server/hub-server.mjs', 'server/hub-server.mjs', true]);
}

let failed = false;
for (const [from, to, required] of files) {
  const src = join(host, from);
  if (!existsSync(src)) {
    if (required) { console.error(`missing in host: ${from}`); failed = true; }
    else console.warn(`skipped ${to} (host has no ${from})`);
    continue;
  }
  const dest = join(root, to);
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(src, dest);
  console.log('synced', to);
}

if (!existsSync(join(root, 'server'))) {
  console.log('(no server/ dir: skipped hub-server.mjs; own-server games copy clients/server/hub-server.mjs to server/)');
}
if (failed) {
  console.error('Sync incomplete: the host checkout is missing required client files (is it up to date?).');
  process.exit(1);
}
console.log(`Hub client + docs synced from ${host}`);
