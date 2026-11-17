# Demo

The interactive demo for this project. It is built with [demo-kit](https://github.com/Mark-Bugden/demo-kit), which is pinned in `package.json`.

## Run it locally

```sh
npm install
npm run dev
```

## Build and check the bundle

```sh
npm run build
npx demo-kit validate dist/
npx vite preview            # serves dist/ at http://localhost:4173
```

The release workflow zips `dist/` as `demo-<slug>.zip` and attaches it to the GitHub release. For the bundle contract and the kit's API, see the [demo-kit README](https://github.com/Mark-Bugden/demo-kit#readme).

The files to edit:

| File | What to change |
| --- | --- |
| `public/manifest.json` | The demo's metadata. |
| `src/main.js` | Controls, drawing and the `mount()` call. |
| `public/data/`, `public/model/` | Runtime files. |
| `public/static.webp`, `thumb.webp`, `og.jpg` | Images. |
