import type { ProjectConfig, ResourceInstance } from "./types";
import { envScope, sharedScope } from "./environments";

export interface StarterTemplate {
  id: string;
  label: string;
  description: string;
  icon: string;
  build: (config: ProjectConfig, makeId: () => string) => ResourceInstance[];
}

function named(prefix: string, suffix: string): string {
  const p = prefix.replace(/[^a-zA-Z0-9-]/g, "").toLowerCase();
  return p ? `${p}-${suffix}` : suffix;
}

function storageName(prefix: string): string {
  const p = prefix.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 16);
  return `${p || "st"}sa001`.slice(0, 24);
}

/** ACR names: 5–50 alphanumeric characters. */
function acrName(prefix: string): string {
  const p = prefix.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 40);
  const base = `${p || "acr"}registry`;
  return base.slice(0, 50);
}

export const STARTERS: StarterTemplate[] = [
  {
    id: "blank",
    label: "Blank",
    description: "Empty project — add resources yourself",
    icon: "⬜",
    build: () => [],
  },
  {
    id: "web-sql",
    label: "Web App + SQL",
    description: "Resource group, App Service plan, Linux web app, SQL server & database",
    icon: "🌐",
    build: (config, makeId) => {
      const rgId = makeId();
      const planId = makeId();
      const appId = makeId();
      const sqlId = makeId();
      const dbId = makeId();
      const p = config.namingPrefix;
      return [
        {
          id: rgId,
          type: "azurerm_resource_group",
          tfName: "main",
          useExisting: false,
          values: {
            name: named(p, "rg"),
            location: config.location,
            tags: { ...config.tags },
          },
          existingValues: {},
          scope: sharedScope(),
        },
        {
          id: planId,
          type: "azurerm_service_plan",
          tfName: "main",
          useExisting: false,
          values: {
            name: named(p, "asp"),
            resource_group_name: { resourceId: rgId, attr: "name" },
            location: { resourceId: rgId, attr: "location" },
            os_type: "Linux",
            sku_name: "B1",
            tags: { ...config.tags },
          },
          existingValues: {},
          scope: envScope("dev"),
        },
        {
          id: appId,
          type: "azurerm_linux_web_app",
          tfName: "main",
          useExisting: false,
          values: {
            name: named(p, "app"),
            resource_group_name: { resourceId: rgId, attr: "name" },
            location: { resourceId: rgId, attr: "location" },
            service_plan_id: { resourceId: planId, attr: "id" },
            https_only: true,
            node_version: "20-lts",
            tags: { ...config.tags },
          },
          existingValues: {},
          scope: envScope("dev"),
        },
        {
          id: sqlId,
          type: "azurerm_mssql_server",
          tfName: "main",
          useExisting: false,
          values: {
            name: named(p, "sql"),
            resource_group_name: { resourceId: rgId, attr: "name" },
            location: { resourceId: rgId, attr: "location" },
            version: "12.0",
            administrator_login: "sqladmin",
            administrator_login_password: "",
            minimum_tls_version: "1.2",
            tags: { ...config.tags },
          },
          existingValues: {},
          scope: envScope("dev"),
        },
        {
          id: dbId,
          type: "azurerm_mssql_database",
          tfName: "main",
          useExisting: false,
          values: {
            name: named(p, "sqldb"),
            server_id: { resourceId: sqlId, attr: "id" },
            sku_name: "Basic",
            max_size_gb: 2,
            collation: "SQL_Latin1_General_CP1_CI_AS",
            tags: { ...config.tags },
          },
          existingValues: {},
          scope: envScope("dev"),
        },
      ];
    },
  },
  {
    id: "storage-function",
    label: "Storage + Function App",
    description:
      "Shared RG + storage, Y1 Consumption plan + Linux Function App (Node 20) scoped to dev",
    icon: "⚡",
    build: (config, makeId) => {
      const rgId = makeId();
      const stId = makeId();
      const planId = makeId();
      const funcId = makeId();
      const p = config.namingPrefix;
      return [
        {
          id: rgId,
          type: "azurerm_resource_group",
          tfName: "main",
          useExisting: false,
          values: {
            name: named(p, "rg"),
            location: config.location,
            tags: { ...config.tags },
          },
          existingValues: {},
          scope: sharedScope(),
        },
        {
          id: stId,
          type: "azurerm_storage_account",
          tfName: "main",
          useExisting: false,
          values: {
            name: storageName(p),
            resource_group_name: { resourceId: rgId, attr: "name" },
            location: { resourceId: rgId, attr: "location" },
            account_tier: "Standard",
            account_replication_type: "LRS",
            account_kind: "StorageV2",
            min_tls_version: "TLS1_2",
            tags: { ...config.tags },
          },
          existingValues: {},
          scope: sharedScope(),
        },
        {
          id: planId,
          type: "azurerm_service_plan",
          tfName: "func",
          useExisting: false,
          values: {
            name: named(p, "asp-func"),
            resource_group_name: { resourceId: rgId, attr: "name" },
            location: { resourceId: rgId, attr: "location" },
            os_type: "Linux",
            sku_name: "Y1",
            tags: { ...config.tags },
          },
          existingValues: {},
          scope: envScope("dev"),
        },
        {
          id: funcId,
          type: "azurerm_linux_function_app",
          tfName: "main",
          useExisting: false,
          values: {
            name: named(p, "func"),
            resource_group_name: { resourceId: rgId, attr: "name" },
            location: { resourceId: rgId, attr: "location" },
            service_plan_id: { resourceId: planId, attr: "id" },
            storage_account_id: { resourceId: stId, attr: "id" },
            runtime_stack: "node",
            runtime_version: "20",
            https_only: true,
            public_network_access_enabled: true,
            app_settings: {},
            identity_type: "None",
            tags: { ...config.tags },
          },
          existingValues: {},
          scope: envScope("dev"),
        },
      ];
    },
  },
  {
    id: "vnet-vm",
    label: "VNet + VM",
    description: "Resource group, VNet, subnet, NSG, public IP, NIC, and Linux VM",
    icon: "💻",
    build: (config, makeId) => {
      const rgId = makeId();
      const vnetId = makeId();
      const subnetId = makeId();
      const nsgId = makeId();
      const assocId = makeId();
      const pipId = makeId();
      const nicId = makeId();
      const vmId = makeId();
      const p = config.namingPrefix;
      return [
        {
          id: rgId,
          type: "azurerm_resource_group",
          tfName: "main",
          useExisting: false,
          values: {
            name: named(p, "rg"),
            location: config.location,
            tags: { ...config.tags },
          },
          existingValues: {},
          scope: sharedScope(),
        },
        {
          id: vnetId,
          type: "azurerm_virtual_network",
          tfName: "main",
          useExisting: false,
          values: {
            name: named(p, "vnet"),
            resource_group_name: { resourceId: rgId, attr: "name" },
            location: { resourceId: rgId, attr: "location" },
            address_space: ["10.0.0.0/16"],
            tags: { ...config.tags },
          },
          existingValues: {},
          scope: sharedScope(),
        },
        {
          id: subnetId,
          type: "azurerm_subnet",
          tfName: "default",
          useExisting: false,
          values: {
            name: "default",
            resource_group_name: { resourceId: rgId, attr: "name" },
            virtual_network_name: { resourceId: vnetId, attr: "name" },
            address_prefixes: ["10.0.1.0/24"],
          },
          existingValues: {},
          scope: sharedScope(),
        },
        {
          id: nsgId,
          type: "azurerm_network_security_group",
          tfName: "main",
          useExisting: false,
          values: {
            name: named(p, "nsg"),
            resource_group_name: { resourceId: rgId, attr: "name" },
            location: { resourceId: rgId, attr: "location" },
            allow_ssh: true,
            allow_http: false,
            allow_https: false,
            tags: { ...config.tags },
          },
          existingValues: {},
          scope: sharedScope(),
        },
        {
          id: assocId,
          type: "azurerm_subnet_network_security_group_association",
          tfName: "main",
          useExisting: false,
          values: {
            subnet_id: { resourceId: subnetId, attr: "id" },
            network_security_group_id: { resourceId: nsgId, attr: "id" },
          },
          existingValues: {},
          scope: sharedScope(),
        },
        {
          id: pipId,
          type: "azurerm_public_ip",
          tfName: "main",
          useExisting: false,
          values: {
            name: named(p, "pip"),
            resource_group_name: { resourceId: rgId, attr: "name" },
            location: { resourceId: rgId, attr: "location" },
            allocation_method: "Static",
            sku: "Standard",
            tags: { ...config.tags },
          },
          existingValues: {},
          scope: sharedScope(),
        },
        {
          id: nicId,
          type: "azurerm_network_interface",
          tfName: "main",
          useExisting: false,
          values: {
            name: named(p, "nic"),
            resource_group_name: { resourceId: rgId, attr: "name" },
            location: { resourceId: rgId, attr: "location" },
            subnet_id: { resourceId: subnetId, attr: "id" },
            public_ip_address_id: { resourceId: pipId, attr: "id" },
            tags: { ...config.tags },
          },
          existingValues: {},
          scope: sharedScope(),
        },
        {
          id: vmId,
          type: "azurerm_linux_virtual_machine",
          tfName: "main",
          useExisting: false,
          values: {
            name: named(p, "vm"),
            resource_group_name: { resourceId: rgId, attr: "name" },
            location: { resourceId: rgId, attr: "location" },
            size: "Standard_B2s",
            admin_username: "azureuser",
            admin_ssh_public_key: "",
            network_interface_ids: { resourceId: nicId, attr: "id" },
            os_disk_caching: "ReadWrite",
            os_disk_storage_account_type: "Standard_LRS",
            source_image_publisher: "Canonical",
            source_image_offer: "0001-com-ubuntu-server-jammy",
            source_image_sku: "22_04-lts-gen2",
            source_image_version: "latest",
            tags: { ...config.tags },
          },
          existingValues: {},
          scope: envScope("dev"),
        },
      ];
    },
  },
  {
    id: "acr-container-apps",
    label: "ACR + Container Apps",
    description:
      "Shared foundation (RG, VNet, ACR, MI, KV, LAW, CAE) + a Container App scoped to the dev environment (duplicate for staging/prod as needed)",
    icon: "🐳",
    build: (config, makeId) => {
      const rgId = makeId();
      const vnetId = makeId();
      const subnetId = makeId();
      const acrId = makeId();
      const uaiId = makeId();
      const roleId = makeId();
      const kvId = makeId();
      const roleKvId = makeId();
      const lawId = makeId();
      const envId = makeId();
      const appId = makeId();
      const p = config.namingPrefix;
      return [
        {
          id: rgId,
          type: "azurerm_resource_group",
          tfName: "main",
          useExisting: false,
          values: {
            name: named(p, "rg"),
            location: config.location,
            tags: { ...config.tags },
          },
          existingValues: {},
          scope: sharedScope(),
        },
        {
          id: vnetId,
          type: "azurerm_virtual_network",
          tfName: "main",
          useExisting: false,
          values: {
            name: named(p, "vnet"),
            resource_group_name: { resourceId: rgId, attr: "name" },
            location: { resourceId: rgId, attr: "location" },
            // /16 leaves room for a /21 CAE subnet
            address_space: ["10.0.0.0/16"],
            tags: { ...config.tags },
          },
          existingValues: {},
          scope: sharedScope(),
        },
        {
          id: subnetId,
          type: "azurerm_subnet",
          tfName: "cae",
          useExisting: false,
          values: {
            name: "snet-cae",
            resource_group_name: { resourceId: rgId, attr: "name" },
            virtual_network_name: { resourceId: vnetId, attr: "name" },
            // azurerm 4.x docs often require /21+ for infrastructure_subnet_id
            address_prefixes: ["10.0.0.0/21"],
            delegation: "Microsoft.App/environments",
          },
          existingValues: {},
          scope: sharedScope(),
        },
        {
          id: acrId,
          type: "azurerm_container_registry",
          tfName: "main",
          useExisting: false,
          values: {
            name: acrName(p),
            resource_group_name: { resourceId: rgId, attr: "name" },
            location: { resourceId: rgId, attr: "location" },
            sku: "Basic",
            admin_enabled: false,
            public_network_access_enabled: true,
            tags: { ...config.tags },
          },
          existingValues: {},
          scope: sharedScope(),
        },
        {
          id: uaiId,
          type: "azurerm_user_assigned_identity",
          tfName: "acrpull",
          useExisting: false,
          values: {
            name: named(p, "id-acrpull"),
            resource_group_name: { resourceId: rgId, attr: "name" },
            location: { resourceId: rgId, attr: "location" },
            tags: { ...config.tags },
          },
          existingValues: {},
          scope: sharedScope(),
        },
        {
          id: roleId,
          type: "azurerm_role_assignment",
          tfName: "acr_pull",
          useExisting: false,
          values: {
            scope: { resourceId: acrId, attr: "id" },
            role_definition_name: "AcrPull",
            principal_id: { resourceId: uaiId, attr: "principal_id" },
          },
          existingValues: {},
          scope: sharedScope(),
        },
        {
          id: kvId,
          type: "azurerm_key_vault",
          tfName: "main",
          useExisting: false,
          values: {
            name: named(p, "kv"),
            resource_group_name: { resourceId: rgId, attr: "name" },
            location: { resourceId: rgId, attr: "location" },
            sku_name: "standard",
            soft_delete_retention_days: 7,
            purge_protection_enabled: false,
            enable_rbac_authorization: true,
            tags: { ...config.tags },
          },
          existingValues: {},
          scope: sharedScope(),
        },
        {
          id: roleKvId,
          type: "azurerm_role_assignment",
          tfName: "kv_secrets_user",
          useExisting: false,
          values: {
            scope: { resourceId: kvId, attr: "id" },
            role_definition_name: "Key Vault Secrets User",
            principal_id: { resourceId: uaiId, attr: "principal_id" },
          },
          existingValues: {},
          scope: sharedScope(),
        },
        {
          id: lawId,
          type: "azurerm_log_analytics_workspace",
          tfName: "main",
          useExisting: false,
          values: {
            name: named(p, "log"),
            resource_group_name: { resourceId: rgId, attr: "name" },
            location: { resourceId: rgId, attr: "location" },
            sku: "PerGB2018",
            retention_in_days: 30,
            tags: { ...config.tags },
          },
          existingValues: {},
          scope: sharedScope(),
        },
        {
          id: envId,
          type: "azurerm_container_app_environment",
          tfName: "main",
          useExisting: false,
          values: {
            name: named(p, "cae"),
            resource_group_name: { resourceId: rgId, attr: "name" },
            location: { resourceId: rgId, attr: "location" },
            log_analytics_workspace_id: { resourceId: lawId, attr: "id" },
            infrastructure_subnet_id: { resourceId: subnetId, attr: "id" },
            internal_load_balancer_enabled: false,
            zone_redundancy_enabled: false,
            tags: { ...config.tags },
          },
          existingValues: {},
          scope: sharedScope(),
        },
        {
          id: appId,
          type: "azurerm_container_app",
          tfName: "app",
          useExisting: false,
          values: {
            name: named(p, "ca"),
            resource_group_name: { resourceId: rgId, attr: "name" },
            container_app_environment_id: { resourceId: envId, attr: "id" },
            revision_mode: "Single",
            container_name: "app",
            container_image: "mcr.microsoft.com/k8se/quickstart:latest",
            container_cpu: "0.25",
            container_memory: "0.5Gi",
            min_replicas: 0,
            max_replicas: 3,
            ingress_enabled: true,
            ingress_target_port: 80,
            ingress_transport: "auto",
            container_registry_id: { resourceId: acrId, attr: "id" },
            acr_auth_mode: "managed_identity",
            identity_type: "UserAssigned",
            user_assigned_identity_id: { resourceId: uaiId, attr: "id" },
            env_vars: [
              { name: "ASPNETCORE_ENVIRONMENT", value: "Production" },
              { name: "DB_PASSWORD", secret_name: "db-password" },
            ],
            app_secrets: [
              {
                name: "db-password",
                source: "key_vault",
                key_vault_id: { resourceId: kvId, attr: "id" },
                secret_name: "db-password",
              },
            ],
            http_scale_enabled: true,
            http_concurrent_requests: 10,
            tags: { ...config.tags },
          },
          existingValues: {},
          scope: envScope("dev"),
        },
      ];
    },
  },

  {
    id: "private-acr",
    label: "Private ACR",
    description:
      "Shared VNet + PE subnet + Premium ACR (public access off) + private endpoint + hub Private DNS (Use existing) + VNet link + MI/AcrPull. Optional CAE/app not included — add from catalogue or merge with ACR + Container Apps.",
    icon: "🔐",
    build: (config, makeId) => {
      const rgId = makeId();
      const vnetId = makeId();
      const peSubnetId = makeId();
      const acrId = makeId();
      const dnsId = makeId();
      const linkId = makeId();
      const peId = makeId();
      const uaiId = makeId();
      const roleId = makeId();
      const p = config.namingPrefix;
      return [
        {
          id: rgId,
          type: "azurerm_resource_group",
          tfName: "main",
          useExisting: false,
          values: {
            name: named(p, "rg"),
            location: config.location,
            tags: { ...config.tags },
          },
          existingValues: {},
          scope: sharedScope(),
        },
        {
          id: vnetId,
          type: "azurerm_virtual_network",
          tfName: "main",
          useExisting: false,
          values: {
            name: named(p, "vnet"),
            resource_group_name: { resourceId: rgId, attr: "name" },
            location: { resourceId: rgId, attr: "location" },
            address_space: ["10.0.0.0/16"],
            tags: { ...config.tags },
          },
          existingValues: {},
          scope: sharedScope(),
        },
        {
          id: peSubnetId,
          type: "azurerm_subnet",
          tfName: "private_endpoints",
          useExisting: false,
          values: {
            name: "snet-pe",
            resource_group_name: { resourceId: rgId, attr: "name" },
            virtual_network_name: { resourceId: vnetId, attr: "name" },
            address_prefixes: ["10.0.8.0/24"],
            delegation: "",
          },
          existingValues: {},
          scope: sharedScope(),
        },
        {
          id: acrId,
          type: "azurerm_container_registry",
          tfName: "main",
          useExisting: false,
          values: {
            name: acrName(p),
            resource_group_name: { resourceId: rgId, attr: "name" },
            location: { resourceId: rgId, attr: "location" },
            sku: "Premium",
            admin_enabled: false,
            public_network_access_enabled: false,
            tags: { ...config.tags },
          },
          existingValues: {},
          scope: sharedScope(),
        },
        {
          id: dnsId,
          type: "azurerm_private_dns_zone",
          tfName: "acr",
          useExisting: true,
          values: {
            name: "privatelink.azurecr.io",
            resource_group_name: "rg-hub-dns",
            tags: { ...config.tags },
          },
          existingValues: {
            name: "privatelink.azurecr.io",
            resource_group_name: "rg-hub-dns",
          },
          scope: sharedScope(),
        },
        {
          id: linkId,
          type: "azurerm_private_dns_zone_virtual_network_link",
          tfName: "acr",
          useExisting: false,
          values: {
            name: named(p, "dns-link-acr"),
            resource_group_name: "rg-hub-dns",
            private_dns_zone_name: { resourceId: dnsId, attr: "name" },
            virtual_network_id: { resourceId: vnetId, attr: "id" },
            registration_enabled: false,
            tags: { ...config.tags },
          },
          existingValues: {},
          scope: sharedScope(),
        },
        {
          id: peId,
          type: "azurerm_private_endpoint",
          tfName: "acr",
          useExisting: false,
          values: {
            name: named(p, "pe-acr"),
            resource_group_name: { resourceId: rgId, attr: "name" },
            location: { resourceId: rgId, attr: "location" },
            subnet_id: { resourceId: peSubnetId, attr: "id" },
            private_connection_resource_id: { resourceId: acrId, attr: "id" },
            subresource_names: "registry",
            private_connection_name: "psc-acr",
            is_manual_connection: false,
            private_dns_zone_id: { resourceId: dnsId, attr: "id" },
            tags: { ...config.tags },
          },
          existingValues: {},
          scope: sharedScope(),
        },
        {
          id: uaiId,
          type: "azurerm_user_assigned_identity",
          tfName: "acrpull",
          useExisting: false,
          values: {
            name: named(p, "id-acrpull"),
            resource_group_name: { resourceId: rgId, attr: "name" },
            location: { resourceId: rgId, attr: "location" },
            tags: { ...config.tags },
          },
          existingValues: {},
          scope: sharedScope(),
        },
        {
          id: roleId,
          type: "azurerm_role_assignment",
          tfName: "acr_pull",
          useExisting: false,
          values: {
            scope: { resourceId: acrId, attr: "id" },
            role_definition_name: "AcrPull",
            principal_id: { resourceId: uaiId, attr: "principal_id" },
          },
          existingValues: {},
          scope: sharedScope(),
        },
      ];
    },
  },

];

export function getStarter(id: string): StarterTemplate | undefined {
  return STARTERS.find((s) => s.id === id);
}
