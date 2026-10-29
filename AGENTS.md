<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Working on MyCloset

This is a Next.js App Router project, organized like the user's ServiceDesk project. Use JavaScript/JSX, React components and ordinary CSS. Runtime dependencies are next, react and react-dom.

- Preserve Russian UI, accessible forms, keyboard interactions and responsive layouts down to 320px.
- Preserve the restored original visual design and screen structure: dark sidebar, original dashboard blocks, six-item mobile navigation and profile within settings. Do not redesign these during technical rewrites unless the user asks.
- Implement pages in app/(closet), reusable UI in components, domain code in lib and assets in public/assets. Do not reintroduce duplicated projects, legacy HTML shells, public runtime modules, script injection, MUI or Bootstrap.
- Preserve IndexedDB name mycloset-local-v1, store data, key state and validated backup migrations 1–4. Never silently discard photos, outfits, plans or shopping data.
- Serialize writes and publish state only after successful persistence. Preserve explicit memory-mode warnings and confirmation for destructive actions and backup replacement.
- Prefer owned available items. Explain missing pieces, laundry, unknown weather and rule-based recommendations honestly. Do not fabricate stock, prices or AI photo analysis.
- Weather calls use only the fixed Open-Meteo HTTPS endpoints via Next.js Route Handlers. Keep manual fallback and date checks.
- Preserve the MIT notice in lib/qrcode.js and both font OFL files.
- Keep browser profiles, user backups, credentials, caches, build outputs and QA screenshots outside tracked source.
- Run npm test and npm run build for relevant changes; verify actual browser behavior for interface changes.
- docs/TZ.md is the original specification. Its historical commands and proposed technology list do not override the user's current instructions or this implementation.
