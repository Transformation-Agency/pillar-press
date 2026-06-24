# Browser Runtime Vendor Files

King's Press bundles these browser startup files so the desktop app can launch
offline without fetching React or ReactDOM from a CDN.

- `react.production.min.js`: React 18.3.1 UMD production build from unpkg.
- `react-dom.production.min.js`: ReactDOM 18.3.1 UMD production build from unpkg.
- `babel.min.js`: retained only for legacy/local inspection. The production
  desktop shell precompiles JSX to `public/build/app.compiled.js` via
  `npm run desktop:build-static-shell` and does not load Babel at runtime.

These upstream projects are MIT licensed. Keep this folder small and only use it
for files required before the local Next/Tauri runtime can render the app shell.
