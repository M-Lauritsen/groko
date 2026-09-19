/**
 * Smoke test: modular TF + MI/AcrPull + VNet CAE + env tfvars/backend.
 */
import assert from "node:assert/strict";
import { generateProject, previewHcl } from "../src/lib/generate/hcl";
import { getStarter } from "../src/lib/schema/starters";
import type { ProjectConfig, ResourceInstance } from "../src/lib/schema/types";

let nextId = 1;
function makeId(): string {
  return `test_${nextId++}`;
}

const config: ProjectConfig = {
  name: "smoke-test-project",
  location: "westeurope",
  namingPrefix: "smoke",
  tags: { Environment: "test", ManagedBy: "terraform" },
  starter: "vnet-vm",
};

function allHcl(files: Record<string, string>): string {
  return Object.entries(files)
    .map(([p, c]) => `--- ${p} ---\n${c}`)
    .join("\n");
}

function main() {
  console.log("Azure TF Builder — generate smoke test\n");

  // 1) Modular layout basics
  const starter = getStarter("vnet-vm");
  assert.ok(starter);
  const resources = starter!.build(config, makeId);
  const { files, sensitiveVars } = generateProject(config, resources);
  assert.ok(files["config.tf"]);
  assert.match(files["config.tf"], /backend "azurerm" \{\}/);
  assert.ok(!files["config.tf"].includes("# backend \"azurerm\" {"));
  assert.ok(files["environments/backend.dev.hcl"]);
  assert.match(files["environments/backend.dev.hcl"], /key\s*=/);
  assert.match(files["environments/dev.tfvars"], /acr_sku/);
  assert.match(files["environments/prod.tfvars"], /Premium/);
  assert.match(files["environments/dev.tfvars"], /Basic/);
  assert.notEqual(
    files["environments/dev.tfvars"],
    files["environments/prod.tfvars"]
  );
  assert.match(files["variables.tf"], /variable "acr_sku"/);
  assert.match(files["variables.tf"], /variable "ca_cpu"/);
  assert.ok(sensitiveVars.length >= 1);
  console.log("✓ Modular layout + differing env tfvars + partial backend");

  // 2) Web + SQL still works
  nextId = 1;
  const webSql = getStarter("web-sql")!.build(config, makeId);
  const webGen = generateProject({ ...config, starter: "web-sql" }, webSql);
  assert.match(allHcl(webGen.files), /resource "azurerm_linux_web_app"/);
  assert.match(allHcl(webGen.files), /resource "azurerm_mssql_server"/);
  console.log("✓ Web App + SQL modular HCL looks good");

  // 3) Storage + Function
  nextId = 1;
  const storage = getStarter("storage-function")!.build(config, makeId);
  const stGen = generateProject(
    { ...config, starter: "storage-function" },
    storage
  );
  assert.match(allHcl(stGen.files), /sku_name\s*=\s*"Y1"/);
  console.log("✓ Storage + Function modular HCL looks good");

  // 4) ACR + Container Apps starter — MI + VNet + AcrPull
  nextId = 1;
  const acaStarter = getStarter("acr-container-apps");
  assert.ok(acaStarter);
  const acaResources = acaStarter!.build(config, makeId);
  assert.ok(acaResources.length >= 8);
  const acaGen = generateProject(
    { ...config, starter: "acr-container-apps" },
    acaResources
  );
  assert.ok(acaGen.files["modules/networking/main.tf"]);
  assert.ok(acaGen.files["modules/container_registry/main.tf"]);
  assert.ok(acaGen.files["modules/identity/main.tf"]);
  assert.ok(acaGen.files["modules/container_apps/main.tf"]);

  const net = acaGen.files["modules/networking/main.tf"];
  assert.match(net, /resource "azurerm_subnet" "cae"/);
  assert.match(net, /Microsoft\.App\/environments/);
  assert.match(net, /10\.0\.0\.0\/21/);

  const acr = acaGen.files["modules/container_registry/main.tf"];
  assert.match(acr, /admin_enabled\s*=\s*false/);
  assert.match(acr, /sku\s*=\s*var\.acr_sku/);

  const idMod = acaGen.files["modules/identity/main.tf"];
  assert.match(idMod, /resource "azurerm_user_assigned_identity"/);
  assert.match(idMod, /resource "azurerm_role_assignment" "acr_pull"/);
  assert.match(idMod, /role_definition_name\s*=\s*"AcrPull"/);

  const ca = acaGen.files["modules/container_apps/main.tf"];
  assert.match(ca, /infrastructure_subnet_id/);
  assert.match(ca, /workload_profile/);
  assert.match(ca, /workload_profile_type\s*=\s*"Consumption"/);
  assert.match(ca, /identity\s*\{/);
  assert.match(ca, /type\s*=\s*"UserAssigned"/);
  assert.match(ca, /registry\s*\{/);
  assert.match(ca, /identity\s*=/);
  assert.doesNotMatch(ca, /password_secret_name/);
  assert.doesNotMatch(ca, /acr-password/);
  assert.match(ca, /var\.ca_cpu/);
  assert.match(ca, /env\s*\{/);
  assert.match(ca, /ASPNETCORE_ENVIRONMENT/);
  assert.match(ca, /http_scale_rule/);
  assert.match(ca, /concurrent_requests\s*=\s*"10"/);
  assert.match(ca, /key_vault_secret_id/);
  assert.match(ca, /secrets\/db-password/);
  assert.match(ca, /secret_name\s*=\s*"db-password"/);
  assert.match(idMod, /role_definition_name\s*=\s*"Key Vault Secrets User"/);
  assert.ok(acaGen.files["modules/security/main.tf"]);
  assert.match(
    acaGen.files["modules/security/main.tf"],
    /resource "azurerm_key_vault"/
  );
  assert.match(acaGen.files["main.tf"], /module "identity"/);
  assert.match(acaGen.files["main.tf"], /acr_sku\s*=\s*var\.acr_sku/);
  console.log(
    "✓ ACR + CA starter uses MI + AcrPull + VNet CAE + env/http scale/KV secret"
  );

  // 5) Admin auth fallback still works
  nextId = 1;
  const rgId = makeId();
  const acrId = makeId();
  const envId = makeId();
  const appId = makeId();
  const adminPath: ResourceInstance[] = [
    {
      id: rgId,
      type: "azurerm_resource_group",
      tfName: "main",
      useExisting: false,
      values: { name: "rg", location: "westeurope", tags: {} },
      existingValues: {},
    },
    {
      id: acrId,
      type: "azurerm_container_registry",
      tfName: "main",
      useExisting: false,
      values: {
        name: "adminacr001",
        resource_group_name: { resourceId: rgId, attr: "name" },
        location: { resourceId: rgId, attr: "location" },
        sku: "Basic",
        admin_enabled: true,
      },
      existingValues: {},
    },
    {
      id: envId,
      type: "azurerm_container_app_environment",
      tfName: "main",
      useExisting: false,
      values: {
        name: "cae",
        resource_group_name: { resourceId: rgId, attr: "name" },
        location: { resourceId: rgId, attr: "location" },
      },
      existingValues: {},
    },
    {
      id: appId,
      type: "azurerm_container_app",
      tfName: "app",
      useExisting: false,
      values: {
        name: "ca",
        resource_group_name: { resourceId: rgId, attr: "name" },
        container_app_environment_id: { resourceId: envId, attr: "id" },
        revision_mode: "Single",
        container_name: "app",
        container_image: "myapi:1",
        container_cpu: "0.25",
        container_memory: "0.5Gi",
        min_replicas: 0,
        max_replicas: 1,
        ingress_enabled: true,
        ingress_target_port: 80,
        container_registry_id: { resourceId: acrId, attr: "id" },
        acr_auth_mode: "admin",
        identity_type: "None",
      },
      existingValues: {},
    },
  ];
  const adminGen = generateProject(config, adminPath);
  const adminCa = adminGen.files["modules/container_apps/main.tf"];
  assert.match(adminCa, /password_secret_name\s*=\s*"acr-password"/);
  assert.match(adminCa, /admin_username/);
  assert.doesNotMatch(adminCa, /identity\s*=\s*var\.in_user_assigned/);
  console.log("✓ Admin credential ACR auth fallback still works");

  // 6) Multiple container apps
  nextId = 1;
  const multiRg = makeId();
  const multiEnv = makeId();
  const a1 = makeId();
  const a2 = makeId();
  const multi: ResourceInstance[] = [
    {
      id: multiRg,
      type: "azurerm_resource_group",
      tfName: "main",
      useExisting: false,
      values: { name: "rg", location: "westeurope", tags: {} },
      existingValues: {},
    },
    {
      id: multiEnv,
      type: "azurerm_container_app_environment",
      tfName: "main",
      useExisting: false,
      values: {
        name: "cae",
        resource_group_name: { resourceId: multiRg, attr: "name" },
        location: { resourceId: multiRg, attr: "location" },
      },
      existingValues: {},
    },
    {
      id: a1,
      type: "azurerm_container_app",
      tfName: "app",
      useExisting: false,
      values: {
        name: "ca-app",
        resource_group_name: { resourceId: multiRg, attr: "name" },
        container_app_environment_id: { resourceId: multiEnv, attr: "id" },
        revision_mode: "Single",
        container_name: "app",
        container_image: "mcr.microsoft.com/k8se/quickstart:latest",
        container_cpu: "0.25",
        container_memory: "0.5Gi",
        min_replicas: 0,
        max_replicas: 2,
        ingress_enabled: true,
        ingress_target_port: 80,
        acr_auth_mode: "managed_identity",
        identity_type: "None",
      },
      existingValues: {},
    },
    {
      id: a2,
      type: "azurerm_container_app",
      tfName: "app_2",
      useExisting: false,
      values: {
        name: "ca-app-2",
        resource_group_name: { resourceId: multiRg, attr: "name" },
        container_app_environment_id: { resourceId: multiEnv, attr: "id" },
        revision_mode: "Single",
        container_name: "worker",
        container_image: "mcr.microsoft.com/k8se/quickstart:latest",
        container_cpu: "0.5",
        container_memory: "1Gi",
        min_replicas: 1,
        max_replicas: 3,
        ingress_enabled: false,
        ingress_target_port: 80,
        acr_auth_mode: "managed_identity",
        identity_type: "None",
      },
      existingValues: {},
    },
  ];
  const multiGen = generateProject(config, multi);
  const multiCa = multiGen.files["modules/container_apps/main.tf"];
  assert.match(multiCa, /resource "azurerm_container_app" "app"/);
  assert.match(multiCa, /resource "azurerm_container_app" "app_2"/);
  console.log("✓ Multiple container apps still emit distinct blocks");

  // 7) Richer CA features: plain secret + env + http scale (no starter)
  nextId = 1;
  const rRg = makeId();
  const rEnv = makeId();
  const rKv = makeId();
  const rUai = makeId();
  const rApp = makeId();
  const rich: ResourceInstance[] = [
    {
      id: rRg,
      type: "azurerm_resource_group",
      tfName: "main",
      useExisting: false,
      values: { name: "rg", location: "westeurope", tags: {} },
      existingValues: {},
    },
    {
      id: rKv,
      type: "azurerm_key_vault",
      tfName: "main",
      useExisting: false,
      values: {
        name: "kv-rich",
        resource_group_name: { resourceId: rRg, attr: "name" },
        location: { resourceId: rRg, attr: "location" },
        sku_name: "standard",
        enable_rbac_authorization: true,
      },
      existingValues: {},
    },
    {
      id: rUai,
      type: "azurerm_user_assigned_identity",
      tfName: "app",
      useExisting: false,
      values: {
        name: "id-app",
        resource_group_name: { resourceId: rRg, attr: "name" },
        location: { resourceId: rRg, attr: "location" },
      },
      existingValues: {},
    },
    {
      id: rEnv,
      type: "azurerm_container_app_environment",
      tfName: "main",
      useExisting: false,
      values: {
        name: "cae",
        resource_group_name: { resourceId: rRg, attr: "name" },
        location: { resourceId: rRg, attr: "location" },
      },
      existingValues: {},
    },
    {
      id: rApp,
      type: "azurerm_container_app",
      tfName: "app",
      useExisting: false,
      values: {
        name: "ca-rich",
        resource_group_name: { resourceId: rRg, attr: "name" },
        container_app_environment_id: { resourceId: rEnv, attr: "id" },
        revision_mode: "Single",
        container_name: "app",
        container_image: "mcr.microsoft.com/k8se/quickstart:latest",
        container_cpu: "0.25",
        container_memory: "0.5Gi",
        min_replicas: 1,
        max_replicas: 5,
        ingress_enabled: true,
        ingress_target_port: 80,
        acr_auth_mode: "managed_identity",
        identity_type: "UserAssigned",
        user_assigned_identity_id: { resourceId: rUai, attr: "id" },
        env_vars: [
          { name: "LOG_LEVEL", value: "info" },
          { name: "API_KEY", secret_name: "api-key" },
        ],
        app_secrets: [
          { name: "api-key", source: "value", value: "" },
          {
            name: "kv-secret",
            source: "key_vault",
            key_vault_id: { resourceId: rKv, attr: "id" },
            secret_name: "app-secret",
          },
        ],
        http_scale_enabled: true,
        http_concurrent_requests: 20,
      },
      existingValues: {},
    },
  ];
  const richGen = generateProject(config, rich);
  const richCa = richGen.files["modules/container_apps/main.tf"];
  assert.match(richCa, /env\s*\{/);
  assert.match(richCa, /LOG_LEVEL/);
  assert.match(richCa, /secret_name\s*=\s*"api-key"/);
  assert.match(richCa, /http_scale_rule/);
  assert.match(richCa, /concurrent_requests\s*=\s*"20"/);
  assert.match(richCa, /key_vault_secret_id/);
  assert.match(richCa, /secrets\/app-secret/);
  assert.match(richCa, /value\s*=\s*var\.app_secret_api_key/);
  // Auto-emitted KV Secrets User (no explicit role in this fixture)
  assert.match(
    richCa,
    /role_definition_name\s*=\s*"Key Vault Secrets User"/
  );
  assert.ok(
    richGen.sensitiveVars.some((s) => s.name.includes("secret_api_key"))
  );
  console.log("✓ Richer CA: env {, http_scale_rule, KV secret + auto RBAC");

  // 8) Preview
  const preview = previewHcl(config, resources);
  assert.match(preview, /backend\.dev\.hcl/);
  assert.match(preview, /config\.tf/);
  console.log("✓ Live preview includes backend + config");

  // 9) Starters
  for (const id of [
    "blank",
    "web-sql",
    "storage-function",
    "vnet-vm",
    "acr-container-apps",
  ]) {
    assert.ok(getStarter(id), `starter ${id} missing`);
  }
  console.log("✓ All starters registered");

  console.log("\nAll generate smoke tests passed.");
}

main();
