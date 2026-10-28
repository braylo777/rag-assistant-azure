// Azure adapter: presents Azure OpenAI + Azure AI Search through the same `env` shape the agent already uses
// (env.AI.run, env.VECTORS.query, env.RATE_LIMITER.limit), so the agent code is unchanged across clouds.
// No Azure account is connected to this repo; these calls are verified against recorded request/response shapes in tests.
const API = "2024-10-21";
export function azureEnv(cfg, fetchImpl = fetch) {
  const need = ["AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_CHAT_DEPLOYMENT", "AZURE_OPENAI_EMBED_DEPLOYMENT"];
  const missing = need.filter((k) => !cfg[k]);
  if (missing.length) throw new Error(`azure adapter: missing ${missing.join(", ")}`);
  const base = cfg.AZURE_OPENAI_ENDPOINT.replace(/\/$/, "");
  const auth = async () => (cfg.AZURE_OPENAI_API_KEY ? { "api-key": cfg.AZURE_OPENAI_API_KEY } : { authorization: `Bearer ${await cfg.getToken("https://cognitiveservices.azure.com/.default")}` });
  const post = async (url, body, headers) => {
    const r = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`azure ${r.status}: ${(await r.text()).slice(0, 200)}`); // never echoes credentials
    return r.json();
  };
  const AI = {
    async run(model, input) {
      if (input.text) { // embeddings
        const r = await post(`${base}/openai/deployments/${cfg.AZURE_OPENAI_EMBED_DEPLOYMENT}/embeddings?api-version=${API}`, { input: input.text, dimensions: 768 }, await auth());
        return { data: r.data.map((d) => d.embedding) };
      }
      const body = { messages: input.messages, max_tokens: input.max_tokens ?? 400 };
      if (input.tools?.length) body.tools = input.tools.map((t) => ({ type: "function", function: t }));
      const r = await post(`${base}/openai/deployments/${cfg.AZURE_OPENAI_CHAT_DEPLOYMENT}/chat/completions?api-version=${API}`, body, await auth());
      const m = r.choices[0].message;
      return { response: m.content ?? "", tool_calls: (m.tool_calls || []).map((c) => ({ name: c.function.name, arguments: safeJson(c.function.arguments) })), usage: r.usage };
    },
  };
  const env = { AI, PROVIDER: "azure" };
  if (cfg.AZURE_SEARCH_ENDPOINT && cfg.AZURE_SEARCH_INDEX) {
    const sbase = cfg.AZURE_SEARCH_ENDPOINT.replace(/\/$/, "");
    env.VECTORS = { async query(vector, { topK }) {
      const h = cfg.AZURE_SEARCH_API_KEY ? { "api-key": cfg.AZURE_SEARCH_API_KEY } : { authorization: `Bearer ${await cfg.getToken("https://search.azure.com/.default")}` };
      const r = await post(`${sbase}/indexes/${cfg.AZURE_SEARCH_INDEX}/docs/search?api-version=${API}`, { select: "id,chunk_id", top: topK, vectorQueries: [{ kind: "vector", vector, fields: "embedding", k: topK }] }, h);
      return { matches: r.value.map((v) => ({ id: v.chunk_id ?? v.id, score: v["@search.score"] })) };
    } };
  }
  env.RATE_LIMITER = memoryLimiter(+(cfg.RATE_LIMIT_PER_MIN || 5));
  return env;
}
const safeJson = (s) => { try { return typeof s === "string" ? JSON.parse(s) : s || {}; } catch { return {}; } };
export function memoryLimiter(limit, periodMs = 60_000, now = () => Date.now()) {
  const hits = new Map();
  return { async limit({ key }) { const t = now(); const a = (hits.get(key) || []).filter((x) => t - x < periodMs); const ok = a.length < limit; if (ok) a.push(t); hits.set(key, a); return { success: ok }; } };
}
/** Picks the provider from environment variables: azure when AZURE_OPENAI_ENDPOINT is set, else local (BM25 + extractive, no model). */
export function envFromProcess(p, fetchImpl = fetch) {
  if (p.AZURE_OPENAI_ENDPOINT) return azureEnv({ ...p, getToken: managedIdentityToken(p, fetchImpl) }, fetchImpl);
  return { PROVIDER: "local", RATE_LIMITER: memoryLimiter(+(p.RATE_LIMIT_PER_MIN || 30)) };
}

/** Container Apps / App Service managed identity (IDENTITY_ENDPOINT + IDENTITY_HEADER). Tokens cached until 5 min before expiry. */
export function managedIdentityToken(p, fetchImpl = fetch, now = () => Date.now()) {
  const cache = new Map();
  return async (scope) => {
    const resource = scope.replace(/\/\.default$/, "");
    const c = cache.get(resource); if (c && c.exp - 300_000 > now()) return c.token;
    if (!p.IDENTITY_ENDPOINT || !p.IDENTITY_HEADER) throw new Error("no API key and no managed identity endpoint available");
    const r = await fetchImpl(`${p.IDENTITY_ENDPOINT}?resource=${encodeURIComponent(resource)}&api-version=2019-08-01`, { headers: { "X-IDENTITY-HEADER": p.IDENTITY_HEADER } });
    if (!r.ok) throw new Error(`managed identity ${r.status}`);
    const j = await r.json(); cache.set(resource, { token: j.access_token, exp: +j.expires_on * 1000 }); return j.access_token;
  };
}
