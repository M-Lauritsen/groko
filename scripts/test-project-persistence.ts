import assert from "node:assert/strict";
import { defaultEnvironments, sharedScope } from "../src/lib/schema/environments";
import { defaultExportConfig, type ProjectState } from "../src/lib/schema/types";
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

console.log("Project persistence smoke tests passed");