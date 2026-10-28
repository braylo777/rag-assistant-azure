// Runs the same Worker fetch handler on Node (local dev, Docker, Azure Container Apps / App Service).
import http from "node:http";
import { register } from "node:module";
register("../test/support/html-hooks.mjs", import.meta.url);
const { default: worker } = await import("../src/index.js");
const { envFromProcess } = await import("../src/adapters/azure.js");
const env = envFromProcess(process.env);
const port = +(process.env.PORT || 8080);
http.createServer(async (req, res) => {
  try {
    const chunks = []; for await (const c of req) chunks.push(c);
    const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    headers.set("cf-connecting-ip", (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "anon").toString().split(",")[0].trim());
    const r = await worker.fetch(new Request(`http://localhost${req.url}`, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) }), env, {});
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "internal" })); console.error(e); }
}).listen(port, () => console.log(`rag-assistant listening on :${port} (provider: ${env.PROVIDER})`));
