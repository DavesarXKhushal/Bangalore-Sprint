// Proxies an inline edit (Priorities/Pipeline cells, and now Commitments.Due for calendar drag-and-drop)
// to the Mac mini, which writes the cell via gws. UPSTREAM_URL/ACCESS_KEY live in Vercel env vars.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  const cookie = req.headers.cookie || "";
  if (!cookie.split(/;\s*/).includes(`sprint_k=${process.env.ACCESS_KEY}`)) return res.status(401).json({ error: "locked" });
  try {
    const r = await fetch(`${process.env.UPSTREAM_URL}/api/edit?k=${encodeURIComponent(process.env.ACCESS_KEY)}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req.body || {})
    });
    res.setHeader("Cache-Control", "no-store");
    res.status(r.status).send(await r.text());
  } catch (e) {
    res.status(502).json({ error: "board server unreachable" });
  }
}
