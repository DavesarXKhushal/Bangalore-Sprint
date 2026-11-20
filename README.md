# Bangalore Sprint portal

Apple-style live view of the Bangalore Sprint Board (Google Sheet). The Mac mini reads the sheet, Instagram followers and the team calendar; this Vercel app serves the page and proxies `/api/board` to it.

Vercel env vars: `ACCESS_KEY` (shared link key), `UPSTREAM_URL` (the Mac mini Tailscale Funnel URL). Share `https://<deployment>/?k=ACCESS_KEY`.

## Vercel settings
Framework preset: Other. Root Directory: `./`. Leave Build Command, Output Directory and Install Command empty (no overrides).

## What changed Nov 19
- Pipeline sheet restructured: dropped the repeated per-row owner columns, added `Notes / blocker`, froze header + first 4 columns.
- New `Priorities` tab in the sheet: who's on what right now, today's one thing, what they're delaying on, whether it's immediate, deadline.
- Portal: new `Right now` section mirrors Priorities with live inline editing (writes back to the sheet via `/api/edit` on the Mac mini). Restyled off the apple.com clone: paper background, amber accent, Bricolage Grotesque display type.
- Zian removed from the portal and from Owners.
- `mac-mini/server.py` is the reference copy of what actually runs on the Mac mini (not deployed by Vercel); it is the source of truth, copy it back there after editing.
