// Ad-hoc: run the WebAPI test handshake using the saved Settings config.
import { mt5TestConnect } from "../src/lib/mt5";

mt5TestConnect()
  .then((r) => {
    console.log("RESULT:", JSON.stringify(r));
    process.exit(0);
  })
  .catch((e) => {
    console.error("ERROR:", e);
    process.exit(1);
  });
