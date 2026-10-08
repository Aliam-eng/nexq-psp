# nexQ Deposit

Deposit portal that issues **Whish Pay** links via the **Rival Payments** API and credits
the paid amount to the client's **MetaTrader 5** account automatically.

## Flow

1. Client logs in → **New deposit** → picks a **trading account** → enters an **amount**.
2. Backend creates a `Transaction` and calls Rival `POST /v1/integrations/whish/payments`
   to get a **`collectUrl`** (the Whish Pay link) → client is redirected there to pay.
3. Rival does **not** call us back — settlement is pushed to *their* CRM. So we **poll**
   `GET /v1/integrations/whish/payments/{externalId}` (on the client's return page and via a
   background sweep) to detect `PAID`.
4. On `PAID`, we call the **MT5 gateway** to credit the account → status becomes `CREDITED`
   (with the MT5 deal id), or `CREDIT_FAILED` if the balance operation fails.
5. Both client and technical dashboards show each transaction's status (done / not / failed).

Statuses: `PENDING → LINK_GENERATED → PAID → CREDITED` (or `CREDIT_FAILED` / `FAILED`).

## Two dashboards

- **/admin/settings** (TECHNICAL role) — Rival **API key** (`tsk_...` Bearer) + **base URL** /
  endpoint paths, and the **MT5 gateway** URL/key + the **MT5 connection** (server, manager
  login, password) + default group, each with a *Test connection*. The MT5 connection entered
  here is forwarded to the Python gateway per request, so the gateway holds no broker secrets.
- **/admin/transactions** (TECHNICAL role) — all deposits, filters, per-row **Sync**, and
  **Sync all pending**.

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
- Rival: paste your company key (`tsk_...`), tick *Enabled*, Save.
- MT5: set gateway URL/key + **MT5 server, manager login, password**, tick *Enabled*, *Test connection*.

## Deploy to a server (one command)

On a fresh Linux server with **Docker** + **Docker Compose v2**:

```bash
git clone <this-repo> nexq-deposit && cd nexq-deposit
./deploy.sh portal.giv.trade ops@giv.trade      # <domain> [acme-email]
```

[deploy.sh](deploy.sh) generates secrets (preserved on re-deploys), writes `.env`, then brings
up **Postgres + app + Caddy** via [docker-compose.prod.yml](docker-compose.prod.yml). **Caddy
issues a real Let's Encrypt TLS cert automatically** for the domain, so the site is HTTPS
(required for the PWA and Rival webhooks). It runs `prisma migrate deploy`, seeds the initial
admin, and prints the admin login + password.

Before/after running it:
1. Point a **DNS A record**: `your-domain → server public IP`.
2. Open ports **80 and 443** in the firewall.
3. In **MT5 Administrator**, whitelist **this server's public IP** for the WebAPI manager.
4. Log in at `https://<domain>/login`, go to **Settings**, set the Rival key, MT5 WebAPI
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
  Whish success/failure redirects).

## Key files

- [src/lib/rival.ts](src/lib/rival.ts) — Rival/Whish Pay adapter (create / status / health)
- [src/lib/mt5.ts](src/lib/mt5.ts) — MT5 gateway client
- [src/lib/flow.ts](src/lib/flow.ts) — reconcile (poll PAID → credit MT5), idempotent
- [src/app/deposit/](src/app/deposit/) — client form, Whish handoff, return/status page
- [src/app/admin/](src/app/admin/) — settings + transactions dashboards
