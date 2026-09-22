/**
 * Smoke tests: export folder-structure map, orphans, download gate.
 * Policy: never silently drop unmapped resources — Map mode blocks Download
 * unless leaveUnmappedConfirmed.
 */
import assert from "node:assert/strict";
import type {
  ExportConfig,
  ProjectConfig,
  ProjectState,
  ResourceInstance,
} from "../src/lib/schema/types";
import { defaultExportConfig } from "../src/lib/schema/types";
import {
  defaultEnvironments,
  sharedScope,
} from "../src/lib/schema/environments";
import {
  buildFolderTree,
  canDownloadWithMap,
  listOrphans,
  resolveExportMap,
  resolveModuleId,
  withDomainGroupModule,
  withResourceModule,
  resetExportConfig,
  buildExportReviewSummary,
  canCopyWithMap,
} from "../src/lib/generate/export-map";
import { generateProject } from "../src/lib/generate/hcl";
import {
  canExportWithValidExistingIdentifiers,
  validateExistingIdentifiers,
} from "../src/lib/generate/existing-identifiers";
import { moduleOrder } from "../src/lib/generate/modules";
import {
  createHistory,
  mutateWithHistory,
  undo,
  cloneProjectState,
} from "../src/lib/store/history";

const config: ProjectConfig = {
  name: "map-test",
  location: "westeurope",
  namingPrefix: "map",
  tags: { Environment: "dev" },
  starter: "blank",
};

function res(id: string, type: string, tfName: string): ResourceInstance {
  return {
    id,
    type,
    tfName,
    useExisting: false,
    values: { name: `${tfName}-n` },
    existingValues: {},
    scope: sharedScope(),
  };
}

function main() {
  console.log("Azure TF Builder — export folder map smoke test\n");

  const rg = res("r1", "azurerm_resource_group", "main");
  const vnet = res("r2", "azurerm_virtual_network", "hub");
  const sa = res("r3", "azurerm_storage_account", "data");
  const resources = [rg, vnet, sa];

  assert.deepEqual(
    moduleOrder([
      "private_networking",
      "database",
      "compute",
      "identity",
      "container_registry",
      "container_apps",
      "app_service",
      "security",
      "storage",
      "networking",
      "resource_group",
    ]),
    [
      "resource_group",
      "networking",
      "storage",
      "security",
      "app_service",
      "container_apps",
      "container_registry",
      "identity",
      "compute",
      "database",
      "private_networking",
    ]
  );
  console.log("✓ export metadata uses canonical module order");

  // Defaults match MODULE_DEFS grouping
  {
    const map = resolveExportMap(resources, defaultExportConfig());
    assert.equal(map.orphans.length, 0);
    assert.equal(map.moduleOf.get("r1"), "resource_group");
    assert.equal(map.moduleOf.get("r2"), "networking");
    assert.equal(map.moduleOf.get("r3"), "storage");
    console.log("✓ default map from MODULE_DEFS");
  }

  // Override moves storage → networking
  {
    const ec = withResourceModule(defaultExportConfig(), "r3", "networking");
    assert.equal(resolveModuleId(sa, ec), "networking");
    const map = resolveExportMap(resources, ec);
    assert.ok(map.byModule.get("networking")!.some((r) => r.id === "r3"));
    assert.equal(map.byModule.has("storage"), false);
    console.log("✓ per-resource override");
  }

  // null assignment → orphan
  {
    const ec = withResourceModule(defaultExportConfig(), "r2", null);
    const orphans = listOrphans(resources, ec);
    assert.equal(orphans.length, 1);
    assert.equal(orphans[0].id, "r2");
    console.log("✓ null assignment → orphan");
  }

  // Download gate: Map mode blocks orphans unless confirmed
  {
    const ec = withResourceModule(defaultExportConfig(), "r2", null);
    const blocked = canDownloadWithMap(resources, ec, { mapMode: true });
    assert.equal(blocked.ok, false);
    assert.ok(blocked.reason);
    assert.equal(blocked.orphans.length, 1);

    const confirmed = canDownloadWithMap(resources, ec, {
      mapMode: true,
      leaveUnmappedConfirmed: true,
    });
    assert.equal(confirmed.ok, true);

    // Outside Map mode, null overrides still block (never silent)
    const noMap = canDownloadWithMap(resources, ec, { mapMode: false });
    assert.equal(noMap.ok, false);
    const confirmedNoMap = canDownloadWithMap(resources, ec, {
      mapMode: false,
      leaveUnmappedConfirmed: true,
    });
    assert.equal(
      confirmedNoMap.ok,
      true,
      "the explicit confirmation dialog must work from the Export view"
    );
    const blockedCopy = canCopyWithMap(resources, ec, { mapMode: false });
    assert.equal(blockedCopy.ok, false, "Copy must not silently omit orphans");
    const confirmedCopy = canCopyWithMap(resources, ec, {
      mapMode: false,
      leaveUnmappedConfirmed: true,
    });
    assert.equal(
      confirmedCopy.ok,
      true,
      "Copy may proceed only after explicit leave-unmapped confirmation"
    );
    console.log("✓ download gate blocks orphans; confirm allows");
  }

  // generateProject omits orphans from module files (only after UI confirm)
  {
    const ec = withResourceModule(defaultExportConfig(), "r2", null);
    const { files } = generateProject(config, resources, undefined, ec);
    const netMain = files["modules/networking/main.tf"] ?? "";
    assert.ok(!netMain.includes("azurerm_virtual_network"));
    assert.ok(
      files["modules/resource_group/main.tf"]?.includes("azurerm_resource_group")
    );
    const allHcl = Object.values(files).join("\n");
    assert.ok(!allHcl.includes('azurerm_virtual_network "hub"'));
    console.log("✓ generateProject excludes orphans from modules");
  }

  // Domain group remap
  {
    const ec = withDomainGroupModule(
      defaultExportConfig(),
      resources,
      "networking",
      "storage"
    );
    assert.equal(resolveModuleId(vnet, ec), "storage");
    console.log("✓ domain group remap");
  }

  // Folder tree includes orphans node
  {
    const ec = withResourceModule(defaultExportConfig(), "r3", null);
    const tree = buildFolderTree(resources, ["dev"], ec);
    const orphanNode = tree.find((n) => n.path === "__orphans__");
    assert.ok(orphanNode);
    assert.deepEqual(orphanNode!.resourceIds, ["r3"]);
    assert.ok(tree.some((n) => n.path === "modules"));
    assert.ok(tree.some((n) => n.path === "config.tf" || n.name === "config.tf"));
    console.log("✓ folder tree + orphan node");
  }

  // Reset clears overrides
  {
    let ec: ExportConfig = withResourceModule(
      defaultExportConfig(),
      "r1",
      "other"
    );
    ec = resetExportConfig();
    assert.deepEqual(ec, defaultExportConfig());
    console.log("✓ resetExportConfig");
  }

  // exportConfig included in undo snapshots
  {
    const envs = defaultEnvironments();
    const present: ProjectState = {
      config,
      environments: envs,
      activeEnvironmentId: envs[0].id,
      resources,
      selectedResourceId: null,
      exportConfig: defaultExportConfig(),
    };
    let h = createHistory(present);
    h = mutateWithHistory(
      h,
      (s) => ({
        ...s,
        exportConfig: withResourceModule(s.exportConfig, "r3", "networking"),
      }),
      { clone: cloneProjectState }
    );
    assert.equal(h.present.exportConfig.moduleByResourceId["r3"], "networking");
    h = undo(h, cloneProjectState);
    assert.equal(
      Object.keys(h.present.exportConfig.moduleByResourceId).length,
      0
    );
    console.log("✓ exportConfig in undo snapshots");
  }


  // Review changes summary — domain counts, no HCL
  {
    const withExisting: ResourceInstance = {
      ...sa,
      useExisting: true,
      existingValues: { name: "sa-existing" },
    };
    const list = [rg, vnet, withExisting];
    const summary = buildExportReviewSummary(list, defaultExportConfig());
    assert.equal(summary.counts.adds, 2);
    assert.equal(summary.counts.existing, 1);
    assert.equal(summary.counts.orphans, 0);
    assert.equal(summary.counts.updates, 0);
    assert.ok(summary.adds.every((i) => i.mode === "add"));
    assert.ok(summary.existing.every((i) => i.mode === "existing"));
    assert.ok(summary.folderCounts.length > 0);
    // Domain labels only — no raw HCL blobs in items
    for (const item of [...summary.adds, ...summary.existing]) {
      assert.ok(item.typeLabel);
      assert.ok(item.label);
      assert.equal("hcl" in item, false);
    }
    console.log("✓ review summary adds / Existing / folder counts");
  }

  {
    const ec = withResourceModule(defaultExportConfig(), "r2", null);
    const withExisting: ResourceInstance = {
      ...sa,
      useExisting: true,
    };
    const list = [rg, vnet, withExisting];
    const summary = buildExportReviewSummary(list, ec);
    assert.equal(summary.counts.orphans, 1);
    assert.equal(summary.orphans[0].id, "r2");
    assert.equal(summary.counts.adds, 1); // rg only (vnet orphan)
    assert.equal(summary.counts.existing, 1);
    // Override that remaps (not null) counts as update
    const ec2 = withResourceModule(defaultExportConfig(), "r3", "networking");
    const sum2 = buildExportReviewSummary([rg, vnet, sa], ec2);
    assert.equal(sum2.counts.updates, 1);
    assert.equal(sum2.updates[0].id, "r3");
    console.log("✓ review summary orphans + updates (folder overrides)");
  }

  // Existing identifier validation remains visible in Review for orphans, but
  // exposes an included-only result for future Copy/ZIP gates.
  {
    const invalidExisting: ResourceInstance = {
      ...sa,
      id: "invalid-existing",
      tfName: "invalid_existing",
      useExisting: true,
      values: { name: "storage-source-name" },
      existingValues: { name: "" },
    };
    const orphanMap = withResourceModule(
      defaultExportConfig(),
      "invalid-existing",
      null
    );
    const validation = validateExistingIdentifiers([invalidExisting], orphanMap);
    assert.equal(validation.issues.length, 2, "all catalogue existingKey fields are required");
    assert.equal(validation.includedIssues.length, 0);
    assert.ok(validation.issues.every((issue) => issue.resourceId === "invalid-existing"));
    assert.ok(validation.issues.every((issue) => issue.resourceLabel === "Storage Account"));
    assert.ok(validation.issues.every((issue) => issue.resourceName === "storage-source-name"));
    assert.ok(validation.issues.every((issue) => !issue.included));
    const orphanGate = canExportWithValidExistingIdentifiers(
      [invalidExisting],
      orphanMap
    );
    assert.equal(
      orphanGate.ok,
      true,
      "an explicitly omitted orphan must not block valid export"
    );

    const includedGate = canExportWithValidExistingIdentifiers(
      [invalidExisting],
      defaultExportConfig()
    );
    assert.equal(includedGate.ok, false);
    assert.equal(includedGate.includedIssues.length, 2);
    console.log("✓ Existing identifier validation retains orphan diagnostics");
  }

  console.log("\nAll export-map tests passed.");
}

main();
