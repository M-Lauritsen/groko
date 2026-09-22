/**
 * Smoke test: modular TF + MI/AcrPull + VNet CAE + env tfvars/backend.
 */
import assert from "node:assert/strict";
import { generateProject, previewHcl } from "../src/lib/generate/hcl";
import { getStarter } from "../src/lib/schema/starters";
import { getResourceType } from "../src/lib/schema/resources";
import {
  defaultExportConfig,
  type ProjectConfig,
  type ResourceInstance,
} from "../src/lib/schema/types";
import {
  defaultEnvironments,
  envScope,
  filterRefCandidates,
  canReference,
  mapResourceReferences,
  resourcesVisibleInEnv,
  sharedScope,
} from "../src/lib/schema/environments";
import { parseHcl, parseHclFiles } from "../src/lib/import/parse";
import { mapToProject, mergeImportedResources } from "../src/lib/import/mapToProject";
import {
  createImportDiagnosticReport,
  IMPORT_DIAGNOSTIC_REPORT_FILE_NAME,
} from "../src/lib/import/report";
import { isReferenceValue } from "../src/lib/schema/types";
import {
  RESOURCE_TYPE_ORDER,
  sortResourcesByBuildOrder,
} from "../src/lib/generate/modules";
import {
  buildProjectZipBuffer,
  downloadProjectZip,
  OrphanConfirmationRequiredError,
} from "../src/lib/generate/zip";
import { MissingExistingIdentifierError } from "../src/lib/generate/existing-identifiers";
import { withResourceModule } from "../src/lib/generate/export-map";

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

async function main() {
  console.log("Azure TF Builder — generate smoke test\n");

  // One canonical order drives block output and module/export metadata.
  {
    const types = [
      "azurerm_private_endpoint",
      "azurerm_container_app",
      "azurerm_resource_group",
      "azurerm_log_analytics_workspace",
      "azurerm_virtual_network",
      "azurerm_user_assigned_identity",
    ];
    const ordered = sortResourcesByBuildOrder(
      types.map((type, index) => ({
        id: `order_${index}`,
        type,
        tfName: `resource_${index}`,
        useExisting: false,
        values: {},
        existingValues: {},
        scope: sharedScope(),
      }))
    );
    assert.deepEqual(
      ordered.map((resource) => resource.type),
      [
        "azurerm_resource_group",
        "azurerm_virtual_network",
        "azurerm_log_analytics_workspace",
        "azurerm_user_assigned_identity",
        "azurerm_container_app",
        "azurerm_private_endpoint",
      ]
    );
    assert.equal(RESOURCE_TYPE_ORDER.at(-1), "azurerm_private_endpoint");
    console.log("✓ canonical resource build order");
  }

  // 1) Modular layout basics
  const starter = getStarter("vnet-vm");
  assert.ok(starter);
  const resources = starter!.build(config, makeId);
  const { files, sensitiveVars } = generateProject(config, resources);
  assert.ok(files["config.tf"]);
  assert.match(
    files["main.tf"],
    /Module order is a stable build guide; Terraform schedules references automatically\./
  );
  assert.match(files["README.md"], /## Stable build order/);
  assert.match(
    files["README.md"],
    /Terraform does not apply these blocks sequentially/
  );
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

  // 3) Storage + Function App (+ Application Insights)
  nextId = 1;
  const storage = getStarter("storage-function")!.build(config, makeId);
  assert.ok(
    storage.some((r) => r.type === "azurerm_linux_function_app"),
    "starter must include Function App"
  );
  assert.ok(
    storage.some((r) => r.type === "azurerm_application_insights"),
    "starter must include Application Insights"
  );
  assert.ok(
    storage.find((r) => r.type === "azurerm_linux_function_app")?.scope.kind ===
      "environment"
  );
  assert.ok(
    storage.find((r) => r.type === "azurerm_application_insights")?.scope
      .kind === "environment"
  );
  const stGen = generateProject(
    { ...config, starter: "storage-function" },
    storage
  );
  const stHcl = allHcl(stGen.files);
  assert.match(stHcl, /sku_name\s*=\s*"Y1"/);
  assert.match(stHcl, /resource "azurerm_linux_function_app"/);
  assert.match(stHcl, /resource "azurerm_application_insights"/);
  assert.match(stHcl, /storage_account_name/);
  assert.match(stHcl, /storage_account_access_key/);
  assert.match(stHcl, /primary_access_key/);
  assert.match(stHcl, /application_stack/);
  assert.match(stHcl, /node_version\s*=\s*"20"/);
  assert.match(stHcl, /application_insights_connection_string/);
  assert.match(stHcl, /application_insights_key/);
  assert.match(stHcl, /connection_string/);
  assert.ok(stGen.files["modules/app_service/main.tf"]);
  assert.ok(stGen.files["modules/storage/main.tf"]);
  assert.match(
    stGen.files["modules/app_service/main.tf"],
    /storage_account_name\s*=/
  );
  assert.match(
    stGen.files["modules/app_service/main.tf"],
    /resource "azurerm_application_insights"/
  );
  assert.match(
    stGen.files["modules/storage/outputs.tf"],
    /primary_access_key/
  );
  console.log("✓ Storage + Function App + App Insights modular HCL looks good");

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
  const richWithoutVault = rich
    .filter((resource) => resource.id !== rKv)
    .map((resource) =>
      resource.id === rApp
        ? mapResourceReferences(resource, (reference) =>
            reference.resourceId === rKv ? undefined : reference
          )
        : resource
    );
  assert.doesNotMatch(
    allHcl(generateProject(config, richWithoutVault).files),
    /UNRESOLVED_REF/,
    "removing a Key Vault must not leave an unresolved nested app secret reference"
  );
  console.log("✓ Richer CA: env {, http_scale_rule, KV secret + auto RBAC");

  // 8) Preview
  {
    const enteredName = "  rg-existing  ";
    const invalidExisting: ResourceInstance = {
      id: "invalid-existing",
      type: "azurerm_resource_group",
      tfName: "invalid_existing",
      useExisting: true,
      values: { name: "source-name" },
      existingValues: { name: " \t " },
      scope: sharedScope(),
    };
    const trimmedExisting: ResourceInstance = {
      id: "trimmed-existing",
      type: "azurerm_resource_group",
      tfName: "trimmed_existing",
      useExisting: true,
      values: {},
      existingValues: { name: enteredName },
      scope: sharedScope(),
    };
    const existingGen = generateProject(config, [invalidExisting, trimmedExisting]);
    const existingHcl = allHcl(existingGen.files);
    assert.equal(existingGen.validationIssues.length, 1);
    assert.equal(existingGen.validationIssues[0].resourceId, "invalid-existing");
    assert.equal(existingGen.validationIssues[0].resourceLabel, "Resource Group");
    assert.equal(existingGen.validationIssues[0].resourceName, "source-name");
    assert.equal(existingGen.validationIssues[0].fieldLabel, "Name");
    assert.match(existingHcl, /INVALID EXISTING IDENTIFIER: Name is required before export/);
    assert.doesNotMatch(existingHcl, /name = "TODO"/);
    assert.match(existingHcl, /name = "rg-existing"/);
    assert.equal(
      trimmedExisting.existingValues.name,
      enteredName,
      "generation must not rewrite the entered Resource state"
    );
    console.log("✓ Existing identifier diagnostics + trimmed emission");
  }

  {
    const invalidExisting: ResourceInstance = {
      id: "zip-invalid-existing",
      type: "azurerm_resource_group",
      tfName: "zip_invalid_existing",
      useExisting: true,
      values: { name: "source-name" },
      existingValues: { name: "" },
      scope: sharedScope(),
    };
    await assert.rejects(
      () => buildProjectZipBuffer(config, [invalidExisting]),
      (error: unknown) =>
        error instanceof MissingExistingIdentifierError &&
        error.code === "missing-existing-identifier" &&
        error.issues.length === 1 &&
        error.issues[0].resourceId === invalidExisting.id,
      "ZIP creation must reject invalid included Existing identifiers"
    );
    console.log("✓ ZIP boundary rejects invalid Existing identifiers");
  }

  {
    const orphan: ResourceInstance = {
      id: "zip-orphan",
      type: "azurerm_resource_group",
      tfName: "zip_orphan",
      useExisting: false,
      values: { name: "zip-orphan", location: "westeurope" },
      existingValues: {},
      scope: sharedScope(),
    };
    const exportConfig = withResourceModule(
      defaultExportConfig(),
      orphan.id,
      null
    );
    for (const createZip of [
      () => buildProjectZipBuffer(config, [orphan], undefined, exportConfig),
      () => downloadProjectZip(config, [orphan], undefined, exportConfig),
    ]) {
      await assert.rejects(
        createZip,
        (error: unknown) =>
          error instanceof OrphanConfirmationRequiredError &&
          error.code === "orphan-confirmation-required" &&
          error.orphans[0]?.id === orphan.id,
        "each public ZIP API must reject an unconfirmed orphan"
      );
    }
    const zip = await buildProjectZipBuffer(
      config,
      [orphan],
      undefined,
      exportConfig,
      { leaveUnmappedConfirmed: true }
    );
    assert.ok(zip.length > 0, "confirmed orphan exclusion permits ZIP creation");
    await assert.doesNotReject(
      () =>
        downloadProjectZip(
          config,
          [orphan],
          undefined,
          exportConfig,
          { leaveUnmappedConfirmed: true }
        ),
      "confirmed orphan exclusion permits direct ZIP download"
    );
    console.log("✓ ZIP APIs require explicit orphan confirmation");
  }

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
  name                = "vnet-dev"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  address_space       = ["10.0.0.0/16"]
}

resource "azurerm_subnet" "default" {
  name                 = "snet-dev"
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

    const nestedImported = mergeImportedResources([], [
      {
        id: "imported-vault",
        type: "azurerm_key_vault",
        tfName: "vault",
        useExisting: false,
        values: { name: "kv-imported" },
        existingValues: {},
        scope: sharedScope(),
      },
      {
        id: "imported-app",
        type: "azurerm_container_app",
        tfName: "app",
        useExisting: false,
        values: {
          name: "app-imported",
          app_secrets: [{
            name: "api-key",
            source: "key_vault",
            key_vault_id: { resourceId: "imported-vault", attr: "id" },
            secret_name: "api-key",
          }],
        },
        existingValues: {},
        scope: sharedScope(),
      },
    ], "merge");
    const mergedVault = nestedImported.find((resource) => resource.tfName === "vault")!;
    const mergedApp = nestedImported.find((resource) => resource.tfName === "app")!;
    const nestedVaultRef = (mergedApp.values.app_secrets as Array<{ key_vault_id: { resourceId: string } }>)[0].key_vault_id;
    assert.equal(nestedVaultRef.resourceId, mergedVault.id, "merge must remap nested Key Vault references");
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
    assert.ok(
      funcStarter
        .filter((r) => r.type === "azurerm_application_insights")
        .every(
          (r) =>
            r.scope.kind === "environment" &&
            r.scope.environmentId === "dev"
        )
    );
    const funcRes = funcStarter.find(
      (r) => r.type === "azurerm_linux_function_app"
    );
    assert.ok(isReferenceValue(funcRes!.values.application_insights_id));
    console.log(
      "✓ Storage+Function starter: shared storage + env-scoped Function App + App Insights"
    );
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
  name                = "asp-func-dev"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  os_type             = "Linux"
  sku_name            = "Y1"
}

resource "azurerm_linux_function_app" "main" {
  name                       = "func-import-dev"
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

  // 14c) Application Insights catalogue + Function App optional ref (not buried checkbox)
  {
    nextId = 1;
    const rgId = makeId();
    const stId = makeId();
    const planId = makeId();
    const lawId = makeId();
    const aiId = makeId();
    const funcId = makeId();
    const resources: ResourceInstance[] = [
      {
        id: rgId,
        type: "azurerm_resource_group",
        tfName: "main",
        useExisting: false,
        values: { name: "rg-ai", location: "westeurope", tags: {} },
        existingValues: {},
        scope: sharedScope(),
      },
      {
        id: stId,
        type: "azurerm_storage_account",
        tfName: "main",
        useExisting: false,
        values: {
          name: "stai001",
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
        id: lawId,
        type: "azurerm_log_analytics_workspace",
        tfName: "main",
        useExisting: false,
        values: {
          name: "log-ai",
          resource_group_name: { resourceId: rgId, attr: "name" },
          location: { resourceId: rgId, attr: "location" },
          sku: "PerGB2018",
          retention_in_days: 30,
        },
        existingValues: {},
        scope: sharedScope(),
      },
      {
        id: aiId,
        type: "azurerm_application_insights",
        tfName: "func",
        useExisting: false,
        values: {
          name: "appi-func",
          resource_group_name: { resourceId: rgId, attr: "name" },
          location: { resourceId: rgId, attr: "location" },
          application_type: "web",
          workspace_id: { resourceId: lawId, attr: "id" },
          tags: {},
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
          name: "func-ai",
          resource_group_name: { resourceId: rgId, attr: "name" },
          location: { resourceId: rgId, attr: "location" },
          service_plan_id: { resourceId: planId, attr: "id" },
          storage_account_id: { resourceId: stId, attr: "id" },
          application_insights_id: { resourceId: aiId, attr: "id" },
          runtime_stack: "node",
          runtime_version: "20",
          https_only: true,
          public_network_access_enabled: true,
          app_settings: {},
          identity_type: "None",
          tags: {},
        },
        existingValues: {},
        scope: envScope("dev"),
      },
    ];
    const gen = generateProject(config, resources);
    const appSvc = gen.files["modules/app_service/main.tf"];
    assert.ok(appSvc);
    assert.match(appSvc, /resource "azurerm_application_insights" "func"/);
    assert.match(appSvc, /application_type\s*=\s*"web"/);
    assert.match(appSvc, /workspace_id\s*=/);
    assert.match(appSvc, /application_insights_connection_string\s*=/);
    assert.match(appSvc, /application_insights_key\s*=/);
    assert.match(appSvc, /connection_string/);
    assert.match(appSvc, /instrumentation_key/);
    // Sensitive AI outputs
    const outs = gen.files["modules/app_service/outputs.tf"];
    assert.match(outs, /connection_string/);
    assert.match(outs, /sensitive\s*=\s*true/);

    // Existing App Insights data source
    const existingAi: ResourceInstance[] = [
      {
        id: "ai-exist",
        type: "azurerm_application_insights",
        tfName: "existing",
        useExisting: true,
        values: {},
        existingValues: {
          name: "appi-existing",
          resource_group_name: "rg-ai",
        },
        scope: envScope("dev"),
      },
    ];
    const existGen = generateProject(config, existingAi);
    assert.match(
      existGen.files["modules/app_service/main.tf"],
      /data "azurerm_application_insights" "existing"/
    );

    // Import: AI resource + Function wired via connection_string
    const fixture = `
resource "azurerm_resource_group" "main" {
  name     = "rg-ai-import"
  location = "westeurope"
}

resource "azurerm_application_insights" "func" {
  name                = "appi-import"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  application_type    = "web"
}

resource "azurerm_storage_account" "main" {
  name                     = "staiimport"
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
  name                       = "func-ai-import"
  resource_group_name        = azurerm_resource_group.main.name
  location                   = azurerm_resource_group.main.location
  service_plan_id            = azurerm_service_plan.func.id
  storage_account_name       = azurerm_storage_account.main.name
  storage_account_access_key = azurerm_storage_account.main.primary_access_key
  application_insights_connection_string = azurerm_application_insights.func.connection_string
  https_only                 = true

  site_config {
    application_stack {
      node_version = "20"
    }
  }
}
`;
    const parsed = parseHcl(fixture, "ai.tf");
    const summary = mapToProject(parsed);
    const ai = summary.resources.find(
      (r) => r.type === "azurerm_application_insights"
    );
    assert.ok(ai, "Application Insights should be imported");
    assert.equal(ai!.values.application_type, "web");
    const func = summary.resources.find(
      (r) => r.type === "azurerm_linux_function_app"
    );
    assert.ok(func);
    assert.ok(
      isReferenceValue(func!.values.application_insights_id),
      "Function App should ref Application Insights"
    );
    console.log("✓ Application Insights catalogue + Function App optional ref");
  }

  // 14d) Storage Container imports as a typed child of a Storage Account.
  {
    const fixture = `
resource "azurerm_storage_account" "main" {
  name                     = "stcontainerimport"
  resource_group_name      = "rg-import"
  location                 = "westeurope"
  account_tier             = "Standard"
  account_replication_type = "LRS"
}

resource "azurerm_storage_container" "uploads" {
  name                  = "uploads"
  storage_account_id    = azurerm_storage_account.main.id
  container_access_type = "private"
}
`;
    const summary = mapToProject(parseHcl(fixture, "storage-container.tf"));
    const storageAccount = summary.resources.find(
      (resource) => resource.type === "azurerm_storage_account"
    );
    const container = summary.resources.find(
      (resource) => resource.type === "azurerm_storage_container"
    );
    assert.ok(storageAccount);
    assert.ok(container, "Storage Container should be imported");
    assert.equal(container!.values.name, "uploads");
    assert.equal(container!.values.container_access_type, "private");
    assert.ok(isReferenceValue(container!.values.storage_account_id));

    const generated = generateProject(config, summary.resources);
    const storageHcl = generated.files["modules/storage/main.tf"];
    assert.match(storageHcl, /resource "azurerm_storage_container" "uploads"/);
    assert.match(storageHcl, /storage_account_id\s*=\s*azurerm_storage_account\.main\.id/);
    assert.match(storageHcl, /container_access_type\s*=\s*"private"/);
    console.log("✓ Storage Container HCL import + export");
  }

  // 14e) Import diagnostic reports contain only sanitized transient outcomes.
  {
    const secret = "Server=tcp:private.example;Password=not-for-report";
    const parsed = parseHclFiles([
      {
        name: "C:/Users/example/private-config.tf",
        content: `
resource "azurerm_resource_group" "main" {
  name = "rg-import"
  location = "westeurope"
  connection_string = "${secret}"
}

resource "azurerm_unknown_service" "unsupported" {}
`,
      },
    ]);
    parsed.warnings.push(`C:/Users/example/private-config.tf: ${secret}`);
    parsed.warningUploadIndexes?.push(0);
    const summary = mapToProject(parsed);
    const report = createImportDiagnosticReport(
      1,
      parsed,
      summary,
      "2026-09-21T12:00:00.000Z"
    );
    const json = JSON.stringify(report);

    assert.equal(IMPORT_DIAGNOSTIC_REPORT_FILE_NAME, "groko-import-report.json");
    assert.equal(report.reportVersion, 2);
    assert.equal(report.generatedAt, "2026-09-21T12:00:00.000Z");
    assert.deepEqual(report.summary, {
      filesRead: 1,
      mappedResources: 1,
      couldNotMap: 1,
      partiallyMappedFields: 1,
      notes: 2,
    });
    assert.deepEqual(report.outcomes.mapped[0], {
      uploadIndex: 0,
      sourcePath: null,
      kind: "resource",
      catalogueLabel: "Resource Group",
      sourceType: "azurerm_resource_group",
      sourceName: "main",
      mappingStatus: "partiallyMapped",
      mappedFieldNames: ["location", "name"],
      unmappedFieldNames: ["connection_string"],
      unsupportedConstructs: [],
    });
    assert.deepEqual(report.outcomes.skipped[0], {
      uploadIndex: 0,
      sourcePath: null,
      kind: "resource",
      sourceType: "azurerm_unknown_service",
      sourceName: "unsupported",
      reasonCode: "resource_type_not_supported",
      reason: "Type not in RESOURCE_CATALOGUE",
    });
    assert.deepEqual(report.notes, [
      {
        uploadIndex: 0,
        category: "mapping",
        message: "Some fields could not be mapped.",
      },
      {
        uploadIndex: 0,
        category: "parse",
        message: "Some source content could not be read.",
      },
    ]);
    assert.doesNotMatch(json, /private-config|C:\/|Password=|Server=tcp|not-for-report/);
    console.log("✓ Import diagnostic report sanitization");
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

  // 17) PE catalogue: one type targets ACR | KV | SQL | Storage via subresource
  {
    const peDef = getResourceType("azurerm_private_endpoint");
    assert.ok(peDef);
    const sub = peDef!.fields.find((f) => f.key === "subresource_names");
    assert.ok(sub);
    const vals = (sub!.options ?? []).map((o) => o.value);
    assert.ok(vals.includes("registry"));
    assert.ok(vals.includes("vault"));
    assert.ok(vals.includes("sqlServer"));
    assert.ok(vals.includes("blob"));
    const target = peDef!.fields.find(
      (f) => f.key === "private_connection_resource_id"
    );
    assert.ok(target);
    for (const t of [
      "azurerm_container_registry",
      "azurerm_key_vault",
      "azurerm_mssql_server",
      "azurerm_storage_account",
    ]) {
      assert.ok(target!.refTypes?.includes(t), `missing refType ${t}`);
    }
    console.log("✓ PE catalogue: ACR | KV | SQL | Storage subresources + target refs");
  }

  // 18) Static Storage PE, CAE infrastructure RG, and Blob Contributor role emit
  {
    const resourceGroupId = "rg-static";
    const storageAccountId = "storage-static";
    const identityId = "identity-static";
    const privateZoneId = "zone-static";
    const privateEndpointId = "endpoint-static";
    const caeId = "cae-static";
    const roleAssignmentId = "role-static";
    const resources: ResourceInstance[] = [
      {
        id: resourceGroupId,
        type: "azurerm_resource_group",
        tfName: "main",
        useExisting: false,
        values: { name: "rg-static", location: "westeurope" },
        existingValues: {},
        scope: sharedScope(),
      },
      {
        id: storageAccountId,
        type: "azurerm_storage_account",
        tfName: "blobstore",
        useExisting: false,
        values: {
          name: "blobstorestatic",
          resource_group_name: { resourceId: resourceGroupId, attr: "name" },
          location: { resourceId: resourceGroupId, attr: "location" },
          account_tier: "Standard",
          account_replication_type: "LRS",
        },
        existingValues: {},
        scope: sharedScope(),
      },
      {
        id: identityId,
        type: "azurerm_user_assigned_identity",
        tfName: "blob_reader",
        useExisting: false,
        values: {
          name: "id-blob-reader",
          resource_group_name: { resourceId: resourceGroupId, attr: "name" },
          location: { resourceId: resourceGroupId, attr: "location" },
        },
        existingValues: {},
        scope: sharedScope(),
      },
      {
        id: privateZoneId,
        type: "azurerm_private_dns_zone",
        tfName: "blob",
        useExisting: false,
        values: {
          name: "privatelink.blob.core.windows.net",
          resource_group_name: { resourceId: resourceGroupId, attr: "name" },
        },
        existingValues: {},
        scope: sharedScope(),
      },
      {
        id: privateEndpointId,
        type: "azurerm_private_endpoint",
        tfName: "blob",
        useExisting: false,
        values: {
          name: "pe-blob",
          resource_group_name: { resourceId: resourceGroupId, attr: "name" },
          location: { resourceId: resourceGroupId, attr: "location" },
          subnet_id: "/subscriptions/example/subnets/private-endpoints",
          private_connection_name: "psc-blob",
          private_connection_resource_id: { resourceId: storageAccountId, attr: "id" },
          subresource_names: "blob",
          private_dns_zone_id: { resourceId: privateZoneId, attr: "id" },
        },
        existingValues: {},
        scope: sharedScope(),
      },
      {
        id: caeId,
        type: "azurerm_container_app_environment",
        tfName: "main",
        useExisting: false,
        values: {
          name: "cae-static",
          resource_group_name: { resourceId: resourceGroupId, attr: "name" },
          location: { resourceId: resourceGroupId, attr: "location" },
          infrastructure_resource_group_name: "rg-cae-managed",
        },
        existingValues: {},
        scope: sharedScope(),
      },
      {
        id: roleAssignmentId,
        type: "azurerm_role_assignment",
        tfName: "blob_contributor",
        useExisting: false,
        values: {
          scope: { resourceId: storageAccountId, attr: "id" },
          role_definition_name: "Storage Blob Data Contributor",
          principal_id: { resourceId: identityId, attr: "principal_id" },
        },
        existingValues: {},
        scope: sharedScope(),
      },
    ];
    const generated = generateProject(config, resources);
    const privateNetworking = generated.files["modules/private_networking/main.tf"];
    const containerApps = generated.files["modules/container_apps/main.tf"];
    const identity = generated.files["modules/identity/main.tf"];
    assert.match(privateNetworking, /subresource_names\s*=\s*\["blob"\]/);
    assert.match(privateNetworking, /private_dns_zone_group\s*\{/);
    assert.match(containerApps, /infrastructure_resource_group_name\s*=\s*"rg-cae-managed"/);
    assert.match(identity, /role_definition_name\s*=\s*"Storage Blob Data Contributor"/);
    assert.match(identity, /scope\s*=\s*var\./);
    console.log("✓ Static Storage PE, CAE infrastructure RG, and Blob Contributor emit");
  }

  // 19) Invalid legacy PE / Role Assignment pairs must never reach Terraform
  {
    const resources: ResourceInstance[] = [
      {
        id: "storage",
        type: "azurerm_storage_account",
        tfName: "data",
        useExisting: false,
        values: {},
        existingValues: {},
        scope: sharedScope(),
      },
      {
        id: "identity",
        type: "azurerm_user_assigned_identity",
        tfName: "app",
        useExisting: false,
        values: {},
        existingValues: {},
        scope: sharedScope(),
      },
      {
        id: "endpoint",
        type: "azurerm_private_endpoint",
        tfName: "legacy",
        useExisting: false,
        values: {
          private_connection_resource_id: { resourceId: "storage", attr: "id" },
          subresource_names: "vault",
        },
        existingValues: {},
        scope: sharedScope(),
      },
      {
        id: "assignment",
        type: "azurerm_role_assignment",
        tfName: "legacy",
        useExisting: false,
        values: {
          scope: { resourceId: "storage", attr: "id" },
          role_definition_name: "AcrPull",
          principal_id: { resourceId: "identity", attr: "principal_id" },
        },
        existingValues: {},
        scope: sharedScope(),
      },
    ];
    const hcl = allHcl(generateProject(config, resources).files);
    assert.match(hcl, /subresource_names\s*=\s*\["blob"\]/);
    assert.doesNotMatch(hcl, /subresource_names\s*=\s*\["vault"\]/);
    assert.doesNotMatch(hcl, /resource "azurerm_role_assignment" "legacy"/);
    console.log("✓ Invalid legacy PE normalizes; invalid Role Assignment is omitted");
  }

  console.log("\nAll generate smoke tests passed.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
