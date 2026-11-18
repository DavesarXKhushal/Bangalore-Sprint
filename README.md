# Bangalore Sprint portal

Apple-style live view of the Bangalore Sprint Board (Google Sheet). The Mac mini reads the sheet, Instagram followers and the team calendar; this Vercel app serves the page and proxies `/api/board` to it.

Vercel env vars: `ACCESS_KEY` (shared link key), `UPSTREAM_URL` (the Mac mini Tailscale Funnel URL). Share `https://<deployment>/?k=ACCESS_KEY`.

## Vercel settings
Framework preset: Other. Root Directory: `./`. Leave Build Command, Output Directory and Install Command empty (no overrides).
