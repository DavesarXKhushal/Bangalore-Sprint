// Access gate: first visit with ?k=KEY sets a cookie; everything else needs it.
export const config = { matcher: ["/", "/index.html", "/app.js", "/style.css"] };
const LOCKED = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Bangalore Sprint</title><style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;background:#fff;color:#1d1d1f;display:grid;place-items:center;min-height:100vh}p{max-width:30em;padding:24px;font-size:17px}</style></head><body><p>This is the LocalHost sprint portal. Open it from the link shared in Slack.</p></body></html>`;
export default function middleware(request) {
  const url = new URL(request.url);
  const key = process.env.ACCESS_KEY;
  const cookie = request.headers.get("cookie") || "";
  if (key && url.searchParams.get("k") === key) {
    url.searchParams.delete("k");
    return new Response(null, { status: 302, headers: { Location: url.toString(), "Set-Cookie": `sprint_k=${key}; Max-Age=31536000; Path=/; HttpOnly; Secure; SameSite=Lax` } });
  }
  if (key && cookie.split(/;\s*/).includes(`sprint_k=${key}`)) return;
  return new Response(LOCKED, { status: 401, headers: { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex" } });
}
