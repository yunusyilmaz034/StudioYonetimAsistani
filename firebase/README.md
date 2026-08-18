# firebase/

## `storage-cors.json` — the Storage bucket's CORS policy

`pnpm deploy:cors`

**A Firebase Storage bucket ships with NO CORS configuration.** A download URL still works everywhere
an `<img src>` works, which is why this went unnoticed for months: the browser renders the picture
happily. It only bites the moment JavaScript needs to *read the pixels* — `crossOrigin="anonymous"`,
`fetch()`, or drawing into a `<canvas>`. Without the header the browser refuses the load outright and
the failure surfaces as `img.onerror`, which looks exactly like a broken URL.

That is what happened on 2026-08-18: the banner crop dialog sat on its spinner forever, and the
diagnosis was slowed down by a false negative — probing a **404** response returns
`access-control-allow-origin: *`, while the real object returns nothing at all. **Test CORS against a
URL that actually resolves.**

The policy is deliberately narrow: `GET`/`HEAD` only, and only from the panel, the marketing site and
local development. A bucket that answers `*` hands every image the studio has ever uploaded to any
page on the internet that wants to read it as data.

**Re-run this after creating a new bucket** — a new tenant, a new environment, a restored backup.
Nothing enforces it and nothing warns when it is missing.
