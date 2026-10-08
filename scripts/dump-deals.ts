import { webapiDealsRaw } from "../src/lib/mt5-webapi";

// Manager credentials come from the environment: MT5_SERVER, MT5_LOGIN, MT5_PASSWORD.
const { MT5_SERVER, MT5_LOGIN, MT5_PASSWORD } = process.env;
if (!MT5_SERVER || !MT5_LOGIN || !MT5_PASSWORD) throw new Error("Set MT5_SERVER, MT5_LOGIN and MT5_PASSWORD");
const login = process.argv[2] || "129060";
(async () => {
  const r = await webapiDealsRaw({ server: MT5_SERVER, login: MT5_LOGIN, password: MT5_PASSWORD, cryptMethod: "NONE", clientLogin: login });
  console.log(`login ${login} -> retcode: ${r.retcode}, deals: ${r.count}`);
  const bal = r.sample.filter((d: any) => Number(d.action) === 2);
  console.log(`balance deals (action=2): ${bal.length}`);
  // count comments
  const counts: Record<string, number> = {};
  for (const d of bal) counts[d.comment] = (counts[d.comment] || 0) + 1;
  console.log("\n--- comment -> occurrences (balance deals) ---");
  for (const [c, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`${n}x  ${JSON.stringify(c)}`);
  const ours = bal.filter((d: any) => /NEXQ-|Deposit/i.test(d.comment));
  console.log(`\n--- deals whose comment mentions NEXQ/Deposit: ${ours.length} ---`);
  for (const d of ours) console.log(JSON.stringify(d));
  process.exit(0);
})();
