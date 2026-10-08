import net from "node:net";
import crypto from "node:crypto";

// Client for the MetaQuotes MT5 WebAPI (binary/TCP), ported faithfully from the
// official PHP reference (MetaTrader5SDK/Examples/Web/PHP/mt5_api).
//
// Wire format:
//   First packet:  "MT5WEBAPI" + hex4(len) + hex4(number) + "0" + body(utf16le)
//   Next packets:               hex4(len) + hex4(number) + "0" + body(utf16le)
//   Response header (9 ascii): SIZE(4) + NUMBER(4) + FLAG(1), then SIZE bytes body (utf16le)
//   Body text:     "COMMAND|KEY=VALUE|KEY=VALUE|\r\n"   (values escaped)
//   Password hash: md5( md5( md5(utf16le(pw)) + "WebAPI" ) + rand_bytes )
// AUTH_START / AUTH_ANSWER are never encrypted. (AES256OFB for later commands TODO.)

const WEBAPI_VERSION = "5120";
const WEBAPI_AGENT = "WebAPI";
const WEB_API_WORD = "WebAPI";

function md5(...parts: Buffer[]): Buffer {
  const h = crypto.createHash("md5");
  for (const p of parts) h.update(p);
  return h.digest();
}

// md5( md5( md5(utf16le(pw)) + "WebAPI" ) + randBytes ) -> hex string
function hashFromPassword(password: string, randBytes: Buffer): string {
  const pwHash = md5(Buffer.from(password, "utf16le")); // 16 bytes
  const b = Buffer.concat([pwHash, Buffer.from(WEB_API_WORD, "latin1")]);
  const c = md5(b); // 16 bytes
  return md5(c, randBytes).toString("hex");
}

function escapeValue(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/=/g, "\\=").replace(/\|/g, "\\|").replace(/\n/g, "\\\n");
}

function buildQuery(command: string, data?: Record<string, string | number>): Buffer {
  let q = command;
  if (data && Object.keys(data).length) {
    q += "|";
    for (const [k, v] of Object.entries(data)) q += `${k}=${escapeValue(String(v))}|`;
    q += "\r\n";
  } else {
    q += "|\r\n";
  }
  return Buffer.from(q, "utf16le");
}

function hex4(n: number): string {
  return (n & 0xffff).toString(16).padStart(4, "0");
}

type Parsed = { command: string; params: Record<string, string>; retcode: number; rettext: string; json: string };

function parseAnswer(answer: string): Parsed {
  const bar = answer.indexOf("|");
  const command = bar >= 0 ? answer.slice(0, bar) : answer.trim();
  const end = answer.indexOf("\r\n");
  const paramStr = answer.slice(bar + 1, end >= 0 ? end : undefined);
  const params: Record<string, string> = {};
  for (const piece of paramStr.split("|")) {
    if (!piece) continue;
    const eq = piece.indexOf("=");
    if (eq === -1) continue;
    params[piece.slice(0, eq).toUpperCase()] = piece.slice(eq + 1);
  }
  const rc = params.RETCODE || "";
  const retcode = parseInt(rc.split(" ")[0] || "-1", 10);
  // Some commands (DEAL_GET_PAGE, USER_GET, ...) append a JSON body after CRLF.
  const nl = answer.indexOf("\n");
  const json = nl >= 0 ? answer.slice(nl + 1).trim() : "";
  return { command, params, retcode, rettext: rc, json };
}

class WebApiConnection {
  private socket: net.Socket;
  private buffer = Buffer.alloc(0);
  private pendingBody: Buffer[] = [];
  private waiters: Array<{ resolve: (s: string) => void; reject: (e: Error) => void }> = [];
  private failure: Error | null = null;
  private clientCommand = 0;

  constructor(socket: net.Socket) {
    this.socket = socket;
    socket.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drain();
    });
    socket.on("error", (e: any) =>
      this.fail(new Error(e?.code === "ECONNRESET" ? "connection reset by server (check IP allowlist / WebAPI access)" : `socket error: ${e?.code || e?.message}`))
    );
    socket.on("close", (hadError) => {
      if (!hadError) this.fail(new Error("connection closed by server before reply"));
    });
  }

  private fail(err: Error) {
    this.failure = err;
    const pending = this.waiters;
    this.waiters = [];
    for (const w of pending) w.reject(err);
  }

  private drain() {
    while (this.buffer.length >= 9) {
      const header = this.buffer.subarray(0, 9).toString("ascii");
      const size = parseInt(header.slice(0, 4), 16);
      const flag = parseInt(header.slice(8, 9), 16);
      if (Number.isNaN(size) || this.buffer.length < 9 + size) break;
      const part = this.buffer.subarray(9, 9 + size);
      this.buffer = this.buffer.subarray(9 + size);
      if (size === 0) continue; // PING / keep-alive
      this.pendingBody.push(Buffer.from(part));
      if (flag === 0) {
        const full = Buffer.concat(this.pendingBody).toString("utf16le");
        this.pendingBody = [];
        const w = this.waiters.shift();
        if (w) w.resolve(full);
      }
    }
  }

  private nextNumber(): number {
    this.clientCommand++;
    if (this.clientCommand > 16383) this.clientCommand = 1;
    return this.clientCommand;
  }

  send(command: string, data: Record<string, string | number> | undefined, firstRequest: boolean) {
    const number = this.nextNumber();
    const body = buildQuery(command, data);
    const prefix = (firstRequest ? "MT5WEBAPI" : "") + hex4(body.length) + hex4(number) + "0";
    this.socket.write(Buffer.concat([Buffer.from(prefix, "ascii"), body]));
  }

  receive(timeoutMs = 15000): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.failure) return reject(this.failure);
      const t = setTimeout(() => reject(new Error("WebAPI response timeout (no reply)")), timeoutMs);
      this.waiters.push({
        resolve: (s) => {
          clearTimeout(t);
          resolve(s);
        },
        reject: (e) => {
          clearTimeout(t);
          reject(e);
        },
      });
    });
  }

  async command(name: string, data: Record<string, string | number> | undefined, firstRequest = false): Promise<Parsed> {
    this.send(name, data, firstRequest);
    return parseAnswer(await this.receive());
  }

  close() {
    this.socket.destroy();
  }
}

function connect(host: string, port: number, timeoutMs = 10000): Promise<WebApiConnection> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const t = setTimeout(() => {
      socket.destroy();
      reject(new Error(`connect timeout to ${host}:${port}`));
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(t);
      resolve(new WebApiConnection(socket));
    });
    socket.once("error", (e: any) => {
      clearTimeout(t);
      reject(new Error(`connect failed to ${host}:${port}: ${e?.code || e?.message}`));
    });
  });
}

export type WebApiConfig = {
  server: string; // "host:port"
  login: string;
  password: string;
  cryptMethod?: string | null; // NONE | AES256OFB
};

function parseHostPort(server: string): { host: string; port: number } {
  const [host, portStr] = server.split(":");
  const port = parseInt(portStr || "443", 10);
  return { host: (host || "").trim(), port: Number.isNaN(port) ? 443 : port };
}

async function authenticate(conn: WebApiConnection, cfg: WebApiConfig) {
  const crypt = (cfg.cryptMethod || "NONE").toUpperCase();
  if (crypt !== "NONE") {
    throw new Error("AES256OFB not implemented yet — set crypt method to NONE");
  }

  // AUTH_START (first packet, never encrypted)
  const start = await conn.command(
    "AUTH_START",
    { VERSION: WEBAPI_VERSION, AGENT: WEBAPI_AGENT, LOGIN: cfg.login, TYPE: "MANAGER", CRYPT_METHOD: "NONE" },
    true
  );
  if (start.command !== "AUTH_START") throw new Error(`unexpected response: ${start.command}`);
  if (start.retcode !== 0) throw new Error(`AUTH_START rejected: ${start.rettext}`);
  const srvRandHex = start.params.SRV_RAND;
  if (!srvRandHex || srvRandHex === "none") throw new Error("no SRV_RAND from server");

  // AUTH_ANSWER
  const srvRand = Buffer.from(srvRandHex, "hex");
  const answerHash = hashFromPassword(cfg.password, srvRand);
  const cliRandHex = crypto.randomBytes(16).toString("hex");
  const ans = await conn.command("AUTH_ANSWER", { SRV_RAND_ANSWER: answerHash, CLI_RAND: cliRandHex }, false);
  if (ans.retcode !== 0) throw new Error(`AUTH failed: ${ans.rettext || "invalid login/password"}`);

  // verify the server proved it knows the password
  const expected = hashFromPassword(cfg.password, Buffer.from(cliRandHex, "hex"));
  const got = (ans.params.CLI_RAND_ANSWER || "").toLowerCase();
  if (got && got !== expected.toLowerCase()) throw new Error("server password hash mismatch (not trusted)");
}

export async function webapiTest(cfg: WebApiConfig): Promise<{ ok: boolean; detail: string }> {
  if (!cfg.server || !cfg.login || !cfg.password) return { ok: false, detail: "host:port, login and password are required" };
  const { host, port } = parseHostPort(cfg.server);
  let conn: WebApiConnection | null = null;
  try {
    conn = await connect(host, port);
    await authenticate(conn, cfg);
    return { ok: true, detail: `authenticated to ${host}:${port} as ${cfg.login}` };
  } catch (e: any) {
    return { ok: false, detail: e?.message || "WebAPI connection failed" };
  } finally {
    conn?.close();
  }
}

// Read-only check that post-auth commands work (no balance change).
export async function webapiUserGet(cfg: WebApiConfig & { clientLogin: string }): Promise<{ ok: boolean; detail: string }> {
  const { host, port } = parseHostPort(cfg.server);
  let conn: WebApiConnection | null = null;
  try {
    conn = await connect(host, port);
    await authenticate(conn, cfg);
    const res = await conn.command("USER_GET", { LOGIN: cfg.clientLogin });
    return { ok: res.retcode === 0, detail: `USER_GET retcode=${res.rettext}` };
  } catch (e: any) {
    return { ok: false, detail: e?.message || "USER_GET failed" };
  } finally {
    conn?.close();
  }
}

// Read-only: fetch recent deals for a login and (optionally) look for one whose
// comment carries `reference`. Used by the idempotency guard and for diagnostics.
export async function webapiFindDeal(
  cfg: WebApiConfig & { clientLogin: string; reference?: string }
): Promise<{ ok: boolean; retcode: string; parseOk: boolean; count: number; dealId: string | null; detail?: string }> {
  const { host, port } = parseHostPort(cfg.server);
  let conn: WebApiConnection | null = null;
  try {
    conn = await connect(host, port);
    await authenticate(conn, cfg);
    const { retcode, deals } = await fetchAllDeals(conn, cfg.clientLogin);
    let dealId: string | null = null;
    if (cfg.reference) {
      const m = deals.find((d) => d && typeof d.Comment === "string" && d.Comment.includes(cfg.reference!) && Number(d.Action) === 2);
      dealId = m ? String(m.Deal ?? "") : null;
    }
    return { ok: retcode.startsWith("0"), retcode, parseOk: true, count: deals.length, dealId };
  } catch (e: any) {
    return { ok: false, retcode: "", parseOk: false, count: 0, dealId: null, detail: e?.message };
  } finally {
    conn?.close();
  }
}

// Fetch deals for a login within a time window, paging (DEAL_GET_PAGE returns
// ~100 at a time). A tight window keeps the load on MT5 small and fast.
async function fetchAllDeals(
  conn: WebApiConnection,
  login: string,
  fromSec?: number,
  toSec?: number,
  maxPages = 200
): Promise<{ retcode: string; deals: any[] }> {
  const now = Math.floor(Date.now() / 1000);
  const from = fromSec ?? now - 5 * 365 * 24 * 3600;
  const to = toSec ?? now + 24 * 3600;
  const PAGE = 100;
  const all: any[] = [];
  let offset = 0;
  let retcode = "";
  for (let i = 0; i < maxPages; i++) {
    const res = await conn.command("DEAL_GET_PAGE", { LOGIN: login, FROM: from, TO: to, OFFSET: offset, TOTAL: PAGE });
    retcode = res.rettext;
    if (res.retcode !== 0) break;
    let arr: any[] = [];
    try {
      const p = JSON.parse(res.json || "[]");
      arr = Array.isArray(p) ? p : p?.deals || p?.data || [];
    } catch {
      break;
    }
    all.push(...arr);
    if (arr.length < PAGE) break; // last page
    offset += arr.length;
  }
  return { retcode, deals: all };
}

// Debug: return raw deals (compact) for a login, paging through all of them.
export async function webapiDealsRaw(
  cfg: WebApiConfig & { clientLogin: string }
): Promise<{ ok: boolean; retcode: string; count: number; sample: any[]; detail?: string }> {
  const { host, port } = parseHostPort(cfg.server);
  let conn: WebApiConnection | null = null;
  try {
    conn = await connect(host, port);
    await authenticate(conn, cfg);
    const { retcode, deals } = await fetchAllDeals(conn, cfg.clientLogin);
    const sample = deals.map((d) => ({ deal: String(d.Deal ?? ""), action: String(d.Action ?? ""), comment: String(d.Comment ?? ""), profit: String(d.Profit ?? "") }));
    return { ok: retcode.startsWith("0"), retcode, count: deals.length, sample };
  } catch (e: any) {
    return { ok: false, retcode: "", count: 0, sample: [], detail: e?.message };
  } finally {
    conn?.close();
  }
}

export type BalanceDeal = { deal: string; comment: string };
export type ScanItem = { login: string; from: number; to: number }; // window in unix seconds

// Fetch balance deals (Action=2) for many accounts, each within its own tight
// time window. Uses a few parallel connections to stay quick while keeping load
// on MT5 modest. Read-only.
export async function webapiBalanceDeals(
  cfg: WebApiConfig,
  items: ScanItem[],
  concurrency = 3
): Promise<{ ok: boolean; byLogin: Record<string, BalanceDeal[]>; errors: Record<string, string>; detail?: string }> {
  const byLogin: Record<string, BalanceDeal[]> = {};
  const errors: Record<string, string> = {};
  if (!cfg.server || !cfg.login || !cfg.password) return { ok: false, byLogin, errors, detail: "MT5 not configured" };
  const { host, port } = parseHostPort(cfg.server);

  const queue = [...items];
  let connError: string | null = null;

  async function worker() {
    let conn: WebApiConnection | null = null;
    try {
      conn = await connect(host, port);
      await authenticate(conn, cfg);
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const item = queue.shift();
        if (!item) break;
        try {
          const { retcode, deals } = await fetchAllDeals(conn, item.login, item.from, item.to);
          if (deals.length === 0 && retcode && !retcode.startsWith("0")) {
            errors[item.login] = retcode;
            byLogin[item.login] = [];
            continue;
          }
          byLogin[item.login] = deals
            .filter((d) => Number(d?.Action) === 2)
            .map((d) => ({ deal: String(d.Deal ?? ""), comment: String(d.Comment ?? "") }));
        } catch (e: any) {
          errors[item.login] = e?.message || "query failed";
          byLogin[item.login] = [];
        }
      }
    } catch (e: any) {
      connError = e?.message || "connection failed";
    } finally {
      conn?.close();
    }
  }

  const workers = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: workers }, () => worker()));

  if (Object.keys(byLogin).length === 0 && connError) return { ok: false, byLogin, errors, detail: connError };
  return { ok: true, byLogin, errors };
}

export type WebApiDepositInput = WebApiConfig & {
  clientLogin: string;
  amount: number;
  comment: string;
  reference: string; // unique tag we match on to avoid double-crediting
};

// Look for an already-existing balance deal carrying our reference in its
// comment. Returns the deal ticket if found (i.e. this deposit was already
// credited), else null. Best-effort: returns null on any query problem.
async function findExistingDeal(conn: WebApiConnection, login: string, reference: string): Promise<string | null> {
  // Tight window: a prior credit for THIS deposit would be very recent, so we
  // only look back a couple of days — one small, fast query, gentle on MT5.
  const now = Math.floor(Date.now() / 1000);
  const { deals } = await fetchAllDeals(conn, login, now - 2 * 24 * 3600, now + 24 * 3600);
  const match = deals.find(
    (d) => d && typeof d.Comment === "string" && d.Comment.includes(reference) && Number(d.Action) === 2
  );
  return match ? String(match.Deal ?? "") : null;
}

// Credit a deposit EXACTLY ONCE. Before sending TRADE_BALANCE we ask MT5 whether
// a deal for this reference already exists (covers a crash/retry after a prior
// credit). Combined with the DB-level claim in flow.ts, a deposit can never be
// credited twice. TYPE=2 is DEAL_BALANCE (deposit when amount is positive).
export async function webapiDeposit(
  input: WebApiDepositInput
): Promise<{ ok: true; dealId: string; existing?: boolean; checkMs?: number } | { ok: false; message: string }> {
  if (!input.server || !input.login || !input.password) return { ok: false, message: "WebAPI connection not configured" };
  const { host, port } = parseHostPort(input.server);
  let conn: WebApiConnection | null = null;
  try {
    conn = await connect(host, port);
    await authenticate(conn, input);

    // Idempotency guard: already credited? (timed so we can see how long the
    // duplicate-check adds to each deposit)
    const t0 = Date.now();
    const existing = await findExistingDeal(conn, input.clientLogin, input.reference);
    const checkMs = Date.now() - t0;
    console.log(`[mt5] ${input.reference} dup-check ${checkMs}ms -> ${existing ? "already credited " + existing : "not credited"}`);
    if (existing) return { ok: true, dealId: existing, existing: true, checkMs };

    const res = await conn.command("TRADE_BALANCE", {
      LOGIN: input.clientLogin,
      TYPE: "2",
      BALANCE: input.amount.toFixed(2),
      COMMENT: input.comment,
      CHECK_MARGIN: "0",
    });
    if (res.retcode !== 0) return { ok: false, message: `TRADE_BALANCE failed: ${res.rettext || "error"}` };
    return { ok: true, dealId: String(res.params.TICKET || ""), existing: false, checkMs };
  } catch (e: any) {
    return { ok: false, message: e?.message || "WebAPI deposit failed" };
  } finally {
    conn?.close();
  }
}
