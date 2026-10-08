// Diagnose the saved MT5 WebAPI endpoint: TCP reachability, whether it sends a
// banner, whether it replies to AUTH_START, and whether the port speaks TLS.
import net from "node:net";
import tls from "node:tls";
import { prisma } from "../src/lib/db";

function probePlain(host: string, port: number): Promise<string> {
  return new Promise((resolve) => {
    const s = net.createConnection({ host, port });
    let got = "";
    const done = (m: string) => { s.destroy(); resolve(m); };
    const t = setTimeout(() => done(`TCP connected, NO reply in 6s${got ? ` (banner: ${got.slice(0,40)})` : ""}`), 6000);
    s.once("connect", () => {
      // send a minimal AUTH_START packet
      const body = Buffer.from("AUTH_START\r\nVERSION=3264\r\nAGENT=WebAPI\r\nLOGIN=1\r\nTYPE=MANAGER\r\nCRYPT_METHOD=NONE\r\n\r\n");
      const header = (body.length & 0xffff).toString(16).padStart(4,"0") + "0" + "0000";
      s.write(Buffer.concat([Buffer.from(header), body]));
    });
    s.on("data", (d) => { got += d.toString("latin1"); clearTimeout(t); done(`REPLIED: ${JSON.stringify(d.toString("latin1").slice(0,80))}`); });
    s.once("error", (e: any) => { clearTimeout(t); done(`TCP error: ${e.code || e.message}`); });
  });
}

function probeTls(host: string, port: number): Promise<string> {
  return new Promise((resolve) => {
    const s = tls.connect({ host, port, rejectUnauthorized: false, servername: host });
    const t = setTimeout(() => { s.destroy(); resolve("TLS handshake timed out"); }, 6000);
    s.once("secureConnect", () => { clearTimeout(t); s.destroy(); resolve("TLS handshake OK — this port speaks TLS"); });
    s.once("error", (e: any) => { clearTimeout(t); resolve(`not TLS / error: ${e.code || e.message}`); });
  });
}

(async () => {
  const cfg = await prisma.mt5Config.findUnique({ where: { id: "mt5" } });
  const server = cfg?.mt5Server || "";
  const [host, portStr] = server.split(":");
  const port = parseInt(portStr || "443", 10);
  console.log(`Saved endpoint: ${JSON.stringify(server)} -> host=${host} port=${port}`);
  console.log("plain:", await probePlain(host, port));
  console.log("tls:  ", await probeTls(host, port));
  process.exit(0);
})();
