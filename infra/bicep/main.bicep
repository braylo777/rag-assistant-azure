// Azure deployment for the RAG assistant: Container App (Node server) + Azure OpenAI + Azure AI Search + Log Analytics.
// Auth is keyless: the Container App's system-assigned managed identity gets data-plane roles. No secrets in templates.
// NOT DEPLOYED: no Azure account is connected to this project. Validated with `bicep build` only.
targetScope = 'resourceGroup'

@description('Short name prefix, lowercase letters/numbers.')
@minLength(3)
@maxLength(12)
param prefix string = 'braylorag'
param location string = resourceGroup().location
@description('Container image, e.g. ghcr.io/braylo777/rag-assistant-azure:1.0.0')
param image string
param chatModel string = 'gpt-4o-mini'
param chatModelVersion string = '2024-07-18'
param embedModel string = 'text-embedding-3-small'
param embedModelVersion string = '1'
@minValue(0)
param minReplicas int = 0
@maxValue(10)
param maxReplicas int = 3

var suffix = uniqueString(resourceGroup().id)
var searchIndex = 'braylo-si-kb'

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${prefix}-logs-${suffix}'
  location: location
  properties: { sku: { name: 'PerGB2018' }, retentionInDays: 30 }
}

resource openai 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: '${prefix}-aoai-${suffix}'
  location: location
  kind: 'OpenAI'
  sku: { name: 'S0' }
  properties: { customSubDomainName: '${prefix}-aoai-${suffix}', publicNetworkAccess: 'Enabled', disableLocalAuth: true }
}

resource chat 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: openai
  name: 'chat'
  sku: { name: 'GlobalStandard', capacity: 10 }
  properties: { model: { format: 'OpenAI', name: chatModel, version: chatModelVersion } }
}

resource embed 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: openai
  name: 'embed'
  sku: { name: 'Standard', capacity: 10 }
  properties: { model: { format: 'OpenAI', name: embedModel, version: embedModelVersion } }
  dependsOn: [ chat ]
}

resource search 'Microsoft.Search/searchServices@2023-11-01' = {
  name: '${prefix}-search-${suffix}'
  location: location
  sku: { name: 'basic' }
  properties: { replicaCount: 1, partitionCount: 1, disableLocalAuth: true }
}

resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${prefix}-env-${suffix}'
  location: location
  properties: { appLogsConfiguration: { destination: 'log-analytics', logAnalyticsConfiguration: { customerId: logs.properties.customerId, sharedKey: logs.listKeys().primarySharedKey } } }
}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${prefix}-app'
  location: location
  identity: { type: 'SystemAssigned' }
  properties: {
    managedEnvironmentId: env.id
    configuration: { ingress: { external: true, targetPort: 8080, transport: 'auto' } }
    template: {
      containers: [ {
        name: 'api'
        image: image
        resources: { cpu: json('0.5'), memory: '1Gi' }
        env: [
          { name: 'AZURE_OPENAI_ENDPOINT', value: openai.properties.endpoint }
          { name: 'AZURE_OPENAI_CHAT_DEPLOYMENT', value: chat.name }
          { name: 'AZURE_OPENAI_EMBED_DEPLOYMENT', value: embed.name }
          { name: 'AZURE_SEARCH_ENDPOINT', value: 'https://${search.name}.search.windows.net' }
          { name: 'AZURE_SEARCH_INDEX', value: searchIndex }
          { name: 'AZURE_USE_MANAGED_IDENTITY', value: 'true' }
        ]
        probes: [ { type: 'Liveness', httpGet: { path: '/api/health', port: 8080 } } ]
      } ]
      scale: { minReplicas: minReplicas, maxReplicas: maxReplicas }
    }
  }
}

// Data-plane roles for the app's managed identity (built-in role definition ids).
var openaiUser = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd' // Cognitive Services OpenAI User
var searchReader = '1407120a-92aa-4202-b7e9-c0e197c71c8f' // Search Index Data Reader
resource r1 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(openai.id, app.id, openaiUser)
  scope: openai
  properties: { principalId: app.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', openaiUser) }
}
resource r2 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(search.id, app.id, searchReader)
  scope: search
  properties: { principalId: app.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', searchReader) }
}

output url string = 'https://${app.properties.configuration.ingress.fqdn}'
output searchService string = search.name
output openaiEndpoint string = openai.properties.endpoint
