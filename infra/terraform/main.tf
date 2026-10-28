# Terraform equivalent of infra/bicep/main.bicep. NOT APPLIED: no Azure account is connected. Validated with `terraform validate`.
terraform {
  required_version = ">= 1.6"
  required_providers {
    azurerm = { source = "hashicorp/azurerm", version = "~> 4.0" }
    random  = { source = "hashicorp/random", version = "~> 3.6" }
  }
}
provider "azurerm" {
  features {}
}

variable "prefix" {
  type    = string
  default = "braylorag"
}
variable "location" {
  type    = string
  default = "eastus2"
}
variable "image" {
  type        = string
  description = "Container image, e.g. ghcr.io/braylo777/rag-assistant-azure:1.0.0"
}
variable "chat_model" {
  type    = string
  default = "gpt-4o-mini"
}
variable "chat_model_version" {
  type    = string
  default = "2024-07-18"
}
variable "embed_model" {
  type    = string
  default = "text-embedding-3-small"
}

resource "random_string" "s" {
  length  = 6
  upper   = false
  special = false
}
locals { n = "${var.prefix}-${random_string.s.result}" }

resource "azurerm_resource_group" "rg" {
  name     = "${local.n}-rg"
  location = var.location
}
resource "azurerm_log_analytics_workspace" "logs" {
  name                = "${local.n}-logs"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
}
resource "azurerm_cognitive_account" "aoai" {
  name                  = "${local.n}-aoai"
  location              = azurerm_resource_group.rg.location
  resource_group_name   = azurerm_resource_group.rg.name
  kind                  = "OpenAI"
  sku_name              = "S0"
  custom_subdomain_name = "${local.n}-aoai"
  local_auth_enabled    = false
}
resource "azurerm_cognitive_deployment" "chat" {
  name                 = "chat"
  cognitive_account_id = azurerm_cognitive_account.aoai.id
  model {
    format  = "OpenAI"
    name    = var.chat_model
    version = var.chat_model_version
  }
  sku {
    name     = "GlobalStandard"
    capacity = 10
  }
}
resource "azurerm_cognitive_deployment" "embed" {
  name                 = "embed"
  cognitive_account_id = azurerm_cognitive_account.aoai.id
  model {
    format  = "OpenAI"
    name    = var.embed_model
    version = "1"
  }
  sku {
    name     = "Standard"
    capacity = 10
  }
  depends_on = [azurerm_cognitive_deployment.chat]
}
resource "azurerm_search_service" "search" {
  name                         = "${local.n}-search"
  location                     = azurerm_resource_group.rg.location
  resource_group_name          = azurerm_resource_group.rg.name
  sku                          = "basic"
  local_authentication_enabled = false
}
resource "azurerm_container_app_environment" "env" {
  name                       = "${local.n}-env"
  location                   = azurerm_resource_group.rg.location
  resource_group_name        = azurerm_resource_group.rg.name
  log_analytics_workspace_id = azurerm_log_analytics_workspace.logs.id
}
resource "azurerm_container_app" "app" {
  name                         = "${var.prefix}-app"
  container_app_environment_id = azurerm_container_app_environment.env.id
  resource_group_name          = azurerm_resource_group.rg.name
  revision_mode                = "Single"
  identity { type = "SystemAssigned" }
  ingress {
    external_enabled = true
    target_port      = 8080
    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }
  template {
    min_replicas = 0
    max_replicas = 3
    container {
      name   = "api"
      image  = var.image
      cpu    = 0.5
      memory = "1Gi"
      env {
        name  = "AZURE_OPENAI_ENDPOINT"
        value = azurerm_cognitive_account.aoai.endpoint
      }
      env {
        name  = "AZURE_OPENAI_CHAT_DEPLOYMENT"
        value = azurerm_cognitive_deployment.chat.name
      }
      env {
        name  = "AZURE_OPENAI_EMBED_DEPLOYMENT"
        value = azurerm_cognitive_deployment.embed.name
      }
      env {
        name  = "AZURE_SEARCH_ENDPOINT"
        value = "https://${azurerm_search_service.search.name}.search.windows.net"
      }
      env {
        name  = "AZURE_SEARCH_INDEX"
        value = "braylo-si-kb"
      }
      liveness_probe {
        transport = "HTTP"
        path      = "/api/health"
        port      = 8080
      }
    }
  }
}
resource "azurerm_role_assignment" "openai_user" {
  scope                = azurerm_cognitive_account.aoai.id
  role_definition_name = "Cognitive Services OpenAI User"
  principal_id         = azurerm_container_app.app.identity[0].principal_id
}
resource "azurerm_role_assignment" "search_reader" {
  scope                = azurerm_search_service.search.id
  role_definition_name = "Search Index Data Reader"
  principal_id         = azurerm_container_app.app.identity[0].principal_id
}
output "url" { value = "https://${azurerm_container_app.app.ingress[0].fqdn}" }
