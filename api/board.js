// Proxies the live board from the Mac mini (which reads the Google Sheet with LocalHost's credentials).
// UPSTREAM_URL and ACCESS_KEY live in Vercel env vars, never in the repo.
export default async function handler(req, res) {
  const cookie = req.headers.cookie || "";
  if (!cookie.split(/;\s*/).includes(`sprint_k=${process.env.ACCESS_KEY}`)) return res.status(401).json({ error: "locked" });
  const fresh = req.query.fresh ? "&fresh=1" : "";
  try {
    const r = await fetch(`${process.env.UPSTREAM_URL}/api/board?k=${encodeURIComponent(process.env.ACCESS_KEY)}${fresh}`);
    res.setHeader("Cache-Control", "no-store");
    res.status(r.status).send(await r.text());
  } catch (e) {
    res.status(502).json({ error: "board server unreachable" });
  }
}
