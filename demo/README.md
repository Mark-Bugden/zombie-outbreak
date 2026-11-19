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

To release a change, bump `version` in `package.json` in its PR (CI fails if the demo changed and that version is already released). When the PR merges, the Demo workflow builds the bundle, sets the manifest's `built` to that day, releases it as `v<version>` with `dist/` zipped as `demo-<slug>.zip`, and starts the site's build, which puts it live. For the bundle contract and the kit's API, see the [demo-kit README](https://github.com/Mark-Bugden/demo-kit#readme).

The files to edit:

| File | What to change |
| --- | --- |
| `public/manifest.json` | The demo's metadata. |
| `src/main.js` | Controls, drawing and the `mount()` call. |
| `public/data/`, `public/model/` | Runtime files. |
| `public/static.webp`, `thumb.webp`, `og.jpg` | Images. |
