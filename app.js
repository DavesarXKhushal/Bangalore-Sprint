// Bangalore Sprint portal. Reads /api/board (live sheet mirror) every 30s.
const START = Date.UTC(2026, 10, 17, -5, -30); // Nov 17 2026 00:00 IST
const END = Date.UTC(2027, 0, 17, -5, -30);
const DAY = 864e5;
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
let ownerFilter = "All";
let last = null;

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const link = (u, label) => /^https?:\/\//i.test(u || "") ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(label)}</a>` : "";
const num = s => { const n = parseFloat(String(s ?? "").replace(/[$,₹\s]/g, "")); return isNaN(n) ? null : n; };
const fmt = n => n == null ? "" : n.toLocaleString("en-US");

// "Dec 16", "Thu Nov 19", "Tue Nov 17, 10:30 PM IST", "2027-01-17" -> ms (IST). Nov/Dec = 2026, Jan+ = 2027.
function parseDate(s, endOfDay = true) {
  if (!s) return null;
  let m = String(s).match(/(\d{4})-(\d{2})-(\d{2})/);
  let y, mo, d;
  if (m) { y = +m[1]; mo = +m[2] - 1; d = +m[3]; }
  else {
    m = String(s).match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?/);
    if (!m || !(m[1].toLowerCase() in MONTHS)) return null;
    mo = MONTHS[m[1].toLowerCase()]; d = +m[2]; y = m[3] ? +m[3] : (mo >= 10 ? 2026 : 2027);
  }
  let hh = endOfDay ? 23 : 0, mm = endOfDay ? 59 : 0;
  const t = String(s).match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (t) { hh = (+t[1] % 12) + (t[3].toUpperCase() === "PM" ? 12 : 0); mm = +t[2]; }
  return Date.UTC(y, mo, d, hh - 5, mm - 30);
}
const istDay = ms => Math.floor((ms + 5.5 * 36e5) / DAY);
const relDay = ms => { const d = istDay(ms) - istDay(Date.now()); return d === 0 ? "today" : d === 1 ? "tomorrow" : d === -1 ? "yesterday" : d < 0 ? `${-d} days ago` : `in ${d} days`; };

function stageClass(s) {
  s = (s || "").toLowerCase();
  if (s.startsWith("posted")) return "s-posted";
  if (s.startsWith("finished")) return "s-banked";
  if (s.startsWith("edit")) return "s-edit";
  if (s.startsWith("build")) return "s-build";
  if (s.startsWith("script")) return "s-script";
  return "s-idea";
}
const STAGE_ORDER = ["Idea", "Script", "Build / Shoot", "Edit", "Finished (banked)", "Posted"];
const stageIdx = s => Math.max(0, STAGE_ORDER.findIndex(x => x.toLowerCase() === (s || "").toLowerCase()));

function renderScore(st) {
  const rows = st.board.Scoreboard || [];
  const now = Date.now();
  let html = "", flags = "";
  for (const r of rows) {
    const name = r["Metric"];
    const target = num(r["Checkpoint target"]);
    let cur = num(r["Current"]);
    const upd = parseDate(r["Updated"]);
    const stale = upd && istDay(now) - istDay(upd) > 1;
    let src = r["Updated"] ? `Updated ${esc(r["Updated"])}${stale ? ". Needs a fresh number." : ""}` : "";
    if (/follower/i.test(name) && st.ig) {
      cur = st.ig.count;
      src = `Live from Instagram, ${new Date(st.ig.at * 1000).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" })} IST`;
    }
    if (!src && r["Notes"]) src = esc(r["Notes"]);
    if (/video/i.test(name) && !r["Updated"]) src = "Counted from posted slots in the pipeline";
    if (target == null) {
      const v = r["Current"] || "Not set";
      const val = /^no\b/i.test(v) ? "No" : v;
      const note = /bank/i.test(name) ? "Never post a video unless the next one is finished." : (r["Notes"] || "");
      flags += `<div class="tile status"><div class="label">${esc(name.replace(/\?$/, ""))}</div><div class="val">${esc(val)}</div>`
        + `<div class="note">${esc([r["Checkpoint target"] && r["Checkpoint date"] && /film/i.test(name) ? `Posts ${r["Checkpoint date"]}` : "", note].filter(Boolean).join(". "))}</div></div>`;
      continue;
    }
    const cpDate = parseDate(r["Checkpoint date"]);
    const money = /\$/.test(name);
    const show = v => v == null ? "" : (money ? "$" : "") + fmt(v);
    const fill = cur != null && target ? Math.min(1, cur / target) : 0;
    let fact = "Nothing entered in the board yet.";
    if (cur != null) {
      const daysLeft = cpDate ? istDay(cpDate) - istDay(now) : null;
      const togo = Math.max(0, target - cur);
      fact = togo ? `${show(togo)} to go${daysLeft != null ? `, ${daysLeft} days left` : ""}.` : "Target reached.";
    }
    const label = name.replace(/^Followers \(Hardeep IG\)$/i, "Instagram followers").replace(/^\$ closed$/i, "Closed deals").replace(/^Tempura /i, "Tempura ");
    html += `<div class="tile"><div class="label">${esc(label)}</div>`
      + (cur == null ? `<div class="num empty">None</div>` : `<div class="num">${show(cur)}</div>`)
      + `<div class="of">Goal ${show(target)} by ${esc(r["Checkpoint date"])}${r["Final target"] ? `<br>Then ${show(num(r["Final target"]))} by ${esc(r["Final date"])}` : ""}</div>`
      + `<div class="bar" role="img" aria-label="${Math.floor(fill * 1000) / 10} percent of the target"><i style="transform:scaleX(${fill})"></i></div>`
      + `<div class="fact">${fact}</div>` + `<div class="src">${src || "&nbsp;"}</div></div>`;
  }
  const pipe = st.board.Pipeline || [];
  const nxt = pipe.find(p => !/^posted/i.test(p.Stage || "") && (parseDate(p["Planned post"]) || 0) >= now);
  if (nxt) {
    const t = parseDate(nxt["Planned post"]);
    flags += `<div class="tile status"><div class="label">Next post</div><div class="val">${esc(nxt["Planned post"].replace(/,?\s*10:30 PM IST/, ""))}</div>`
      + `<div class="note">Slot ${esc(nxt.Slot)}, 10:30 PM IST, ${relDay(t)}. ${nxt["Title / idea"] ? esc(nxt["Title / idea"]) + ". " : "No idea written yet. "}Stage: ${esc(nxt.Stage || "Idea")}.</div></div>`;
  }
  const coms = st.board.Commitments || [];
  const done = coms.filter(c => /^done/i.test(c.Status || "")).length;
  const over = coms.filter(c => { const d = parseDate(c.Due); return d && istDay(d) < istDay(now) && !/done|renegotiated/i.test(c.Status || ""); }).length;
  flags += `<div class="tile status"><div class="label">Commitments done</div><div class="val">${done} of ${coms.length}</div>`
    + `<div class="note">${over ? `${over} overdue.` : "None overdue."} ${coms.filter(c => /progress/i.test(c.Status || "")).length} in progress.</div></div>`;
  document.getElementById("score").innerHTML = html;
  document.getElementById("flags").innerHTML = flags;
}

const metricName = m => m.replace(/^\$ closed$/i, "Closed deals").replace(/^Followers \(Hardeep IG\)$/i, "Instagram followers");
function computeGaps(st) {
  const g = [], now = Date.now(), today = istDay(now);
  const b = st.board;
  for (const c of b.Commitments || []) {
    const s = (c["Status"] || "").toLowerCase();
    const due = parseDate(c["Due"]);
    if (s === "done" && !c["Proof link"]) g.push({ sev: 1, who: c.Owner, what: `<strong>#${esc(c["#"])} is marked done with no proof link.</strong> ${esc(c.Commitment)}.` });
    if (["done", "renegotiated"].includes(s) || !due) continue;
    const d = istDay(due) - today;
    if (s === "missed" || d < 0) g.push({ sev: 3, who: c.Owner, what: `<strong>Overdue since ${esc(c.Due)}.</strong> ${esc(c.Commitment)}. Ship it or set a new date.` });
    else if (d === 0) g.push({ sev: 2, who: c.Owner, what: `<strong>Due today.</strong> ${esc(c.Commitment)}. Done looks like: ${esc(c["Done looks like"])}.` });
    else if (d === 1) g.push({ sev: 1, who: c.Owner, what: `<strong>Due tomorrow.</strong> ${esc(c.Commitment)}.` });
  }
  const pipe = b.Pipeline || [];
  const open = pipe.filter(p => !/^posted/i.test(p.Stage || ""));
  const nextTwo = new Set(open.filter(p => (parseDate(p["Planned post"]) || 0) >= now).slice(0, 2));
  for (const p of pipe) {
    const t = parseDate(p["Planned post"]); if (!t) continue;
    const posted = /^posted/i.test(p.Stage || ""), idx = stageIdx(p.Stage), stage = (p.Stage || "Idea").toLowerCase();
    const date = esc((p["Planned post"] || "").replace(/,?\s*10:30 PM IST/, ""));
    const noIdea = !p["Title / idea"] ? " No idea written yet." : "";
    if (!posted && t < now) { g.push({ sev: 3, who: "Chandan", what: `<strong>Slot ${esc(p.Slot)} missed its ${date} post.</strong> Still at ${stage}.${noIdea} Ship it or move the date.` }); continue; }
    if (!posted && t - now < 48 * 36e5 && idx < 4) { g.push({ sev: 3, who: p["Script (Andrew)"] || "Andrew", what: `<strong>Slot ${esc(p.Slot)} posts ${relDay(t)}, ${date}.</strong> Still at ${stage}.${noIdea}` }); continue; }
    if (nextTwo.has(p) && noIdea) g.push({ sev: 2, who: p["Script (Andrew)"] || "Andrew", what: `<strong>Slot ${esc(p.Slot)} has no idea yet.</strong> Posts ${date}.` });
    if (idx >= 2 && !p["Script link"]) g.push({ sev: 2, who: p["Script (Andrew)"] || "Andrew", what: `<strong>Slot ${esc(p.Slot)} has no script link.</strong> It is at ${stage}.` });
    if (idx >= 3 && !p["Edit folder"]) g.push({ sev: 2, who: "Chandan", what: `<strong>Slot ${esc(p.Slot)} has no edit folder.</strong>` });
    if (posted && !p["Post link"]) g.push({ sev: 2, who: "Khushal", what: `<strong>Slot ${esc(p.Slot)} is posted with no post link.</strong>` });
    if (posted && now - t > 48 * 36e5 && !p["Repeat next time"]) g.push({ sev: 1, who: "Hardeep", what: `<strong>Post-mortem due for slot ${esc(p.Slot)}.</strong> Hold, watch time, shares, saves, follows, and what to repeat or drop.` });
  }
  const bank = (b.Scoreboard || []).find(r => /bank/i.test(r.Metric));
  if (bank && /^no/i.test(bank.Current || "")) g.push({ sev: 3, who: "Chandan", what: `<strong>No video in the bank.</strong> Nothing posts until the next one is finished.` });
  const stale = [], blank = [];
  for (const r of b.Scoreboard || []) {
    if (num(r["Checkpoint target"]) == null || /video|follower/i.test(r.Metric)) continue;
    const u = parseDate(r.Updated);
    if (!r.Current) blank.push(metricName(r.Metric));
    else if (!u || today - istDay(u) > 1) stale.push(`${metricName(r.Metric).toLowerCase()} (${esc(r.Updated || "never")})`);
  }
  if (blank.length) g.push({ sev: 1, who: "Khushal", what: `<strong>Not entered on the board:</strong> ${blank.join(", ").toLowerCase()}.` });
  if (stale.length) g.push({ sev: 1, who: "Khushal", what: `<strong>Old numbers on the scoreboard:</strong> ${stale.join(", ")}.` });
  return g.sort((a, b) => b.sev - a.sev);
}

const PEOPLE = ["Hardeep", "Khushal", "Chandan", "Sanchay", "Suhas", "Andrew", "Kei"];
const istTime = iso => new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });
function renderGaps(st) {
  const g = computeGaps(st), cal = st.cal || [], now = Date.now();
  const names = [...new Set([...PEOPLE, ...g.map(x => x.who), ...cal.flatMap(e => e.people)])]
    .filter(n => g.some(x => x.who === n) || cal.some(e => e.people.includes(n)));
  const cards = names.map(n => {
    const items = g.filter(x => x.who === n);
    const evs = cal.filter(e => e.people.includes(n));
    const evHtml = evs.map(e => {
      const past = !e.allDay && new Date(e.end).getTime() < now;
      const carried = !e.allDay && istDay(new Date(e.start).getTime()) < istDay(now);
      return `<li class="ev ${past ? "past" : ""}"><span class="t">${e.allDay ? "All day" : carried ? "Until " + istTime(e.end) : istTime(e.start)}</span><span>${esc(e.title)}</span></li>`;
    }).join("");
    return `<div class="person"><div class="pname">${esc(n)}</div>`
      + `<div class="pcount">${items.length ? `${items.length} to act on` : "Nothing flagged"}${evs.length ? `. ${evs.length} on the calendar` : ""}</div>`
      + (items.length ? `<ul class="acts">${items.map(x => `<li>${x.what}</li>`).join("")}</ul>` : "")
      + (evs.length ? `<div class="calhead">Calendar today, IST</div><ul class="cal">${evHtml}</ul>` : "")
      + `</div>`;
  });
  document.getElementById("gaps").innerHTML = cards.join("") || `<div class="person"><div class="pname">All clear.</div><div class="pcount">Nothing overdue, nothing missing.</div></div>`;
}

// --- inline editing: contenteditable spans that PATCH the sheet via /api/edit ---
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._h); toast._h = setTimeout(() => t.classList.remove("show"), 2200);
}
async function saveCell(el) {
  const { sheet, row, header } = el.dataset;
  const value = el.textContent.trim();
  el.classList.add("saving");
  try {
    const r = await fetch("/api/edit", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sheet, row: +row, header, value }) });
    const d = await r.json();
    if (!r.ok || d.error) throw new Error(d.error || "save failed");
    toast("Saved to the sheet.");
  } catch (e) {
    toast("Could not save: " + e.message);
  } finally {
    el.classList.remove("saving");
  }
}
function editable(sheet, row, header, value, placeholder, extraClass) {
  const v = esc(value || "");
  return `<div class="editable ${extraClass || ""}" contenteditable="true" spellcheck="false" data-empty="${!value}"
    data-sheet="${sheet}" data-row="${row}" data-header="${esc(header)}" data-placeholder="${esc(placeholder || "")}">${v}</div>`;
}
function wireEditables(root) {
  root.querySelectorAll(".editable").forEach(el => {
    el.addEventListener("focus", () => { el.dataset.before = el.textContent; });
    el.addEventListener("blur", () => {
      el.dataset.empty = !el.textContent.trim();
      if (el.textContent.trim() !== (el.dataset.before || "").trim()) saveCell(el);
    });
    el.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); el.blur(); } });
  });
}

function renderRules(st) {
  document.getElementById("rulesrow").innerHTML = (st.rules || [])
    .map((r, i) => `<span class="rule-item"><b>${i + 1}.</b> ${esc(r)}</span>`).join("");
}

function renderPriorities(st) {
  const rows = st.board.Priorities || [];
  const html = rows.map((p, i) => {
    const imm = /yes/i.test(p["Immediate?"] || "");
    return `<div class="pcard">
      <div class="pname">${esc(p.Person)}</div>
      <span class="pbadge ${imm ? "now" : "later"}">${imm ? "Immediate" : "On track"}</span>
      <div class="prow"><div class="plabel">Right now</div>${editable("Priorities", i, "Right now", p["Right now"], "What are they doing right now")}</div>
      <div class="prow"><div class="plabel">Today's one thing</div>${editable("Priorities", i, "Today's one thing", p["Today's one thing"], "The one thing that has to ship today")}</div>
      <div class="prow"><div class="plabel">Delaying on</div>${editable("Priorities", i, "Delaying on / blocked", p["Delaying on / blocked"], "Nothing right now")}</div>
      <div class="prow"><div class="plabel">Deadline today</div>${editable("Priorities", i, "Deadline today", p["Deadline today"], "No deadline set")}</div>
    </div>`;
  }).join("");
  const grid = document.getElementById("priorities-grid");
  grid.innerHTML = html || `<p class="lede">Nothing in the Priorities tab yet.</p>`;
  wireEditables(grid);
}

function renderPipe(st) {
  const pipe = st.board.Pipeline || [], now = Date.now();
  const nextSlot = pipe.find(p => !/^posted/i.test(p.Stage || "") && (parseDate(p["Planned post"]) || 0) >= now);
  const counts = {};
  pipe.forEach(p => counts[p.Stage || "Idea"] = (counts[p.Stage || "Idea"] || 0) + 1);
  const posted = counts["Posted"] || 0;
  document.getElementById("stagecount").textContent = `${pipe.length} slots. ${posted} posted. ` + STAGE_ORDER.filter(s => counts[s] && s !== "Posted").map(s => `${counts[s]} at ${s.toLowerCase()}`).join(", ") + ".";
  const head = ["Slot", "Posts", "Idea", "Stage", "Team", "Script", "Edit folder", "Post", "Notes / blocker", "3s hold", "Avg watch", "Shares", "Saves", "Follows", "Repeat", "Drop"];
  let h = `<thead><tr>${head.map(x => `<th scope="col">${x}</th>`).join("")}</tr></thead><tbody>`;
  for (const [i, p] of pipe.entries()) {
    const t = parseDate(p["Planned post"]), idx = stageIdx(p.Stage);
    const missed = t && t < now && idx < 5;
    const cell = (u, label, need) => u ? `<td>${link(u, label).replace("<a ", '<a class="go" ')}</td>` : `<td class="${need ? "need" : "dim"}">${need ? "Missing" : "None"}</td>`;
    h += `<tr class="${p === nextSlot ? "next" : ""}">`
      + `<td class="num">${esc(p.Slot)}</td><td class="num">${esc((p["Planned post"] || "").replace(/,?\s*10:30 PM IST/, ""))}${p === nextSlot ? '<span class="sub">Next up</span>' : missed ? '<span class="sub">Missed</span>' : ""}</td>`
      + `<td>${editable("Pipeline", i, "Title / idea", p["Title / idea"], "No idea yet")}</td>`
      + `<td>${editable("Pipeline", i, "Stage", p.Stage || "Idea", "Idea")}</td>`
      + `<td>Hardeep, Andrew, Sanchay</td>`
      + cell(p["Script link"], "Script", idx >= 2) + cell(p["Edit folder"], "Folder", idx >= 3) + cell(p["Post link"], "Post", idx >= 5)
      + `<td class="notes">${editable("Pipeline", i, "Notes / blocker", p["Notes / blocker"], "No blocker")}</td>`
      + ["3 sec hold %", "Avg watch (s)", "Shares", "Saves", "Follows"].map(k => `<td class="num">${esc(p[k])}</td>`).join("")
      + `<td>${esc(p["Repeat next time"])}</td><td>${esc(p["Drop next time"])}</td></tr>`;
  }
  document.getElementById("pipe").innerHTML = h + "</tbody>";
  wireEditables(document.getElementById("pipe"));
}

function renderCom(st) {
  const coms = (st.board.Commitments || []).slice().sort((a, b) => (parseDate(a.Due) || 9e15) - (parseDate(b.Due) || 9e15));
  const owners = ["All", ...new Set(coms.map(c => c.Owner).filter(Boolean))];
  document.getElementById("ownerfilter").innerHTML = owners.map(o => `<button type="button" aria-pressed="${o === ownerFilter}" data-o="${esc(o)}">${esc(o)}</button>`).join("");
  document.querySelectorAll("#ownerfilter button").forEach(b => b.onclick = () => { ownerFilter = b.dataset.o; renderCom(last); });
  const today = istDay(Date.now());
  let h = `<thead><tr>${["#", "Owner", "Commitment", "Due", "Done looks like", "Status", "Proof"].map(x => `<th scope="col">${x}</th>`).join("")}</tr></thead><tbody>`;
  for (const c of coms.filter(c => ownerFilter === "All" || c.Owner === ownerFilter)) {
    const s = c.Status || "Not started", due = parseDate(c.Due);
    const overdue = due && istDay(due) < today && !/done|renegotiated/i.test(s);
    h += `<tr><td class="num">${esc(c["#"])}</td><td><strong>${esc(c.Owner)}</strong></td><td>${esc(c.Commitment)}</td>`
      + `<td class="num">${esc(c.Due)}${due ? `<span class="sub">${relDay(due)}</span>` : ""}</td><td>${esc(c["Done looks like"])}</td>`
      + `<td class="${overdue || /done/i.test(s) ? "st" : ""}">${esc(s)}${overdue ? ". Overdue" : ""}</td><td>${link(c["Proof link"], "Proof").replace("<a ", '<a class="go" ') || '<span class="dim">None</span>'}</td></tr>`;
  }
  document.getElementById("com").innerHTML = h + "</tbody>";
}

function renderOwn(st) {
  const rows = st.board.Owners || [];
  let h = `<thead><tr>${["Area", "Owner", "Backup", "Recurring output"].map(x => `<th scope="col">${x}</th>`).join("")}</tr></thead><tbody>`;
  for (const r of rows) h += `<tr><td>${esc(r.Area)}</td><td><strong>${esc(r.Owner)}</strong></td><td>${esc(r.Backup)}</td><td>${esc(r["Recurring output"])}</td></tr>`;
  document.getElementById("own").innerHTML = h + "</tbody>";
}

async function load(fresh) {
  if (document.activeElement && document.activeElement.classList.contains("editable")) return; // don't clobber an in-progress edit
  try {
    const r = await fetch("/api/board" + (fresh ? "?fresh=1" : ""), { cache: "no-store" });
    const st = await r.json();
    if (!st.board) throw new Error(st.error || "no data yet");
    last = st;
    ["h-board", "l-board", "f-board", "g-board"].forEach(id => document.getElementById(id).href = st.sheet_url);
    ["h-drive", "g-drive"].forEach(id => document.getElementById(id).href = st.drive_url);
    const L = st.links || {};
    [["g-reels", L.reels], ["g-scripts", L.scripts], ["g-docs", L.docs]].forEach(([id, u]) => { if (u) document.getElementById(id).href = u; });
    const day = Math.min(61, Math.max(1, istDay(Date.now()) - istDay(START) + 1));
    const left = Math.max(0, istDay(END) - istDay(Date.now()));
    document.getElementById("dayline").textContent = `Day ${day}. Ends Jan 17, 2027.`;
    renderScore(st); renderRules(st); renderGaps(st); renderPriorities(st); renderPipe(st); renderCom(st); renderOwn(st);
    document.getElementById("sync").textContent = (st.error ? "The sheet did not answer, so this is the last good copy. " : "")
      + `Synced from the board ${new Date(st.synced_at * 1000).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", hour: "numeric", minute: "2-digit" })} IST.`;
  } catch (e) {
    document.getElementById("sync").textContent = "Could not reach the board: " + e.message;
  }
}
load(true);
setInterval(() => load(false), 30000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) load(false); });
