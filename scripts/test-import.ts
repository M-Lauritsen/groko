import assert from "node:assert/strict";
import type { ResourceInstance } from "../src/lib/schema/types";
import type { InvalidImportReference } from "../src/lib/import";
import {
  isPrivateEndpointTargetCompatible,
  isRoleAssignmentScopeCompatible,
} from "../src/lib/schema/resources";
import JSZip from "jszip";
import {
  createImportDiagnosticReport,
  findInvalidImportReferences,
  getImportSkipDiagnostic,
  importFromUpload,
  mapToProject,
  parseHclFiles,
  readImportUpload,
  readFilesFromUpload,
} from "../src/lib/import";
import { mergeImportedResources } from "../src/lib/import/mapToProject";
import { sharedScope } from "../src/lib/schema/environments";
import { tokenize } from "../src/lib/import/tokenize";

async function main() {
  const conditionalFiles = [
    { name: "main.tf", content: `
variable "environment" {}
locals { deploy = var.environment != "edt" && !(var.environment == "off") }
resource "azurerm_resource_group" "created" {
  count = local.deploy ? 1 : 0
  name = "rg-example"
  location = "westeurope"
}
data "azurerm_resource_group" "existing" {
  count = local.deploy ? 0 : 1
  name = "rg-existing"
}
module "backend" {
  count = local.deploy ? 1 : 0
  source = "./backend"
  name = "rg-backend"
}
resource "azurerm_container_app_environment" "app" {
  name = "cae-example"
  resource_group_name = local.deploy ? azurerm_resource_group.created[0].name : data.azurerm_resource_group.existing[0].name
  location = "westeurope"
  infrastructure_resource_group_name = local.deploy ? "\${module.backend[0].name}-managed" : "rg-existing-managed"
  zone_redundancy_enabled = var.environment == "prd"
}
resource "azurerm_resource_group" "unknown" { count = var.missing ? 1 : 0 }
resource "azurerm_resource_group" "many" { count = 2 }
` },
    { name: "backend/main.tf", content: `
variable "name" {}
resource "azurerm_resource_group" "main" { name = var.name location = "westeurope" }
output "name" { value = azurerm_resource_group.main.name }
` },
    { name: "editor.tfvars", content: 'environment = "edt"' },
    { name: "prod.tfvars", content: 'environment = "prd"' },
  ];
  for (const [profile, deployed] of [["editor", false], ["prod", true]] as const) {
    const conditional = mapToProject(parseHclFiles(conditionalFiles, `${profile}.tfvars`));
    assert.equal(conditional.resources.length, deployed ? 3 : 2, "only active count instances should map");
    assert.equal(conditional.skipped.length, 2, "unknown and larger counts must remain explicit skips");
    const group = conditional.resources.find((resource) => resource.tfName === (deployed ? "created" : "existing"));
    assert.ok(group);
    assert.equal(group.useExisting, !deployed);
    const app = conditional.resources.find((resource) => resource.tfName === "app");
    assert.ok(app);
    assert.deepEqual(app.values.resource_group_name, { resourceId: group.id, attr: "name" });
    assert.equal(app.values.zone_redundancy_enabled, deployed);
    assert.equal(app.values.infrastructure_resource_group_name, deployed ? "rg-backend-managed" : "rg-existing-managed");
    assert.equal(JSON.stringify(conditional.resources).includes("__expr"), false);
  }

  const stableResources = (resources: ResourceInstance[]) => {
    const identities = new Map(resources.map((resource) => [resource.id, `${resource.type}.${resource.tfName}`]));
    return resources.map((resource) => JSON.parse(JSON.stringify({ ...resource, id: identities.get(resource.id) }, (key, value) =>
      key === "resourceId" ? identities.get(value) : value
    ))).sort((left, right) => left.id.localeCompare(right.id));
  };
  for (const wrapper of ["", "archive/terraform/"]) {
    for (const reverse of [false, true]) {
      const archive = new JSZip();
      for (const file of reverse ? [...conditionalFiles].reverse() : conditionalFiles) archive.file(`${wrapper}${file.name}`, file.content);
      const bytes = await archive.generateAsync({ type: "uint8array" });
      const upload = await readImportUpload([{ name: "conditional.zip", arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } as File]);
      assert.equal(upload.rootProfiles.length, 2);
      for (const profile of ["editor", "prod"]) {
        const session = importFromUpload(upload, `${wrapper}${profile}.tfvars`);
        assert.deepEqual(stableResources(session.resources), stableResources(mapToProject(parseHclFiles(conditionalFiles, `${profile}.tfvars`)).resources));
        assert.equal(findInvalidImportReferences(session.resources).length, 0);
      }
    }
  }

  const interpolatedName = 'ca-${replace(domain_key, "_", "-")}-example-${var.environment}';
  const countBoundaries = mapToProject(parseHclFiles([{ name: "main.tf", content: `
locals {
  cycle = local.cycle
  chosen = coalesce(null, "", "rg-chosen")
}
resource "azurerm_resource_group" "present" { count = (2 >= 1 && true) ? 1 : 0 name = local.chosen location = "westeurope" }
resource "azurerm_resource_group" "absent" { count = false ? 1 : 0 }
resource "azurerm_resource_group" "uncounted" { name = "plain" location = "westeurope" }
resource "azurerm_resource_group" "unknown" { count = var.unknown ? 1 : 0 }
resource "azurerm_resource_group" "unknown_boolean" { count = false && var.unknown ? 1 : 0 }
resource "azurerm_resource_group" "cyclic" { count = local.cycle ? 1 : 0 }
resource "azurerm_resource_group" "string_count" { count = "1" }
resource "azurerm_resource_group" "fraction" { count = 0.5 }
resource "azurerm_resource_group" "negative" { count = -1 }
resource "azurerm_resource_group" "many" { count = 2 }
resource "azurerm_resource_group" "function" { count = length([]) }
resource "azurerm_resource_group" "invalid_token" { count = true @ ? 1 : 0 }
resource "azurerm_virtual_network" "valid" { resource_group_name = azurerm_resource_group.present[0].name }
resource "azurerm_virtual_network" "zero" { resource_group_name = azurerm_resource_group.absent[0].name }
resource "azurerm_virtual_network" "wrong_index" { resource_group_name = azurerm_resource_group.present[1].name }
resource "azurerm_virtual_network" "missing_index" { resource_group_name = azurerm_resource_group.present.name }
resource "azurerm_virtual_network" "spurious_index" { resource_group_name = azurerm_resource_group.uncounted[0].name }
` }]));
  assert.equal(countBoundaries.skipped.length, 9);
  const chosenGroup = countBoundaries.resources.find((resource) => resource.tfName === "present");
  assert.equal(chosenGroup?.values.name, "rg-chosen");
  assert.deepEqual(countBoundaries.resources.find((resource) => resource.tfName === "valid")?.values.resource_group_name, { resourceId: chosenGroup?.id, attr: "name" });
  for (const name of ["zero", "wrong_index", "missing_index", "spurious_index"]) {
    assert.equal(countBoundaries.resources.find((resource) => resource.tfName === name)?.values.resource_group_name, undefined);
    assert.ok(countBoundaries.mapped.find((item) => item.name === name)?.unmappedFieldNames.includes("resource_group_name"));
  }

  const nestedCountFiles = [
    { name: "main.tf", content: `
module "outer" { source = "./outer" count = null == null ? 1 : 0 suffix = "managed" }
resource "azurerm_container_app_environment" "app" {
  resource_group_name = module.outer[0].name
  infrastructure_resource_group_name = "\${module.outer[0].name}-managed"
}
module "disabled" { source = "./outer" count = 0 }
resource "azurerm_virtual_network" "absent_module" { resource_group_name = module.disabled[0].name }
` },
    { name: "outer/main.tf", content: `
variable "suffix" {}
module "child" { source = "../child" count = 1 }
resource "azurerm_virtual_network" "network" { resource_group_name = module.child[0].name }
resource "azurerm_container_app_environment" "nested_app" {
  resource_group_name = module.child[0].name
  infrastructure_resource_group_name = true ? "\${module.child[0].name}-\${var.suffix}" : "unused"
}
output "name" { value = module.child[0].name }
` },
    { name: "child/main.tf", content: `
resource "azurerm_resource_group" "main" { count = 1 name = "rg-nested" location = "westeurope" }
output "name" { value = azurerm_resource_group.main[0].name }
` },
  ];
  const nestedCount = mapToProject(parseHclFiles(nestedCountFiles));
  assert.equal(nestedCount.resources.length, 4);
  assert.equal(nestedCount.skipped.length, 1, "the disabled module output must not bind");
  const nestedGroup = nestedCount.resources.find((resource) => resource.type === "azurerm_resource_group");
  for (const resource of nestedCount.resources.filter((resource) => resource.type !== "azurerm_resource_group")) {
    assert.deepEqual(resource.values.resource_group_name, { resourceId: nestedGroup?.id, attr: "name" });
  }
  assert.equal(nestedCount.resources.find((resource) => resource.tfName === "app")?.values.infrastructure_resource_group_name, "rg-nested-managed");
  assert.equal(nestedCount.resources.find((resource) => resource.tfName === "outer__nested_app")?.values.infrastructure_resource_group_name, "rg-nested-managed");

  const parentAlias = mapToProject(parseHclFiles([
    { name: "main.tf", content: `
resource "azurerm_resource_group" "main" { count = 1 name = "rg-parent" location = "westeurope" }
module "child" { source = "./child" parent = azurerm_resource_group.main[0].name }
` },
    { name: "child/main.tf", content: `
variable "parent" {}
locals { alias = var.parent }
resource "azurerm_resource_group" "main" { count = 1 name = "rg-child" location = "westeurope" }
resource "azurerm_virtual_network" "network" { resource_group_name = local.alias }
` },
  ]));
  assert.deepEqual(parentAlias.resources.find((resource) => resource.type === "azurerm_virtual_network")?.values.resource_group_name, {
    resourceId: parentAlias.resources.find((resource) => resource.tfName === "main")?.id,
    attr: "name",
  }, "parent arguments must not bind to a same-named module resource");

  const lookupSummary = mapToProject(parseHclFiles([{ name: "main.tf", content: `
data "azurerm_client_config" "current" {}
resource "azapi_update_resource" "settings" {}
resource "azurerm_container_app_environment" "unresolved" {
  name = "example"
  zone_redundancy_enabled = var.missing == "prd"
}
` }]));
  assert.equal(getImportSkipDiagnostic(lookupSummary.skipped[0]).reasonCode, "configuration_lookup");
  assert.equal(getImportSkipDiagnostic(lookupSummary.skipped[1]).title, "Azure AzAPI provider is not supported");
  assert.equal(lookupSummary.resources[0].values.zone_redundancy_enabled, undefined, "unresolved explicit values must not fall back to catalogue defaults");

  const interpolationTokens = tokenize(`"${interpolatedName}"\nlocation = "westeurope"`);
  assert.deepEqual(
    interpolationTokens.map(({ type, value }) => [type, value]),
    [
      ["STRING", interpolatedName],
      ["IDENT", "location"],
      ["EQUALS", "="],
      ["STRING", "westeurope"],
      ["EOF", ""],
    ],
    "quoted function arguments inside interpolation must not terminate the template"
  );
  assert.equal(interpolationTokens[1].line, 2);
  assert.equal(interpolationTokens[1].col, 1);

  for (const template of [
    '${jsonencode({ label = "}", nested = { value = "{" } })}',
    '${join("-", ["${replace("a_b", "_", "-")}", "tail"])}',
    '${replace("a\\\"b", "\\\"", "-")}',
    '${replace("a\\\\b", "\\\\", "-")}',
    '${var.name /* " } { */}',
    '${var.name # " }\n}',
    '${var.name // " }\n}',
    '%{ if var.name == "example" }yes%{ endif }',
    '$${literal} %%{literal}',
    '${"$${literal}"}',
  ]) {
    assert.deepEqual(
      tokenize(`"${template}" next = true`).map(({ type, value }) => [type, value]),
      [["STRING", template], ["IDENT", "next"], ["EQUALS", "="], ["BOOL", "true"], ["EOF", ""]],
      "nested template syntax must preserve the following assignment"
    );
  }
  assert.equal(tokenize('"line\\n\\t\\\"quoted\\\"\\\\end"')[0].value, 'line\n\t"quoted"\\end');
  assert.deepEqual(
    tokenize('"${replace("x", "_", "-")').map(({ type, value }) => [type, value]),
    [["STRING", '${replace("x", "_", "-")'], ["EOF", ""]],
    "an unfinished interpolation must terminate at EOF"
  );

  const interpolationFiles = [{
    name: "main.tf",
    content: `
locals {
  container_app_name = "${interpolatedName}"
  location = "westeurope"
}
resource "azurerm_resource_group" "after_template" {
  name = "rg-example"
  location = local.location
}
resource "azurerm_container_app" "template" {
  name = "${interpolatedName}"
  resource_group_name = "rg-example"
}
`,
  }];
  const interpolationParsed = parseHclFiles(interpolationFiles);
  assert.deepEqual(interpolationParsed.blocks.find((block) => block.name === "template")?.body.attrs, {
    name: { __expr: interpolatedName, __template: true },
    resource_group_name: "rg-example",
  });
  assert.deepEqual(interpolationParsed.warnings, [
    'main.tf: Configuration ignored: local "container_app_name" is not a static scalar alias',
  ]);
  assert.equal(mapToProject(interpolationParsed).resources.find((resource) => resource.tfName === "after_template")?.values.location, "westeurope");

  const interpolationZip = new JSZip();
  for (const file of interpolationFiles) interpolationZip.file(file.name, file.content);
  const interpolationZipContents = await interpolationZip.generateAsync({ type: "uint8array" });
  const interpolationUpload = await readImportUpload([{
    name: "interpolation.zip",
    arrayBuffer: async () => interpolationZipContents.buffer.slice(
      interpolationZipContents.byteOffset,
      interpolationZipContents.byteOffset + interpolationZipContents.byteLength
    ),
  } as File]);
  const interpolationSession = importFromUpload(interpolationUpload);
  assert.deepEqual(interpolationSession.parse, interpolationParsed);
  const importedTemplate = interpolationSession.resources.find((resource) => resource.tfName === "template");
  assert.ok(importedTemplate);
  assert.equal(importedTemplate.values.name, undefined, "complex templates must not become literal domain names");
  assert.ok(interpolationSession.mapped.find((item) => item.name === "template")?.unmappedFieldNames.includes("name"));
  assert.equal(importedTemplate.values.resource_group_name, "rg-example");

  const parsed = parseHclFiles([
    {
      name: "container-app.tf",
      content: `
resource "azurerm_user_assigned_identity" "runtime" {
  name                = "id-runtime"
  location            = "westeurope"
  resource_group_name = "rg-app"
}

resource "azurerm_container_app" "api" {
  name                         = "ca-api"
  resource_group_name          = "rg-app"
  container_app_environment_id = azurerm_container_app_environment.main.id
  revision_mode                = "Single"

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.runtime.id]
  }

  dynamic "secret" {
    for_each = []
    content {}
  }

  lifecycle {
    ignore_changes = [tags]
  }
}
`,
    },
    {
      name: "broken.tf",
      content: `resource "azurerm_resource_group" broken {}`,
    },
  ]);
  const summary = mapToProject(parsed);
  const containerApp = summary.resources.find(
    (resource) => resource.type === "azurerm_container_app"
  );

  assert.ok(containerApp, "Container App should be imported");
  assert.equal(containerApp.values.identity_type, "UserAssigned");
  assert.deepEqual(containerApp.values.user_assigned_identity_id, {
    resourceId: summary.resources.find(
      (resource) => resource.type === "azurerm_user_assigned_identity"
    )?.id,
    attr: "id",
  });

  const mappedApp = summary.mapped.find(
    (item) => item.type === "azurerm_container_app"
  );
  assert.ok(mappedApp);
  assert.deepEqual(mappedApp.unmappedFieldNames, ["container_app_environment_id"]);
  assert.deepEqual(mappedApp.unsupportedConstructs, [
    'nested block "dynamic" (secret)',
    'nested block "lifecycle"',
  ]);

  const report = createImportDiagnosticReport(2, parsed, summary, "2026-09-21T12:00:00.000Z");
  const reportApp = report.outcomes.mapped.find(
    (item) => item.sourceType === "azurerm_container_app"
  );
  assert.deepEqual(reportApp?.unsupportedConstructs, [
    'nested block "dynamic" (secret)',
    'nested block "lifecycle"',
  ]);
  assert.ok(
    report.notes.some(
      (note) =>
        note.uploadIndex === 1 &&
        note.category === "parse" &&
        note.message.startsWith("Parse error: Expected")
    ),
    "report should keep the actionable parser detail for the source upload"
  );

  const moduleParsed = parseHclFiles([
    {
      name: "main.tf",
      content: `
module "resource_group" {
  source = "./modules/resource-group"
  name   = "rg-imported"
}

module "remote" {
  source = "Azure/avm-res-resources-resourcegroup/azurerm"
}

module "missing" {
  source = "./modules/missing"
}

module "dynamic" {
  source = var.module_source
}

resource "azurerm_resource_group" "conditional" {
  name     = var.enabled ? "rg-enabled" : "rg-disabled"
  location = "westeurope"
}

resource "azurerm_storage_container" "depends_on_module" {
  name               = "uploads"
  storage_account_id = module.remote.id
}
`,
    },
    {
      name: "modules/resource-group/main.tf",
      content: `
resource "azurerm_resource_group" "this" {
  name     = var.name
  location = "westeurope"
}
`,
    },
  ]);
  const conditional = moduleParsed.blocks.find(
    (block) => block.name === "conditional"
  );
  assert.deepEqual(conditional?.body.attrs.name, {
    __expr: 'var.enabled?"rg-enabled":"rg-disabled"',
  });
  assert.equal(
    moduleParsed.warnings.length,
    0,
    "conditional expressions should remain parseable, not trigger resynchronization"
  );

  const moduleSummary = mapToProject(moduleParsed);
  const expandedGroup = moduleSummary.resources.find(
    (resource) => resource.tfName === "resource_group__this"
  );
  assert.ok(expandedGroup, "uploaded local module resources should expand");
  assert.equal(expandedGroup.values.name, "rg-imported");
  assert.equal(
    moduleSummary.resources.some(
      (resource) => resource.tfName === "depends_on_module"
    ),
    false,
    "resources with unresolved module outputs must not enter the domain"
  );
  assert.deepEqual(
    moduleSummary.skipped.map((item) => [item.name, item.reason]),
    [
      [
        "remote",
        'Module source "Azure/avm-res-resources-resourcegroup/azurerm" is remote; only uploaded local modules are expanded',
      ],
      [
        "missing",
        'Local module source "./modules/missing" was not found in the upload',
      ],
      ["dynamic", "Module source must be a static local path"],
      [
        "depends_on_module",
        'Unresolved module output reference in "storage_account_id"',
      ],
    ]
  );
  const moduleReport = createImportDiagnosticReport(2, moduleParsed, moduleSummary, "2026-09-21T12:00:00.000Z");
  assert.deepEqual(
    moduleReport.outcomes.skipped.map((item) => item.reasonCode),
    [
      "module_source_remote",
      "local_module_unavailable",
      "module_source_dynamic",
      "module_output_unresolved",
    ]
  );

  const templateNote = "Imported one template from for_each; each.* values need review";
  const forEachModuleSummary = mapToProject(parseHclFiles([
    {
      name: "main.tf",
      content: `
module "template" {
  source   = "./modules/resource-group"
  for_each = { first = { name = "rg-template" } }
}

module "counted" {
  source = "./modules/resource-group"
  count  = 1
}
`,
    },
    {
      name: "modules/resource-group/main.tf",
      content: `
resource "azurerm_resource_group" "this" {
  name     = each.value.name
  location = "westeurope"
}
`,
    },
  ]));
  assert.equal(
    forEachModuleSummary.resources.length,
    2,
    "for_each produces one template and count=1 produces one instance"
  );
  const templateResource = forEachModuleSummary.resources[0];
  const mappedTemplate = forEachModuleSummary.mapped[0];
  assert.ok(templateResource);
  assert.ok(mappedTemplate);
  assert.equal(templateResource.values.name, undefined, "each.value names should remain unmapped");
  assert.deepEqual(mappedTemplate.unmappedFieldNames, ["name"]);
  assert.deepEqual(mappedTemplate.unsupportedConstructs, [templateNote]);
  assert.deepEqual(forEachModuleSummary.skipped, []);

  const moduleSession = importFromUpload({
    files: [
      {
        name: "safe/main.tf",
        content: `module "remote" { source = "Azure/avm-res-resources-resourcegroup/azurerm" }`,
      },
    ],
    rootProfiles: [],
  });
  assert.equal(moduleSession.skipped[0]?.sourcePath, "safe/main.tf");
  assert.deepEqual(getImportSkipDiagnostic(moduleSession.skipped[0]!), {
    reasonCode: "module_source_remote",
    title: "Remote module source",
    actionability: "repair",
    help: "Upload a local copy of this module, then import the files together.",
  });

  const staticModuleOutputs = mapToProject(parseHclFiles([
    {
      name: "main.tf",
      content: `
module "resource_group" {
  source              = "./modules/resource_group"
  resource_group_name = "rg-imported"
  location            = "westeurope"
}

module "log_analytics" {
  source              = "./modules/log_analytics"
  log_analytics_name  = "logs-imported"
  resource_group_name = module.resource_group.resource_group_name
  location            = "westeurope"
}

resource "azurerm_application_insights" "app" {
  name                = "insights-imported"
  location            = "westeurope"
  resource_group_name = module.resource_group.resource_group_name
  application_type    = "web"
  workspace_id        = module.log_analytics.log_analytics_workspace_id
}
`,
    },
    {
      name: "modules/resource_group/main.tf",
      content: `
resource "azurerm_resource_group" "rg" {
  name     = var.resource_group_name
  location = var.location
}

output "resource_group_name" {
  value = azurerm_resource_group.rg.name
}
`,
    },
    {
      name: "modules/log_analytics/main.tf",
      content: `
resource "azurerm_log_analytics_workspace" "this" {
  name                = var.log_analytics_name
  location            = var.location
  resource_group_name = var.resource_group_name
}

output "log_analytics_workspace_id" {
  value = azurerm_log_analytics_workspace.this.id
}
`,
    },
  ]));
  assert.equal(
    staticModuleOutputs.resources.length,
    3,
    "static local module output aliases should resolve to their expanded resources"
  );
  assert.deepEqual(staticModuleOutputs.skipped, []);
  const importedGroup = staticModuleOutputs.resources.find(
    (resource) => resource.tfName === "resource_group__rg"
  );
  const importedWorkspace = staticModuleOutputs.resources.find(
    (resource) => resource.tfName === "log_analytics__this"
  );
  const importedInsights = staticModuleOutputs.resources.find(
    (resource) => resource.tfName === "app"
  );
  assert.ok(importedGroup);
  assert.ok(importedWorkspace);
  assert.ok(importedInsights);
  assert.deepEqual(importedWorkspace.values.resource_group_name, {
    resourceId: importedGroup.id,
    attr: "name",
  });
  assert.deepEqual(importedInsights.values.resource_group_name, {
    resourceId: importedGroup.id,
    attr: "name",
  });
  assert.deepEqual(importedInsights.values.workspace_id, {
    resourceId: importedWorkspace.id,
    attr: "id",
  });

  const unsupportedProvider = mapToProject(parseHclFiles([{
    name: "unsupported-provider.tf",
    content: `resource "random_pet" "name" {}`,
  }]));
  const unsupportedProviderReport = createImportDiagnosticReport(
    1,
    parseHclFiles([{ name: "unsupported-provider.tf", content: `resource "random_pet" "name" {}` }]),
    unsupportedProvider,
    "2026-09-21T12:00:00.000Z"
  );
  assert.deepEqual(unsupportedProviderReport.outcomes.skipped[0], {
    uploadIndex: 0,
    sourcePath: "unsupported-provider.tf",
    kind: "resource",
    sourceType: "random_pet",
    sourceName: "name",
    reasonCode: "provider_not_supported",
    reason: "Non-azurerm provider / unknown type",
  });

  const nestedModuleReference = mapToProject(parseHclFiles([
    {
      name: "nested-module-output.tf",
      content: `resource "azurerm_container_app" "nested_module_output" {
  name                         = "ca-nested"
  resource_group_name          = "rg-app"
  container_app_environment_id = azurerm_container_app_environment.main.id
  revision_mode                = "Single"

  identity {
    type         = "UserAssigned"
    identity_ids = [module.identity.id]
  }
}`,
    },
  ]));
  assert.deepEqual(nestedModuleReference.resources, []);
  assert.deepEqual(nestedModuleReference.skipped.map((item) => item.reason), [
    'Unresolved module output reference in "identity.identity_ids[0]"',
  ]);

  const indirectModuleReferences = mapToProject(parseHclFiles([
    {
      name: "indirect-module-outputs.tf",
      content: `resource "azurerm_resource_group" "object_module_output" {
  name     = "rg-object"
  location = "westeurope"
  tags     = { owner = module.identity.name }
}

resource "azurerm_resource_group" "interpolated_module_output" {
  name     = "rg-\${module.identity.name}"
  location = "westeurope"
}`,
    },
  ]));
  assert.deepEqual(indirectModuleReferences.resources, []);
  assert.deepEqual(indirectModuleReferences.skipped.map((item) => item.reason), [
    'Unresolved module output reference in "tags.owner"',
    'Unresolved module output reference in "name"',
  ]);

  const expressions = parseHclFiles([
    {
      name: "unsupported-expressions.tf",
      content: `resource "azurerm_resource_group" "expressions" {
  name = var.size >= 3 && var.enabled ? "rg-conditional" : "rg-default"
  location = var.region + "-primary"
  tags = { priority = -1 }
}`,
    },
  ]);
  assert.deepEqual(expressions.blocks[0]?.body.attrs.name, {
    __expr: 'var.size>=3&&var.enabled?"rg-conditional":"rg-default"',
  });
  assert.deepEqual(expressions.blocks[0]?.body.attrs.location, {
    __expr: 'var.region+"-primary"',
  });
  assert.deepEqual(expressions.blocks[0]?.body.attrs.tags, { priority: -1 });
  const expressionSummary = mapToProject(expressions);
  assert.deepEqual(
    expressionSummary.mapped[0]?.unmappedFieldNames,
    ["location", "name"],
    "unsupported expressions should leave the source field unmapped"
  );
  assert.equal(
    Object.values(expressionSummary.resources[0]?.values ?? {}).some(
      (value) => typeof value === "object" && value !== null && ("__expr" in value || "__ref" in value)
    ),
    false,
    "parser artifacts must not reach ResourceInstance values"
  );
  assert.ok(
    expressionSummary.warnings.some((warning) => warning.includes('complex expression for "name"')),
    "unsupported expressions should be reported and omitted rather than altered into domain values"
  );

  const advisoryPartial = mapToProject(parseHclFiles([{
    name: "advisory-partial.tf",
    content: `resource "azurerm_resource_group" "advisory" {
  name = "rg-advisory"
  location = "westeurope"
  unsupported_optional_setting = "ignored"
}`,
  }]));
  assert.deepEqual(advisoryPartial.mapped[0]?.unmappedFieldNames, ["unsupported_optional_setting"]);
  assert.equal(advisoryPartial.resources[0]?.values.name, "rg-advisory");
  assert.equal(advisoryPartial.resources[0]?.values.location, "westeurope");

  const zip = new JSZip();
  zip.file("main.tf", `module "resource_group" { source = "./components/resource-group" }`);
  zip.file("components/resource-group/resource_group.tf", `resource "azurerm_resource_group" "this" { name = "rg-zip" location = "westeurope" }`);
  zip.file(".terraform/providers/cache.tf", `resource "azurerm_resource_group" "ignored" {}`);
  zip.file("__MACOSX/metadata.tf", `resource "azurerm_resource_group" "ignored" {}`);
  const zipContents = await zip.generateAsync({ type: "uint8array" });
  const uploadedFiles = await readFilesFromUpload([{
    name: "project.zip",
    arrayBuffer: async () => zipContents.buffer.slice(zipContents.byteOffset, zipContents.byteOffset + zipContents.byteLength),
  } as File]);
  assert.deepEqual(uploadedFiles.map((file) => file.name).sort(), [
    "components/resource-group/resource_group.tf",
    "main.tf",
  ]);
  const zipSummary = mapToProject(parseHclFiles(uploadedFiles));
  assert.ok(
    zipSummary.resources.some((resource) => resource.tfName === "resource_group__this"),
    "uploaded local module files with non-main filenames should expand"
  );

  const uploadRootModule = mapToProject(parseHclFiles([
    {
      name: "modules/application/main.tf",
      content: `module "root_resource" { source = "../.." }`,
    },
    {
      name: "root-resource.tf",
      content: `resource "azurerm_resource_group" "this" { name = "rg-root-module" location = "westeurope" }`,
    },
  ]));
  assert.ok(
    uploadRootModule.resources.some(
      (resource) => resource.tfName === "root_resource__this"
    ),
    "a static local module path resolving to the upload root should expand"
  );
  assert.equal(
    uploadRootModule.resources.some((resource) => resource.tfName === "this"),
    false,
    "root module files should not also be imported as independent roots"
  );

  const scalarAliases = mapToProject(parseHclFiles([
    {
      name: "main.tf",
      content: `
variable "location" { default = "default-region" }
variable "resource_group_name" { default = "rg-default" }
variable "app_insights_name" { default = "appi-default" }

locals {
  resolved_location = var.location
  resolved_group    = var.resource_group_name
  insights_base     = var.app_insights_name
  resolved_insights = local.insights_base
  cycle_one         = local.cycle_two
  cycle_two         = local.cycle_one
}

module "resource_group" {
  source              = "./modules/resource_group"
  resource_group_name = local.resolved_group
  location            = "module-region"
}

module "log_analytics" {
  source              = "./modules/log_analytics"
  log_analytics_name  = "logs-fixture"
  resource_group_name = module.resource_group.resource_group_name
  location            = local.resolved_location
  sku                 = "Basic"
}

module "app_insights" {
  source                     = "./modules/app_insights"
  app_insights_name          = local.resolved_insights
  resource_group_name        = module.resource_group.resource_group_name
  location                   = var.location
  log_analytics_workspace_id = module.log_analytics.log_analytics_workspace_id
}

resource "azurerm_resource_group" "cyclic" {
  name     = local.cycle_one
  location = "westeurope"
}

resource "azurerm_resource_group" "conditional" {
  name     = var.location == "westeurope" ? "rg-a" : "rg-b"
  location = "westeurope"
}

resource "azurerm_resource_group" "function" {
  name     = lower(var.location)
  location = "westeurope"
}
`,
    },
    {
      name: "fixture.tfvars",
      content: `
location            = "tfvars-region"
resource_group_name = "rg-fixture"
app_insights_name   = "appi-fixture"
`,
    },
    {
      name: "modules/resource_group/main.tf",
      content: `
variable "resource_group_name" { default = "rg-module-default" }
variable "location" { default = "module-default-region" }

resource "azurerm_resource_group" "rg" {
  name     = var.resource_group_name
  location = var.location
}

output "resource_group_name" { value = azurerm_resource_group.rg.name }
`,
    },
    {
      name: "modules/log_analytics/main.tf",
      content: `
variable "log_analytics_name" { default = "logs-module-default" }
variable "resource_group_name" {}
variable "location" { default = "module-default-region" }
variable "sku" { default = "PerGB2018" }

locals {
  base_name     = var.log_analytics_name
  resolved_name = local.base_name
}

resource "azurerm_log_analytics_workspace" "this" {
  name                = local.resolved_name
  location            = var.location
  resource_group_name = var.resource_group_name
  sku                 = var.sku
}

output "log_analytics_workspace_id" { value = azurerm_log_analytics_workspace.this.id }
`,
    },
    {
      name: "modules/app_insights/main.tf",
      content: `
variable "app_insights_name" { default = "appi-module-default" }
variable "resource_group_name" {}
variable "location" { default = "module-default-region" }
variable "log_analytics_workspace_id" { default = null }

resource "azurerm_application_insights" "this" {
  name                = var.app_insights_name
  location            = var.location
  resource_group_name = var.resource_group_name
  application_type    = "web"
  workspace_id        = var.log_analytics_workspace_id
}
`,
    },
  ]));
  const scalarGroup = scalarAliases.resources.find(
    (resource) => resource.tfName === "resource_group__rg"
  );
  const scalarWorkspace = scalarAliases.resources.find(
    (resource) => resource.tfName === "log_analytics__this"
  );
  const scalarInsights = scalarAliases.resources.find(
    (resource) => resource.tfName === "app_insights__this"
  );
  assert.ok(scalarGroup);
  assert.ok(scalarWorkspace);
  assert.ok(scalarInsights);
  assert.equal(scalarGroup.values.name, "rg-fixture");
  assert.equal(
    scalarGroup.values.location,
    "module-region",
    "direct module arguments override module defaults and root tfvars"
  );
  assert.equal(scalarWorkspace.values.name, "logs-fixture");
  assert.equal(scalarWorkspace.values.location, "tfvars-region");
  assert.equal(scalarWorkspace.values.sku, "Basic");
  assert.equal(scalarInsights.values.name, "appi-fixture");
  assert.equal(scalarInsights.values.location, "tfvars-region");
  assert.deepEqual(scalarInsights.values.workspace_id, {
    resourceId: scalarWorkspace.id,
    attr: "id",
  });
  assert.deepEqual(
    scalarAliases.mapped
      .filter((item) => ["cyclic", "conditional", "function"].includes(item.name))
      .map((item) => item.unmappedFieldNames),
    [["name"], [], ["name"]],
    "static conditionals resolve while cycles and unsupported functions remain partial mappings"
  );
  assert.ok(
    scalarAliases.warnings.some((warning) => warning.includes('complex expression for "name"')),
    "unresolved dynamic aliases should retain mapping diagnostics"
  );
  assert.equal(
    scalarAliases.resources.some((resource) =>
      Object.values(resource.values).some(
        (value) => typeof value === "object" && value !== null && ("__expr" in value || "__ref" in value || "__raw_block" in value)
      )
    ),
    false,
    "transient parser and alias-resolution state must not enter ResourceInstance"
  );

  const nonScalarModuleArgument = mapToProject(parseHclFiles([
    {
      name: "main.tf",
      content: `module "resource_group" {
  source = "./modules/resource_group"
  name   = ["rg-not-a-scalar"]
}
module "resource_group_object" {
  source = "./modules/resource_group"
  name   = { value = "rg-not-a-scalar" }
}`,
    },
    {
      name: "modules/resource_group/main.tf",
      content: `resource "azurerm_resource_group" "this" {
  name     = var.name
  location = "westeurope"
}`,
    },
  ]));
  assert.equal(nonScalarModuleArgument.resources.length, 2);
  for (const resource of nonScalarModuleArgument.resources) {
    assert.notEqual(
      resource.values.name,
      "rg-not-a-scalar",
      "list and object module arguments must not be substituted into var aliases"
    );
  }
  assert.deepEqual(
    nonScalarModuleArgument.mapped.map((item) => item.unmappedFieldNames),
    [["name"], ["name"]]
  );
  assert.equal(
    nonScalarModuleArgument.resources.some((resource) =>
      Object.values(resource.values).some(
        (value) => Array.isArray(value) || (typeof value === "object" && value !== null && ("__expr" in value || "__ref" in value))
      )
    ),
    false,
    "non-scalar resolver data must not enter ResourceInstance values"
  );

  const duplicateModuleRoots = mapToProject(parseHclFiles([
    {
      name: "root-a/main.tf",
      content: `module "network" { source = "./modules/network" }
resource "azurerm_subnet" "app" {
  name                 = "subnet-a"
  resource_group_name  = "rg-a"
  virtual_network_name = module.network.name
}`,
    },
    {
      name: "root-a/modules/network/main.tf",
      content: `resource "azurerm_virtual_network" "this" {
  name                = "vnet-a"
  location            = "westeurope"
  resource_group_name = "rg-a"
  address_space       = ["10.0.0.0/16"]
}
output "name" { value = azurerm_virtual_network.this.name }`,
    },
    {
      name: "root-b/main.tf",
      content: `module "network" { source = "./modules/network" }
resource "azurerm_subnet" "app" {
  name                 = "subnet-b"
  resource_group_name  = "rg-b"
  virtual_network_name = module.network.name
}`,
    },
    {
      name: "root-b/modules/network/main.tf",
      content: `resource "azurerm_virtual_network" "this" {
  name                = "vnet-b"
  location            = "westeurope"
  resource_group_name = "rg-b"
  address_space       = ["10.1.0.0/16"]
}
output "name" { value = azurerm_virtual_network.this.name }`,
    },
  ]));
  for (const root of ["a", "b"]) {
    const network = duplicateModuleRoots.resources.find(
      (resource) => resource.values.name === `vnet-${root}`
    );
    const subnet = duplicateModuleRoots.resources.find(
      (resource) => resource.values.name === `subnet-${root}`
    );
    assert.ok(network);
    assert.ok(subnet);
    assert.deepEqual(subnet.values.virtual_network_name, {
      resourceId: network.id,
      attr: "name",
    });
  }

  const childModuleTfvars = mapToProject(parseHclFiles([
    {
      name: "main.tf",
      content: `module "resource_group" { source = "./modules/resource_group" }`,
    },
    {
      name: "modules/resource_group/main.tf",
      content: `variable "name" { default = "rg-module-default" }
resource "azurerm_resource_group" "this" {
  name     = var.name
  location = "westeurope"
}`,
    },
    {
      name: "modules/resource_group/override.tfvars",
      content: `name = "rg-child-tfvars"`,
    },
  ]));
  assert.equal(
    childModuleTfvars.resources[0]?.values.name,
    "rg-module-default",
    "only upload-root tfvars may configure root module defaults"
  );

  const rootProfiles = ["editor", "prod", "test"].map((name) => ({
    name: `${name}.tfvars`,
    content: `location = "${name}-region"\nresource_group_name = "rg-${name}"`,
  }));
  const rootProfileSource = {
    name: "main.tf",
    content: `variable "location" { validation { condition = can(regex("^[a-z]+$", var.location)) error_message = "invalid" } }
variable "resource_group_name" { default = null }
resource "azurerm_resource_group" "main" { name = var.resource_group_name location = var.location }
import { to = module.example[0].azurerm_resource_group.main id = "ignored" }`,
  };
  for (const profiles of [rootProfiles, [...rootProfiles].reverse()]) {
    const parsedProfiles = parseHclFiles([rootProfileSource, ...profiles]);
    const profileSummary = mapToProject(parsedProfiles);
    assert.equal(parsedProfiles.warnings.length, 1, "ambiguous root profiles produce one deterministic warning");
    assert.match(parsedProfiles.warnings[0], /select one profile/);
    assert.equal(profileSummary.resources.length, 1, "top-level import blocks must be ignored");
    assert.deepEqual(profileSummary.mapped[0]?.unmappedFieldNames, ["location", "name"]);
    assert.equal(profileSummary.warnings.some((warning) => warning.includes("Unsupported value")), false);
  }

  const selectedProfileTemplates = mapToProject(parseHclFiles([
    {
      name: "main.tf",
      content: `
variable "location" { default = "northeurope" }
variable "name_suffix" { default = "default" }
locals { group_name = "rg-\${var.name_suffix}" }
resource "azurerm_resource_group" "templated" {
  name = local.group_name
  location = "\${var.location}"
}
resource "azurerm_resource_group" "dynamic_template" {
  name = "rg-\${lower(var.name_suffix)}"
  location = "westeurope"
}
`,
    },
    {
      name: "prod.tfvars",
      content: `location = "westeurope"\nname_suffix = "prod"`,
    },
  ], "prod.tfvars"));
  const templatedGroup = selectedProfileTemplates.resources.find(
    (resource) => resource.tfName === "templated"
  );
  assert.ok(templatedGroup);
  assert.equal(templatedGroup.values.name, "rg-prod");
  assert.equal(templatedGroup.values.location, "westeurope");
  assert.deepEqual(
    selectedProfileTemplates.mapped.find((item) => item.name === "dynamic_template")
      ?.unmappedFieldNames,
    ["name"],
    "templates with function calls must remain explicit partial mappings"
  );
  assert.equal(
    Object.values(templatedGroup.values).some(
      (value) => typeof value === "object" && value !== null && ("__expr" in value || "__ref" in value)
    ),
    false,
    "resolved profile templates must not put parser artifacts in ResourceInstance values"
  );

  const configurationRecovery = parseHclFiles([
    {
      name: "config/locals.tf",
      content: `
locals {
  safe_name = var.resource_group_name
  dynamic_name = lower(var.resource_group_name)
}

output "dynamic" {
  value = lower(local.safe_name)
  precondition {
    condition     = local.safe_name != ""
    error_message = "name is required"
  }
}
`,
    },
    {
      name: "config/variables.tf",
      content: `
variable "resource_group_name" {
  default = "rg-config"
  validation {
    condition     = can(regex("^[a-z0-9-]+$", var.resource_group_name))
    error_message = "invalid"
  }
}
`,
    },
    {
      name: "config/main.tf",
      content: `resource "azurerm_resource_group" "after_configuration" {
  name     = local.safe_name
  location = "westeurope"
}`,
    },
  ]);
  assert.equal(
    configurationRecovery.blocks.some((block) => block.name === "after_configuration"),
    true,
    "configuration bodies must not prevent parsing following resources"
  );
  const configurationLocals = configurationRecovery.blocks.find(
    (block) => block.type === "locals"
  );
  assert.deepEqual(configurationLocals?.body.attrs, {
    safe_name: "rg-config",
  });
  assert.deepEqual(
    configurationRecovery.warnings.filter((warning) => warning.includes("Configuration ignored:")),
    ['config/locals.tf: Configuration ignored: local "dynamic_name" is not a static scalar alias']
  );
  const configurationReport = createImportDiagnosticReport(
    3,
    configurationRecovery,
    mapToProject(configurationRecovery),
    "2026-09-21T12:00:00.000Z"
  );
  assert.deepEqual(
    configurationReport.notes.filter((note) => note.message.startsWith("Configuration ignored:")),
    [{
      uploadIndex: 0,
      category: "parse",
      message: 'Configuration ignored: local "dynamic_name" is not a static scalar alias',
    }],
    "ignored configuration should retain one source-attributed stable parse category"
  );

  for (const profiles of [rootProfiles, [...rootProfiles].reverse()]) {
    const upload = await readImportUpload(
      profiles.map((profile) => ({
        name: profile.name,
        text: async () => profile.content,
      })) as File[]
    );
    assert.deepEqual(upload.rootProfiles.map((profile) => profile.path), [
      "editor.tfvars",
      "prod.tfvars",
      "test.tfvars",
    ]);
    for (const profile of upload.rootProfiles) {
      const summary = importFromUpload(
        { files: [rootProfileSource, ...profiles], rootProfiles: upload.rootProfiles },
        profile.path
      );
      const resource = summary.resources[0];
      assert.equal(resource?.values.name, `rg-${profile.label}`);
      assert.equal(resource?.values.location, `${profile.label}-region`);
    }
  }

  const independentRoots = mapToProject(parseHclFiles([
    { name: "root-a/main.tf", content: `resource "azurerm_resource_group" "shared" { name = "rg-a" location = "westeurope" }
resource "azurerm_storage_account" "account" { name = "storea" resource_group_name = azurerm_resource_group.shared.name location = "westeurope" account_tier = "Standard" account_replication_type = "LRS" }` },
    { name: "root-b/main.tf", content: `resource "azurerm_resource_group" "shared" { name = "rg-b" location = "westeurope" }
resource "azurerm_storage_account" "account" { name = "storeb" resource_group_name = azurerm_resource_group.shared.name location = "westeurope" account_tier = "Standard" account_replication_type = "LRS" }` },
  ]));
  for (const root of ["a", "b"]) {
    const group = independentRoots.resources.find((resource) => resource.values.name === `rg-${root}`);
    const account = independentRoots.resources.find((resource) => resource.values.name === `store${root}`);
    assert.ok(group);
    assert.ok(account);
    assert.deepEqual(account.values.resource_group_name, { resourceId: group.id, attr: "name" });
  }

  const precedenceParsed = parseHclFiles([{
    name: "precedence.tf",
    content: `resource "random_pet" "provider_first" { count = 1 value = module.missing.id }
resource "azurerm_resource_group" "dynamic_first" { for_each = {} name = module.missing.name location = "westeurope" }`,
  }]);
  const precedenceSummary = mapToProject(precedenceParsed);
  assert.deepEqual(precedenceSummary.skipped.map((item) => item.reason), [
    "Non-azurerm provider / unknown type",
    "for_each is not supported",
  ]);
  assert.deepEqual(
    createImportDiagnosticReport(1, precedenceParsed, precedenceSummary, "2026-09-21T12:00:00.000Z").outcomes.skipped.map((item) => item.reasonCode),
    ["provider_not_supported", "for_each_not_supported"]
  );
  assert.equal(
    getImportSkipDiagnostic(precedenceSummary.skipped[1]!).actionability,
    "informational",
    "dynamic resource iteration remains an explicit non-importable outcome"
  );

  const mappedParsed = parseHclFiles([{ name: "root-a/main.tf", content: `resource "azurerm_resource_group" "main" { name = "rg-a" location = "westeurope" }` }]);
  const manifestReport = createImportDiagnosticReport(
    2,
    mappedParsed,
    mapToProject(mappedParsed),
    "2026-09-21T12:00:00.000Z",
    ["root-a/main.tf"]
  );
  assert.deepEqual(manifestReport.uploadManifest, [{ uploadIndex: 0, path: "root-a/main.tf" }]);
  assert.equal(manifestReport.outcomes.mapped[0]?.sourcePath, "root-a/main.tf");

  const diagnosticPathParsed = parseHclFiles([
    { name: "safe/main.tf", content: `resource "azurerm_resource_group" "safe" { name = "rg-safe" location = "westeurope" }` },
    { name: "C:\\uploads\\windows.tf", content: `resource "azurerm_resource_group" "windows" { name = "rg-windows" location = "westeurope" }` },
    { name: "/uploads/unix.tf", content: `resource "azurerm_resource_group" "unix" { name = "rg-unix" location = "westeurope" }` },
    { name: "../outside.tf", content: `resource "azurerm_resource_group" "traversal" { name = "rg-traversal" location = "westeurope" }` },
  ]);
  const diagnosticPathReport = createImportDiagnosticReport(
    4,
    diagnosticPathParsed,
    mapToProject(diagnosticPathParsed),
    "2026-09-21T12:00:00.000Z",
    ["safe/main.tf", "C:\\uploads\\windows.tf", "/uploads/unix.tf", "../outside.tf"]
  );
  assert.deepEqual(diagnosticPathReport.uploadManifest, [
    { uploadIndex: 0, path: "safe/main.tf" },
  ]);
  assert.deepEqual(
    diagnosticPathReport.outcomes.mapped.map((item) => item.sourcePath),
    ["safe/main.tf", null, null, null],
    "v2 diagnostics must omit absolute and traversal upload hints while keeping safe relative paths"
  );

  const auditedAdditions = mapToProject(parseHclFiles([{
    name: "audited-static-resources.tf",
    content: `
resource "azurerm_resource_group" "main" {
  name     = "rg-static"
  location = "westeurope"
}

resource "azurerm_storage_account" "blobstore" {
  name                     = "blobstorestatic"
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
}

resource "azurerm_user_assigned_identity" "blob_reader" {
  name                = "id-blob-reader"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
}

resource "azurerm_private_dns_zone" "blob" {
  name                = "privatelink.blob.core.windows.net"
  resource_group_name = azurerm_resource_group.main.name
}

resource "azurerm_private_endpoint" "blob" {
  name                = "pe-blob"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  subnet_id           = "/subscriptions/example/subnets/private-endpoints"

  private_service_connection {
    name                           = "psc-blob"
    private_connection_resource_id = azurerm_storage_account.blobstore.id
    is_manual_connection           = false
    subresource_names              = ["blob"]
  }

  private_dns_zone_group {
    name                 = "default"
    private_dns_zone_ids = [azurerm_private_dns_zone.blob.id]
  }
}

resource "azurerm_container_app_environment" "static" {
  name                                 = "cae-static"
  resource_group_name                  = azurerm_resource_group.main.name
  location                             = azurerm_resource_group.main.location
  infrastructure_resource_group_name   = "rg-cae-managed"
}

resource "azurerm_role_assignment" "blob_contributor" {
  scope                = azurerm_storage_account.blobstore.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_user_assigned_identity.blob_reader.principal_id
}

resource "azurerm_private_endpoint" "indexed" {
  name                = "pe-indexed"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  subnet_id           = "/subscriptions/example/subnets/private-endpoints"

  private_service_connection {
    name                           = "psc-indexed"
    private_connection_resource_id = azurerm_storage_account.blobstore[count.index].id
    is_manual_connection           = false
    subresource_names              = ["blob"]
  }
}

resource "azurerm_container_app_environment" "module_value" {
  name                               = "cae-module"
  resource_group_name                = azurerm_resource_group.main.name
  location                           = azurerm_resource_group.main.location
  infrastructure_resource_group_name = module.shared.infrastructure_resource_group_name
}
`,
  }]));
  const importedStorage = auditedAdditions.resources.find((resource) => resource.tfName === "blobstore");
  const importedZone = auditedAdditions.resources.find((resource) => resource.type === "azurerm_private_dns_zone");
  const importedEndpoint = auditedAdditions.resources.find(
    (resource) =>
      resource.tfName === "blob" && resource.type === "azurerm_private_endpoint"
  );
  const importedCae = auditedAdditions.resources.find((resource) => resource.tfName === "static");
  const importedRole = auditedAdditions.resources.find((resource) => resource.tfName === "blob_contributor");
  const indexedEndpoint = auditedAdditions.resources.find((resource) => resource.tfName === "indexed");
  assert.ok(importedStorage);
  assert.ok(importedZone);
  assert.ok(importedEndpoint);
  assert.ok(importedCae);
  assert.ok(importedRole);
  assert.ok(indexedEndpoint);
  assert.deepEqual(importedEndpoint.values.private_connection_resource_id, {
    resourceId: importedStorage.id,
    attr: "id",
  });
  assert.equal(importedEndpoint.values.private_connection_name, "psc-blob");
  assert.equal(importedEndpoint.values.subresource_names, "blob");
  assert.deepEqual(importedEndpoint.values.private_dns_zone_id, {
    resourceId: importedZone.id,
    attr: "id",
  });
  assert.equal(importedCae.values.infrastructure_resource_group_name, "rg-cae-managed");
  assert.deepEqual(importedRole.values.scope, {
    resourceId: importedStorage.id,
    attr: "id",
  });
  assert.equal(importedRole.values.role_definition_name, "Storage Blob Data Contributor");
  assert.ok(
    isPrivateEndpointTargetCompatible("blob", importedStorage.type),
    "imported blob endpoint must retain its Storage Account compatibility"
  );
  assert.ok(
    isRoleAssignmentScopeCompatible(
      importedRole.values.role_definition_name,
      importedStorage.type
    ),
    "imported Blob Contributor assignment must retain its Storage Account scope"
  );
  assert.equal(indexedEndpoint.values.private_connection_resource_id, undefined);
  assert.ok(
    auditedAdditions.mapped.find((item) => item.name === "indexed")?.unsupportedConstructs.includes(
      "private_service_connection (only one static connection is supported)"
    )
  );
  assert.ok(
    auditedAdditions.skipped.some((item) =>
      item.reason.includes('Unresolved module output reference in "infrastructure_resource_group_name"')
    )
  );

  const literalTypedReferences = mapToProject(parseHclFiles([{
    name: "literal-typed-references.tf",
    content: `
resource "azurerm_private_endpoint" "literal_target" {
  name                = "pe-literal"
  resource_group_name = "rg-dev"
  location            = "westeurope"
  subnet_id           = "/subscriptions/example/subnets/private-endpoints"

  private_service_connection {
    name                           = "psc-literal"
    private_connection_resource_id = "/subscriptions/example/resourceGroups/rg-dev/providers/Microsoft.Storage/storageAccounts/literal"
    is_manual_connection           = false
    subresource_names              = ["blob"]
  }
}

resource "azurerm_role_assignment" "literal_scope" {
  scope                = "/subscriptions/example/resourceGroups/rg-dev/providers/Microsoft.Storage/storageAccounts/literal"
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = "00000000-0000-0000-0000-000000000000"
}
`,
  }]));
  assert.equal(literalTypedReferences.resources.length, 0);
  assert.deepEqual(
    literalTypedReferences.skipped.map((item) => [item.name, item.reason]),
    [
      ["literal_target", "Literal target ID cannot be safely matched to a builder resource"],
      ["literal_scope", "Literal scope ID cannot be safely matched to a builder resource"],
    ]
  );

  const invalidReferenceSummary = mapToProject(parseHclFiles([{
    name: "reference-contract.tf",
    content: `
resource "azurerm_virtual_network" "network" {
  name                = "vnet-dev"
  location            = "westeurope"
  resource_group_name = "rg-dev"
  address_space       = ["10.0.0.0/16"]
}

resource "azurerm_storage_account" "wrong_type" {
  name                     = "storedev"
  location                 = "westeurope"
  resource_group_name      = azurerm_virtual_network.network.name
  account_tier             = "Standard"
  account_replication_type = "LRS"
}

resource "azurerm_container_app_environment" "dev" {
  name                = "cae-dev"
  location            = "westeurope"
  resource_group_name = "rg-dev"
}

resource "azurerm_container_app" "wrong_attr" {
  name                         = "app-dev"
  resource_group_name          = "rg-dev"
  container_app_environment_id = azurerm_container_app_environment.dev.name
  revision_mode                = "Single"
}

resource "azurerm_container_app" "cross_environment" {
  name                         = "app-prod"
  resource_group_name          = "rg-prod"
  container_app_environment_id = azurerm_container_app_environment.dev.id
  revision_mode                = "Single"
}
`,
  }]));
  const wrongType = invalidReferenceSummary.resources.find((resource) => resource.tfName === "wrong_type");
  const wrongAttr = invalidReferenceSummary.resources.find((resource) => resource.tfName === "wrong_attr");
  const crossEnvironment = invalidReferenceSummary.resources.find((resource) => resource.tfName === "cross_environment");
  assert.ok(wrongType);
  assert.ok(wrongAttr);
  assert.ok(crossEnvironment);
  assert.equal(wrongType.values.resource_group_name, undefined);
  assert.equal(wrongAttr.values.container_app_environment_id, undefined);
  assert.equal(crossEnvironment.values.container_app_environment_id, undefined);
  assert.deepEqual(findInvalidImportReferences(invalidReferenceSummary.resources), []);
  assert.ok(invalidReferenceSummary.warnings.some((warning) => warning.includes("target type azurerm_virtual_network is not allowed")));
  assert.ok(invalidReferenceSummary.warnings.some((warning) => warning.includes("attribute name is not allowed; expected id")));
  assert.ok(invalidReferenceSummary.warnings.some((warning) => warning.includes("target is outside the allowed scope")));

  const validScopedReference = mapToProject(parseHclFiles([{
    name: "scope-review.tf",
    content: `
resource "azurerm_container_app_environment" "dev" {
  name                = "cae-dev"
  location            = "westeurope"
  resource_group_name = "rg-dev"
}
resource "azurerm_container_app" "dev" {
  name                         = "app-dev"
  resource_group_name          = "rg-dev"
  container_app_environment_id = azurerm_container_app_environment.dev.id
  revision_mode                = "Single"
}
`,
  }]));
  assert.deepEqual(findInvalidImportReferences(validScopedReference.resources), []);
  const scopeChanged: ResourceInstance[] = validScopedReference.resources.map((resource: ResourceInstance) =>
    resource.tfName === "dev" && resource.type === "azurerm_container_app_environment"
      ? { ...resource, scope: { kind: "environment" as const, environmentId: "prod" } }
      : resource
  );
  assert.deepEqual(
    findInvalidImportReferences(scopeChanged).map((reference: InvalidImportReference) => [reference.fieldKey, reference.reason]),
    [["container_app_environment_id", "target is outside the allowed scope"]]
  );

  const mergedNestedReferences = mergeImportedResources([], [
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
  const mergedVault = mergedNestedReferences.find((resource) => resource.tfName === "vault")!;
  const mergedApp = mergedNestedReferences.find((resource) => resource.tfName === "app")!;
  const nestedVaultRef = (mergedApp.values.app_secrets as Array<{ key_vault_id: { resourceId: string } }>)[0].key_vault_id;
  assert.equal(nestedVaultRef.resourceId, mergedVault.id, "merge must remap nested Key Vault references");

  console.log("✓ parser diagnostics, safe module expansion, expression skipping, and ZIP module extraction");
}

void main();