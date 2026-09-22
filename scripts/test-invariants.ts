/**
 * Domain invariants + export golden (Develops #1 — built-to-last).
 *
 * Named invariants only — keep focused:
 * 1. Shared vs env-scoped ref
 * 2. Cross-env ref rejected
 * 3. Orphan blocks ZIP
 * 4. Prod Replace confirm required
 * 5. Export folder map golden snapshot
 */
import assert from "node:assert/strict";
import type {
  ProjectConfig,
  ResourceInstance,
} from "../src/lib/schema/types";
import { AZURE_LOCATIONS, defaultExportConfig } from "../src/lib/schema/types";
import {
  canReference,
  defaultEnvironments,
  envScope,
  filterRefCandidates,
  findScopeCompatibleResource,
  isResourceVisibleInEnv,
  mapResourceReferences,
  resourcesVisibleInEnv,
  sharedScope,
  withScopeAndValidReferences,
} from "../src/lib/schema/environments";
import {
  canDownloadWithMap,
  listOrphans,
  withResourceModule,
} from "../src/lib/generate/export-map";
import {
  isPrivateEndpointTargetCompatible,
  isRoleAssignmentScopeCompatible,
} from "../src/lib/schema/resources";
import { generateProject } from "../src/lib/generate/hcl";
import { graphEdgesForVisible } from "../src/lib/generate/graph-layout";
import {
  shouldGateDestructiveApplyOnProd,
  starterConfirmKind,
} from "../src/lib/store/prod-friction";

/** Assert with a named invariant id in the failure message. */
function invariant(
  name: string,
  condition: unknown,
  detail?: string
): asserts condition {
  const msg = detail
    ? `INVARIANT [${name}]: ${detail}`
    : `INVARIANT [${name}] failed`;
  assert.ok(condition, msg);
}

function res(
  partial: Partial<ResourceInstance> &
    Pick<ResourceInstance, "id" | "type" | "tfName">
): ResourceInstance {
  return {
    useExisting: false,
    values: {},
    existingValues: {},
    scope: sharedScope(),
    ...partial,
  };
}

const fixtureConfig: ProjectConfig = {
  name: "invariant-fixture",
  location: "westeurope",
  namingPrefix: "inv",
  tags: { Environment: "dev", ManagedBy: "azure-tf-builder" },
  starter: "blank",
};

/** Small Environment graph for golden export (stable keys + HCL markers). */
function goldenFixtureResources(): ResourceInstance[] {
  return [
    res({
      id: "rg1",
      type: "azurerm_resource_group",
      tfName: "main",
      scope: sharedScope(),
      values: {
        name: "rg-main",
        location: "westeurope",
        tags: {},
      },
    }),
    res({
      id: "vnet1",
      type: "azurerm_virtual_network",
      tfName: "hub",
      scope: sharedScope(),
      values: {
        name: "vnet-hub",
        resource_group_name: { resourceId: "rg1", attr: "name" },
        address_space: ["10.0.0.0/16"],
        location: { resourceId: "rg1", attr: "location" },
      },
    }),
    res({
      id: "sa1",
      type: "azurerm_storage_account",
      tfName: "data",
      scope: envScope("dev"),
      values: {
        name: "invdata001",
        resource_group_name: { resourceId: "rg1", attr: "name" },
        location: { resourceId: "rg1", attr: "location" },
        account_tier: "Standard",
        account_replication_type: "LRS",
      },
    }),
  ];
}

/** Expected ZIP / generateProject paths for the golden fixture (sorted). */
const GOLDEN_EXPORT_KEYS = [
  "README.md",
  "config.tf",
  "environments/backend.dev.hcl",
  "environments/backend.prod.hcl",
  "environments/backend.staging.hcl",
  "environments/dev.tfvars",
  "environments/prod.tfvars",
  "environments/staging.tfvars",
  "main.tf",
  "modules/networking/main.tf",
  "modules/networking/outputs.tf",
  "modules/networking/variables.tf",
  "modules/resource_group/main.tf",
  "modules/resource_group/outputs.tf",
  "modules/resource_group/variables.tf",
  "modules/storage/main.tf",
  "modules/storage/outputs.tf",
  "modules/storage/variables.tf",
  "outputs.tf",
  "variables.tf",
] as const;

function main() {
  console.log("Azure TF Builder — domain invariants + export golden\n");

  const envs = defaultEnvironments();
  const prod = envs.find((e) => e.id === "prod")!;
  const dev = envs.find((e) => e.id === "dev")!;

  const sharedRg = res({
    id: "rg",
    type: "azurerm_resource_group",
    tfName: "main",
    scope: sharedScope(),
    values: { name: "rg" },
  });
  const devApp = res({
    id: "app-dev",
    type: "azurerm_container_app",
    tfName: "app",
    scope: envScope("dev"),
    values: {
      name: "ca-dev",
      resource_group_name: { resourceId: "rg", attr: "name" },
    },
  });
  const prodApp = res({
    id: "app-prod",
    type: "azurerm_container_app",
    tfName: "app_prod",
    scope: envScope("prod"),
    values: {
      name: "ca-prod",
      resource_group_name: { resourceId: "rg", attr: "name" },
    },
  });
  const stagingApp = res({
    id: "app-stg",
    type: "azurerm_container_app",
    tfName: "app_stg",
    scope: envScope("staging"),
    values: {
      name: "ca-stg",
      resource_group_name: { resourceId: "rg", attr: "name" },
    },
  });
  const all = [sharedRg, devApp, prodApp, stagingApp];

  // -------------------------------------------------------------------------
  // 1. Catalogue compatibility contracts
  // -------------------------------------------------------------------------
  {
    const name = "azure-location-catalogue";
    const swedenCentral = AZURE_LOCATIONS.filter(
      (location) => location.value === "swedencentral"
    );
    invariant(
      name,
      swedenCentral.length === 1 &&
        swedenCentral[0]?.label === "Sweden Central",
      "Sweden Central must be a selectable Azure location"
    );
    console.log(`✓ [${name}] Sweden Central location`);
  }

  {
    const name = "target-role-compatibility";
    invariant(
      name,
      isPrivateEndpointTargetCompatible("blob", "azurerm_storage_account"),
      "blob must target Storage Account"
    );
    invariant(
      name,
      !isPrivateEndpointTargetCompatible("blob", "azurerm_key_vault"),
      "blob must reject Key Vault"
    );
    invariant(
      name,
      isPrivateEndpointTargetCompatible(
        "registry",
        "azurerm_container_registry"
      ),
      "registry must target Container Registry"
    );
    invariant(
      name,
      isRoleAssignmentScopeCompatible(
        "Storage Blob Data Contributor",
        "azurerm_storage_account"
      ),
      "Storage Blob Data Contributor must target Storage Account"
    );
    invariant(
      name,
      !isRoleAssignmentScopeCompatible(
        "AcrPull",
        "azurerm_storage_account"
      ),
      "AcrPull must reject Storage Account"
    );
    invariant(
      name,
      isRoleAssignmentScopeCompatible(
        "Key Vault Secrets User",
        "azurerm_key_vault"
      ),
      "Key Vault Secrets User must target Key Vault"
    );
    console.log(`✓ [${name}] Private Endpoint and Role Assignment pairings`);
  }

  // -------------------------------------------------------------------------
  // 2. Shared vs env-scoped visibility / filtering + ref eligibility
  // -------------------------------------------------------------------------
  {
    const name = "shared-vs-env-scoped";

    invariant(
      name,
      isResourceVisibleInEnv(sharedRg, "dev"),
      "shared resource must be visible in every env (dev)"
    );
    invariant(
      name,
      isResourceVisibleInEnv(sharedRg, "prod"),
      "shared resource must be visible in every env (prod)"
    );
    invariant(
      name,
      isResourceVisibleInEnv(devApp, "dev"),
      "dev-scoped app must be visible in dev"
    );
    invariant(
      name,
      !isResourceVisibleInEnv(devApp, "prod"),
      "dev-scoped app must NOT be visible in prod"
    );
    invariant(
      name,
      !isResourceVisibleInEnv(prodApp, "dev"),
      "prod-scoped app must NOT be visible in dev"
    );

    const inDev = resourcesVisibleInEnv(all, "dev");
    invariant(
      name,
      inDev.length === 2 &&
        inDev.some((r) => r.id === "rg") &&
        inDev.some((r) => r.id === "app-dev") &&
        !inDev.some((r) => r.id === "app-prod"),
      `dev filter expected [rg, app-dev]; got [${inDev.map((r) => r.id).join(", ")}]`
    );

    // Env-scoped → shared OK; shared → env-scoped blocked (no leak across envs)
    invariant(
      name,
      canReference(devApp, sharedRg) === true,
      "env-scoped may reference shared"
    );
    invariant(
      name,
      canReference(sharedRg, devApp) === false,
      "shared must NOT reference env-scoped (would leak across envs)"
    );
    invariant(
      name,
      canReference(sharedRg, sharedRg) === true ||
        canReference(
          sharedRg,
          res({
            id: "rg2",
            type: "azurerm_resource_group",
            tfName: "other",
            scope: sharedScope(),
          })
        ) === true,
      "shared may reference shared"
    );

    const candidates = filterRefCandidates(all, {
      currentId: "app-dev",
      refTypes: ["azurerm_container_app", "azurerm_resource_group"],
      activeEnvironmentId: "dev",
      current: devApp,
    });
    invariant(
      name,
      candidates.some((c) => c.id === "rg"),
      "picker must include shared RG for env-scoped current"
    );
    invariant(
      name,
      !candidates.some((c) => c.id === "app-prod"),
      "picker must exclude prod-scoped when current is dev"
    );
    invariant(
      name,
      !candidates.some((c) => c.id === "app-dev"),
      "picker must exclude self"
    );

    console.log(`✓ [${name}] visibility filter + shared↔env ref rules`);
  }

  // -------------------------------------------------------------------------
  // 2. Cross-env reference blocking (canReference / pickers / graph edges)
  // -------------------------------------------------------------------------
  {
    const name = "cross-env-ref-rejected";

    invariant(
      name,
      canReference(devApp, prodApp) === false,
      "dev → prod must be rejected"
    );
    invariant(
      name,
      canReference(prodApp, devApp) === false,
      "prod → dev must be rejected"
    );
    invariant(
      name,
      canReference(devApp, stagingApp) === false,
      "dev → staging must be rejected"
    );
    // Same-env OK
    const otherDev = res({
      id: "app-dev-2",
      type: "azurerm_container_app",
      tfName: "app2",
      scope: envScope("dev"),
    });
    invariant(
      name,
      canReference(devApp, otherDev) === true,
      "same-env refs must be allowed"
    );

    // Graph edges: cross-env dep marked invalid
    const crossFromStg = res({
      id: "app-stg-bad",
      type: "azurerm_container_app",
      tfName: "bad",
      scope: envScope("staging"),
      values: {
        resource_group_name: { resourceId: "app-dev", attr: "name" },
      },
    });
    const graphAll = [sharedRg, devApp, crossFromStg];
    const edges = graphEdgesForVisible(graphAll, graphAll);
    const blocked = edges.find(
      (e) => e.fromId === "app-stg-bad" && e.toId === "app-dev"
    );
    invariant(
      name,
      blocked != null,
      "collectDeps must still surface the cross-env edge for validity marking"
    );
    invariant(
      name,
      blocked!.valid === false,
      "cross-env graph edge must be valid:false (omit/dim in UI)"
    );

    // Valid env→shared edge stays valid
    const goodEdges = graphEdgesForVisible(
      [sharedRg, devApp],
      [sharedRg, devApp]
    );
    const good = goodEdges.find(
      (e) => e.fromId === "app-dev" && e.toId === "rg"
    );
    invariant(
      name,
      good != null && good.valid === true,
      "env→shared graph edge must remain valid"
    );

    console.log(`✓ [${name}] canReference + picker + graph edge validity`);
  }

  // -------------------------------------------------------------------------
  // 3. Nested reference cleanup and scope-compatible auto-wiring
  // -------------------------------------------------------------------------
  {
    const name = "nested-reference-integrity";
    const prodVault = res({
      id: "prod-vault",
      type: "azurerm_key_vault",
      tfName: "prod",
      scope: envScope("prod"),
    });
    const devVault = res({
      id: "dev-vault",
      type: "azurerm_key_vault",
      tfName: "dev",
      scope: envScope("dev"),
    });
    const vaultCandidates = filterRefCandidates([devApp, devVault, prodVault], {
      currentId: devApp.id,
      refTypes: ["azurerm_key_vault"],
      activeEnvironmentId: "dev",
      current: devApp,
    });
    invariant(
      name,
      vaultCandidates.some((candidate) => candidate.id === devVault.id) &&
        !vaultCandidates.some((candidate) => candidate.id === prodVault.id),
      "a dev Container App must exclude a prod Key Vault"
    );
    invariant(
      name,
      findScopeCompatibleResource({ scope: envScope("dev") }, [prodVault], "azurerm_key_vault") === undefined,
      "catalogue auto-wiring must reject a target from another environment"
    );

    const appWithSecret = res({
      id: "app-with-secret",
      type: "azurerm_container_app",
      tfName: "app",
      scope: envScope("dev"),
      values: {
        name: "app-with-secret",
        app_secrets: [
          {
            name: "api-key",
            source: "key_vault",
            key_vault_id: { resourceId: devVault.id, attr: "id" },
            secret_name: "api-key",
          },
        ],
      },
    });
    const afterDelete = mapResourceReferences(appWithSecret, (reference) =>
      reference.resourceId === devVault.id ? undefined : reference
    );
    const secret = (afterDelete.values.app_secrets as Array<Record<string, unknown>>)[0];
    invariant(name, !("key_vault_id" in secret), "deleting a vault must clear nested secret references");
    const generated = generateProject(fixtureConfig, [afterDelete], envs);
    invariant(
      name,
      !Object.values(generated.files).join("\n").includes("UNRESOLVED_REF"),
      "generation must not emit unresolved references after vault deletion"
    );
    console.log(`✓ [${name}] scoped vault selection, auto-wiring, and nested deletion cleanup`);
  }

  // -------------------------------------------------------------------------
  // 4. Scope changes clear references that would become cross-environment
  // -------------------------------------------------------------------------
  {
    const name = "scope-change-clears-invalid-references";
    const appWithReferences = res({
      id: "app-with-refs",
      type: "azurerm_container_app",
      tfName: "app",
      scope: envScope("dev"),
      values: {
        container_app_environment_id: { resourceId: "dev-app-env", attr: "id" },
        resource_group_name: { resourceId: "rg", attr: "name" },
        app_secrets: [
          {
            name: "api-key",
            source: "key_vault",
            key_vault_id: { resourceId: "dev-vault", attr: "id" },
            secret_name: "api-key",
          },
        ],
      },
    });
    const devAppEnvironment = res({
      id: "dev-app-env",
      type: "azurerm_container_app_environment",
      tfName: "dev",
      scope: envScope("dev"),
    });
    const devVault = res({
      id: "dev-vault",
      type: "azurerm_key_vault",
      tfName: "dev",
      scope: envScope("dev"),
    });
    const scopedResources = withScopeAndValidReferences(
      appWithReferences,
      sharedScope(),
      [appWithReferences, devAppEnvironment, devVault, sharedRg]
    );
    const scoped = scopedResources.find((resource) => resource.id === appWithReferences.id)!;

    invariant(name, scoped.scope.kind === "shared", "must apply the requested scope");
    invariant(
      name,
      !("container_app_environment_id" in scoped.values),
      "must clear an env-scoped top-level reference"
    );
    invariant(name, scoped.values.resource_group_name !== undefined, "must preserve a shared reference");
    const secret = (scoped.values.app_secrets as Array<Record<string, unknown>>)[0];
    invariant(
      name,
      !("key_vault_id" in secret),
      "must clear a nested app-secret reference when it becomes cross-env"
    );

    const sharedTarget = res({
      id: "shared-target",
      type: "azurerm_container_app_environment",
      tfName: "shared",
      scope: sharedScope(),
    });
    const devDependent = res({
      id: "dev-dependent",
      type: "azurerm_container_app",
      tfName: "dev",
      scope: envScope("dev"),
      values: {
        container_app_environment_id: { resourceId: "shared-target", attr: "id" },
      },
    });
    const movedTargetResources = withScopeAndValidReferences(
      sharedTarget,
      envScope("prod"),
      [sharedTarget, devDependent]
    );
    const movedTarget = movedTargetResources.find((resource) => resource.id === sharedTarget.id)!;
    const dependentAfterMove = movedTargetResources.find(
      (resource) => resource.id === devDependent.id
    )!;
    invariant(
      name,
      movedTarget.scope.kind === "environment" && movedTarget.scope.environmentId === "prod",
      "must move the target to prod"
    );
    invariant(
      name,
      !("container_app_environment_id" in dependentAfterMove.values),
      "must clear an incoming dev reference to a target moved to prod"
    );
    console.log(`✓ [${name}] scope changes remove invalid exportable references`);
  }

  // -------------------------------------------------------------------------
  // 3. Export orphan ZIP gate (download blocked; leave-unmapped confirm)
  // -------------------------------------------------------------------------
  {
    const name = "orphan-blocks-zip";
    const resources = goldenFixtureResources();
    const ec = withResourceModule(defaultExportConfig(), "vnet1", null);

    const orphans = listOrphans(resources, ec);
    invariant(
      name,
      orphans.length === 1 && orphans[0].id === "vnet1",
      `expected orphan vnet1; got [${orphans.map((o) => o.id).join(", ")}]`
    );

    const blockedMap = canDownloadWithMap(resources, ec, { mapMode: true });
    invariant(
      name,
      blockedMap.ok === false,
      "Map mode must block Download ZIP while orphans remain"
    );
    invariant(
      name,
      blockedMap.orphans.length === 1,
      "blocked gate must report the orphan list"
    );

    const blockedNoMap = canDownloadWithMap(resources, ec, { mapMode: false });
    invariant(
      name,
      blockedNoMap.ok === false,
      "outside Map mode, null overrides still block (never silent drop)"
    );

    const confirmed = canDownloadWithMap(resources, ec, {
      mapMode: true,
      leaveUnmappedConfirmed: true,
    });
    invariant(
      name,
      confirmed.ok === true,
      "Leave unmapped… confirm must allow download"
    );

    // After confirm path, generate excludes orphan from modules
    const { files } = generateProject(
      fixtureConfig,
      resources,
      envs,
      ec
    );
    const netMain = files["modules/networking/main.tf"] ?? "";
    invariant(
      name,
      !netMain.includes("azurerm_virtual_network"),
      "orphan must be omitted from module HCL (no silent ZIP inclusion)"
    );
    const allHcl = Object.values(files).join("\n");
    invariant(
      name,
      !allHcl.includes('azurerm_virtual_network "hub"'),
      "orphan resource block must not appear anywhere in export"
    );

    console.log(`✓ [${name}] download gate + leave-unmapped confirm`);
  }

  // -------------------------------------------------------------------------
  // 4. Prod friction confirms (starter + import) can’t be silently skipped
  // -------------------------------------------------------------------------
  {
    const name = "prod-replace-confirm-required";

    // Starter: Prod always needs friction — empty canvas included (no silent skip)
    invariant(
      name,
      starterConfirmKind(0, prod) === "prod",
      "empty Prod canvas must still require Prod friction (not 'none')"
    );
    invariant(
      name,
      starterConfirmKind(5, prod) === "prod",
      "non-empty Prod must require Prod friction"
    );
    invariant(
      name,
      starterConfirmKind(0, dev) === "none",
      "empty non-Prod may apply immediately"
    );
    invariant(
      name,
      starterConfirmKind(2, dev) === "normal",
      "non-empty non-Prod uses normal Replace/Merge confirm"
    );

    // Import Replace (and Merge) gated on Prod
    invariant(
      name,
      shouldGateDestructiveApplyOnProd("replace", prod) === true,
      "Import Replace on Prod must require second confirm"
    );
    invariant(
      name,
      shouldGateDestructiveApplyOnProd("merge", prod) === true,
      "Import Merge on Prod must require second confirm"
    );
    invariant(
      name,
      shouldGateDestructiveApplyOnProd("replace", dev) === false,
      "Import Replace on Dev must NOT require Prod friction"
    );

    console.log(`✓ [${name}] starter + import Replace/Merge cannot skip on Prod`);
  }

  // -------------------------------------------------------------------------
  // 5. Export folder map golden snapshot (file keys + critical HCL markers)
  // -------------------------------------------------------------------------
  {
    const name = "export-folder-map-golden";
    const resources = goldenFixtureResources();
    const { files } = generateProject(
      fixtureConfig,
      resources,
      defaultEnvironments()
    );
    const keys = Object.keys(files).sort();

    invariant(
      name,
      keys.length === GOLDEN_EXPORT_KEYS.length,
      `key count ${keys.length} !== golden ${GOLDEN_EXPORT_KEYS.length}`
    );
    for (let i = 0; i < GOLDEN_EXPORT_KEYS.length; i++) {
      invariant(
        name,
        keys[i] === GOLDEN_EXPORT_KEYS[i],
        `file key[${i}]: got "${keys[i]}" expected "${GOLDEN_EXPORT_KEYS[i]}"`
      );
    }

    // Critical HCL markers — regex / includes, not full-file whitespace snapshots
    const markers: { path: string; re: RegExp; label: string }[] = [
      {
        path: "config.tf",
        re: /backend "azurerm" \{\}/,
        label: "partial azurerm backend",
      },
      {
        path: "modules/resource_group/main.tf",
        re: /resource "azurerm_resource_group" "main"/,
        label: "RG resource block",
      },
      {
        path: "modules/networking/main.tf",
        re: /resource "azurerm_virtual_network" "hub"/,
        label: "VNet resource block",
      },
      {
        path: "modules/storage/main.tf",
        re: /resource "azurerm_storage_account" "data"/,
        label: "storage resource block",
      },
      {
        path: "main.tf",
        re: /module "resource_group"/,
        label: "root module resource_group",
      },
      {
        path: "main.tf",
        re: /module "networking"/,
        label: "root module networking",
      },
      {
        path: "main.tf",
        re: /module "storage"/,
        label: "root module storage",
      },
      {
        path: "environments/dev.tfvars",
        re: /naming_prefix/,
        label: "dev tfvars naming_prefix",
      },
      {
        path: "environments/prod.tfvars",
        re: /acr_sku/,
        label: "prod tfvars acr_sku",
      },
      {
        path: "environments/backend.dev.hcl",
        re: /\bkey\s*=/,
        label: "backend.dev.hcl key",
      },
    ];

    for (const m of markers) {
      const content = files[m.path] ?? "";
      invariant(
        name,
        m.re.test(content),
        `missing HCL marker "${m.label}" in ${m.path}`
      );
    }

    // Env tfvars must differ (sizing) — regression lock without brittle whitespace
    invariant(
      name,
      files["environments/dev.tfvars"] !== files["environments/prod.tfvars"],
      "dev and prod tfvars must differ"
    );

    console.log(
      `✓ [${name}] ${GOLDEN_EXPORT_KEYS.length} file keys + ${markers.length} HCL markers`
    );
  }

  console.log("\nAll domain invariants passed.");
}

main();
