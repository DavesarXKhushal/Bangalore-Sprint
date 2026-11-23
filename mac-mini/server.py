#!/usr/bin/env python3
"""Bangalore Sprint portal: live mirror of the sprint board Google Sheet.

Reads the sheet through the gws-work wrapper (cached SYNC_SECONDS), scrapes the
public Instagram follower count (cached hourly), serves a single-page portal.
Access gated by a key: first visit with ?k=<key> sets a cookie.
"""
import http.server, json, os, re, secrets, subprocess, threading, time, urllib.request
import datetime
from http.cookies import SimpleCookie
from urllib.parse import urlparse, parse_qs

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORTAL_PORT", "8790"))
SHEET_ID = "1H0-XwkBFwa_hpklD-2n-V06Eg78CimuLTlr1fRn3zbM"
DRIVE_ID = "105jg1uZ451s_jn_g5mvSJZmFW72aut-5"
IG_USER = "hardeep_gambhir"
GWS = "/Users/hardeep/.hermes/bin/gws-work"
SYNC_SECONDS = 20
HIDDEN_METRICS = {"weeks of cash"}  # core team only, never on the shared portal
KEY_FILE = os.path.join(HERE, "access_key")

if not os.path.exists(KEY_FILE):
    with open(KEY_FILE, "w") as f:
        f.write(secrets.token_urlsafe(9))
    os.chmod(KEY_FILE, 0o600)
ACCESS_KEY = open(KEY_FILE).read().strip()

_lock = threading.Lock()
_cache = {"board": None, "board_at": 0, "error": None, "ig": None, "ig_at": 0, "cal": None, "cal_at": 0}


def fetch_sheet():
    params = {"spreadsheetId": SHEET_ID,
              "ranges": ["Scoreboard!A1:Z60", "Priorities!A1:Z60", "Standup!A1:Z200", "Pipeline!A1:Z40", "Commitments!A1:Z400"],
              "valueRenderOption": "FORMATTED_VALUE"}
    for attempt in range(3):  # Google connections on this network reset now and then; retry before giving up
        r = subprocess.run([GWS, "sheets", "spreadsheets", "values", "batchGet", "--params", json.dumps(params)],
                           capture_output=True, text=True, timeout=45)
        out = "\n".join(l for l in r.stdout.splitlines() if not l.startswith("Using keyring"))
        try:
            data = json.loads(out)
        except ValueError:
            data = {"error": out[:200]}
        if "valueRanges" in data:
            break
        time.sleep(1.5)
    if "valueRanges" not in data:
        raise RuntimeError(str(data.get("error", data))[:300])
    tabs = {}
    for vr in data["valueRanges"]:
        name = vr["range"].split("!")[0].strip("'")
        rows = vr.get("values", [])
        if not rows:
            tabs[name] = []
            continue
        head = [h.strip() for h in rows[0]]
        recs = []
        for row in rows[1:]:
            if not any(c.strip() for c in row):
                continue
            recs.append({head[i]: (row[i].strip() if i < len(row) else "") for i in range(len(head)) if head[i]})
        tabs[name] = recs
    tabs["Scoreboard"] = [m for m in tabs.get("Scoreboard", []) if m.get("Metric", "").strip().lower() not in HIDDEN_METRICS]
    return tabs


def parse_count(s):
    m = re.match(r"([\d.,]+)\s*([KkMm]?)", s)
    if not m:
        return None
    n = float(m.group(1).replace(",", ""))
    mult = {"k": 1e3, "m": 1e6}.get(m.group(2).lower(), 1)
    return int(n * mult)


def fetch_ig():
    """Exact follower count from the profile page's embedded JSON. Never a rounded figure."""
    req = urllib.request.Request(f"https://www.instagram.com/{IG_USER}/",
                                 headers={"User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"})
    html = urllib.request.urlopen(req, timeout=25).read().decode("utf-8", "ignore")
    for m in re.finditer(r'"follower_count":(\d+)', html):
        window = html[max(0, m.start() - 2000):m.end() + 2000]
        if f'"username":"{IG_USER}"' in window:
            return {"count": int(m.group(1)), "at": int(time.time())}
    raise RuntimeError("exact follower count not found")


TEAM = {"hardeep@localhosthq.com": "Hardeep", "khushal.davesar@localhosthq.com": "Khushal", "chandan.perla@localhosthq.com": "Chandan",
        "sanchay.thalnerkar@localhosthq.com": "Sanchay", "suhas@localhosthq.com": "Suhas", "andrew@smalldrew.com": "Andrew",
        "kei@localhosthq.com": "Kei", "kei.hayashi.2017@gmail.com": "Kei"}  # Zian removed from the portal by request (Nov 19 2026)
CAL_HIDE = re.compile(r"\b(sleep|finance|cash|equity|payroll|salary|personal|doctor|lawyer|visa)\b", re.I)
IST = 5.5 * 3600
RULES = [
    "Andrew's call is at 8 am. Everyone's awake and on it, no exceptions.",
    "Bunk beds are at the office if you want to crash there. Otherwise, just be in by 8.",
    "No meetings before 7 PM. Work until then.",
]
# Editable cells: sheet tab -> header name -> column letter, and the first data row number
EDITABLE = {
    "Priorities": {"first_row": 2, "cols": {"Right now": "B", "Today's one thing": "C", "Delaying on / blocked": "D",
                                             "Immediate?": "E", "Deadline today": "F"}},
    "Pipeline": {"first_row": 2, "cols": {"Title / idea": "C", "Stage": "D", "On it": "E", "Notes / blocker": "J"}},
    "Commitments": {"first_row": 2, "cols": {"Due": "D"}},  # calendar drag-and-drop moves a deadline's date
}


def fetch_calendar():
    """Today's (IST) team events from Hardeep's work calendar. Only sprint/team events, never private ones."""
    now = time.time()
    day0 = (now + IST) // 86400 * 86400 - IST
    fmt = lambda t: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))
    params = {"calendarId": "primary", "timeMin": fmt(day0), "timeMax": fmt(day0 + 86400), "singleEvents": True,
              "orderBy": "startTime", "maxResults": 100}
    r = subprocess.run([GWS, "calendar", "events", "list", "--params", json.dumps(params)], capture_output=True, text=True, timeout=45)
    data = json.loads("\n".join(l for l in r.stdout.splitlines() if not l.startswith("Using keyring")))
    if "items" not in data:
        raise RuntimeError(str(data.get("error", data))[:200])
    out = []
    for e in data["items"]:
        title = e.get("summary", "")
        emails = [a.get("email", "").lower() for a in e.get("attendees", []) if a.get("responseStatus") != "declined"]
        team = [TEAM[m] for m in emails if m in TEAM and m != "hardeep@localhosthq.com"]
        if CAL_HIDE.search(title) or e.get("visibility") == "private":
            continue
        if "[sprint]" not in title.lower() and not team:
            continue
        people = sorted(set(["Hardeep"] + team + [n for n in TEAM.values() if re.search(rf"\b{n}\b", title)]))
        st, en = e.get("start", {}), e.get("end", {})
        out.append({"title": re.sub(r"^\[Sprint\]\s*", "", title), "start": st.get("dateTime") or st.get("date"),
                    "end": en.get("dateTime") or en.get("date"), "allDay": "date" in st, "people": people})
    return out


def get_state(force=False):
    now = time.time()
    with _lock:
        if force or now - _cache["board_at"] > SYNC_SECONDS:
            try:
                _cache["board"] = fetch_sheet()
                _cache["error"] = None
            except Exception as e:  # keep serving last good copy
                _cache["error"] = f"sheet sync failed: {e}"
            _cache["board_at"] = now
        if now - _cache["ig_at"] > 900:
            try:
                _cache["ig"] = fetch_ig()
            except Exception:
                pass
            _cache["ig_at"] = now if _cache["ig"] else now - 780
        if now - _cache["cal_at"] > 300:
            try:
                _cache["cal"] = fetch_calendar()
            except Exception:
                pass
            _cache["cal_at"] = now
        return {"board": _cache["board"], "cal": _cache["cal"] or [], "synced_at": int(_cache["board_at"]), "error": _cache["error"],
                "ig": _cache["ig"], "ig_user": IG_USER, "rules": RULES,
                "sheet_url": f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit",
                "drive_url": f"https://drive.google.com/drive/folders/{DRIVE_ID}",
                "links": {"reels": "https://drive.google.com/drive/folders/1atNCRbYCT9sLBg4N30aduoRU_yLi2jDL",
                          "scripts": "https://drive.google.com/drive/folders/1m9kgSClekqRoAkkgEAafBkFOHB4469ma",
                          "docs": "https://drive.google.com/drive/folders/1r3zMh_kh6J703SpQzqKZIhRTjr06vvjN"}}


def edit_cell(sheet, row_idx, header):
    """Write one cell value via gws. row_idx is the 0-based position in the data rows (matches the API payload)."""
    spec = EDITABLE.get(sheet)
    if not spec or header not in spec["cols"]:
        raise ValueError("that field is not editable")
    col = spec["cols"][header]
    row = spec["first_row"] + row_idx
    return f"{sheet}!{col}{row}"


def add_task(due_iso, text, owner):
    """Append a new deadline as a row in Commitments. due_iso is YYYY-MM-DD; stored as a sheet-native date string."""
    text = (text or "").strip()
    if not text:
        raise ValueError("task text is required")
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", due_iso or ""):
        raise ValueError("bad date")
    y, m, d = (int(x) for x in due_iso.split("-"))
    due_label = datetime.date(y, m, d).strftime("%a %b ") + str(d)
    rows = _cache["board"]["Commitments"] if _cache["board"] else []
    next_n = max([int(r["#"]) for r in rows if r.get("#", "").isdigit()], default=0) + 1
    logged = time.strftime("%Y-%m-%d", time.gmtime(time.time() + IST))
    params = {"spreadsheetId": SHEET_ID, "range": "Commitments!A1", "valueInputOption": "USER_ENTERED",
              "insertDataOption": "INSERT_ROWS"}
    row = [str(next_n), (owner or "").strip() or "Unassigned", text, due_label, "", "Not started", "", logged, "Added from the calendar"]
    r = subprocess.run([GWS, "sheets", "spreadsheets", "values", "append", "--params", json.dumps(params),
                        "--json", json.dumps({"values": [row]})], capture_output=True, text=True, timeout=30)
    out = "\n".join(l for l in r.stdout.splitlines() if not l.startswith("Using keyring"))
    res = json.loads(out)
    if "error" in res:
        raise RuntimeError(str(res["error"])[:200])
    _cache["board_at"] = 0  # force the next read to pick up the new row


def delete_task(row_idx):
    """Blank out one Commitments row (calendar right-click delete). Clearing, not shifting rows, keeps every other row's index stable."""
    row = EDITABLE["Commitments"]["first_row"] + int(row_idx)
    params = {"spreadsheetId": SHEET_ID, "range": f"Commitments!A{row}:I{row}"}
    r = subprocess.run([GWS, "sheets", "spreadsheets", "values", "clear", "--params", json.dumps(params)],
                        capture_output=True, text=True, timeout=30)
    out = "\n".join(l for l in r.stdout.splitlines() if not l.startswith("Using keyring"))
    res = json.loads(out)
    if "error" in res:
        raise RuntimeError(str(res["error"])[:200])
    _cache["board_at"] = 0


class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *a):
        pass

    def authed(self, q):
        if q.get("k", [""])[0] == ACCESS_KEY:
            return "set"
        c = SimpleCookie(self.headers.get("Cookie", ""))
        if "sprint_k" in c and c["sprint_k"].value == ACCESS_KEY:
            return "ok"
        proxied = any(self.headers.get(h) for h in ("Cf-Connecting-Ip", "X-Forwarded-For", "Tailscale-Funnel-Request", "Tailscale-User-Login"))
        if self.client_address[0] in ("127.0.0.1", "::1") and not proxied:
            return "ok"  # direct local access on the Mac mini
        return None

    def send(self, code, body, ctype, extra=None):
        b = body if isinstance(body, bytes) else body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Robots-Tag", "noindex")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path == "/health":
            return self.send(200, "ok", "text/plain")
        a = self.authed(q)
        if not a:
            return self.send(401, open(os.path.join(HERE, "locked.html")).read(), "text/html; charset=utf-8")
        extra = {}
        if a == "set":
            extra["Set-Cookie"] = f"sprint_k={ACCESS_KEY}; Max-Age=31536000; Path=/; HttpOnly; Secure; SameSite=Lax"
        if u.path == "/api/board":
            st = get_state(force="fresh" in q)
            return self.send(200, json.dumps(st), "application/json", extra)
        if u.path in ("/", "/index.html"):
            return self.send(200, open(os.path.join(HERE, "index.html"), "rb").read(), "text/html; charset=utf-8", extra)
        if u.path == "/app.js":
            return self.send(200, open(os.path.join(HERE, "app.js"), "rb").read(), "text/javascript", extra)
        if u.path == "/style.css":
            return self.send(200, open(os.path.join(HERE, "style.css"), "rb").read(), "text/css", extra)
        self.send(404, "not found", "text/plain")

    def do_POST(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        a = self.authed(q)
        if not a:
            return self.send(401, json.dumps({"error": "locked"}), "application/json")
        if u.path == "/api/add-task":
            try:
                length = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(length) or b"{}")
                add_task(body.get("due"), body.get("text"), body.get("owner"))
                return self.send(200, json.dumps({"ok": True}), "application/json")
            except Exception as e:
                return self.send(400, json.dumps({"error": str(e)[:200]}), "application/json")
        if u.path == "/api/delete-task":
            try:
                length = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(length) or b"{}")
                delete_task(body.get("row"))
                return self.send(200, json.dumps({"ok": True}), "application/json")
            except Exception as e:
                return self.send(400, json.dumps({"error": str(e)[:200]}), "application/json")
        if u.path != "/api/edit":
            return self.send(404, json.dumps({"error": "not found"}), "application/json")
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
            cell = edit_cell(body["sheet"], int(body["row"]), body["header"])
            params = {"spreadsheetId": SHEET_ID, "range": cell, "valueInputOption": "USER_ENTERED"}
            r = subprocess.run([GWS, "sheets", "spreadsheets", "values", "update", "--params", json.dumps(params),
                                "--json", json.dumps({"values": [[str(body.get("value", ""))]]})],
                               capture_output=True, text=True, timeout=30)
            out = "\n".join(l for l in r.stdout.splitlines() if not l.startswith("Using keyring"))
            res = json.loads(out)
            if "error" in res:
                return self.send(502, json.dumps({"error": str(res["error"])[:200]}), "application/json")
            _cache["board_at"] = 0  # force the next read to pick up the edit
            return self.send(200, json.dumps({"ok": True}), "application/json")
        except Exception as e:
            return self.send(400, json.dumps({"error": str(e)[:200]}), "application/json")


if __name__ == "__main__":
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), H)
    print(f"sprint portal on http://127.0.0.1:{PORT}", flush=True)
    srv.serve_forever()
