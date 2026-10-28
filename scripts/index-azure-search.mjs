// Creates the Azure AI Search index and uploads KB chunks with Azure OpenAI embeddings.
// Usage: node scripts/index-azure-search.mjs [--dry-run]   (dry run prints the index schema and first payload; no network)
// Needs AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_EMBED_DEPLOYMENT, AZURE_SEARCH_ENDPOINT, AZURE_SEARCH_INDEX and either
// API keys in env (local only, never committed) or an Entra token via AZURE_ACCESS_TOKEN_* from `az account get-access-token`.
import { KB } from "../src/kb.js";
export const INDEX_SCHEMA = (name) => ({
  name,
  fields: [
    { name: "id", type: "Edm.String", key: true, filterable: true },
    { name: "chunk_id", type: "Edm.String", filterable: true },
    { name: "doc", type: "Edm.String", filterable: true },
    { name: "source", type: "Edm.String", filterable: true },
    { name: "text", type: "Edm.String", searchable: true },
    { name: "embedding", type: "Collection(Edm.Single)", searchable: true, dimensions: 768, vectorSearchProfile: "hnsw-cosine" },
  ],
  vectorSearch: { algorithms: [{ name: "hnsw", kind: "hnsw", hnswParameters: { metric: "cosine" } }], profiles: [{ name: "hnsw-cosine", algorithm: "hnsw" }] },
});
export const docKey = (id) => id.replace(/[^A-Za-z0-9_\-=]/g, "_"); // Azure Search keys allow letters, digits, _ - =
if (import.meta.url === `file://${process.argv[1]}`) {
  const dry = process.argv.includes("--dry-run"), index = process.env.AZURE_SEARCH_INDEX || "braylo-si-kb";
  if (dry) { console.log(JSON.stringify({ schema: INDEX_SCHEMA(index), chunks: KB.chunks.length, firstDoc: { "@search.action": "mergeOrUpload", id: docKey(KB.chunks[0].id), chunk_id: KB.chunks[0].id, doc: KB.chunks[0].doc, text: KB.chunks[0].text.slice(0, 80) + "…", embedding: "[768 floats]" } }, null, 2)); process.exit(0); }
  const { azureEnv } = await import("../src/adapters/azure.js");
  const p = process.env; const env = azureEnv({ ...p, getToken: async (s) => (s.includes("search") ? p.AZURE_ACCESS_TOKEN_SEARCH : p.AZURE_ACCESS_TOKEN_COGNITIVE) });
  const sh = p.AZURE_SEARCH_API_KEY ? { "api-key": p.AZURE_SEARCH_API_KEY } : { authorization: `Bearer ${p.AZURE_ACCESS_TOKEN_SEARCH}` };
  const base = p.AZURE_SEARCH_ENDPOINT.replace(/\/$/, ""), v = "api-version=2024-07-01";
  let r = await fetch(`${base}/indexes/${index}?${v}`, { method: "PUT", headers: { "content-type": "application/json", ...sh }, body: JSON.stringify(INDEX_SCHEMA(index)) });
  if (!r.ok) throw new Error(`index ${r.status}`);
  for (let i = 0; i < KB.chunks.length; i += 16) {
    const batch = KB.chunks.slice(i, i + 16); const e = await env.AI.run("embed", { text: batch.map((c) => c.text) });
    r = await fetch(`${base}/indexes/${index}/docs/index?${v}`, { method: "POST", headers: { "content-type": "application/json", ...sh }, body: JSON.stringify({ value: batch.map((c, j) => ({ "@search.action": "mergeOrUpload", id: docKey(c.id), chunk_id: c.id, doc: c.doc, source: c.source, text: c.text, embedding: e.data[j] })) }) });
    if (!r.ok) throw new Error(`upload ${r.status}`); console.log(`uploaded ${i + batch.length}/${KB.chunks.length}`);
  }
}
