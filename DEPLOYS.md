# Deploys

No Azure deployments: no Azure account is connected.

| When (CT) | Target | Worker version | Deployment | Rollback point |
| --- | --- | --- | --- | --- |
| 2026-10-28 10:03 | Cloudflare (local mode) | 62d03dd5-1985-4b4d-aa04-ff77b5e74683 | e2b14617-a170-4d36-ae91-bdb7af964c37 | First deploy. To take it offline without deleting, disable the workers.dev route; later deploys roll back to this version id. The original braylo-si-rag worker is untouched. |

Post-deploy check (10:03 CT): `/api/health` shows provider local and azure_account_connected false; `/api/chat` answers extractively with citations; `/` 200.
