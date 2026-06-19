/**
 * Bundles the game into one self-contained index.html for sharing/testing.
 * Run after: npx esbuild src/main.ts --bundle --format=esm --target=es2022 --minify --outfile=/tmp/bundle.js
 */
import { readFileSync, writeFileSync } from 'node:fs';

const js = readFileSync('/tmp/bundle.js', 'utf8').replace(/<\/script/gi, '<\\/script');
const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <title>Reactor Coolant Routing</title>
  <style>html,body{margin:0;height:100%;background:#05070d;overflow:hidden}canvas{display:block}</style>
</head>
<body>
  <script type="module">
${js}
  </script>
</body>
</html>`;
writeFileSync(new URL('../reactor-coolant.html', import.meta.url), html);
console.log('wrote reactor-coolant.html', (html.length / 1024 | 0) + 'kb');
