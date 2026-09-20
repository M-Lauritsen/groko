/**
 * Smoke test: modular TF + MI/AcrPull + VNet CAE + env tfvars/backend.
 */
import assert from "node:assert/strict";
import { generateProject, previewHcl } from "../src/lib/generate/hcl";
import { getStarter } from "../src/lib/schema/starters";
import { getResourceType } from "../src/lib/schema/resources";
import type { ProjectConfig, ResourceInstance } from "../src/lib/schema/types";
import {
  defaultEnvironments,
  envScope,
  filterRefCandidates,
  canReference,
  resourcesVisibleInEnv,
  sharedScope,
} from "../src/lib/schema/environments";
import { parseHcl, parseHclFiles } from "../src/lib/import/parse";
import { mapToProject, mergeImportedResources } from "../src/lib/import/mapToProject";
import { isReferenceValue } from "../src/lib/schema/types";

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

  // 3) Storage + Function App
  nextId = 1;
  const storage = getStarter("storage-function")!.build(config, makeId);
  assert.ok(
    storage.some((r) => r.type === "azurerm_linux_function_app"),
    "starter must include Function App"
  );
  assert.ok(
    storage.find((r) => r.type === "azurerm_linux_function_app")?.scope.kind ===
      "environment"
  );
  const stGen = generateProject(
    { ...config, starter: "storage-function" },
    storage
  );
  const stHcl = allHcl(stGen.files);
  assert.match(stHcl, /sku_name\s*=\s*"Y1"/);
  assert.match(stHcl, /resource "azurerm_linux_function_app"/);
  assert.match(stHcl, /storage_account_name/);
  assert.match(stHcl, /storage_account_access_key/);
  assert.match(stHcl, /primary_access_key/);
  assert.match(stHcl, /application_stack/);
  assert.match(stHcl, /node_version\s*=\s*"20"/);
  assert.ok(stGen.files["modules/app_service/main.tf"]);
  assert.ok(stGen.files["modules/storage/main.tf"]);
  assert.match(
    stGen.files["modules/app_service/main.tf"],
    /storage_account_name\s*=/
  );
  assert.match(
    stGen.files["modules/storage/outputs.tf"],
    /primary_access_key/
  );
  console.log("✓ Storage + Function App modular HCL looks good");

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
      scope: sharedScope(),
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
      scope: sharedScope(),
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
      scope: sharedScope(),
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
      scope: sharedScope(),
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
      scope: sharedScope(),
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
      scope: sharedScope(),
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
      scope: sharedScope(),
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
      scope: sharedScope(),
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
      scope: sharedScope(),
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
      scope: sharedScope(),
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
      scope: sharedScope(),
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
      scope: sharedScope(),
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
      scope: sharedScope(),
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
    "private-acr",
  ]) {
    assert.ok(getStarter(id), `starter ${id} missing`);
  }
  console.log("✓ All starters registered");


  // 10) Terraform import — RG + VNet + subnet refs, data source, unsupported type
  {
    const fixture = `
resource "azurerm_resource_group" "main" {
  name     = "rg-import-demo"
  location = "westeurope"
  tags = {
    Environment = "dev"
    ManagedBy   = "terraform"
  }
}

resource "azurerm_virtual_network" "main" {
  name                = "vnet-main"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  address_space       = ["10.0.0.0/16"]
}

resource "azurerm_subnet" "default" {
  name                 = "snet-default"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = ["10.0.1.0/24"]
}

data "azurerm_resource_group" "existing" {
  name = "rg-already-there"
}

resource "azurerm_kubernetes_cluster" "aks" {
  name = "aks-unsupported"
}

module "network" {
  source = "./modules/network"
}
`;
    const parsed = parseHcl(fixture, "fixture.tf");
    const summary = mapToProject(parsed);
    assert.equal(summary.supportedCount, 4); // 3 resources + 1 data
    assert.ok(summary.skipped.some((s) => s.type === "azurerm_kubernetes_cluster"));
    assert.ok(summary.skipped.some((s) => s.kind === "module"));
    const rg = summary.resources.find(
      (r) => r.type === "azurerm_resource_group" && !r.useExisting
    );
    assert.ok(rg);
    assert.equal(rg!.values.name, "rg-import-demo");
    assert.equal(rg!.values.location, "westeurope");
    const tags = rg!.values.tags as Record<string, string>;
    assert.equal(tags.Environment, "dev");

    const vnet = summary.resources.find((r) => r.type === "azurerm_virtual_network");
    assert.ok(vnet);
    assert.ok(isReferenceValue(vnet!.values.resource_group_name));
    assert.equal(
      (vnet!.values.resource_group_name as { resourceId: string }).resourceId,
      rg!.id
    );
    assert.equal(
      (vnet!.values.resource_group_name as { attr: string }).attr,
      "name"
    );
    assert.ok(isReferenceValue(vnet!.values.location));
    assert.deepEqual(vnet!.values.address_space, ["10.0.0.0/16"]);

    const subnet = summary.resources.find((r) => r.type === "azurerm_subnet");
    assert.ok(subnet);
    assert.ok(isReferenceValue(subnet!.values.virtual_network_name));
    assert.equal(
      (subnet!.values.virtual_network_name as { resourceId: string }).resourceId,
      vnet!.id
    );

    const dataRg = summary.resources.find((r) => r.useExisting);
    assert.ok(dataRg);
    assert.equal(dataRg!.type, "azurerm_resource_group");
    assert.equal(dataRg!.existingValues.name, "rg-already-there");

    const merged = mergeImportedResources([], summary.resources, "merge");
    assert.equal(merged.length, 4);
    // Import defaults to shared unless env-named
    assert.ok(merged.every((r) => r.scope?.kind === "shared" || r.scope?.kind === "environment"));
    const envNamed = merged.find((r) => String(r.values.name ?? "").includes("import-demo"));
    // tags.Environment = "dev" on the fixture → env scope (name alone has no token)
    assert.equal(envNamed?.scope.kind, "environment");
    assert.equal(
      envNamed?.scope.kind === "environment" ? envNamed.scope.environmentId : null,
      "dev"
    );
    console.log("✓ Import: RG/VNet/subnet refs + data source + unsupported/module skip");

    // Env-name + tags.Environment → env scope; plain names stay shared
    {
      const envFixture = `
resource "azurerm_resource_group" "dev_rg" {
  name     = "rg-myapp-dev"
  location = "westeurope"
}
resource "azurerm_resource_group" "tagged" {
  name     = "rg-plain"
  location = "westeurope"
  tags = {
    Environment = "staging"
  }
}
resource "azurerm_container_app" "web" {
  name = "ca-plain"
}
`;
      const envParsed = parseHcl(envFixture, "env-scope.tf");
      const envSummary = mapToProject(envParsed);
      const devRg = envSummary.resources.find((r) => r.tfName === "dev_rg");
      assert.ok(devRg);
      assert.equal(devRg!.scope.kind, "environment");
      assert.equal(
        devRg!.scope.kind === "environment" ? devRg!.scope.environmentId : null,
        "dev"
      );
      const tagged = envSummary.resources.find((r) => r.tfName === "tagged");
      assert.ok(tagged);
      assert.equal(tagged!.scope.kind, "environment");
      assert.equal(
        tagged!.scope.kind === "environment" ? tagged!.scope.environmentId : null,
        "staging"
      );
      console.log("✓ Import scope heuristics: env name + tags.Environment");
    }

  }

  // 11) Environment objects drive tfvars (not hard-coded)
  {
    const envs = defaultEnvironments();
    envs[0].knobs.acrSku = "Premium";
    envs[0].knobs.namingSuffix = "-customdev";
    envs[0].knobs.caCpu = 0.75;
    const { files } = generateProject(config, [], envs);
    assert.match(files["environments/dev.tfvars"], /acr_sku\s*=\s*"Premium"/);
    assert.match(files["environments/dev.tfvars"], /naming_prefix\s*=\s*"smoke-customdev"/);
    assert.match(files["environments/dev.tfvars"], /ca_cpu\s*=\s*0\.75/);
    assert.match(files["environments/staging.tfvars"], /acr_sku\s*=\s*"Standard"/);
    assert.match(files["environments/prod.tfvars"], /acr_sku\s*=\s*"Premium"/);
    assert.match(files["environments/prod.tfvars"], /ca_ingress_external\s*=\s*false/);
    assert.ok(files["environments/backend.dev.hcl"]);
    // Custom env id
    const custom = [
      ...defaultEnvironments(),
      {
        id: "qa",
        displayName: "QA",
        knobs: {
          namingSuffix: "-qa",
          tags: { Environment: "qa" },
          acrSku: "Basic",
          caCpu: 0.25,
          caMemory: "0.5Gi",
          caMinReplicas: 0,
          caMaxReplicas: 1,
          caIngressExternal: true,
        },
      },
    ];
    const customGen = generateProject(config, [], custom);
    assert.ok(customGen.files["environments/qa.tfvars"]);
    assert.match(customGen.files["environments/qa.tfvars"], /environment\s*=\s*"qa"/);
    assert.ok(customGen.files["environments/backend.qa.hcl"]);
    console.log("✓ Tfvars generated from Environment objects (incl. custom id)");
  }

  // 12) Scope filtering + no cross-env refs in picker logic
  {
    const envs = defaultEnvironments();
    const sharedRg: ResourceInstance = {
      id: "rg",
      type: "azurerm_resource_group",
      tfName: "main",
      useExisting: false,
      values: { name: "rg" },
      existingValues: {},
      scope: sharedScope(),
    };
    const devApp: ResourceInstance = {
      id: "app-dev",
      type: "azurerm_container_app",
      tfName: "app",
      useExisting: false,
      values: { name: "ca-dev" },
      existingValues: {},
      scope: envScope("dev"),
    };
    const prodApp: ResourceInstance = {
      id: "app-prod",
      type: "azurerm_container_app",
      tfName: "app_prod",
      useExisting: false,
      values: { name: "ca-prod" },
      existingValues: {},
      scope: envScope("prod"),
    };
    const all = [sharedRg, devApp, prodApp];
    const inDev = resourcesVisibleInEnv(all, "dev");
    assert.equal(inDev.length, 2);
    assert.ok(inDev.every((r) => r.id !== "app-prod"));
    const inProd = resourcesVisibleInEnv(all, "prod");
    assert.equal(inProd.length, 2);
    assert.ok(inProd.every((r) => r.id !== "app-dev"));

    assert.equal(canReference(devApp, sharedRg), true);
    assert.equal(canReference(devApp, prodApp), false);
    assert.equal(canReference(prodApp, devApp), false);
    assert.equal(canReference(sharedRg, prodApp), false);

    const candidates = filterRefCandidates(all, {
      currentId: "app-dev",
      refTypes: ["azurerm_container_app", "azurerm_resource_group"],
      activeEnvironmentId: "dev",
      current: devApp,
    });
    assert.ok(candidates.some((c) => c.id === "rg"));
    assert.ok(!candidates.some((c) => c.id === "app-prod"));
    assert.ok(!candidates.some((c) => c.id === "app-dev"));
    console.log("✓ Scope filtering + cross-env refs blocked in picker logic");
  }

  // 13) Starter scopes: foundation shared, apps env-scoped
  {
    nextId = 1;
    const aca = getStarter("acr-container-apps")!.build(config, makeId);
    const shared = aca.filter((r) => r.scope.kind === "shared");
    const scoped = aca.filter((r) => r.scope.kind === "environment");
    assert.ok(shared.length >= 5);
    assert.ok(scoped.some((r) => r.type === "azurerm_container_app"));
    assert.ok(
      scoped
        .filter((r) => r.type === "azurerm_container_app")
        .every((r) => r.scope.kind === "environment" && r.scope.environmentId === "dev")
    );
    console.log("✓ Starter scaffolds shared foundation + env-scoped app");

    nextId = 1;
    const funcStarter = getStarter("storage-function")!.build(config, makeId);
    assert.ok(
      funcStarter
        .filter((r) => r.type === "azurerm_storage_account")
        .every((r) => r.scope.kind === "shared")
    );
    assert.ok(
      funcStarter
        .filter((r) => r.type === "azurerm_linux_function_app")
        .every(
          (r) =>
            r.scope.kind === "environment" &&
            r.scope.environmentId === "dev"
        )
    );
    console.log("✓ Storage+Function starter: shared storage + env-scoped Function App");
  }

  // 14b) Function App catalogue HCL + import round-trip (best-effort)
  {
    nextId = 1;
    const rgId = makeId();
    const stId = makeId();
    const planId = makeId();
    const funcId = makeId();
    const resources: ResourceInstance[] = [
      {
        id: rgId,
        type: "azurerm_resource_group",
        tfName: "main",
        useExisting: false,
        values: { name: "rg-func", location: "westeurope", tags: {} },
        existingValues: {},
        scope: sharedScope(),
      },
      {
        id: stId,
        type: "azurerm_storage_account",
        tfName: "main",
        useExisting: false,
        values: {
          name: "stfunc001",
          resource_group_name: { resourceId: rgId, attr: "name" },
          location: { resourceId: rgId, attr: "location" },
          account_tier: "Standard",
          account_replication_type: "LRS",
          account_kind: "StorageV2",
          min_tls_version: "TLS1_2",
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
          name: "asp-func",
          resource_group_name: { resourceId: rgId, attr: "name" },
          location: { resourceId: rgId, attr: "location" },
          os_type: "Linux",
          sku_name: "Y1",
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
          name: "func-main",
          resource_group_name: { resourceId: rgId, attr: "name" },
          location: { resourceId: rgId, attr: "location" },
          service_plan_id: { resourceId: planId, attr: "id" },
          storage_account_id: { resourceId: stId, attr: "id" },
          runtime_stack: "python",
          runtime_version: "3.11",
          https_only: true,
          public_network_access_enabled: true,
          app_settings: { WEBSITE_RUN_FROM_PACKAGE: "1" },
          identity_type: "SystemAssigned",
          tags: {},
        },
        existingValues: {},
        scope: envScope("dev"),
      },
    ];
    const gen = generateProject(config, resources);
    const appSvc = gen.files["modules/app_service/main.tf"];
    assert.ok(appSvc);
    assert.match(appSvc, /resource "azurerm_linux_function_app" "main"/);
    assert.match(appSvc, /python_version\s*=\s*"3\.11"/);
    assert.match(appSvc, /https_only\s*=\s*true/);
    assert.match(appSvc, /WEBSITE_RUN_FROM_PACKAGE/);
    assert.match(appSvc, /identity\s*\{/);
    assert.match(appSvc, /SystemAssigned/);

    const fixture = `
resource "azurerm_resource_group" "main" {
  name     = "rg-func-import"
  location = "westeurope"
}

resource "azurerm_storage_account" "main" {
  name                     = "stfuncimport"
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
}

resource "azurerm_service_plan" "func" {
  name                = "asp-func"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  os_type             = "Linux"
  sku_name            = "Y1"
}

resource "azurerm_linux_function_app" "main" {
  name                       = "func-import"
  resource_group_name        = azurerm_resource_group.main.name
  location                   = azurerm_resource_group.main.location
  service_plan_id            = azurerm_service_plan.func.id
  storage_account_name       = azurerm_storage_account.main.name
  storage_account_access_key = azurerm_storage_account.main.primary_access_key
  https_only                 = true

  site_config {
    application_stack {
      node_version = "20"
    }
  }

  app_settings = {
    CUSTOM_SETTING = "yes"
  }
}
`;
    const parsed = parseHcl(fixture, "func.tf");
    const summary = mapToProject(parsed);
    const func = summary.resources.find(
      (r) => r.type === "azurerm_linux_function_app"
    );
    assert.ok(func, "Function App should be imported");
    assert.equal(func!.values.runtime_stack, "node");
    assert.equal(func!.values.runtime_version, "20");
    assert.ok(isReferenceValue(func!.values.storage_account_id));
    assert.ok(isReferenceValue(func!.values.service_plan_id));
    const settings = func!.values.app_settings as Record<string, string>;
    assert.equal(settings.CUSTOM_SETTING, "yes");
    console.log("✓ Function App HCL emit + import mapper");
  }




  // 14) Private ACR: PE + DNS zone (use existing) + VNet link + public access off
  {
    nextId = 1;
    const priv = getStarter("private-acr");
    assert.ok(priv);
    const resources = priv!.build(config, makeId);
    const dns = resources.find((r) => r.type === "azurerm_private_dns_zone");
    assert.ok(dns);
    assert.equal(dns!.useExisting, true);
    assert.equal(dns!.scope.kind, "shared");
    assert.equal(dns!.existingValues.name, "privatelink.azurecr.io");

    const link = resources.find(
      (r) => r.type === "azurerm_private_dns_zone_virtual_network_link"
    );
    assert.ok(link);
    assert.equal(link!.scope.kind, "shared");

    const pe = resources.find((r) => r.type === "azurerm_private_endpoint");
    assert.ok(pe);
    assert.equal(pe!.scope.kind, "shared");

    const acr = resources.find((r) => r.type === "azurerm_container_registry");
    assert.ok(acr);
    assert.equal(acr!.values.public_network_access_enabled, false);
    assert.equal(acr!.values.sku, "Premium");

    const gen = generateProject(
      { ...config, starter: "private-acr" },
      resources
    );
    assert.ok(gen.files["modules/private_networking/main.tf"]);
    const pn = gen.files["modules/private_networking/main.tf"];
    assert.match(pn, /data "azurerm_private_dns_zone"/);
    assert.match(pn, /privatelink\.azurecr\.io/);
    assert.match(pn, /resource "azurerm_private_dns_zone_virtual_network_link"/);
    assert.match(pn, /resource "azurerm_private_endpoint"/);
    assert.match(pn, /private_service_connection\s*\{/);
    assert.match(pn, /subresource_names\s*=\s*\["registry"\]/);
    assert.match(pn, /private_dns_zone_group\s*\{/);
    assert.match(pn, /private_dns_zone_ids/);

    const acrHcl = gen.files["modules/container_registry/main.tf"];
    assert.match(acrHcl, /public_network_access_enabled\s*=\s*false/);

    // Cross-env: shared PE may not reference env-scoped ACR
    const envAcr = {
      ...acr!,
      id: "acr-dev",
      scope: envScope("dev"),
    };
    const sharedPe = { ...pe!, id: "pe-shared", scope: sharedScope() };
    assert.equal(canReference(sharedPe, envAcr), false);
    assert.equal(canReference(sharedPe, { ...acr!, scope: sharedScope() }), true);

    console.log(
      "✓ Private ACR starter: PE + hub DNS (use existing) + VNet link + public off"
    );
  }

  // 15) Private Key Vault: PE vault + DNS zone (use existing) + VNet link + public off
  {
    nextId = 1;
    const priv = getStarter("private-key-vault");
    assert.ok(priv);
    const resources = priv!.build(config, makeId);
    const dns = resources.find((r) => r.type === "azurerm_private_dns_zone");
    assert.ok(dns);
    assert.equal(dns!.useExisting, true);
    assert.equal(dns!.scope.kind, "shared");
    assert.equal(dns!.existingValues.name, "privatelink.vaultcore.azure.net");

    const link = resources.find(
      (r) => r.type === "azurerm_private_dns_zone_virtual_network_link"
    );
    assert.ok(link);
    assert.equal(link!.scope.kind, "shared");

    const pe = resources.find((r) => r.type === "azurerm_private_endpoint");
    assert.ok(pe);
    assert.equal(pe!.values.subresource_names, "vault");
    assert.equal(pe!.values.private_connection_name, "psc-kv");
    assert.equal(pe!.scope.kind, "shared");

    const kv = resources.find((r) => r.type === "azurerm_key_vault");
    assert.ok(kv);
    assert.equal(kv!.values.public_network_access_enabled, false);

    const gen = generateProject(
      { ...config, starter: "private-key-vault" },
      resources
    );
    assert.ok(gen.files["modules/private_networking/main.tf"]);
    const pn = gen.files["modules/private_networking/main.tf"];
    assert.match(pn, /data "azurerm_private_dns_zone"/);
    assert.match(pn, /privatelink\.vaultcore\.azure\.net/);
    assert.match(pn, /resource "azurerm_private_dns_zone_virtual_network_link"/);
    assert.match(pn, /resource "azurerm_private_endpoint"/);
    assert.match(pn, /subresource_names\s*=\s*\["vault"\]/);
    assert.match(pn, /private_dns_zone_group\s*\{/);

    const kvHcl = gen.files["modules/security/main.tf"];
    assert.ok(kvHcl);
    assert.match(kvHcl, /public_network_access_enabled\s*=\s*false/);

    // Cross-env: shared PE may not reference env-scoped KV
    const envKv = {
      ...kv!,
      id: "kv-dev",
      scope: envScope("dev"),
    };
    const sharedPe = { ...pe!, id: "pe-shared", scope: sharedScope() };
    assert.equal(canReference(sharedPe, envKv), false);
    assert.equal(canReference(sharedPe, { ...kv!, scope: sharedScope() }), true);

    console.log(
      "✓ Private Key Vault starter: PE vault + hub DNS (use existing) + VNet link + public off"
    );
  }

  // 16) Private SQL: PE sqlServer + DNS zone (use existing) + VNet link + public off
  {
    nextId = 1;
    const priv = getStarter("private-sql");
    assert.ok(priv);
    const resources = priv!.build(config, makeId);
    const dns = resources.find((r) => r.type === "azurerm_private_dns_zone");
    assert.ok(dns);
    assert.equal(dns!.useExisting, true);
    assert.equal(dns!.scope.kind, "shared");
    assert.equal(dns!.existingValues.name, "privatelink.database.windows.net");

    const link = resources.find(
      (r) => r.type === "azurerm_private_dns_zone_virtual_network_link"
    );
    assert.ok(link);
    assert.equal(link!.scope.kind, "shared");

    const pe = resources.find((r) => r.type === "azurerm_private_endpoint");
    assert.ok(pe);
    assert.equal(pe!.values.subresource_names, "sqlServer");
    assert.equal(pe!.values.private_connection_name, "psc-sql");
    assert.equal(pe!.scope.kind, "shared");

    const sql = resources.find((r) => r.type === "azurerm_mssql_server");
    assert.ok(sql);
    assert.equal(sql!.values.public_network_access_enabled, false);

    const gen = generateProject(
      { ...config, starter: "private-sql" },
      resources
    );
    assert.ok(gen.files["modules/private_networking/main.tf"]);
    const pn = gen.files["modules/private_networking/main.tf"];
    assert.match(pn, /data "azurerm_private_dns_zone"/);
    assert.match(pn, /privatelink\.database\.windows\.net/);
    assert.match(pn, /resource "azurerm_private_dns_zone_virtual_network_link"/);
    assert.match(pn, /resource "azurerm_private_endpoint"/);
    assert.match(pn, /subresource_names\s*=\s*\["sqlServer"\]/);
    assert.match(pn, /private_dns_zone_group\s*\{/);

    const sqlHcl = gen.files["modules/database/main.tf"];
    assert.ok(sqlHcl);
    assert.match(sqlHcl, /public_network_access_enabled\s*=\s*false/);

    // Cross-env: shared PE may not reference env-scoped SQL
    const envSql = {
      ...sql!,
      id: "sql-dev",
      scope: envScope("dev"),
    };
    const sharedPe = { ...pe!, id: "pe-shared", scope: sharedScope() };
    assert.equal(canReference(sharedPe, envSql), false);
    assert.equal(
      canReference(sharedPe, { ...sql!, scope: sharedScope() }),
      true
    );

    console.log(
      "✓ Private SQL starter: PE sqlServer + hub DNS (use existing) + VNet link + public off"
    );
  }

  // 17) PE catalogue: one type targets ACR | KV | SQL via subresource
  {
    const peDef = getResourceType("azurerm_private_endpoint");
    assert.ok(peDef);
    const sub = peDef!.fields.find((f) => f.key === "subresource_names");
    assert.ok(sub);
    const vals = (sub!.options ?? []).map((o) => o.value);
    assert.ok(vals.includes("registry"));
    assert.ok(vals.includes("vault"));
    assert.ok(vals.includes("sqlServer"));
    const target = peDef!.fields.find(
      (f) => f.key === "private_connection_resource_id"
    );
    assert.ok(target);
    for (const t of [
      "azurerm_container_registry",
      "azurerm_key_vault",
      "azurerm_mssql_server",
    ]) {
      assert.ok(target!.refTypes?.includes(t), `missing refType ${t}`);
    }
    console.log("✓ PE catalogue: ACR | KV | SQL subresources + target refs");
  }

  console.log("\nAll generate smoke tests passed.");
}

main();
