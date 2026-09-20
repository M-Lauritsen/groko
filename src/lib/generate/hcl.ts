import {
  type ProjectConfig,
  type ResourceInstance,
  type FieldDef,
  type ReferenceValue,
  type ContainerEnvVar,
  type ContainerAppSecret,
  type Environment,
  isReferenceValue,
  TERRAFORM_VERSION,
  AZURERM_VERSION,
} from "../schema/types";
import { defaultEnvironments } from "../schema/environments";
import { getResourceType } from "../schema/resources";
import {
  MODULE_DEFS,
  moduleOrder,
  resolveModularRef,
  outputName,
  envTags,
  type ModularRefContext,
  type CrossModuleInput,
} from "./modules";
import { resolveExportMap } from "./export-map";
import type { ExportConfig } from "../schema/types";

function escapeHclString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function formatString(s: string): string {
  return `"${escapeHclString(s)}"`;
}

function formatTags(tags: Record<string, string>): string {
  const entries = Object.entries(tags);
  if (entries.length === 0) return "{}";
  const lines = entries.map(
    ([k, v]) => `    ${k} = ${formatString(String(v))}`
  );
  return `{\n${lines.join("\n")}\n  }`;
}

function formatList(items: string[]): string {
  if (items.length === 0) return "[]";
  return `[${items.map((i) => formatString(i)).join(", ")}]`;
}

/** When set, resolveRef emits cross-module var.* inputs instead of foreign addresses. */
let modularRefCtx: ModularRefContext | null = null;

export function setModularRefContext(ctx: ModularRefContext | null): void {
  modularRefCtx = ctx;
}

function resolveRef(
  ref: ReferenceValue,
  resources: ResourceInstance[]
): string {
  if (modularRefCtx) {
    return resolveModularRef(ref, resources, modularRefCtx);
  }
  const target = resources.find((r) => r.id === ref.resourceId);
  if (!target) return `"UNRESOLVED_REF"`;
  const prefix = target.useExisting
    ? `data.${target.type}.${target.tfName}`
    : `${target.type}.${target.tfName}`;
  return `${prefix}.${ref.attr}`;
}

function sensitiveVarName(resource: ResourceInstance, fieldKey: string): string {
  return `${resource.tfName}_${fieldKey}`.replace(/[^a-zA-Z0-9_]/g, "_");
}

/** Path → file contents for the generated Terraform project (supports nested paths). */
export type GeneratedFiles = Record<string, string>;

export interface GenerateResult {
  files: GeneratedFiles;
  sensitiveVars: { name: string; description: string; resourceLabel: string }[];
}

function emitNsgRules(values: Record<string, unknown>): string {
  const rules: string[] = [];
  if (values.allow_ssh) {
    rules.push(`  security_rule {
    name                       = "AllowSSH"
    priority                   = 1001
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "22"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }`);
  }
  if (values.allow_http) {
    rules.push(`  security_rule {
    name                       = "AllowHTTP"
    priority                   = 1002
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "80"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }`);
  }
  if (values.allow_https) {
    rules.push(`  security_rule {
    name                       = "AllowHTTPS"
    priority                   = 1003
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "443"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }`);
  }
  return rules.length ? "\n" + rules.join("\n\n") + "\n" : "";
}

function emitFieldValue(
  field: FieldDef,
  value: unknown,
  resource: ResourceInstance,
  resources: ResourceInstance[],
  sensitiveVars: GenerateResult["sensitiveVars"]
): string | null {
  // Skip helper-only fields for NSG
  if (
    ["allow_ssh", "allow_http", "allow_https"].includes(field.key) &&
    resource.type === "azurerm_network_security_group"
  ) {
    return null;
  }

  // Skip VM nested helpers — handled specially
  if (
    resource.type === "azurerm_linux_virtual_machine" &&
    (field.key.startsWith("os_disk_") ||
      field.key.startsWith("source_image_") ||
      field.key === "admin_ssh_public_key" ||
      field.key === "network_interface_ids")
  ) {
    return null;
  }

  // Skip web app node_version — handled in site_config
  if (
    resource.type === "azurerm_linux_web_app" &&
    field.key === "node_version"
  ) {
    return null;
  }

  // Function App: nested site_config / storage / identity / App Insights handled specially
  if (
    resource.type === "azurerm_linux_function_app" &&
    [
      "storage_account_id",
      "runtime_stack",
      "runtime_version",
      "identity_type",
      "user_assigned_identity_id",
      "application_insights_id",
    ].includes(field.key)
  ) {
    return null;
  }

  // Skip NIC public IP / subnet — handled in ip_configuration
  if (
    resource.type === "azurerm_network_interface" &&
    (field.key === "subnet_id" || field.key === "public_ip_address_id")
  ) {
    return null;
  }

  // Container App: nested template/ingress/registry handled specially
  if (resource.type === "azurerm_container_app") {
    const topLevel = new Set([
      "name",
      "resource_group_name",
      "container_app_environment_id",
      "revision_mode",
      "tags",
    ]);
    if (!topLevel.has(field.key)) {
      return null;
    }
  }

  // Environment: nested / VNet wiring handled specially
  if (
    resource.type === "azurerm_container_app_environment" &&
    (
      field.key === "log_analytics_workspace_id" ||
      field.key === "infrastructure_subnet_id" ||
      field.key === "internal_load_balancer_enabled" ||
      field.key === "zone_redundancy_enabled"
    )
  ) {
    return null;
  }

  // Private Endpoint: nested PSC + DNS zone group handled specially
  if (
    resource.type === "azurerm_private_endpoint" &&
    [
      "private_connection_resource_id",
      "subresource_names",
      "private_connection_name",
      "is_manual_connection",
      "private_dns_zone_id",
    ].includes(field.key)
  ) {
    return null;
  }

  if (resource.type === "azurerm_subnet" && field.key === "delegation") {
    return null;
  }

  const hclKey = field.hclKey ?? field.key;

  if (field.type === "sensitive") {
    const varName = sensitiveVarName(resource, field.key);
    const def = getResourceType(resource.type);
    sensitiveVars.push({
      name: varName,
      description: field.description || `${field.label} for ${resource.type}.${resource.tfName}`,
      resourceLabel: `${def?.label ?? resource.type}.${resource.tfName}`,
    });
    return `  ${hclKey} = var.${varName}`;
  }

  if (value === undefined || value === null || value === "") {
    if (!field.required) return null;
  }

  if (field.type === "reference" || isReferenceValue(value)) {
    if (isReferenceValue(value)) {
      return `  ${hclKey} = ${resolveRef(value, resources)}`;
    }
    // Allow plain string literals (e.g. existing RG name typed by hand)
    if (typeof value === "string" && value) {
      return `  ${hclKey} = ${formatString(value)}`;
    }
    return null;
  }

  if (field.type === "boolean") {
    return `  ${hclKey} = ${value ? "true" : "false"}`;
  }

  if (field.type === "number") {
    return `  ${hclKey} = ${Number(value)}`;
  }

  if (field.type === "list") {
    const items = Array.isArray(value) ? (value as string[]) : [];
    return `  ${hclKey} = ${formatList(items)}`;
  }

  if (field.type === "tags") {
    const tags =
      typeof value === "object" && value !== null
        ? (value as Record<string, string>)
        : {};
    return `  ${hclKey} = ${formatTags(tags)}`;
  }

  // string / select
  return `  ${hclKey} = ${formatString(String(value ?? ""))}`;
}

function emitVmBlock(
  resource: ResourceInstance,
  resources: ResourceInstance[],
  sensitiveVars: GenerateResult["sensitiveVars"]
): string {
  const v = resource.values;
  const def = getResourceType(resource.type)!;
  const lines: string[] = [];

  for (const field of def.fields) {
    if (
      field.key.startsWith("os_disk_") ||
      field.key.startsWith("source_image_") ||
      field.key === "admin_ssh_public_key" ||
      field.key === "network_interface_ids"
    ) {
      continue;
    }
    const line = emitFieldValue(
      field,
      v[field.key],
      resource,
      resources,
      sensitiveVars
    );
    if (line) lines.push(line);
  }

  // network_interface_ids
  const nicRef = v.network_interface_ids;
  if (isReferenceValue(nicRef)) {
    lines.push(`  network_interface_ids = [${resolveRef(nicRef, resources)}]`);
  }

  // SSH key as sensitive var
  const sshVar = sensitiveVarName(resource, "admin_ssh_public_key");
  sensitiveVars.push({
    name: sshVar,
    description: "SSH public key for the Linux VM admin user",
    resourceLabel: `Linux VM.${resource.tfName}`,
  });

  lines.push(`  admin_ssh_key {
    username   = ${formatString(String(v.admin_username ?? "azureuser"))}
    public_key = var.${sshVar}
  }`);

  lines.push(`  os_disk {
    caching              = ${formatString(String(v.os_disk_caching ?? "ReadWrite"))}
    storage_account_type = ${formatString(String(v.os_disk_storage_account_type ?? "Standard_LRS"))}
  }`);

  lines.push(`  source_image_reference {
    publisher = ${formatString(String(v.source_image_publisher ?? "Canonical"))}
    offer     = ${formatString(String(v.source_image_offer ?? "0001-com-ubuntu-server-jammy"))}
    sku       = ${formatString(String(v.source_image_sku ?? "22_04-lts-gen2"))}
    version   = ${formatString(String(v.source_image_version ?? "latest"))}
  }`);

  // disable_password_authentication is required when using SSH
  lines.push(`  disable_password_authentication = true`);

  return lines.join("\n");
}

function emitNicBlock(
  resource: ResourceInstance,
  resources: ResourceInstance[],
  sensitiveVars: GenerateResult["sensitiveVars"]
): string {
  const v = resource.values;
  const def = getResourceType(resource.type)!;
  const lines: string[] = [];

  for (const field of def.fields) {
    if (field.key === "subnet_id" || field.key === "public_ip_address_id") continue;
    const line = emitFieldValue(
      field,
      v[field.key],
      resource,
      resources,
      sensitiveVars
    );
    if (line) lines.push(line);
  }

  const subnetRef = v.subnet_id;
  const pipRef = v.public_ip_address_id;
  let ipConfig = `  ip_configuration {
    name                          = "internal"
    subnet_id                     = ${isReferenceValue(subnetRef) ? resolveRef(subnetRef, resources) : '""'}
    private_ip_address_allocation = "Dynamic"`;
  if (isReferenceValue(pipRef)) {
    ipConfig += `\n    public_ip_address_id          = ${resolveRef(pipRef, resources)}`;
  }
  ipConfig += `\n  }`;
  lines.push(ipConfig);

  return lines.join("\n");
}

function emitWebAppBlock(
  resource: ResourceInstance,
  resources: ResourceInstance[],
  sensitiveVars: GenerateResult["sensitiveVars"]
): string {
  const v = resource.values;
  const def = getResourceType(resource.type)!;
  const lines: string[] = [];

  for (const field of def.fields) {
    if (field.key === "node_version") continue;
    const line = emitFieldValue(
      field,
      v[field.key],
      resource,
      resources,
      sensitiveVars
    );
    if (line) lines.push(line);
  }

  const nodeVer = String(v.node_version ?? "");
  if (nodeVer) {
    lines.push(`  site_config {
    application_stack {
      node_version = ${formatString(nodeVer)}
    }
  }`);
  } else {
    lines.push(`  site_config {}`);
  }

  return lines.join("\n");
}

function emitFunctionAppBlock(
  resource: ResourceInstance,
  resources: ResourceInstance[],
  sensitiveVars: GenerateResult["sensitiveVars"]
): string {
  const v = resource.values;
  const def = getResourceType(resource.type)!;
  const lines: string[] = [];

  for (const field of def.fields) {
    if (
      [
        "storage_account_id",
        "runtime_stack",
        "runtime_version",
        "identity_type",
        "user_assigned_identity_id",
        "application_insights_id",
      ].includes(field.key)
    ) {
      continue;
    }
    const line = emitFieldValue(
      field,
      v[field.key],
      resource,
      resources,
      sensitiveVars
    );
    if (line) lines.push(line);
  }

  // Storage: one catalogue pick → name + access key (azurerm 4.x)
  const stRef = v.storage_account_id;
  if (isReferenceValue(stRef)) {
    lines.push(
      `  storage_account_name       = ${resolveRef({ resourceId: stRef.resourceId, attr: "name" }, resources)}`
    );
    lines.push(
      `  storage_account_access_key = ${resolveRef({ resourceId: stRef.resourceId, attr: "primary_access_key" }, resources)}`
    );
  } else if (typeof stRef === "string" && stRef) {
    lines.push(`  storage_account_name = ${formatString(stRef)}`);
    lines.push(
      `  # TODO: set storage_account_access_key when storage is not a catalogue reference`
    );
  }

  const stack = String(v.runtime_stack ?? "node");
  const ver = String(v.runtime_version ?? "");
  let stackInner = "";
  if (stack === "python") {
    stackInner = `      python_version = ${formatString(ver || "3.11")}`;
  } else if (stack === "dotnet") {
    stackInner = `      dotnet_version = ${formatString(ver || "8.0")}`;
  } else {
    stackInner = `      node_version = ${formatString(ver || "20")}`;
  }
  lines.push(`  site_config {
    application_stack {
${stackInner}
    }
  }`);

  const identityType = String(v.identity_type ?? "None");
  const uaiRef = v.user_assigned_identity_id;
  if (identityType && identityType !== "None") {
    if (identityType === "UserAssigned" && isReferenceValue(uaiRef)) {
      lines.push(`  identity {
    type         = ${formatString(identityType)}
    identity_ids = [${resolveRef(uaiRef, resources)}]
  }`);
    } else if (identityType === "SystemAssigned") {
      lines.push(`  identity {
    type = "SystemAssigned"
  }`);
    }
  }

  // App Insights: catalogue pick → connection string (+ instrumentation key) azurerm 4.x
  const aiRef = v.application_insights_id;
  if (isReferenceValue(aiRef)) {
    lines.push(
      `  application_insights_connection_string = ${resolveRef({ resourceId: aiRef.resourceId, attr: "connection_string" }, resources)}`
    );
    lines.push(
      `  application_insights_key               = ${resolveRef({ resourceId: aiRef.resourceId, attr: "instrumentation_key" }, resources)}`
    );
  }

  return lines.join("\n");
}

/** True if image already includes a registry host (do not prefix ACR login_server). */
function isFullyQualifiedContainerImage(image: string): boolean {
  if (image.startsWith("mcr.")) return true;
  if (image.includes(".azurecr.io/")) return true;
  const slash = image.indexOf("/");
  if (slash === -1) return false; // e.g. "myapi:1.0.0"
  const host = image.slice(0, slash);
  return host.includes(".");
}

function emitContainerAppEnvBlock(
  resource: ResourceInstance,
  resources: ResourceInstance[],
  sensitiveVars: GenerateResult["sensitiveVars"]
): string {
  const v = resource.values;
  const def = getResourceType(resource.type)!;
  const lines: string[] = [];
  const skip = new Set([
    "log_analytics_workspace_id",
    "infrastructure_subnet_id",
    "internal_load_balancer_enabled",
    "zone_redundancy_enabled",
  ]);

  for (const field of def.fields) {
    if (skip.has(field.key)) continue;
    const line = emitFieldValue(
      field,
      v[field.key],
      resource,
      resources,
      sensitiveVars
    );
    if (line) lines.push(line);
  }

  const lawRef = v.log_analytics_workspace_id;
  if (isReferenceValue(lawRef)) {
    lines.push(`  logs_destination           = "log-analytics"`);
    lines.push(
      `  log_analytics_workspace_id = ${resolveRef(lawRef, resources)}`
    );
  }

  // azurerm 4.x: infrastructure_subnet_id needs a workload_profile (Consumption)
  const subnetRef = v.infrastructure_subnet_id;
  if (isReferenceValue(subnetRef)) {
    lines.push(
      `  infrastructure_subnet_id = ${resolveRef(subnetRef, resources)}`
    );
    if (v.internal_load_balancer_enabled) {
      lines.push(`  internal_load_balancer_enabled = true`);
    }
    if (v.zone_redundancy_enabled) {
      lines.push(`  zone_redundancy_enabled = true`);
    }
    lines.push(`  workload_profile {
    name                  = "Consumption"
    workload_profile_type = "Consumption"
  }`);
  }

  return lines.join("\n");
}

function resolveAcrAttr(
  acrRef: unknown,
  attr: string,
  resources: ResourceInstance[]
): string | null {
  if (!isReferenceValue(acrRef)) return null;
  const target = resources.find((r) => r.id === acrRef.resourceId);
  if (!target || target.type !== "azurerm_container_registry") return null;
  if (modularRefCtx) {
    return resolveModularRef(
      { resourceId: target.id, attr: attr as ReferenceValue["attr"] },
      resources,
      modularRefCtx
    );
  }
  const prefix = target.useExisting
    ? `data.${target.type}.${target.tfName}`
    : `${target.type}.${target.tfName}`;
  return `${prefix}.${attr}`;
}

function parseEnvVars(raw: unknown): ContainerEnvVar[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null)
    .map((e) => ({
      name: String(e.name ?? ""),
      value: e.value !== undefined ? String(e.value) : undefined,
      secret_name:
        e.secret_name !== undefined ? String(e.secret_name) : undefined,
    }))
    .filter((e) => e.name.trim() !== "");
}

function parseAppSecrets(raw: unknown): ContainerAppSecret[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null)
    .map((e) => {
      const source = e.source === "key_vault" ? "key_vault" : "value";
      const item: ContainerAppSecret = {
        name: String(e.name ?? ""),
        source,
      };
      if (e.value !== undefined) item.value = String(e.value);
      if (e.secret_name !== undefined) item.secret_name = String(e.secret_name);
      if (isReferenceValue(e.key_vault_id)) item.key_vault_id = e.key_vault_id;
      return item;
    })
    .filter((e) => e.name.trim() !== "");
}

function emitContainerAppSecrets(
  resource: ResourceInstance,
  resources: ResourceInstance[],
  sensitiveVars: GenerateResult["sensitiveVars"],
  secrets: ContainerAppSecret[],
  uaiRef: unknown
): string[] {
  const lines: string[] = [];
  for (const sec of secrets) {
    if (sec.source === "key_vault") {
      if (!isReferenceValue(sec.key_vault_id) || !sec.secret_name) continue;
      const vaultUri = resolveRef(
        { resourceId: sec.key_vault_id.resourceId, attr: "vault_uri" },
        resources
      );
      const secretName = escapeHclString(sec.secret_name);
      let block = `  secret {
    name                = ${formatString(sec.name)}
    key_vault_secret_id = "\${${vaultUri}}secrets/${secretName}"`;
      if (isReferenceValue(uaiRef)) {
        block += `
    identity            = ${resolveRef(uaiRef, resources)}`;
      }
      block += `
  }`;
      lines.push(block);
    } else {
      const varName = sensitiveVarName(resource, `secret_${sec.name}`);
      sensitiveVars.push({
        name: varName,
        description: `Container App secret "${sec.name}" for ${resource.type}.${resource.tfName}`,
        resourceLabel: `Container App.${resource.tfName}`,
      });
      lines.push(`  secret {
    name  = ${formatString(sec.name)}
    value = var.${varName}
  }`);
    }
  }
  return lines;
}

function emitContainerEnvBlocks(envVars: ContainerEnvVar[]): string {
  if (envVars.length === 0) return "";
  const parts: string[] = [];
  for (const ev of envVars) {
    if (ev.secret_name) {
      parts.push(`      env {
        name        = ${formatString(ev.name)}
        secret_name = ${formatString(ev.secret_name)}
      }`);
    } else {
      parts.push(`      env {
        name  = ${formatString(ev.name)}
        value = ${formatString(ev.value ?? "")}
      }`);
    }
  }
  return "\n" + parts.join("\n");
}

/** Emit Key Vault Secrets User role assignments when MI + KV secrets are used. */
function emitKvSecretsUserAssignments(
  resource: ResourceInstance,
  resources: ResourceInstance[],
  secrets: ContainerAppSecret[],
  uaiRef: unknown
): string {
  if (!isReferenceValue(uaiRef)) return "";
  const kvIds = new Set<string>();
  for (const sec of secrets) {
    if (sec.source === "key_vault" && isReferenceValue(sec.key_vault_id)) {
      kvIds.add(sec.key_vault_id.resourceId);
    }
  }
  if (kvIds.size === 0) return "";

  const uai = resources.find((r) => r.id === uaiRef.resourceId);
  if (!uai) return "";

  const blocks: string[] = [];
  for (const kvId of kvIds) {
    const already = resources.some(
      (r) =>
        r.type === "azurerm_role_assignment" &&
        !r.useExisting &&
        String(r.values.role_definition_name ?? "") ===
          "Key Vault Secrets User" &&
        isReferenceValue(r.values.scope) &&
        (r.values.scope as ReferenceValue).resourceId === kvId &&
        isReferenceValue(r.values.principal_id) &&
        (r.values.principal_id as ReferenceValue).resourceId === uai.id
    );
    if (already) continue;

    const kv = resources.find((r) => r.id === kvId);
    if (!kv) continue;
    const tfSafe = `${resource.tfName}_kv_${kv.tfName}_secrets_user`.replace(
      /[^a-zA-Z0-9_]/g,
      "_"
    );
    const scopeExpr = resolveRef({ resourceId: kvId, attr: "id" }, resources);
    const principalExpr = resolveRef(
      { resourceId: uai.id, attr: "principal_id" },
      resources
    );
    blocks.push(`resource "azurerm_role_assignment" "${tfSafe}" {
  scope                = ${scopeExpr}
  role_definition_name = "Key Vault Secrets User"
  principal_id         = ${principalExpr}
}
`);
  }
  return blocks.length ? "\n" + blocks.join("\n") : "";
}

function emitContainerAppBlock(
  resource: ResourceInstance,
  resources: ResourceInstance[],
  sensitiveVars: GenerateResult["sensitiveVars"]
): string {
  const v = resource.values;
  const def = getResourceType(resource.type)!;
  const lines: string[] = [];
  const topLevel = new Set([
    "name",
    "resource_group_name",
    "container_app_environment_id",
    "revision_mode",
    "tags",
  ]);

  for (const field of def.fields) {
    if (!topLevel.has(field.key)) continue;
    const line = emitFieldValue(
      field,
      v[field.key],
      resource,
      resources,
      sensitiveVars
    );
    if (line) lines.push(line);
  }

  const acrRef = v.container_registry_id;
  const loginServer = resolveAcrAttr(acrRef, "login_server", resources);
  const authMode = String(v.acr_auth_mode ?? "managed_identity");
  const identityType = String(v.identity_type ?? "UserAssigned");
  const uaiRef = v.user_assigned_identity_id;
  const appSecrets = parseAppSecrets(v.app_secrets);
  const envVars = parseEnvVars(v.env_vars);

  if (identityType && identityType !== "None") {
    if (identityType.includes("UserAssigned") && isReferenceValue(uaiRef)) {
      lines.push(`  identity {
    type         = ${formatString(identityType)}
    identity_ids = [${resolveRef(uaiRef, resources)}]
  }`);
    } else if (identityType === "SystemAssigned") {
      lines.push(`  identity {
    type = "SystemAssigned"
  }`);
    }
  }

  lines.push(
    ...emitContainerAppSecrets(
      resource,
      resources,
      sensitiveVars,
      appSecrets,
      uaiRef
    )
  );

  if (loginServer) {
    if (authMode === "admin") {
      const adminUser = resolveAcrAttr(acrRef, "admin_username", resources);
      const adminPass = resolveAcrAttr(acrRef, "admin_password", resources);
      if (adminUser && adminPass) {
        lines.push(`  secret {
    name  = "acr-password"
    value = ${adminPass}
  }`);
        lines.push(`  registry {
    server               = ${loginServer}
    username             = ${adminUser}
    password_secret_name = "acr-password"
  }`);
      }
    } else if (isReferenceValue(uaiRef)) {
      lines.push(`  registry {
    server   = ${loginServer}
    identity = ${resolveRef(uaiRef, resources)}
  }`);
      const roleDeps = resources.filter(
        (r) =>
          r.type === "azurerm_role_assignment" &&
          !r.useExisting &&
          isReferenceValue(r.values.scope) &&
          isReferenceValue(acrRef) &&
          (r.values.scope as { resourceId: string }).resourceId ===
            (acrRef as { resourceId: string }).resourceId
      );
      if (roleDeps.length > 0 && !modularRefCtx) {
        lines.push(
          `  depends_on = [${roleDeps
            .map((r) => `${r.type}.${r.tfName}`)
            .join(", ")}]`
        );
      } else if (roleDeps.length > 0) {
        lines.push(
          `  # Apply AcrPull (modules/identity) before the first image pull`
        );
      }
    }
  }

  const rawImage = String(
    v.container_image ?? "mcr.microsoft.com/k8se/quickstart:latest"
  );
  let imageHcl: string;
  if (loginServer && !isFullyQualifiedContainerImage(rawImage)) {
    imageHcl = `"\${${loginServer}}/${escapeHclString(rawImage)}"`;
  } else {
    imageHcl = formatString(rawImage);
  }

  const cname = String(v.container_name ?? "app");
  const useEnvVars = modularRefCtx?.currentModuleId === "container_apps";
  const cpuExpr = useEnvVars ? "var.ca_cpu" : String(v.container_cpu ?? "0.25");
  const memExpr = useEnvVars
    ? "var.ca_memory"
    : formatString(String(v.container_memory ?? "0.5Gi"));
  const minExpr = useEnvVars
    ? "var.ca_min_replicas"
    : String(Number(v.min_replicas ?? 0));
  const maxExpr = useEnvVars
    ? "var.ca_max_replicas"
    : String(Number(v.max_replicas ?? 10));

  const envHcl = emitContainerEnvBlocks(envVars);

  let scaleRule = "";
  if (v.http_scale_enabled) {
    const concurrent = String(Number(v.http_concurrent_requests ?? 10));
    scaleRule = `
    http_scale_rule {
      name                = "http"
      concurrent_requests = ${formatString(concurrent)}
    }`;
  }

  lines.push(`  template {
    min_replicas = ${minExpr}
    max_replicas = ${maxExpr}
${scaleRule}
    container {
      name   = ${formatString(cname)}
      image  = ${imageHcl}
      cpu    = ${cpuExpr}
      memory = ${memExpr}${envHcl}
    }
  }`);

  const port = Number(v.ingress_target_port ?? 80);
  const transport = String(v.ingress_transport ?? "auto");
  if (useEnvVars) {
    lines.push(`  dynamic "ingress" {
    for_each = var.ca_ingress_external ? [1] : []
    content {
      external_enabled = true
      target_port      = ${port}
      transport        = ${formatString(transport)}

      traffic_weight {
        latest_revision = true
        percentage      = 100
      }
    }
  }`);
  } else if (v.ingress_enabled) {
    lines.push(`  ingress {
    external_enabled = true
    target_port      = ${port}
    transport        = ${formatString(transport)}

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }`);
  }

  return lines.join("\n");
}


function emitSubnetBlock(
  resource: ResourceInstance,
  resources: ResourceInstance[],
  sensitiveVars: GenerateResult["sensitiveVars"]
): string {
  const v = resource.values;
  const def = getResourceType(resource.type)!;
  const lines: string[] = [];
  for (const field of def.fields) {
    if (field.key === "delegation") continue;
    const line = emitFieldValue(
      field,
      v[field.key],
      resource,
      resources,
      sensitiveVars
    );
    if (line) lines.push(line);
  }
  if (String(v.delegation ?? "") === "Microsoft.App/environments") {
    lines.push(`  delegation {
    name = "Microsoft.App.environments"
    service_delegation {
      name    = "Microsoft.App/environments"
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }`);
  }
  return lines.join("\n");
}

function emitPrivateEndpointBlock(
  resource: ResourceInstance,
  resources: ResourceInstance[],
  sensitiveVars: GenerateResult["sensitiveVars"]
): string {
  const v = resource.values;
  const def = getResourceType(resource.type)!;
  const lines: string[] = [];
  const nestedKeys = new Set([
    "private_connection_resource_id",
    "subresource_names",
    "private_connection_name",
    "is_manual_connection",
    "private_dns_zone_id",
  ]);
  for (const field of def.fields) {
    if (nestedKeys.has(field.key)) continue;
    const line = emitFieldValue(
      field,
      v[field.key],
      resource,
      resources,
      sensitiveVars
    );
    if (line) lines.push(line);
  }

  const connName =
    typeof v.private_connection_name === "string" && v.private_connection_name
      ? v.private_connection_name
      : `psc-${resource.tfName}`;
  const subresource =
    typeof v.subresource_names === "string" && v.subresource_names
      ? v.subresource_names
      : "registry";
  const target = v.private_connection_resource_id;
  const targetExpr = isReferenceValue(target)
    ? resolveRef(target, resources)
    : typeof target === "string" && target
      ? formatString(target)
      : '"TODO_PRIVATE_CONNECTION_RESOURCE_ID"';
  const manual = v.is_manual_connection ? "true" : "false";

  lines.push(`  private_service_connection {
    name                           = ${formatString(connName)}
    private_connection_resource_id = ${targetExpr}
    is_manual_connection           = ${manual}
    subresource_names              = [${formatString(subresource)}]
  }`);

  const dnsZone = v.private_dns_zone_id;
  if (dnsZone && (isReferenceValue(dnsZone) || (typeof dnsZone === "string" && dnsZone))) {
    const zoneExpr = isReferenceValue(dnsZone)
      ? resolveRef(dnsZone, resources)
      : formatString(String(dnsZone));
    lines.push(`  private_dns_zone_group {
    name                 = "default"
    private_dns_zone_ids = [${zoneExpr}]
  }`);
  }

  return lines.join("\n");
}


export function emitResourceBlock(
  resource: ResourceInstance,
  resources: ResourceInstance[],
  sensitiveVars: GenerateResult["sensitiveVars"]
): string {
  const def = getResourceType(resource.type);
  if (!def) return `# Unknown type: ${resource.type}\n`;

  if (resource.useExisting) {
    return emitDataBlock(resource, def.fields);
  }

  let body: string;
  if (resource.type === "azurerm_linux_virtual_machine") {
    body = emitVmBlock(resource, resources, sensitiveVars);
  } else if (resource.type === "azurerm_network_interface") {
    body = emitNicBlock(resource, resources, sensitiveVars);
  } else if (resource.type === "azurerm_linux_web_app") {
    body = emitWebAppBlock(resource, resources, sensitiveVars);
  } else if (resource.type === "azurerm_linux_function_app") {
    body = emitFunctionAppBlock(resource, resources, sensitiveVars);
  } else if (resource.type === "azurerm_container_app_environment") {
    body = emitContainerAppEnvBlock(resource, resources, sensitiveVars);
  } else if (resource.type === "azurerm_container_app") {
    body = emitContainerAppBlock(resource, resources, sensitiveVars);
  } else if (resource.type === "azurerm_subnet") {
    body = emitSubnetBlock(resource, resources, sensitiveVars);
  } else if (resource.type === "azurerm_private_endpoint") {
    body = emitPrivateEndpointBlock(resource, resources, sensitiveVars);
  } else {
    const lines: string[] = [];
    for (const field of def.fields) {
      const line = emitFieldValue(
        field,
        resource.values[field.key],
        resource,
        resources,
        sensitiveVars
      );
      if (line) lines.push(line);
    }
    if (resource.type === "azurerm_network_security_group") {
      lines.push(emitNsgRules(resource.values));
    }
    // Key Vault needs tenant_id from client config
    if (resource.type === "azurerm_key_vault") {
      lines.push(`  tenant_id = data.azurerm_client_config.current.tenant_id`);
    }
    if (
      resource.type === "azurerm_container_registry" &&
      modularRefCtx?.currentModuleId === "container_registry"
    ) {
      const filtered = lines.filter((l) => !/^\s*sku\s*=/.test(l));
      filtered.push(`  sku = var.acr_sku`);
      body = filtered.filter(Boolean).join("\n");
    } else {
      body = lines.filter(Boolean).join("\n");
    }
  }

  const main = `resource "${resource.type}" "${resource.tfName}" {\n${body}\n}\n`;
  if (resource.type === "azurerm_container_app") {
    const extras = emitKvSecretsUserAssignments(
      resource,
      resources,
      parseAppSecrets(resource.values.app_secrets),
      resource.values.user_assigned_identity_id
    );
    return main + extras;
  }
  return main;
}

function emitDataBlock(resource: ResourceInstance, fields: FieldDef[]): string {
  const lines: string[] = [];
  const existingKeys = fields.filter((f) => f.existingKey);
  for (const field of existingKeys) {
    const val = resource.existingValues[field.key] ?? resource.values[field.key];
    if (val === undefined || val === null || val === "") continue;
    if (isReferenceValue(val)) continue; // existing should be literal
    lines.push(`  ${field.key} = ${formatString(String(val))}`);
  }
  // Always need name for most data sources; ensure at least something
  if (lines.length === 0) {
    lines.push(`  # TODO: fill in identifying attributes for existing resource`);
    lines.push(`  name = "TODO"`);
  }
  return `data "${resource.type}" "${resource.tfName}" {\n${lines.join("\n")}\n}\n`;
}

function moduleLabel(id: string): string {
  return MODULE_DEFS.find((m) => m.id === id)?.label ?? id;
}

function attrsToExport(r: ResourceInstance): string[] {
  const def = getResourceType(r.type);
  const attrs = new Set<string>(def?.outputs ?? ["id", "name"]);
  if (r.type === "azurerm_storage_account") {
    attrs.add("primary_access_key");
  }
  if (r.type === "azurerm_container_registry") {
    attrs.add("login_server");
    attrs.add("admin_username");
    attrs.add("admin_password");
  }
  if (r.type === "azurerm_user_assigned_identity") {
    attrs.add("principal_id");
    attrs.add("client_id");
  }
  if (r.type === "azurerm_key_vault") {
    attrs.add("vault_uri");
  }
  if (r.type === "azurerm_application_insights") {
    attrs.add("connection_string");
    attrs.add("instrumentation_key");
  }
  return Array.from(attrs);
}

function sortResources(resources: ResourceInstance[]): ResourceInstance[] {
  const order = [
    "azurerm_resource_group",
    "azurerm_virtual_network",
    "azurerm_subnet",
    "azurerm_network_security_group",
    "azurerm_subnet_network_security_group_association",
    "azurerm_public_ip",
    "azurerm_network_interface",
    "azurerm_private_dns_zone",
    "azurerm_private_dns_zone_virtual_network_link",
    "azurerm_private_endpoint",
    "azurerm_linux_virtual_machine",
    "azurerm_storage_account",
    "azurerm_key_vault",
    "azurerm_service_plan",
    "azurerm_linux_web_app",
    "azurerm_linux_function_app",
    "azurerm_application_insights",
    "azurerm_mssql_server",
    "azurerm_mssql_database",
    "azurerm_container_registry",
    "azurerm_user_assigned_identity",
    "azurerm_role_assignment",
    "azurerm_log_analytics_workspace",
    "azurerm_container_app_environment",
    "azurerm_container_app",
  ];
  return [...resources].sort((a, b) => {
    const ai = order.indexOf(a.type);
    const bi = order.indexOf(b.type);
    if (ai !== bi) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    return a.tfName.localeCompare(b.tfName);
  });
}

function generateConfigTf(): string {
  return `terraform {
  required_version = "${TERRAFORM_VERSION}"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "${AZURERM_VERSION}"
    }
  }

  # Partial backend — supply details at init time:
  #   terraform init -backend-config=environments/backend.dev.hcl
  backend "azurerm" {}
}

provider "azurerm" {
  features {}
}

data "azurerm_client_config" "current" {}
`;
}

function generateRootVariables(
  config: ProjectConfig,
  sensitiveVars: GenerateResult["sensitiveVars"]
): string {
  const parts: string[] = [];

  parts.push(`variable "project_name" {
  description = "Project name used for tagging and naming"
  type        = string
  default     = ${formatString(config.name)}
}
`);

  parts.push(`variable "location" {
  description = "Default Azure region"
  type        = string
  default     = ${formatString(config.location)}
}
`);

  parts.push(`variable "naming_prefix" {
  description = "Prefix applied to resource names"
  type        = string
  default     = ${formatString(config.namingPrefix)}
}
`);

  const tagEntries = Object.entries(config.tags);
  const tagDefault =
    tagEntries.length === 0
      ? "{}"
      : `{\n${tagEntries.map(([k, v]) => `    ${k} = ${formatString(v)}`).join("\n")}\n  }`;

  parts.push(`variable "tags" {
  description = "Common tags applied to resources (override per environment via -var-file)"
  type        = map(string)
  default     = ${tagDefault}
}
`);

  parts.push(`variable "environment" {
  description = "Environment name (dev, staging, prod, …)"
  type        = string
  default     = "dev"
}
`);

  parts.push(`variable "acr_sku" {
  description = "Azure Container Registry SKU (Basic | Standard | Premium)"
  type        = string
  default     = "Basic"
}
`);

  parts.push(`variable "ca_cpu" {
  description = "Default Container App CPU (cores)"
  type        = number
  default     = 0.25
}
`);

  parts.push(`variable "ca_memory" {
  description = "Default Container App memory"
  type        = string
  default     = "0.5Gi"
}
`);

  parts.push(`variable "ca_min_replicas" {
  description = "Default Container App min replicas"
  type        = number
  default     = 0
}
`);

  parts.push(`variable "ca_max_replicas" {
  description = "Default Container App max replicas"
  type        = number
  default     = 3
}
`);

  parts.push(`variable "ca_ingress_external" {
  description = "Expose Container Apps with external ingress"
  type        = bool
  default     = true
}
`);

  for (const sv of sensitiveVars) {
    parts.push(`variable "${sv.name}" {
  description = ${formatString(sv.description)}
  type        = string
  sensitive   = true
}
`);
  }

  return parts.join("\n");
}

function formatTagsHcl(tags: Record<string, string>): string {
  const entries = Object.entries(tags);
  if (entries.length === 0) return "{}";
  const lines = entries.map(([k, v]) => `  ${k} = ${formatString(String(v))}`);
  return `{\n${lines.join("\n")}\n}`;
}

function generateEnvTfvars(
  config: ProjectConfig,
  env: Environment,
  sensitiveVars: GenerateResult["sensitiveVars"]
): string {
  const k = env.knobs;
  const tags = envTags(config, env.id, k.tags);
  const prefix = `${config.namingPrefix}${k.namingSuffix}`;

  const lines: string[] = [
    `# Environment: ${env.displayName} (${env.id})`,
    `# Usage: terraform plan -var-file=environments/${env.id}.tfvars`,
    `# Fill sensitive values before apply. Do not commit real secrets.`,
    ``,
    `project_name  = ${formatString(config.name)}`,
    `location      = ${formatString(config.location)}`,
    `naming_prefix = ${formatString(prefix)}`,
    `environment   = ${formatString(env.id)}`,
    `tags = ${formatTagsHcl(tags)}`,
    ``,
    `# Per-environment sizing (from Environment knobs)`,
    `acr_sku             = ${formatString(k.acrSku)}`,
    `ca_cpu              = ${k.caCpu}`,
    `ca_memory           = ${formatString(k.caMemory)}`,
    `ca_min_replicas     = ${k.caMinReplicas}`,
    `ca_max_replicas     = ${k.caMaxReplicas}`,
    `ca_ingress_external = ${k.caIngressExternal ? "true" : "false"}`,
  ];
  for (const sv of sensitiveVars) {
    lines.push(``);
    lines.push(`# ${sv.description}`);
    lines.push(`${sv.name} = "CHANGE_ME_${env.id.toUpperCase().replace(/[^A-Z0-9]/g, "_")}"`);
  }
  return lines.join("\n") + "\n";
}

function generateBackendHcl(config: ProjectConfig, env: string): string {
  const key = `${config.name.replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase()}/${env}.terraform.tfstate`;
  return `# Remote state backend config for ${env}
# terraform init -reconfigure -backend-config=environments/backend.${env}.hcl
#
# Create the storage account / container once (shared across envs), then point
# each environment at a distinct state key.

resource_group_name  = "rg-terraform-state"
storage_account_name = "sttfstateCHANGE_ME"
container_name       = "tfstate"
key                  = "${key}"
`;
}

function generateModuleOutputs(moduleResources: ResourceInstance[]): string {
  const parts: string[] = [];
  for (const r of moduleResources) {
    const prefix = r.useExisting
      ? `data.${r.type}.${r.tfName}`
      : `${r.type}.${r.tfName}`;
    for (const attr of attrsToExport(r)) {
      const sensitive =
        attr === "admin_password" ||
        attr === "connection_string" ||
        attr === "instrumentation_key"
          ? "\n  sensitive   = true"
          : "";
      parts.push(`output "${outputName(r, attr)}" {
  description = "${attr} of ${r.type}.${r.tfName}"
  value       = ${prefix}.${attr}${sensitive}
}
`);
    }
  }
  return parts.join("\n") || `# No outputs\n`;
}

function generateModuleVariables(
  moduleId: string,
  inputs: CrossModuleInput[],
  sensitiveForModule: GenerateResult["sensitiveVars"]
): string {
  const parts: string[] = [];
  for (const inp of inputs) {
    parts.push(`variable "${inp.varName}" {
  description = "From module.${inp.fromModuleId} → ${inp.fromResource.type}.${inp.fromResource.tfName}.${inp.attr}"
  type        = string
}
`);
  }
  for (const sv of sensitiveForModule) {
    parts.push(`variable "${sv.name}" {
  description = ${formatString(sv.description)}
  type        = string
  sensitive   = true
}
`);
  }
  if (moduleId === "container_registry") {
    parts.push(`variable "acr_sku" {
  description = "ACR SKU from root (per-environment)"
  type        = string
}
`);
  }
  if (moduleId === "container_apps") {
    parts.push(`variable "ca_cpu" {
  type = number
}
`);
    parts.push(`variable "ca_memory" {
  type = string
}
`);
    parts.push(`variable "ca_min_replicas" {
  type = number
}
`);
    parts.push(`variable "ca_max_replicas" {
  type = number
}
`);
    parts.push(`variable "ca_ingress_external" {
  type = bool
}
`);
  }
  if (parts.length === 0) {
    return `# No module inputs\n`;
  }
  return parts.join("\n");
}

function sensitiveVarsUsedInHcl(
  hcl: string,
  all: GenerateResult["sensitiveVars"]
): GenerateResult["sensitiveVars"] {
  return all.filter((s) => hcl.includes(`var.${s.name}`));
}

function generateRootMain(
  orderedModules: string[],
  moduleInputs: Map<string, CrossModuleInput[]>,
  moduleSensitive: Map<string, GenerateResult["sensitiveVars"]>
): string {
  const parts: string[] = [
    `# Root module — wires child modules`,
    `# Generated by Azure TF Builder`,
    ``,
  ];

  for (const mid of orderedModules) {
    const inputs = moduleInputs.get(mid) ?? [];
    const sens = moduleSensitive.get(mid) ?? [];
    parts.push(`module "${mid}" {`);
    parts.push(`  source = "./modules/${mid}"`);
    parts.push(``);
    for (const inp of inputs) {
      parts.push(
        `  ${inp.varName} = module.${inp.fromModuleId}.${outputName(inp.fromResource, inp.attr)}`
      );
    }
    for (const sv of sens) {
      parts.push(`  ${sv.name} = var.${sv.name}`);
    }
    if (mid === "container_registry") {
      parts.push(`  acr_sku = var.acr_sku`);
    }
    if (mid === "container_apps") {
      parts.push(`  ca_cpu              = var.ca_cpu`);
      parts.push(`  ca_memory           = var.ca_memory`);
      parts.push(`  ca_min_replicas     = var.ca_min_replicas`);
      parts.push(`  ca_max_replicas     = var.ca_max_replicas`);
      parts.push(`  ca_ingress_external = var.ca_ingress_external`);
    }
    if (
      inputs.length === 0 &&
      sens.length === 0 &&
      mid !== "container_registry" &&
      mid !== "container_apps"
    ) {
      parts.push(`  # (no inputs)`);
    }
    parts.push(`}`);
    parts.push(``);
  }

  if (orderedModules.length === 0) {
    parts.push(`# Add resources in the Azure TF Builder UI, then re-export.`);
    parts.push(``);
  }

  return parts.join("\n");
}

function generateRootOutputs(
  orderedModules: string[],
  partitioned: Map<string, ResourceInstance[]>
): string {
  const parts: string[] = [
    `# Re-export key module outputs for convenience`,
    ``,
  ];
  for (const mid of orderedModules) {
    const resources = partitioned.get(mid) ?? [];
    for (const r of resources) {
      for (const attr of attrsToExport(r)) {
        if (
          attr === "admin_password" ||
          attr === "connection_string" ||
          attr === "instrumentation_key"
        )
          continue;
        const out = outputName(r, attr);
        parts.push(`output "${mid}__${out}" {
  description = "${moduleLabel(mid)} / ${r.type}.${r.tfName}.${attr}"
  value       = module.${mid}.${out}
}
`);
      }
    }
  }
  return parts.join("\n") || `# No outputs yet.\n`;
}

function generateProjectReadme(
  config: ProjectConfig,
  resources: ResourceInstance[],
  sensitiveVars: GenerateResult["sensitiveVars"],
  orderedModules: string[]
): string {
  const existing = resources.filter((r) => r.useExisting);
  const managed = resources.filter((r) => !r.useExisting);
  const caCount = resources.filter(
    (r) => r.type === "azurerm_container_app"
  ).length;

  return `# ${config.name} — Azure Terraform

Generated by **Azure TF Builder** (modular layout).

## Prerequisites

- [Terraform](https://www.terraform.io/downloads) ${TERRAFORM_VERSION}
- Azure CLI authenticated (\`az login\`) or a service principal
- Provider: \`hashicorp/azurerm\` ${AZURERM_VERSION}

## Quick start

\`\`\`bash
# 1) Init with remote state (partial backend in config.tf)
terraform init -backend-config=environments/backend.dev.hcl

# 2) Plan / apply with environment values
terraform plan  -var-file=environments/dev.tfvars
terraform apply -var-file=environments/dev.tfvars
\`\`\`

Edit \`environments/*.tfvars\` for per-env sizing (ACR SKU, CPU/memory/replicas, ingress).
Fill any \`CHANGE_ME_*\` sensitive placeholders and the storage account name in \`environments/backend.*.hcl\` before apply.

### Switching environments

\`\`\`bash
terraform init -reconfigure -backend-config=environments/backend.prod.hcl
terraform plan -var-file=environments/prod.tfvars
\`\`\`

## Layout

\`\`\`
config.tf                 # terraform + provider + backend placeholder
main.tf                   # root module calls
variables.tf
outputs.tf
environments/
  dev.tfvars / staging.tfvars / prod.tfvars
  backend.dev.hcl / backend.staging.hcl / backend.prod.hcl
modules/
${orderedModules.map((m) => `  ${m}/`).join("\n") || "  (none yet)"}
README.md
\`\`\`

### Modules in this project

${
  orderedModules.length === 0
    ? "_None_"
    : orderedModules
        .map((m) => `- \`modules/${m}\` — ${moduleLabel(m)}`)
        .join("\n")
}

## Project settings

| Setting | Value |
|---------|-------|
| Name | ${config.name} |
| Location | ${config.location} |
| Naming prefix | ${config.namingPrefix || "(none)"} |
| Container apps | ${caCount} |

## Resources

### Managed — ${managed.length}

${
  managed.length === 0
    ? "_None_"
    : managed.map((r) => `- \`${r.type}.${r.tfName}\``).join("\n")
}

### Existing (data sources) — ${existing.length}

${
  existing.length === 0
    ? "_None_"
    : existing.map((r) => `- \`data.${r.type}.${r.tfName}\``).join("\n")
}

${
  existing.length > 0
    ? `
> **Using existing resources:** Emitted as Terraform \`data\` sources inside the relevant module. Terraform will not create or destroy them.
`
    : ""
}

## Sensitive variables

${
  sensitiveVars.length === 0
    ? "_No sensitive variables._"
    : sensitiveVars
        .map((s) => `- \`var.${s.name}\` — ${s.description}`)
        .join("\n")
}

Pass secrets via \`-var-file=environments/<env>.tfvars\` or \`TF_VAR_*\` environment variables — never hardcode them in \`.tf\` files.
`;
}

export function generateProject(
  config: ProjectConfig,
  resources: ResourceInstance[],
  environments: Environment[] = defaultEnvironments(),
  exportConfig?: ExportConfig | null
): GenerateResult {
  const sensitiveVars: GenerateResult["sensitiveVars"] = [];
  const resolved = resolveExportMap(resources, exportConfig);
  const partitioned = resolved.byModule;
  const orderedModules = moduleOrder(Array.from(partitioned.keys()));
  const moduleOf = resolved.moduleOf;
  // Orphans (null folder) are excluded from modules. Download ZIP must block or
  // require explicit “leave unmapped” confirm — never silent drop (see export-map).

  const files: GeneratedFiles = {};
  const moduleInputs = new Map<string, CrossModuleInput[]>();
  const moduleSensitive = new Map<
    string,
    GenerateResult["sensitiveVars"]
  >();

  for (const mid of orderedModules) {
    const modResources = sortResources(partitioned.get(mid) ?? []);
    const ctx: ModularRefContext = {
      currentModuleId: mid,
      moduleOf,
      inputs: new Map(),
    };
    setModularRefContext(ctx);

    const bodyParts: string[] = [
      `# Module: ${mid} (${moduleLabel(mid)})`,
      `# Generated by Azure TF Builder`,
      ``,
    ];
    for (const r of modResources) {
      bodyParts.push(emitResourceBlock(r, resources, sensitiveVars));
    }
    setModularRefContext(null);

    const mainHcl = bodyParts.join("\n");
    files[`modules/${mid}/main.tf`] = mainHcl;
    moduleInputs.set(mid, Array.from(ctx.inputs.values()));
    files[`modules/${mid}/outputs.tf`] = generateModuleOutputs(modResources);
    files[`modules/${mid}/variables.tf`] = ""; // filled after sensitive dedupe
  }

  const seen = new Set<string>();
  const uniqueSensitive = sensitiveVars.filter((s) => {
    if (seen.has(s.name)) return false;
    seen.add(s.name);
    return true;
  });

  for (const mid of orderedModules) {
    const mainHcl = files[`modules/${mid}/main.tf`];
    const sens = sensitiveVarsUsedInHcl(mainHcl, uniqueSensitive);
    moduleSensitive.set(mid, sens);
    files[`modules/${mid}/variables.tf`] = generateModuleVariables(
      mid,
      moduleInputs.get(mid) ?? [],
      sens
    );
  }

  files["config.tf"] = generateConfigTf();
  files["variables.tf"] = generateRootVariables(config, uniqueSensitive);
  files["main.tf"] = generateRootMain(
    orderedModules,
    moduleInputs,
    moduleSensitive
  );
  files["outputs.tf"] = generateRootOutputs(orderedModules, partitioned);

  const envs =
    environments.length > 0 ? environments : defaultEnvironments();
  for (const env of envs) {
    files[`environments/${env.id}.tfvars`] = generateEnvTfvars(
      config,
      env,
      uniqueSensitive
    );
    files[`environments/backend.${env.id}.hcl`] = generateBackendHcl(
      config,
      env.id
    );
  }

  files["README.md"] = generateProjectReadme(
    config,
    sortResources(resources),
    uniqueSensitive,
    orderedModules
  );

  return { files, sensitiveVars: uniqueSensitive };
}

export function previewHcl(
  config: ProjectConfig,
  resources: ResourceInstance[],
  environments?: Environment[],
  exportConfig?: ExportConfig | null
): string {
  const { files } = generateProject(config, resources, environments, exportConfig);
  const paths = Object.keys(files).sort((a, b) => {
    const rank = (p: string) => {
      if (!p.includes("/")) return 0;
      if (p.startsWith("environments/")) return 1;
      if (p.startsWith("modules/")) return 2;
      return 3;
    };
    const d = rank(a) - rank(b);
    return d !== 0 ? d : a.localeCompare(b);
  });
  return paths.map((p) => `# ===== ${p} =====\n${files[p]}`).join("\n");
}
