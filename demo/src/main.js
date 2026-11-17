// The demo's entry point. Vite bundles it with the kit and the CSS into demo.js and demo.css.
// For now the demo is a stub: the frame around a still image.

import manifest from 'virtual:manifest';
import { mount } from '@mark-bugden/demo-kit';
import '@mark-bugden/demo-kit/tokens.scoped.css';
import '@mark-bugden/demo-kit/frame.css';
import './demo.css';

// static.webp sits beside demo.js in the bundle; `npm run dev` serves it from the page's folder.
const base = import.meta.env.DEV ? document.baseURI : import.meta.url;

const frame = mount({
  el: document.querySelector(`[data-demo="${manifest.slug}"]`),
  manifest,
  status: 'Coming soon: this demo is a stub.',
});

const still = document.createElement('img');
Object.assign(still, {
  src: new URL('static.webp', base).href,
  alt: 'A sketch of a zombie drawn across the pages of an open notebook full of handwritten notes.',
  width: 1200,
  height: 675,
});
frame.stage.append(still);
