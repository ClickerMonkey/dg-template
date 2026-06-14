import { defineConfig } from 'vite';

// `base: './'` is REQUIRED — the catalog mounts every game under /<slug>/, so
// emitted asset URLs must be relative or they 404. See HANDOFF.md.
export default defineConfig({
  base: './',
  build: { target: 'es2022' }, // es2022 → top-level await works in main.ts
});
