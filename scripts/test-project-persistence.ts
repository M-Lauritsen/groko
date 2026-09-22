import assert from "node:assert/strict";
import {
  defaultEnvironments,
  envScope,
  sharedScope,
} from "../src/lib/schema/environments";
import { defaultExportConfig, type ProjectState, type ResourceInstance } from "../src/lib/schema/types";
import {
  clearExistingSnapshot,
  deriveExistingSnapshot,
  refreshExistingSnapshot,
  resolveExistingSnapshotReference,
  withDerivedExistingSnapshots,
} from "../src/lib/store/existing-snapshots";
import { parseProjectFile, projectFileFromState, serializeProject } from "../src/lib/store/project-persistence";

function state(): ProjectState {
  const environments = defaultEnvironments();
  return {
    config: {
      name: "persistence-test",
      location: "westeurope",
      namingPrefix: "persist",
      tags: { Environment: "dev" },
      starter: "blank",
    },
    environments,
    activeEnvironmentId: environments[0].id,
    resources: [
      {
        id: "r1",
        type: "azurerm_resource_group",
        tfName: "main",
        useExisting: false,
        values: { name: "rg-persist" },
        existingValues: {},
        scope: sharedScope(),
      },
    ],
    selectedResourceId: "r1",
    exportConfig: defaultExportConfig(),
  };
}

const original = state();
const roundTrip = parseProjectFile(serializeProject(original));
assert.equal(roundTrip.config.name, original.config.name);
assert.equal(roundTrip.resources.length, 1);
assert.equal(roundTrip.selectedResourceId, null);

// Existing identifiers are literal project state. In particular, a missing
// entry and an explicit empty entry remain distinguishable through save/load.
const snapshotState: ProjectState = {
  ...state(),
  resources: [
    {
      id: "empty-snapshot",
      type: "azurerm_resource_group",
      tfName: "empty_snapshot",
      useExisting: true,
      values: {},
      existingValues: { name: "" },
      scope: sharedScope(),
    },
    {
      id: "missing-snapshot",
      type: "azurerm_resource_group",
      tfName: "missing_snapshot",
      useExisting: true,
      values: {},
      existingValues: {},
      scope: sharedScope(),
    },
  ],
};
const persistedSnapshots = parseProjectFile(serializeProject(snapshotState));
const emptySnapshot = persistedSnapshots.resources.find(
  (candidate) => candidate.id === "empty-snapshot"
)!;
const missingSnapshot = persistedSnapshots.resources.find(
  (candidate) => candidate.id === "missing-snapshot"
)!;
assert.equal(emptySnapshot.existingValues.name, "");
assert.equal(
  Object.hasOwn(missingSnapshot.existingValues, "name"),
  false,
  "a missing snapshot must not be serialized or loaded as an intentional empty value",
);

const invalid = projectFileFromState(original);
invalid.state.environments = [];
const repaired = parseProjectFile(JSON.stringify(invalid));
assert.equal(repaired.environments.length, 3);
assert.equal(repaired.activeEnvironmentId, repaired.environments[0].id);

assert.throws(
  () => parseProjectFile(JSON.stringify({ format: "groko-project", version: 99 })),
  /Unsupported project file/,
);
assert.throws(() => parseProjectFile("not json"), /not valid JSON/);

function resource(partial: Partial<ResourceInstance> & Pick<ResourceInstance, "id" | "type">): ResourceInstance {
  return {
    tfName: "main",
    useExisting: false,
    values: {},
    existingValues: {},
    scope: sharedScope(),
    ...partial,
  };
}

// Existing keys are catalogue-driven. A direct Resource Group target's saved
// Existing name wins over its current literal value when a Private DNS zone is
// repaired from a reference.
const group = resource({
  id: "rg",
  type: "azurerm_resource_group",
  values: { name: "rg-current" },
  existingValues: { name: "rg-snapshot" },
});
const dns = resource({
  id: "dns",
  type: "azurerm_private_dns_zone",
  useExisting: true,
  values: {
    name: "privatelink.azurecr.io",
    resource_group_name: { resourceId: "rg", attr: "name" },
  },
  existingValues: { name: "explicit-zone-name" },
});
const repairedFile = projectFileFromState({
  ...state(),
  resources: [group, dns],
});
const repairedFromLoad = parseProjectFile(repairedFile);
const repairedDns = repairedFromLoad.resources.find((candidate) => candidate.id === "dns")!;
assert.equal(repairedDns.existingValues.name, "explicit-zone-name");
assert.equal(repairedDns.existingValues.resource_group_name, "rg-snapshot");
assert.equal(
  deriveExistingSnapshot(dns, "name", [dns]),
  "privatelink.azurecr.io",
  "literal existingKey values remain eligible for Create-to-Existing seeding",
);
assert.equal(repairedFile.version, 1, "load repair must not bump the file version");
assert.equal(
  (repairedFile.state.resources[1].existingValues as Record<string, unknown>).resource_group_name,
  undefined,
  "load repair must not mutate the parsed project-file object",
);
assert.match(
  serializeProject(repairedFromLoad),
  /"resource_group_name": "rg-snapshot"/,
  "the normal next save persists an in-memory repair",
);

// A target's literal value is the fallback only when its saved Existing value
// is absent or empty. Snapshot derivation never follows a second Ref.
const fallbackGroup = resource({
  ...group,
  existingValues: { name: "" },
  values: { name: "rg-literal" },
});
assert.equal(
  deriveExistingSnapshot(dns, "resource_group_name", [fallbackGroup, dns]),
  "rg-literal",
);
assert.equal(
  deriveExistingSnapshot(
    resource({
      ...dns,
      values: { ...dns.values, resource_group_name: "  rg-padded  " },
    }),
    "resource_group_name",
    [dns],
  ),
  "  rg-padded  ",
  "padded identifiers remain literal snapshot state",
);
assert.equal(
  deriveExistingSnapshot(
    resource({
      ...dns,
      values: { ...dns.values, resource_group_name: " \t " },
    }),
    "resource_group_name",
    [dns],
  ),
  undefined,
  "whitespace-only identifiers must not snapshot",
);
assert.equal(
  resolveExistingSnapshotReference(
    resource({
      ...dns,
      scope: envScope("dev"),
    }),
    "resource_group_name",
    [
      resource({
        ...group,
        scope: envScope("staging"),
      }),
      dns,
    ],
  ),
  undefined,
  "cross-environment direct Refs must not resolve as safe snapshots",
);
for (const targetValue of [
  undefined,
  "",
  42,
  { resourceId: "other", attr: "name" },
]) {
  const unsafeGroup = resource({
    ...group,
    existingValues: {},
    values: { name: targetValue },
  });
  assert.equal(
    deriveExistingSnapshot(dns, "resource_group_name", [unsafeGroup, dns]),
    undefined,
    "unresolved, empty, non-string, and Ref-chain values must not snapshot",
  );
}
assert.equal(
  deriveExistingSnapshot(
    resource({
      ...dns,
      values: { ...dns.values, resource_group_name: { resourceId: "missing", attr: "name" } },
    }),
    "resource_group_name",
    [dns],
  ),
  undefined,
  "missing direct targets must not snapshot",
);

const explicitlyCleared = withDerivedExistingSnapshots(
  resource({
    ...dns,
    existingValues: { name: "explicit-zone-name", resource_group_name: "" },
  }),
  [group, dns],
);
assert.equal(
  explicitlyCleared.existingValues.resource_group_name,
  "",
  "present-empty destination snapshots must remain intentional clears",
);
const createToExistingSeed = withDerivedExistingSnapshots(
  resource({ ...dns, useExisting: false, existingValues: {} }),
  [group, dns],
);
assert.deepEqual(createToExistingSeed.existingValues, {
  name: "privatelink.azurecr.io",
  resource_group_name: "rg-snapshot",
});

// Toggling Existing off does not clear its literal snapshot. Toggling it back
// on only offers missing-key derivation, so all present values (including an
// intentional clear) remain stable despite changed Create values.
const existingToCreateToExisting = withDerivedExistingSnapshots(
  {
    ...dns,
    useExisting: true,
    values: {
      name: "changed-create-zone-name",
      resource_group_name: { resourceId: "rg", attr: "name" },
    },
    existingValues: {
      name: "",
      resource_group_name: "captured-rg-name",
    },
  },
  [group, dns],
);
assert.deepEqual(existingToCreateToExisting.existingValues, {
  name: "",
  resource_group_name: "captured-rg-name",
});

// Field actions only affect their selected snapshot. Clearing is an explicit
// present-empty value, so later Existing mode transitions cannot reseed it.
const actionResource = resource({
  ...dns,
  existingValues: {
    name: "saved-zone-name",
    resource_group_name: "saved-rg-name",
  },
});
const clearedSnapshot = clearExistingSnapshot(actionResource, "resource_group_name");
assert.deepEqual(clearedSnapshot.existingValues, {
  name: "saved-zone-name",
  resource_group_name: "",
});
assert.equal(
  Object.hasOwn(clearedSnapshot.existingValues, "resource_group_name"),
  true,
  "clearing must retain an intentional present-empty snapshot",
);
assert.deepEqual(
  withDerivedExistingSnapshots(clearedSnapshot, [group, clearedSnapshot]).existingValues,
  clearedSnapshot.existingValues,
  "mode transitions must not reseed a cleared snapshot",
);

// A refresh is available only for a safely resolved direct Ref, identifies
// its direct source, and changes only that selected Existing field.
const refreshSource = resource({
  ...group,
  existingValues: { name: "current-rg-name" },
});
const refresh = resolveExistingSnapshotReference(
  actionResource,
  "resource_group_name",
  [refreshSource, actionResource],
);
assert.equal(refresh?.source.id, "rg");
assert.equal(refresh?.value, "current-rg-name");
assert.deepEqual(
  refreshExistingSnapshot(actionResource, "resource_group_name", [
    refreshSource,
    actionResource,
  ]).existingValues,
  { name: "saved-zone-name", resource_group_name: "current-rg-name" },
);
assert.equal(
  resolveExistingSnapshotReference(
    resource({
      ...actionResource,
      values: {
        ...actionResource.values,
        resource_group_name: { resourceId: "missing", attr: "name" },
      },
    }),
    "resource_group_name",
    [actionResource],
  ),
  undefined,
  "an unresolved or unsafe Ref cannot offer a refresh",
);

console.log("Project persistence smoke tests passed");