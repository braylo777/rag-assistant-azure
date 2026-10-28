# Deploying to Azure

> **Status: not deployed to Azure.** No Azure account or subscription is connected to this project. The templates are validated offline (`bicep build`, `bicep lint`, `terraform validate`) and the Azure adapter is tested against recorded request/response shapes. Everything below is the runbook for whoever deploys it with their own subscription.

## What gets created
| Resource | Why |
| --- | --- |
| Azure Container Apps (env + app, scale 0–3) | Runs `server/node.mjs`, the same request handler used on Cloudflare |
| Azure OpenAI (`chat` = gpt-4o-mini, `embed` = text-embedding-3-small @ 768 dims) | Generation, tool calls and query embeddings |
| Azure AI Search (Basic, HNSW cosine index `braylo-si-kb`) | Vector half of hybrid retrieval (BM25 stays in-process) |
| Log Analytics | Container logs |
| Role assignments | App's managed identity gets *Cognitive Services OpenAI User* and *Search Index Data Reader* |

Keyless by design: `disableLocalAuth` is on for OpenAI and Search, so there are no API keys to leak. The app gets tokens from its managed identity.

## Steps (Bicep)
```bash
az login && az account set -s <subscription>
az group create -n braylo-rag -l eastus2
# 1. Build and push the image (any registry the app can pull from)
docker build -t ghcr.io/<you>/rag-assistant-azure:1.0.0 . && docker push ghcr.io/<you>/rag-assistant-azure:1.0.0
# 2. Preview, then deploy
az deployment group what-if  -g braylo-rag -f infra/bicep/main.bicep -p image=ghcr.io/<you>/rag-assistant-azure:1.0.0
az deployment group create   -g braylo-rag -f infra/bicep/main.bicep -p image=ghcr.io/<you>/rag-assistant-azure:1.0.0
# 3. Index the knowledge base (grant yourself Search Index Data Contributor + OpenAI User first)
export AZURE_ACCESS_TOKEN_SEARCH=$(az account get-access-token --resource https://search.azure.com --query accessToken -o tsv)
export AZURE_ACCESS_TOKEN_COGNITIVE=$(az account get-access-token --resource https://cognitiveservices.azure.com --query accessToken -o tsv)
AZURE_OPENAI_ENDPOINT=... AZURE_OPENAI_CHAT_DEPLOYMENT=chat AZURE_OPENAI_EMBED_DEPLOYMENT=embed \
AZURE_SEARCH_ENDPOINT=https://<search>.search.windows.net AZURE_SEARCH_INDEX=braylo-si-kb node scripts/index-azure-search.mjs
# 4. Smoke test
curl https://<app-fqdn>/api/health        # provider: "azure", ai: true, vectors: true
```
Terraform: `cd infra/terraform && terraform init && terraform plan -var image=... && terraform apply -var image=...`.

## Rollback
- Container Apps keeps revisions: `az containerapp revision list` then `az containerapp ingress traffic set --revision-weight <previous>=100`.
- Infrastructure: re-deploy the previous template version from git; `what-if` before every change.

## Cost notes (pay-as-you-go, check current pricing)
Container Apps can scale to zero. AI Search Basic is the fixed cost. OpenAI is per token. Set a budget alert on the resource group before deploying.

## Mapping from Cloudflare
| Cloudflare | Azure |
| --- | --- |
| Workers | Container Apps (Node server wrapping the same `fetch` handler) |
| Workers AI (Llama 3.3 70B, bge-base 768-d) | Azure OpenAI (gpt-4o-mini, text-embedding-3-small at 768-d) |
| Vectorize | Azure AI Search vector index |
| KV traces | In-memory ring (Application Insights is the next step) |
| Rate Limiting binding | In-memory limiter per replica |
