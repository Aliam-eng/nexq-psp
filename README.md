# nexQ Deposit

Deposit portal that issues **Whish Pay** links directly through the **Whish Pay API** and
credits the paid amount to the client's **MetaTrader 5** account automatically.

## Flow

1. Client opens **/deposit** → enters their **MT5 account number** and an **amount**.
2. Backend creates a `Transaction` with a fresh `externalId` and calls Whish
   `POST /payment/whish` to get a **`collectUrl`** → client is redirected there and approves
   the payment in the Whish app (OTP).
3. Whish calls our **callback** `GET /api/webhooks/whish?externalId=…` on each attempt. The
   callback is unauthenticated, so it only *triggers* a check: we confirm with
   `POST /payment/collect/status` (also polled from the return page and the background sweep).
   A failed attempt leaves the link payable (`pending`); only `success` or `failed` (expired) settle it.
4. On `success`, we credit the account over **MT5 WebAPI** → status becomes `CREDITED`
   (with the MT5 deal id), or `CREDIT_FAILED` if the balance operation fails.
5. Both client and technical dashboards show each transaction's status (done / not / failed).

Statuses: `PENDING → LINK_GENERATED → PAID → CREDITED` (or `CREDIT_FAILED` / `FAILED`).

## Withdrawals

1. Client opens **/withdraw** → enters **amount**, **MT5 account** and **Whish phone number** → gets a
   reference (`NEXQ-W-…`). One open request per MT5 account; nothing moves yet.
2. Staff review it in **/admin/withdrawals**:
   - **Approve** deducts the amount from the MT5 balance (negative `TRADE_BALANCE` with
     `CHECK_MARGIN=1`, so MT5 refuses if free margin is too low). Exactly once: a DB claim stops
     double-approval and MT5 is checked for an existing deal with the reference before deducting.
     If MT5 refuses, the request shows **MT5 failed** and can be retried or rejected.
   - **Reject** requires a reason (stored and logged).
3. **Payout to the client's Whish number is manual** — the Whish API only collects payments.

Statuses: `PENDING → PROCESSING → COMPLETED` (or `FAILED`, `REJECTED`).

## USDT (TRC20) via 3Pay

Configured in **Admin → Settings → 3Pay** (or `THREEPAY_*` in the server `.env`, which wins):
API key, API secret, **webhook secret**, minimum deposit, on/off. Whitelist the server IP in the
3Pay dashboard. Only USDT-TRC20 is used.

**Deposits** — the client picks *USDT*, we create a 3Pay invoice (`/transaction/create`, with our
webhook + return URLs) and send them to 3Pay's hosted page. When 3Pay confirms, MT5 is credited
**what 3Pay credited us** (`depositedAmount`, i.e. after 3Pay's fee); the deposit shows both the
amount sent and the amount credited. Confirmation arrives by **signed webhook**
(`X-Webhook-Signature`, HMAC-SHA256 of the raw body with the webhook secret — forged/unsigned
events get 401). With no webhook secret set, webhooks are only a hint and the status is read from
3Pay's API. The return page and the sweep also poll, so a missed webhook never strands a deposit.

**Payouts** — approving a USDT withdrawal deducts MT5 **first**, then calls `/withdrawal-request`
(3Pay deducts a 2 USDT fee from the amount; the client sees what they'll receive).
3Pay has no idempotency key, so outcomes are handled strictly:

| 3Pay answer | Status | Next step |
|---|---|---|
| 200 completed | `COMPLETED` (tx hash shown) | — |
| 202 executing / 201 pending | `PAYOUT_PENDING` | webhook / sweep / *Check 3Pay* |
| 4xx (refused before broadcast) | `PAYOUT_FAILED` | *Retry payout* or *Refund to MT5* |
| 5xx / timeout | `PAYOUT_UNKNOWN` | *Check 3Pay* finds it by wallet + amount; only then retry |

MT5 is never deducted twice (retries reuse the deduction), a refund uses its own MT5 reference,
and every step is logged.

## Back office

| Page | Admin | Operator |
|---|---|---|
| Deposits `/admin/transactions` | ✓ | ✓ |
| Withdrawals `/admin/withdrawals` (approve / reject) | ✓ | ✓ |
| Staff `/admin/users` (create, role, disable, reset password) | ✓ | |
| Activity log `/admin/activity` | ✓ | |
| Settings `/admin/settings` (Whish, MT5, min deposit) | ✓ | |

Every request re-checks the account in the database, so disabling a staff account or changing
its role takes effect immediately. The **activity log** records approvals, rejections (with
reason), MT5 results, sign-ins (and failed attempts), account changes and settings changes
(field names only — never secret values). The original `TECHNICAL` role is the Admin role.

## Stack

Next.js 14 (App Router, TS) · Prisma · PostgreSQL · Tailwind · JWT-cookie auth · PWA.

## Run locally

Needs a PostgreSQL instance. Use your own and set `DATABASE_URL` in `.env`, or run the
bundled one: `docker compose up -d` (Postgres on :5432, creds in docker-compose.yml).

```bash
npm install
cp .env.example .env          # then set DATABASE_URL to your Postgres
npx prisma migrate dev        # creates the DB + tables (or: prisma migrate deploy)
npm run seed                  # demo users + config
npm run dev                  # app on :3000

# MT5 gateway — pick ONE:
npm run mock-mt5            # quick JS mock on :4100, OR
cd gateway && pip install -r requirements.txt && python mt5_gateway.py  # Python gateway
```

The Python gateway ([gateway/mt5_gateway.py](gateway/mt5_gateway.py)) auto-runs in **mock mode**
if the `MT5Manager` package isn't installed, so the flow works locally; install `MT5Manager`
(Windows + broker libraries) for real crediting.

Demo logins (password `password123`):
- `admin@nexq.local` — TECHNICAL (dashboards)
- `client@nexq.local` — CLIENT (deposit form), has two MT5 accounts seeded

Then in **/admin/settings**:
- Whish Pay: pick *Sandbox*, enter channel / secret / websiteUrl / User-Agent, tick *Enabled*, Save, *Test connection*.
  Sandbox test payer: phone `96170123456`, OTP `111111`.
- MT5: set gateway URL/key + **MT5 server, manager login, password**, tick *Enabled*, *Test connection*.

## Tests

```bash
npm test                 # everything (integration tests skip without a test DB)
npm run test:unit        # fast, no database: Whish client, deposit state machine, fees
npm run test:integration # real API routes + Postgres + a mock Whish server
```

Integration tests need a **throwaway** Postgres whose database name contains `test`
(they drop and re-create its schema, and refuse any other name):

```bash
docker run -d --rm --name nexq-test-db -e POSTGRES_PASSWORD=test -e POSTGRES_DB=nexq_test -p 55441:5432 postgres:16-alpine
TEST_DATABASE_URL="postgresql://postgres:test@localhost:55441/nexq_test?schema=public" npm test
docker stop nexq-test-db
```

What they cover: the documented Whish request/response contract (headers, envelope, `code: 500` =
pending, error codes, the HTML 403 for non-public callback URLs); crediting MT5 only after Whish
confirms `success`, exactly once even under parallel callbacks/polls (real row lock); failed
attempts never failing a deposit; expiry; the sweep and settings auth; and the Rival → Whish
migration over existing data.

## Deploy to a server (one command)

On a fresh Linux server with **Docker** + **Docker Compose v2**:

```bash
git clone <this-repo> nexq-deposit && cd nexq-deposit
./deploy.sh deposit.nexqcapital.com admin@nexqcapital.com      # <domain> [acme-email]
```

[deploy.sh](deploy.sh) generates secrets (preserved on re-deploys), writes `.env`, then brings
up **Postgres + app + Caddy** via [docker-compose.prod.yml](docker-compose.prod.yml). **Caddy
issues a real Let's Encrypt TLS cert automatically** for the domain, so the site is HTTPS
(required for the PWA and Whish callbacks — Whish rejects non-public callback URLs). It runs `prisma migrate deploy`, seeds the initial
admin, and prints the admin login + password.

Before/after running it:
1. Point a **DNS A record**: `your-domain → server public IP`.
2. Open ports **80 and 443** in the firewall.
3. In **MT5 Administrator**, whitelist **this server's public IP** for the WebAPI manager.
4. Log in at `https://<domain>/login`, go to **Settings**, set the Whish Pay credentials, MT5 WebAPI
   host/login/password, min deposit, and (optionally) the webhook secret + register the
   webhook URL shown there.

Re-deploy after changes: `git pull && ./deploy.sh <domain>`. Logs:
`docker compose -f docker-compose.prod.yml logs -f`.

## Local Docker (no TLS)

Postgres + app on localhost:

```bash
export AUTH_SECRET="$(openssl rand -hex 32)"
export ADMIN_PASSWORD="a-strong-password"
docker compose up -d --build
```

This builds the app image ([Dockerfile](Dockerfile)), starts Postgres, waits for it to be
healthy, runs `prisma migrate deploy`, seeds the **initial admin** (from `ADMIN_EMAIL` /
`ADMIN_PASSWORD`, first boot only), then serves on **http://localhost:3000**.

- Admin signs in at `/login` and **changes the password from Settings → Account**.
- The **MT5 gateway runs separately on a Windows host** (it needs the native `MT5Manager`
  libraries) — it is not part of this Linux stack. Point Settings → MT5 at its URL.
- To deploy the app against a **managed Postgres**, build the image and set `DATABASE_URL`,
  `AUTH_SECRET`, `APP_BASE_URL` in your platform's env (skip the `db` service).

## Production notes

- **Database:** PostgreSQL. Set `DATABASE_URL` and run `prisma migrate deploy` on deploy.
  Role/Status are plain strings; promote to Postgres enums later if you want DB-level checks.
- **MT5 gateway:** [gateway/mt5_gateway.py](gateway/mt5_gateway.py) is the real (Python)
  gateway — it wraps the **MetaTrader 5 Manager API** (`MT5Manager`), connects with the manager
  credentials supplied per request from Settings, and performs the balance deal
  (`DealerBalance` with `DEAL_BALANCE`) on the client's login. Install `MT5Manager` on a Windows
  host with your broker's Manager API libraries. Verify the `DealerBalance` signature/return
  against your SDK version (marked in `_do_deposit`). The JS `scripts/mock-mt5-gateway.ts` is a
  dev-only stand-in. Both expose `GET /health`, `POST /connect`, `POST /deposit` per
  [src/lib/mt5.ts](src/lib/mt5.ts).
- **MT5 secrets:** server/login/password are stored in the DB from Settings — encrypt these
  columns (or move to a secrets manager) before production.
- **Reconciliation:** schedule `POST /api/sweep` (cron / Vercel cron) with header
  `x-cron-secret: $CRON_SECRET` to catch payments where the customer never returns.
- **Secrets:** set a strong `AUTH_SECRET`; set `APP_BASE_URL` to the public URL (used for
  Whish callbacks and redirects). The Whish secret is stored in the DB from Settings — encrypt
  it (or move it to a secrets manager) before production.

## Key files

- [src/lib/whish.ts](src/lib/whish.ts) — direct Whish Pay client (create / collect status / balance)
- [src/lib/mt5.ts](src/lib/mt5.ts) — MT5 gateway client
- [src/lib/flow.ts](src/lib/flow.ts) — reconcile (poll PAID → credit MT5), idempotent
- [src/app/deposit/](src/app/deposit/) — client form, Whish handoff, return/status page
- [src/app/admin/](src/app/admin/) — settings + transactions dashboards
