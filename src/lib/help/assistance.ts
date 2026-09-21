export interface HelpEntry {
  title: string;
  summary: string;
  whenToUse: string;
  security: string[];
  tips: string[];
}

export const RESOURCE_ASSISTANCE: Record<string, HelpEntry> = {
  azurerm_resource_group: {
    title: 'Resource Group',
    summary: 'A container for Azure resources in one region and one subscription scope.',
    whenToUse: 'Create it first for most environments so networking, storage, and apps share a common parent.',
    security: ['Keep production workloads grouped by purpose and ownership.', 'Use tags to track cost, owner, and environment.'],
    tips: ['Create one shared or environment-scoped group per app layer.', 'Use consistent naming so exports stay readable.'],
  },
  azurerm_virtual_network: {
    title: 'Virtual Network',
    summary: 'The private network boundary for compute and services in your environment.',
    whenToUse: 'Use it whenever workloads need private network connectivity or VNet-based integrations.',
    security: ['Place workloads behind private access boundaries when possible.', 'Limit public exposure to only required front doors.'],
    tips: ['Plan address ranges carefully; avoid overlap between environments.', 'Use private endpoints for data-plane access to managed services.'],
  },
  azurerm_subnet: {
    title: 'Subnet',
    summary: 'A segmented slice inside the Virtual Network, used for workload isolation and delegation.',
    whenToUse: 'Create subnets for app tiers, private endpoints, or delegated Container App infrastructure.',
    security: ['Limit routing and NSG exposure per subnet.', 'Prefer dedicated subnets for ingress, data, and private endpoints.'],
    tips: ['Use delegation for Container App Environments when needed.', 'Keep naming stable and role-specific.'],
  },
  azurerm_network_security_group: {
    title: 'Network Security Group',
    summary: 'Firewall-like rules that guard inbound and outbound traffic at the subnet or NIC level.',
    whenToUse: 'Use it when you need controlled ingress for app or admin traffic, or stricter private network boundaries.',
    security: ['Deny by default and explicitly allow only required ports.', 'Avoid exposing management ports unnecessarily.'],
    tips: ['Prefer private access for production services.', 'Review rules regularly as workloads change.'],
  },
  azurerm_public_ip: {
    title: 'Public IP',
    summary: 'A public-facing endpoint that allows inbound access to a load balancer, firewall, or app gateway.',
    whenToUse: 'Use it only for entry points that must be public, such as front-door or admin access.',
    security: ['Keep it limited to the minimum required scope.', 'Pair it with network controls and monitoring.'],
    tips: ['Prefer private alternatives for most internal workloads.', 'Use DNS and certificates instead of exposing raw endpoints.'],
  },
  azurerm_private_dns_zone: {
    title: 'Private DNS Zone',
    summary: 'Private name resolution for services reachable through your VNet and private endpoints.',
    whenToUse: 'Use this for shared hub DNS, private endpoints, and internal service discovery.',
    security: ['Avoid broad public exposure by keeping resolution private.', 'Only allow required VNet links and owners.'],
    tips: ['Shared hub DNS is useful when multiple environments rely on the same platform services.', 'Prefer Existing when an existing shared zone already exists.'],
  },
  azurerm_private_endpoint: {
    title: 'Private Endpoint',
    summary: 'Private IP access path to a platform service such as Key Vault, Storage, or SQL.',
    whenToUse: 'Use it to give workloads private access without exposing services to the public internet.',
    security: ['Lock access to private IPs and restrict public network access.', 'Review private DNS integration for service resolution.'],
    tips: ['Choose Shared for hub-style platform services, or Environment for isolated private access.', 'Verify all required DNS records exist before rollout.'],
  },
  azurerm_container_registry: {
    title: 'Container Registry',
    summary: 'Stores container images and is typically used by Container Apps or other workloads.',
    whenToUse: 'Use it when your workloads build or pull images from a managed registry.',
    security: ['Use managed identity and scoped roles instead of shared admin credentials.', 'Disable public exposure if not required.'],
    tips: ['Prefer managed identity for pull access.', 'Add diagnostic monitoring and image retention rules when needed.'],
  },
  azurerm_user_assigned_identity: {
    title: 'User-assigned identity',
    summary: 'A managed identity that workloads can use to authenticate to Azure resources without embedded secrets.',
    whenToUse: 'Use this for Container Apps, functions, or services that need controlled resource access.',
    security: ['Prefer managed identity over secrets or embedded credentials.', 'Scope RBAC carefully to the exact resource needs.'],
    tips: ['Use one identity per app when isolation matters.', 'Assign only needed roles to reduce blast radius.'],
  },
  azurerm_role_assignment: {
    title: 'Role assignment',
    summary: 'Grants a principal permission to a resource or resource group.',
    whenToUse: 'Use it to connect Managed Identity or users to Key Vault, ACR, or other scoped Azure resources.',
    security: ['Follow least privilege and planned owner separation.', 'Review role assignments before production rollout.'],
    tips: ['Use built-in roles where possible.', 'Prefer narrow scopes over broad subscription-level access.'],
  },
  azurerm_log_analytics_workspace: {
    title: 'Log Analytics workspace',
    summary: 'Stores logs and metrics used for monitoring and diagnostics.',
    whenToUse: 'Use it for Container Apps, App Insights, and broader workload observability.',
    security: ['Control access to operational logs and sensitive diagnostics.', 'Keep retention aligned with compliance needs.'],
    tips: ['Link it with App Insights or Container Apps logs for end-to-end troubleshooting.', 'Keep workspace names predictable across environments.'],
  },
  azurerm_application_insights: {
    title: 'Application Insights',
    summary: 'Monitoring and telemetry for applications, requests, failures, and dependencies.',
    whenToUse: 'Use it when a web app or function needs performance insight and operational visibility.',
    security: ['Protect connection strings and avoid broad sharing.', 'Review alerting and retention settings for production.'],
    tips: ['For Function Apps, Insights is often recommended but optional.', 'Keep app naming and environment tagging consistent.'],
  },
  azurerm_service_plan: {
    title: 'Service Plan',
    summary: 'The hosting plan that defines compute size and capacity for web apps and functions.',
    whenToUse: 'Use it when app workloads need a managed compute host, usually for Web Apps and Function Apps.',
    security: ['Keep production plans sized for resilience and autoscaling needs.', 'Separate workloads by risk profile when needed.'],
    tips: ['Use Dev and Staging plans smaller than Prod.', 'Scale with real usage, not guesswork.'],
  },
  azurerm_linux_web_app: {
    title: 'Linux Web App',
    summary: 'Managed web hosting for application code, usually behind a service plan and identity integration.',
    whenToUse: 'Use it for HTTP-based app workloads that need managed hosting and environment configuration.',
    security: ['Prefer managed identities and private connectivity where possible.', 'Use secrets and app settings only where required.'],
    tips: ['Tie application settings and key references to environment-specific values.', 'Review ingress and public access before Production.'],
  },
  azurerm_linux_function_app: {
    title: 'Linux Function App',
    summary: 'Serverless compute for event-driven workloads, integrations, and lightweight automation.',
    whenToUse: 'Use it for event triggers, scheduled jobs, or lightweight background processing.',
    security: ['Use managed identity and least-privilege access for storage and connectors.', 'Keep secrets out of code and app settings.'],
    tips: ['Application Insights is strongly recommended for operational visibility.', 'Review storage and trigger access carefully for security.'],
  },
  azurerm_storage_account: {
    title: 'Storage Account',
    summary: 'Provides durable blob, queue, table, and file storage for apps and data workloads.',
    whenToUse: 'Use it for app data, deployment assets, diagnostics, and other managed storage needs.',
    security: ['Turn on secure defaults and restrict public access when possible.', 'Review shared access keys and firewall rules.'],
    tips: ['Use private endpoints for sensitive workloads.', 'Keep data classification in mind when setting network access.'],
  },
  azurerm_key_vault: {
    title: 'Key Vault',
    summary: 'Secures certificates, secrets, and keys used by workloads and apps.',
    whenToUse: 'Use it anytime you need to store app secrets, TLS material, or connection values outside code.',
    security: ['Use RBAC and managed identity instead of shared credentials.', 'Keep secret exposure and rotation under explicit control.'],
    tips: ['Prefer Key Vault references over raw secrets in app configuration.', 'Review purge protection and access policies for production.'],
  },
  azurerm_mssql_server: {
    title: 'SQL Server',
    summary: 'Managed relational database service that hosts your SQL databases and security configuration.',
    whenToUse: 'Use it for applications that need a managed SQL backend and the necessary private networking controls.',
    security: ['Restrict public access and rely on private endpoints when possible.', 'Protect admin access and enforce least privilege.'],
    tips: ['Keep environment and app naming consistent across tiers.', 'Use separate databases per application or purpose when possible.'],
  },
  azurerm_mssql_database: {
    title: 'SQL Database',
    summary: 'A logical database hosted by the SQL Server resource.',
    whenToUse: 'Use it for application data, reporting, or service-specific stores.',
    security: ['Follow data classification and access rules from the app owner.', 'Consider private connectivity for production workloads.'],
    tips: ['Keep the database aligned to the app tier and region.', 'Use separate staging and production naming for safer operations.'],
  },
  azurerm_container_app_environment: {
    title: 'Container App Environment',
    summary: 'The hosting boundary for Azure Container Apps, including networking, logging, and revision model.',
    whenToUse: 'Use it when workloads are container-based and you need a managed app hosting environment.',
    security: ['Keep traffic private when possible and review ingress rules.', 'Use managed identity for registry and backend access.'],
    tips: ['Delegate a dedicated subnet for the environment.', 'Match CPU and memory settings to the real workload profile.'],
  },
  azurerm_container_app: {
    title: 'Container App',
    summary: 'A microservice or app container running within the Container App Environment.',
    whenToUse: 'Use it for APIs, workers, or app services that can run as container-based workloads.',
    security: ['Prefer managed identity and Key Vault references over embedded credentials.', 'Review ingress, scale rules, and secrets before production.'],
    tips: ['Limit unnecessary secrets and environment variables.', 'Use scale rules based on HTTP traffic or queue depth instead of fixed scaling.'],
  },
  azurerm_linux_virtual_machine: {
    title: 'Linux VM',
    summary: 'A compute resource for admin, app, or data-plane workloads that need a full OS.',
    whenToUse: 'Use it for workloads that require a full Linux guest operating system, SSH access, or a custom runtime.',
    security: ['Limit SSH exposure and use managed identities where possible.', 'Patch and secure the OS image and admin access carefully.'],
    tips: ['Use VM patterns only when a managed service is not the better fit.', 'Place it behind networking controls and monitor access.'],
  },
  azurerm_private_dns_zone_virtual_network_link: {
    title: 'VNet link',
    summary: 'Links a Virtual Network to a Private DNS Zone so private name resolution works across the network.',
    whenToUse: 'Use it to connect a VNet to a hub or application-specific private DNS zone.',
    security: ['Only link the networks that require resolution.', 'Keep ownership clear in hub DNS scenarios.'],
    tips: ['Hub DNS ownership matters when shared zones are reused across Environments.', 'Prefer Existing when the zone is already managed elsewhere.'],
  },
};

export const MODULE_ASSISTANCE: Record<string, HelpEntry> = {
  resource_group: {
    title: 'Resource Group module',
    summary: 'The foundation module for the Environment. It keeps resources grouped by app and environment.',
    whenToUse: 'Create it first so every other resource has a stable parent grouping.',
    security: ['Keep production resource groups restricted and tagged.', 'Avoid mixing unrelated workloads into the same group.'],
    tips: ['Use consistent naming and environment prefixes.', 'Track cost and ownership with tags.'],
  },
  networking: {
    title: 'Networking module',
    summary: 'Contains VNet, subnet, NSG, and related connectivity resources.',
    whenToUse: 'Use it anytime your app or platform needs private connectivity, segmentation, or ingress controls.',
    security: ['Prefer private access for workloads and managed services.', 'Limit public ingress to the exact required endpoints.'],
    tips: ['Keep address spaces planned and non-overlapping.', 'Use Private Endpoints and Private DNS together for secure data access.'],
  },
  compute: {
    title: 'Compute module',
    summary: 'Houses Linux VM resources when a full guest OS is required.',
    whenToUse: 'Use it for VM-based workloads or legacy patterns not better served by platform-managed hosting.',
    security: ['Hardening and patching are essential.', 'Limit SSH exposure and administrative paths.'],
    tips: ['Keep a clear ownership and patching model.', 'Use managed services where possible to reduce operational burden.'],
  },
  storage: {
    title: 'Storage module',
    summary: 'Stores app or platform data in managed Azure storage resources.',
    whenToUse: 'Use it for blobs, files, or data needed by functions, apps, or diagnostics.',
    security: ['Review firewall and public access settings.', 'Avoid broad sharing of keys or connection strings.'],
    tips: ['Private networking is often the safer default for production.', 'Keep lifecycle and retention aligned with business requirements.'],
  },
  security: {
    title: 'Security module',
    summary: 'Contains secrets and trust boundaries such as Key Vault.',
    whenToUse: 'Use it whenever app secrets, certificates, or sensitive configuration values are required.',
    security: ['Use managed identities and RBAC wherever possible.', 'Store secrets outside code and ensure rotation planning.'],
    tips: ['Prefer Key Vault references in app settings.', 'Review access control and purge protection for production.'],
  },
  app_service: {
    title: 'App Service module',
    summary: 'Hosts web apps and functions that rely on service plans, app settings, and telemetry.',
    whenToUse: 'Use it for HTTP workloads and serverless integrations that sit behind Azure-managed runtime hosting.',
    security: ['Prefer managed identities and private network boundaries.', 'Review secrets, app settings, and public access carefully.'],
    tips: ['Application Insights is useful for production visibility.', 'Keep scale and runtime settings aligned with workload needs.'],
  },
  database: {
    title: 'Database module',
    summary: 'Wraps SQL Server and database resources for relational workloads.',
    whenToUse: 'Use it when the app depends on managed SQL data services.',
    security: ['Use private networking and least-privilege access.', 'Keep secure admin access and backup strategy in place.'],
    tips: ['Review connection strings and naming patterns before export.', 'Keep production and non-production data separated.'],
  },
  container_registry: {
    title: 'Container Registry module',
    summary: 'Owns image storage and pull access for container deployments.',
    whenToUse: 'Use it when apps or containers need a managed image repository.',
    security: ['Prefer managed identity and RBAC over admin credentials.', 'Review registry public exposure and network access.'],
    tips: ['Use image scan and retention practices for production pipelines.', 'Keep environment naming consistent.'],
  },
  private_networking: {
    title: 'Private Networking module',
    summary: 'Contains private DNS zones, VNet links, and private endpoint resources for secure platform integration.',
    whenToUse: 'Use it for private-access patterns, especially when exposed services must remain internal.',
    security: ['Review DNS ownership and VNet link permissions.', 'Keep private access paths explicit and auditable.'],
    tips: ['Shared hub DNS is useful for common platform services.', 'Prefer Existing when the hub is already managed.'],
  },
  identity: {
    title: 'Identity & RBAC module',
    summary: 'Holds managed identities and role assignments for workloads and platform access.',
    whenToUse: 'Use it whenever a workload needs resource permissions without storing credentials in code.',
    security: ['Apply least privilege and narrow scopes.', 'Review role assignments before every production rollout.'],
    tips: ['Prefer one identity per component when isolation matters.', 'Document the purpose of each role assignment.'],
  },
  container_apps: {
    title: 'Container Apps module',
    summary: 'Contains the Container App Environment, runtime logs, and app containers.',
    whenToUse: 'Use it for microservice or container-first workloads that benefit from a managed app platform.',
    security: ['Prefer managed identity, private networking, and scoped secrets.', 'Monitor ingress and scale behavior before production.'],
    tips: ['Match CPU, memory, and replicas to the real traffic profile.', 'Review ingress rules and secret handling before release.'],
  },
};

export const APP_GUIDANCE = [
  {
    title: 'Environment',
    body: 'Set the project, choose the active Tier, and confirm the environment-specific knobs before adding resources. Shared resources and environment-scoped resources behave differently across Dev, Staging, and Prod.',
  },
  {
    title: 'Resources',
    body: 'Add resources from the catalogue, review shared versus environment scope, and confirm Existing vs Create at the right time. Cross-environment references are rejected to keep the model consistent.',
  },
  {
    title: 'Export',
    body: 'Review Adds, Existing, Updates, and Orphans before Download ZIP. Orphans block the export until you either assign them to a folder or explicitly confirm Leave unmapped.',
  },
  {
    title: 'Security defaults',
    body: 'Prefer managed identities, private networking, and least-privilege access. Only expose public endpoints when they are truly required.',
  },
];
