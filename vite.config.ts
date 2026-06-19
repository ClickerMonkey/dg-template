import { defineConfig } from 'vite';

// `base: './'` is REQUIRED — the catalog mounts every game under /<slug>/, so
// emitted asset URLs must be relative or they 404. See HANDOFF.md.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022', // es2022 → top-level await works in main.ts
    // PixiJS v8 lazily `import()`s its renderer/systems. When Rollup splits
    // those across chunks, a cross-chunk circular dependency can leave a
    // renderer system unregistered, and `app.init()` then hangs forever. Force
    // every Pixi module (incl. the dynamically-imported renderer) into one
    // chunk so its init order resolves in a single scope — like dev does.
    rollupOptions: {
      output: {
        manualChunks: (id) =>
          /node_modules[/\\](pixi\.js|@pixi)[/\\]/.test(id) ? 'pixi' : undefined,
      },
    },
  },
});
