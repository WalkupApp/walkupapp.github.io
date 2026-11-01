# Promo code service

Hands out App Store codes for https://walkupsongs.app/promo/. It replaces the Google Sheet and Apps Script.

- `worker.js`: a Cloudflare Worker. `POST /claim` gives out the next unclaimed code; `GET /status` returns
  counts. Each visitor (by hashed IP address) can claim at most 3 codes a day.
- `schema.sql`: the D1 (SQLite) table of codes.
- `promo-service.py`: deploy, import codes, check status, export. It runs on the Mac with only Python and
  talks to the Cloudflare API, so you don't need Node or `wrangler`.

The Cloudflare free plan covers this (100,000 requests a day, 5 GB of D1 storage).

## Set up once

1. Create a Cloudflare account at https://dash.cloudflare.com/sign-up.
2. Open **Workers & Pages** once and pick a `workers.dev` subdomain.
3. Create an API token: **My Profile > API Tokens > Create Token > Create Custom Token**, with these
   account permissions: **Workers Scripts: Edit**, **D1: Edit**, **Account Settings: Read**.
4. On the Mac, run `./promo-service.py set-token` and paste the token at the hidden prompt.
5. Run `./promo-service.py deploy`. It prints the service address.
6. Put that address in `promo/index.html` as `SCRIPT_URL`, then commit and push the site.

## Add codes

Download codes from App Store Connect, save them as a CSV file with one code per line (an optional second
column holds a redeem URL), and run:

```
./promo-service.py import codes.csv
```

Codes already in the database are skipped. A third column with a time marks a code as already claimed.

## Check and back up

```
./promo-service.py status
./promo-service.py export > promo-codes-backup.csv
```
