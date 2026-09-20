/**
 * Smoke tests: undo/history stack + safer starter apply (replace/merge/confirm).
 */
import assert from "node:assert/strict";
import type { ProjectConfig, ProjectState, ResourceInstance } from "../src/lib/schema/types";
import { defaultExportConfig } from "../src/lib/schema/types";
import { defaultEnvironments, sharedScope } from "../src/lib/schema/environments";
import {
  HISTORY_LIMIT,
  canRedo,
  canUndo,
  cloneProjectState,
  createHistory,
  mutateWithHistory,
  pushHistory,
  redo,
  undo,
} from "../src/lib/store/history";
import {
  applyStarterToState,
  shouldConfirmStarterApply,
} from "../src/lib/store/starter-apply";

let nextId = 1;
function makeId(): string {
  return `hist_${nextId++}`;
}

const baseConfig: ProjectConfig = {
  name: "hist-test",
  location: "westeurope",
  namingPrefix: "hist",
  tags: { Environment: "test" },
  starter: "blank",
};

function emptyState(): ProjectState {
  const environments = defaultEnvironments();
  return {
    config: { ...baseConfig },
    environments,
    activeEnvironmentId: environments[0].id,
    resources: [],
    selectedResourceId: null,
    exportConfig: defaultExportConfig(),
  };
}

function fakeResource(id: string, tfName = "main"): ResourceInstance {
  return {
    id,
    type: "azurerm_resource_group",
    tfName,
    useExisting: false,
    values: { name: `rg-${tfName}`, location: "westeurope" },
    existingValues: {},
    scope: sharedScope(),
  };
}

function main() {
  console.log("Azure TF Builder — history + starter confirm smoke test\n");

  // --- History push / undo / redo ---
  {
    let h = createHistory(emptyState());
    assert.equal(canUndo(h), false);
    assert.equal(canRedo(h), false);

    const withOne: ProjectState = {
      ...emptyState(),
      resources: [fakeResource("a")],
      selectedResourceId: "a",
    };
    h = pushHistory(h, withOne);
    assert.equal(canUndo(h), true);
    assert.equal(h.present.resources.length, 1);
    assert.equal(h.past.length, 1);
    assert.equal(h.past[0].resources.length, 0);

    const withTwo: ProjectState = {
      ...withOne,
      resources: [fakeResource("a"), fakeResource("b", "extra")],
      selectedResourceId: "b",
    };
    h = pushHistory(h, withTwo);
    assert.equal(h.present.resources.length, 2);

    h = undo(h);
    assert.equal(h.present.resources.length, 1);
    assert.equal(h.present.selectedResourceId, "a");
    assert.equal(canRedo(h), true);

    h = undo(h);
    assert.equal(h.present.resources.length, 0);
    assert.equal(canUndo(h), false);

    h = redo(h);
    assert.equal(h.present.resources.length, 1);
    h = redo(h);
    assert.equal(h.present.resources.length, 2);
    assert.equal(canRedo(h), false);

    // New push clears future
    h = undo(h);
    assert.equal(canRedo(h), true);
    h = pushHistory(h, emptyState());
    assert.equal(canRedo(h), false);
    assert.equal(h.present.resources.length, 0);

    console.log("✓ History push / undo / redo / clear-future");
  }

  // --- History limit ---
  {
    let h = createHistory(emptyState());
    for (let i = 0; i < HISTORY_LIMIT + 15; i++) {
      h = pushHistory(h, {
        ...emptyState(),
        resources: [fakeResource(`r${i}`, `n${i}`)],
        selectedResourceId: `r${i}`,
      });
    }
    assert.ok(h.past.length <= HISTORY_LIMIT);
    assert.equal(h.past.length, HISTORY_LIMIT);
    console.log(`✓ History capped at ${HISTORY_LIMIT}`);
  }

  // --- Debounced coalesce (value edits) ---
  {
    let h = createHistory({
      ...emptyState(),
      resources: [fakeResource("a")],
      selectedResourceId: "a",
    });
    // First keystroke: push
    h = mutateWithHistory(h, (s) => ({
      ...s,
      resources: s.resources.map((r) =>
        r.id === "a" ? { ...r, values: { ...r.values, name: "rg-a" } } : r
      ),
    }));
    assert.equal(h.past.length, 1);
    // Coalesced keystrokes: no extra past
    h = mutateWithHistory(
      h,
      (s) => ({
        ...s,
        resources: s.resources.map((r) =>
          r.id === "a" ? { ...r, values: { ...r.values, name: "rg-ab" } } : r
        ),
      }),
      { coalesce: true }
    );
    h = mutateWithHistory(
      h,
      (s) => ({
        ...s,
        resources: s.resources.map((r) =>
          r.id === "a" ? { ...r, values: { ...r.values, name: "rg-abc" } } : r
        ),
      }),
      { coalesce: true }
    );
    assert.equal(h.past.length, 1);
    assert.equal(h.present.resources[0].values.name, "rg-abc");
    h = undo(h);
    // Past snapshot is pre-burst state (fakeResource default name).
    assert.equal(h.present.resources[0].values.name, "rg-main");
    console.log("✓ Value-edit coalesce → single undo step");
  }

  // --- clone independence ---
  {
    const s = emptyState();
    s.resources = [fakeResource("x")];
    const c = cloneProjectState(s);
    c.resources[0].values.name = "mutated";
    assert.equal(s.resources[0].values.name, "rg-main");
    console.log("✓ cloneProjectState is deep");
  }

  // --- Starter confirm gate ---
  {
    assert.equal(shouldConfirmStarterApply(0), false);
    assert.equal(shouldConfirmStarterApply(1), true);
    assert.equal(shouldConfirmStarterApply(5), true);
    console.log("✓ Empty canvas skips confirm; non-empty requires confirm");
  }

  // --- Starter replace on empty ---
  {
    nextId = 1;
    const empty = emptyState();
    const next = applyStarterToState(empty, "web-sql", "replace", makeId);
    assert.ok(next.resources.length >= 4);
    assert.equal(next.config.starter, "web-sql");
    console.log("✓ Empty canvas applyStarter replace scaffolds resources");
  }

  // --- Starter replace wipes ---
  {
    nextId = 1;
    const prior: ProjectState = {
      ...emptyState(),
      resources: [fakeResource("keep-me")],
      selectedResourceId: "keep-me",
    };
    const replaced = applyStarterToState(prior, "blank", "replace", makeId);
    assert.equal(replaced.resources.length, 0);
    assert.equal(replaced.config.starter, "blank");

    nextId = 1;
    const web = applyStarterToState(prior, "web-sql", "replace", makeId);
    assert.ok(web.resources.length >= 4);
    assert.ok(!web.resources.some((r) => r.id === "keep-me"));
    console.log("✓ Replace all wipes prior resources");
  }

  // --- Starter merge keeps prior + adds ---
  {
    nextId = 1;
    const prior: ProjectState = {
      ...emptyState(),
      resources: [fakeResource("keep-me")],
      selectedResourceId: "keep-me",
    };
    const beforeCount = prior.resources.length;
    const merged = applyStarterToState(prior, "web-sql", "merge", makeId);
    assert.ok(merged.resources.length > beforeCount);
    assert.ok(merged.resources.some((r) => r.id === "keep-me"));
    // Starter RG may uniquify tfName if collision
    const rgs = merged.resources.filter((r) => r.type === "azurerm_resource_group");
    assert.ok(rgs.length >= 2);
    const names = new Set(rgs.map((r) => r.tfName));
    assert.equal(names.size, rgs.length);
    assert.equal(merged.config.starter, "web-sql");
    console.log("✓ Merge with starter keeps existing and uniquifies tfNames");
  }

  // --- Unknown starter is no-op ---
  {
    const s = emptyState();
    const next = applyStarterToState(s, "no-such-starter", "replace", makeId);
    assert.equal(next, s);
    console.log("✓ Unknown starter id leaves state unchanged");
  }

  // --- Undo snapshots include environments + scopes ---
  {
    let h = createHistory(emptyState());
    const withScoped: ProjectState = {
      ...emptyState(),
      resources: [
        {
          ...fakeResource("a"),
          scope: { kind: "environment", environmentId: "dev" },
        },
      ],
      selectedResourceId: "a",
      environments: defaultEnvironments().map((e) =>
        e.id === "dev"
          ? { ...e, knobs: { ...e.knobs, acrSku: "Premium" } }
          : e
      ),
    };
    h = pushHistory(h, withScoped);
    assert.equal(h.present.resources[0].scope.kind, "environment");
    assert.equal(
      h.present.environments.find((e) => e.id === "dev")!.knobs.acrSku,
      "Premium"
    );
    h = undo(h);
    assert.equal(h.present.resources.length, 0);
    assert.equal(
      h.present.environments.find((e) => e.id === "dev")!.knobs.acrSku,
      "Basic"
    );
    // Starter apply preserves environments
    nextId = 1;
    const applied = applyStarterToState(withScoped, "blank", "replace", makeId);
    assert.equal(applied.environments.length, 3);
    assert.equal(applied.activeEnvironmentId, "dev");
    console.log("✓ Undo snapshots include environments + scopes");
  }

  console.log("\nAll history / starter-confirm smoke tests passed.");
}

main();
