import { webapiTest } from "../src/lib/mt5-webapi";

// Usage: tsx scripts/test-webapi.ts <login> <password> [host:port ...]  (or MT5_LOGIN / MT5_PASSWORD / MT5_SERVER env)
const login = process.argv[2] || process.env.MT5_LOGIN;
const password = process.argv[3] || process.env.MT5_PASSWORD;
if (!login || !password) throw new Error("Pass <login> <password> or set MT5_LOGIN / MT5_PASSWORD");

const endpoints = process.argv.length > 4 ? process.argv.slice(4) : [process.env.MT5_SERVER || "185.67.127.231:443"];

(async () => {
  for (const server of endpoints) {
    const r = await webapiTest({ server, login, password, cryptMethod: "NONE" });
    console.log(`${server} ->`, JSON.stringify(r));
  }
  process.exit(0);
})();
