/**
 * Smoke: dependency graph layout reuses collectDeps + canReference (no second topology).
 */
import assert from "node:assert/strict";
import type { ResourceInstance } from "../src/lib/schema/types";
import { sharedScope, envScope } from "../src/lib/schema/environments";
import {
  graphEdgesForVisible,
  layoutDependencyGraph,
} from "../src/lib/generate/graph-layout";
import { collectDeps } from "../src/lib/generate/deps";

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

console.log("Azure TF Builder — graph layout smoke test\n");

const rg = res({
  id: "rg1",
  type: "azurerm_resource_group",
  tfName: "main",
  scope: sharedScope(),
});
const vnet = res({
  id: "vnet1",
  type: "azurerm_virtual_network",
  tfName: "hub",
  scope: sharedScope(),
  values: {
    resource_group_name: { resourceId: "rg1", attr: "name" },
  },
});
const appDev = res({
  id: "app-dev",
  type: "azurerm_container_app",
  tfName: "api",
  scope: envScope("dev"),
  values: {
    resource_group_name: { resourceId: "rg1", attr: "name" },
  },
});
const appStg = res({
  id: "app-stg",
  type: "azurerm_container_app",
  tfName: "api_stg",
  scope: envScope("staging"),
  values: {
    resource_group_name: { resourceId: "rg1", attr: "name" },
  },
});

const all = [rg, vnet, appDev, appStg];

// Visible for dev: shared + app-dev (not app-stg)
const visibleDev = [rg, vnet, appDev];
const edges = graphEdgesForVisible(visibleDev, all);
assert.ok(
  edges.length >= 2,
  `expected edges among visible, got ${edges.length}`
);
assert.ok(
  edges.every((e) => e.valid),
  "shared↔shared and env→shared are valid"
);
assert.ok(
  edges.some((e) => e.fromId === "vnet1" && e.toId === "rg1"),
  "vnet→rg edge present"
);
assert.ok(
  edges.some((e) => e.fromId === "app-dev" && e.toId === "rg1"),
  "app→rg edge present"
);
assert.ok(
  !edges.some((e) => e.fromId === "app-stg" || e.toId === "app-stg"),
  "staging app not in visible edges"
);

// Cross-env blocked: staging app referencing a dev-scoped resource
const cross = res({
  id: "app-stg2",
  type: "azurerm_container_app",
  tfName: "bad",
  scope: envScope("staging"),
  values: {
    resource_group_name: { resourceId: "app-dev", attr: "name" },
  },
});
const withCross = [rg, appDev, cross];
const crossEdges = graphEdgesForVisible(withCross, withCross);
const blocked = crossEdges.find(
  (e) => e.fromId === "app-stg2" && e.toId === "app-dev"
);
assert.ok(blocked, "edge still collected from collectDeps");
assert.equal(blocked!.valid, false, "cross-env edge marked invalid");

const layout = layoutDependencyGraph(visibleDev, all, {
  omitInvalidEdges: true,
});
assert.equal(layout.nodes.length, 3);
assert.ok(layout.edges.every((e) => e.valid));
assert.ok(
  layout.nodes.every((n) => typeof n.x === "number" && typeof n.y === "number")
);
const nRg = layout.nodes.find((n) => n.id === "rg1")!;
const nVnet = layout.nodes.find((n) => n.id === "vnet1")!;
assert.ok(nRg.layer < nVnet.layer, "dependency left of dependent");

const raw = collectDeps(all).filter(
  (e) =>
    visibleDev.some((r) => r.id === e.fromId) &&
    visibleDev.some((r) => r.id === e.toId)
);
assert.equal(edges.length, raw.length);

console.log("✓ graphEdgesForVisible marks cross-env invalid");
console.log("✓ layoutDependencyGraph layers deps left of dependents");
console.log("✓ edge topology equals filtered collectDeps");
console.log("\nAll graph-layout smoke tests passed.");
