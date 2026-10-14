import { execSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// Integration tests need a throwaway Postgres. They are skipped unless
// TEST_DATABASE_URL is set, and refuse any database whose name lacks "test"
// so they can never wipe a real one. See README → Tests.
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || "";
export const hasTestDb = !!TEST_DATABASE_URL;

export function assertSafeTestDb(url: string) {
  const dbName = new URL(url).pathname.replace(/^\//, "");
  if (!/test/i.test(dbName)) {
    throw new Error(`Refusing to run integration tests against "${dbName}" — the database name must contain "test".`);
  }
}

export function prismaCli(args: string, url: string, input?: string) {
  return execSync(`npx prisma ${args}`, {
    env: { ...process.env, DATABASE_URL: url },
    input,
    stdio: input === undefined ? "pipe" : ["pipe", "pipe", "pipe"],
  }).toString();
}

// Drop and re-create the public schema from the committed migrations.
export function resetDatabase(url: string) {
  assertSafeTestDb(url);
  prismaCli("migrate reset --force --skip-seed --skip-generate", url);
}

export function withSchema(url: string, schema: string) {
  const u = new URL(url);
  u.searchParams.set("schema", schema);
  return u.toString();
}

// ---- Mock Whish Pay server (documented envelope + endpoints) -------------
export type MockWhish = {
  baseUrl: string;
  calls: { method: string; path: string; query: string; headers: Record<string, any>; body: any }[];
  collect: Map<string, string>; // externalId -> collectStatus
  next: { create?: object; status?: object }; // one-shot overrides
  close: () => Promise<void>;
};

export const WHISH_CREDS = {
  channel: "CH1",
  secret: "S3CRET",
  websiteUrl: "https://nexq.example",
  userAgent: "nexQDeposit/1.0 (https://nexq.example; ops@nexq.example)",
};

const ok = (data: unknown) => ({ status: true, code: null, dialog: null, extra: null, data });

export async function startMockWhish(): Promise<MockWhish> {
  const state = { calls: [], collect: new Map(), next: {} } as Pick<MockWhish, "calls" | "collect" | "next">;

  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const [path, query = ""] = (req.url || "").split("?");
      const body = raw ? JSON.parse(raw) : null;
      state.calls.push({ method: req.method || "", path, query, headers: req.headers, body });
      const send = (o: unknown) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(o));
      };

      const h = req.headers;
      if (
        h.channel !== WHISH_CREDS.channel ||
        h.secret !== WHISH_CREDS.secret ||
        h.websiteurl !== WHISH_CREDS.websiteUrl ||
        h["user-agent"] !== WHISH_CREDS.userAgent
      ) {
        return send({ status: false, code: "request.invalid", dialog: { message: "invalid headers" }, data: null });
      }

      if (req.method === "POST" && path === "/payment/whish") {
        if (state.next.create) {
          const o = state.next.create;
          state.next.create = undefined;
          return send(o);
        }
        if (/localhost|127\.0\.0\.1/.test(body.successCallbackUrl)) {
          res.writeHead(403, { "Content-Type": "text/html" });
          return res.end("<html>Forbidden</html>");
        }
        state.collect.set(body.externalId, "pending");
        return send(ok({ collectUrl: `https://whish.money/pay/${body.externalId.slice(0, 7)}` }));
      }
      if (req.method === "POST" && path === "/payment/collect/status") {
        if (state.next.status) {
          const o = state.next.status;
          state.next.status = undefined;
          return send(o);
        }
        const s = state.collect.get(body.externalId);
        if (!s) return send({ status: false, code: "external_id.not_exists", dialog: null, data: null });
        return send(ok({ collectStatus: s, payerPhoneNumber: "96170123456" }));
      }
      if (req.method === "GET" && path === "/payment/account/balance") return send(ok({ balance: 10439 }));
      res.writeHead(404);
      res.end();
    });
  });

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    ...state,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  } as MockWhish;
}
