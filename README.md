# RAG Assistant: Azure-ready port

> **No Azure account is connected.** This repo has not been deployed to Azure. The Bicep and Terraform are validated offline, and the Azure adapter is tested against recorded request/response shapes, not a live subscription. The live demo below runs on Cloudflare in local mode (BM25 + extractive answers, no model).

A port of [braylo-si-rag](https://github.com/braylo777/braylo-si-rag) (the Braylo SI assistant: hybrid retrieval, tool calls, guardrails, evals and tracing) so it runs on three targets **with the agent code unchanged**:

| Target | How | Status |
| --- | --- | --- |
| Local / Docker | `node server/node.mjs` or `docker build . && docker run -p 8080:8080` | ✅ runs (BM25 + extractive) |
| Cloudflare Workers | `npm run build` → `dist/worker.js` | ✅ live: https://rag-assistant-azure.braylo777.workers.dev |
| Azure Container Apps + Azure OpenAI + AI Search | `infra/bicep` or `infra/terraform`, runbook in [docs/DEPLOY-AZURE.md](docs/DEPLOY-AZURE.md) | ⏳ ready, not deployed (no account) |

## How the port works
The agent talks to `env.AI.run`, `env.VECTORS.query` and `env.RATE_LIMITER.limit`. `src/adapters/azure.js` implements that same interface on Azure OpenAI (chat with function calling, embeddings at 768 dims) and Azure AI Search (vector query), so retrieval, tools, guards and tracing are shared code. `server/node.mjs` runs the Worker's `fetch` handler on Node for containers. Auth is keyless by default (managed identity, tokens cached); API keys work for local testing via environment variables and are never committed.

## Tests
`npm test`: 35 tests. 25 come from the original assistant; 10 are new Azure tests covering request shapes and api-version, sanitized search keys mapped back to chunk ids, the full agent path (hybrid retrieval → tool call → answer) on Azure, guards blocking injection before any Azure call, fallback to extractive on Azure 429 without leaking keys, managed-identity token caching, provider selection, rate limiting and the index schema.

Infra checks: `bicep build infra/bicep/main.bicep` (9 resources) and `bicep lint` are clean, and `terraform validate` passes.

Known upstream issue, carried over unchanged: the scope guard treats "What tiers do you offer?" as off-topic because its keyword regex matches "tier" but not "tiers". It will be fixed upstream first.

Deploys and rollback points: [DEPLOYS.md](DEPLOYS.md).
