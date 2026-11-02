#!/usr/bin/env python3
"""Sets up and manages the promo code service (Cloudflare Worker + D1 database). No Node or wrangler needed.

  ./promo-service.py set-token          type a Cloudflare API token at a hidden prompt (saved 600, never shown)
  ./promo-service.py deploy             create the database if needed, apply schema.sql, upload worker.js,
                                        turn on its workers.dev address, and print that address
  ./promo-service.py import FILE.csv [--platform ios|android]
                                        add codes: one per line, "code[,redeem URL[,claimed time]]";
                                        codes already in the database are skipped; default platform ios;
                                        Android codes without a URL get https://play.google.com/redeem?code=<code>
  ./promo-service.py status             total, claimed, remaining
  ./promo-service.py export             all codes as CSV (code,url,added_at,claimed_at) on stdout

Token permissions needed: Account > Workers Scripts > Edit, Account > D1 > Edit,
Account > Account Settings > Read (to find the account), and Account > Workers Subdomain... see README.md.
"""
import csv, getpass, json, os, sys, urllib.error, urllib.parse, urllib.request, uuid

HERE = os.path.dirname(os.path.abspath(__file__))
TOKEN_FILE = os.path.expanduser("~/.config/macserver/cloudflare.token")
API = "https://api.cloudflare.com/client/v4"
DB_NAME = "walkup-promo"
SCRIPT = "walkupsongspromo"


def token():
    try:
        return open(TOKEN_FILE).read().strip()
    except FileNotFoundError:
        sys.exit("No Cloudflare token yet. Run: ./promo-service.py set-token")


def call(method, path, body=None, raw=None, ctype="application/json"):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(API + path, data=data, method=method,
                                 headers={"Authorization": "Bearer " + token(), "Content-Type": ctype})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            out = json.load(r)
    except urllib.error.HTTPError as e:
        out = json.loads(e.read() or b"{}")
    if not out.get("success"):
        errs = "; ".join(f"{x.get('code')}: {x.get('message')}" for x in out.get("errors", []))
        sys.exit(f"Cloudflare refused {method} {path}: {errs or out}")
    return out["result"]


def account():
    accts = call("GET", "/accounts")
    if not accts:
        sys.exit("The token can't see any account (needs Account Settings: Read).")
    return accts[0]["id"]


def database(acct, create=False):
    for db in call("GET", f"/accounts/{acct}/d1/database?name={DB_NAME}"):
        if db["name"] == DB_NAME:
            return db["uuid"]
    if not create:
        sys.exit("No database yet. Run: ./promo-service.py deploy")
    return call("POST", f"/accounts/{acct}/d1/database", {"name": DB_NAME})["uuid"]


def query(acct, db, sql, params=None):
    body = {"sql": sql}
    if params is not None:
        body["params"] = params
    return call("POST", f"/accounts/{acct}/d1/database/{db}/query", body)


def deploy():
    acct = account()
    db = database(acct, create=True)
    query(acct, db, open(os.path.join(HERE, "schema.sql")).read())
    cols = [c["name"] for c in query(acct, db, "PRAGMA table_info(codes)")[0]["results"]]
    if "platform" not in cols:  # databases made before codes had a platform: every code so far is iOS
        query(acct, db, "ALTER TABLE codes ADD COLUMN platform TEXT NOT NULL DEFAULT 'ios'")
    boundary = uuid.uuid4().hex
    meta = {"main_module": "worker.js", "compatibility_date": "2026-10-01",
            "bindings": [{"type": "d1", "name": "DB", "id": db}]}
    parts = [("metadata", "application/json", json.dumps(meta).encode(), None),
             ("worker.js", "application/javascript+module",
              open(os.path.join(HERE, "worker.js"), "rb").read(), "worker.js")]
    body = b""
    for name, ctype, content, fname in parts:
        disp = f'form-data; name="{name}"' + (f'; filename="{fname}"' if fname else "")
        body += (f"--{boundary}\r\nContent-Disposition: {disp}\r\nContent-Type: {ctype}\r\n\r\n").encode()
        body += content + b"\r\n"
    body += f"--{boundary}--\r\n".encode()
    call("PUT", f"/accounts/{acct}/workers/scripts/{SCRIPT}", raw=body,
         ctype=f"multipart/form-data; boundary={boundary}")
    call("POST", f"/accounts/{acct}/workers/scripts/{SCRIPT}/subdomain", {"enabled": True})
    sub = call("GET", f"/accounts/{acct}/workers/subdomain").get("subdomain")
    if not sub:
        sys.exit("Uploaded, but this account has no workers.dev subdomain yet: open Workers & Pages in the "
                 "Cloudflare dashboard once to choose one, then run deploy again.")
    print(f"Deployed: https://{SCRIPT}.{sub}.workers.dev  (database {DB_NAME})")


def import_codes(path, platform="ios"):
    if platform not in ("ios", "android"):
        sys.exit("--platform must be ios or android")
    rows = []
    for r in csv.reader(open(path, newline="")):
        if not r or not r[0].strip() or r[0].strip().lower() == "code":
            continue
        code = r[0].strip()
        url = r[1].strip() if len(r) > 1 else ""
        if not url and platform == "android":
            url = "https://play.google.com/redeem?code=" + urllib.parse.quote(code)
        claimed = (r[2].strip() or None) if len(r) > 2 else None
        rows.append((code, url, claimed))
    acct = account(); db = database(acct)
    before = query(acct, db, "SELECT COUNT(*) AS n FROM codes")[0]["results"][0]["n"]
    for i in range(0, len(rows), 30):  # D1 allows at most 100 bound values per statement
        chunk = rows[i:i + 30]
        sql = "INSERT OR IGNORE INTO codes (code, url, claimed_at, platform) VALUES " + ",".join(["(?,?,?,?)"] * len(chunk))
        query(acct, db, sql, [v for row in chunk for v in (*row, platform)])
    after = query(acct, db, "SELECT COUNT(*) AS n FROM codes")[0]["results"][0]["n"]
    print(f"Read {len(rows)} codes; added {after - before}, skipped {len(rows) - (after - before)} already there.")
    status()


def status():
    acct = account(); db = database(acct)
    rows = query(acct, db, "SELECT platform, COUNT(*) AS total, COUNT(claimed_at) AS claimed "
                           "FROM codes GROUP BY platform ORDER BY platform")[0]["results"]
    if not rows:
        print("no codes")
    for r in rows:
        print(f"{r['platform']}: total {r['total']}, claimed {r['claimed']}, remaining {r['total'] - r['claimed']}")


def export():
    acct = account(); db = database(acct)
    w = csv.writer(sys.stdout)
    w.writerow(["code", "url", "added_at", "claimed_at"])
    for r in query(acct, db, "SELECT code, url, added_at, claimed_at FROM codes ORDER BY rowid")[0]["results"]:
        w.writerow([r["code"], r["url"], r["added_at"], r["claimed_at"] or ""])


def set_token():
    t = getpass.getpass("Cloudflare API token (input hidden): ").strip()
    if not t:
        sys.exit("Nothing typed; no change.")
    os.makedirs(os.path.dirname(TOKEN_FILE), exist_ok=True)
    fd = os.open(TOKEN_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.write(fd, (t + "\n").encode()); os.close(fd)
    print("Saved. Checking it...")
    print("Token works; account found." if account() else "")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "set-token": set_token()
    elif cmd == "deploy": deploy()
    elif cmd == "import" and len(sys.argv) > 2: import_codes(sys.argv[2], sys.argv[sys.argv.index("--platform") + 1] if "--platform" in sys.argv else "ios")
    elif cmd == "status": status()
    elif cmd == "export": export()
    else: sys.exit(__doc__)
