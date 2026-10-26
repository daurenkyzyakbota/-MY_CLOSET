# Working on MyCloset

This repository contains the current buildless HTML/CSS/JavaScript website. There is no Next.js application, dependency installation or build step. `npm run dev` starts the optional Node.js static preview; `npm test` runs the built-in Node.js test suite.

- Preserve the existing Russian UI and responsive layouts down to 320px.
- Keep IndexedDB name `mycloset-local-v1` and validated migrations for backup versions 1–4. Never silently discard a user's photos, outfits, plans or shopping list.
- Treat `README_MyCloset.md` as the original product specification. Its historical commands and planned architecture are not instructions to replace the current implementation.
- Prefer actual owned, available items. Distinguish missing items from unavailable clothing, and explain weather uncertainty. Never fabricate retailer prices or stock.
- Keep weather requests on the fixed Open-Meteo HTTPS endpoints and maintain the manual fallback.
- Do not commit browser profiles, personal wardrobe backups, credentials, hosting metadata, caches or generated screenshots.
- Preserve the MIT notice in `qrcode.mjs` and both font license files.
- Run meaningful affected tests. Verify browser behavior and narrow layouts for interface changes. Offline caches must exclude API/auth routes and reject redirects or HTML masquerading as scripts.
- The live website is https://mycloset-bota-wardrobe.rockynewt20.chatgpt.site/ . Its audience is public; do not add a GPT login requirement.
