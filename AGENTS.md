<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Working on MyCloset

This is a Next.js App Router project, organized like the user's ServiceDesk project. Use JavaScript/JSX and React components. The user has explicitly requested Material UI and Bootstrap; use MUI controls with the App Router SSR cache provider and Bootstrap grid/utilities while retaining the original design.

- Preserve Russian UI, accessible forms, keyboard interactions and responsive layouts down to 320px.
- Preserve the restored original visual design and screen structure: dark sidebar, original dashboard blocks, six-item mobile navigation and profile within settings. Do not redesign these during technical rewrites unless the user asks.
- Preserve light, dark and system appearance modes, the pre-paint theme initializer, the header toggle and settings picker. Keep real photos, garment color swatches and QR codes unchanged by theme filters. Appearance is a browser preference outside wardrobe backups.
- Keep Next.js route wrappers in app/(closet) and screen components in components/pages. Group shared forms, cards, layout, providers, UI and hooks in the corresponding components subfolders. Group domain code in lib/data, lib/styling, lib/weather, lib/cloud, lib/media and lib/devices; styles live in app/styles and assets in public/assets. Do not reintroduce duplicated projects, legacy HTML shells, public runtime modules or script injection. Keep MUI dialogs and controls under the shared theme; use Bootstrap grid and utilities without its global Reboot or imperative DOM plugins.
- Preserve IndexedDB name mycloset-local-v1, store data, key state, format 5 and validated migrations from backups 1–4. Never silently discard photos, outfits, plans, purchases, wear history, capsules or trips.
- Keep this site locally hosted until the user asks to publish it. Cloud accounts and sync are optional; never upload a local wardrobe merely because a user signs in.
- Cloud resource ownership must come from the verified server session. Preserve account-change guards, optimistic revision conflicts, private/no-store auth responses and lossless JSON storage. Local backup import and browser reset disconnect sync before applying local changes and preserve the cloud copy.
- Keep Secure auth cookies. Localhost login is supported; a phone using a LAN HTTP address needs an HTTPS origin to sign in. Do not pretend that a local link is public hosting.
- Serialize writes and publish state only after successful persistence. Preserve explicit memory-mode warnings and confirmation for destructive actions and backup replacement.
- Prefer owned available items. Explain missing pieces, laundry, unknown weather and rule-based recommendations honestly. Do not fabricate stock, prices or AI photo analysis.
- Weather calls use only the fixed Open-Meteo HTTPS endpoints via Next.js Route Handlers. Keep manual fallback and date checks.
- Preserve the MIT notice in lib/devices/qrcode.js and both font OFL files.
- Write readable multiline JavaScript, JSX and CSS with two-space indentation. Shared forms must not be imported from page components. Keep the folder map and setup instructions together in README.md.
- Keep browser profiles, user backups, credentials, caches, build outputs and QA screenshots outside tracked source.
- Run npm test and npm run build for relevant changes; verify actual browser behavior for interface changes.
- docs/TZ.md is the original specification. Its historical commands and proposed technology list do not override the user's current instructions or this implementation.
