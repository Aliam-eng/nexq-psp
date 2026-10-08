// Dev-only mock of the MT5 Manager API gateway.
// Run with:  npm run mock-mt5
// Implements the same contract src/lib/mt5.ts expects, so the deposit ->
// credit flow works end to end before the real MT5 service is wired in.
//
// The REAL gateway should be a Windows service (e.g. .NET) that loads the
// MetaTrader 5 Manager API DLL, connects with manager credentials, and calls
// the balance/deposit operation (DealerBalance) on the client's login.

import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_MT5_PORT || 4100);
const API_KEY = process.env.MOCK_MT5_KEY || "dev-mt5-key";

let dealSeq = 70000;

function send(res: any, status: number, body: unknown) {
  const json = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(json);
}

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    return send(res, 200, { ok: true, service: "mock-mt5-gateway" });
  }

  if (req.method === "POST" && req.url === "/connect") {
    const key = req.headers["x-api-key"];
    if (API_KEY && key !== API_KEY) return send(res, 401, { ok: false, message: "invalid api key" });
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body: any = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        return send(res, 400, { ok: false, message: "invalid json" });
      }
      if (!body.server || !body.managerLogin) {
        return send(res, 400, { ok: false, message: "server and managerLogin required" });
      }
      console.log(`[mock-mt5] connect server=${body.server} login=${body.managerLogin} (mock OK)`);
      return send(res, 200, { ok: true, message: `mock connect to ${body.server} OK` });
    });
    return;
  }

  if (req.method === "POST" && req.url === "/deposit") {
    const key = req.headers["x-api-key"];
    if (API_KEY && key !== API_KEY) {
      return send(res, 401, { ok: false, message: "invalid api key" });
    }
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body: any = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        return send(res, 400, { ok: false, message: "invalid json" });
      }
      if (!body.login || !body.amount) {
        return send(res, 400, { ok: false, message: "login and amount are required" });
      }
      // Simulate a failure for a magic login so you can test CREDIT_FAILED.
      if (String(body.login) === "5000999") {
        return send(res, 422, { ok: false, message: "account disabled (mock)" });
      }
      const dealId = String(++dealSeq);
      console.log(
        `[mock-mt5] credited login=${body.login} amount=${body.amount} ${body.currency} ref=${body.reference} -> deal ${dealId}`
      );
      return send(res, 200, { ok: true, dealId, message: "balance operation accepted (mock)" });
    });
    return;
  }

  send(res, 404, { ok: false, message: "not found" });
});

server.listen(PORT, () => {
  console.log(`[mock-mt5] gateway listening on http://localhost:${PORT}  (x-api-key: ${API_KEY})`);
});
