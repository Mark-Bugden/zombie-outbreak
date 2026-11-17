// Builds the demo bundle: demo.js, demo.css and everything in public/, with relative paths so
// the bundle works at any URL depth (standalone, or under /demos/<slug>/ on the site).
// The bundle contract allows no other files, so code splitting is off and names are fixed.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const manifestFile = fileURLToPath(new URL('./public/manifest.json', import.meta.url));

// Lets src/ `import manifest from 'virtual:manifest'` (Vite warns on imports straight from public/).
function manifest() {
  const id = '\0virtual:manifest';
  return {
    name: 'demo-manifest',
    resolveId: (source) => (source === 'virtual:manifest' ? id : null),
    load(source) {
      if (source !== id) return null;
      this.addWatchFile(manifestFile);
      return `export default ${readFileSync(manifestFile, 'utf8')};`;
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [manifest()],
  build: {
    assetsDir: '.',
    cssCodeSplit: false,
    modulePreload: { polyfill: false },
    rolldownOptions: {
      output: {
        entryFileNames: 'demo.js',
        codeSplitting: false,
        assetFileNames: (asset) => ((asset.names ?? [asset.name]).some((name) => name?.endsWith('.css')) ? 'demo.css' : '[name][extname]'),
      },
    },
  },
});
