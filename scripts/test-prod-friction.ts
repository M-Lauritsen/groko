/**
 * Smoke tests: Prod friction gating (Develops #1).
 */
import assert from "node:assert/strict";
import {
  defaultEnvironments,
  defaultKnobsForId,
  isActiveEnvironmentProd,
  isProdEnvironment,
} from "../src/lib/schema/environments";
import type { Environment } from "../src/lib/schema/types";
import {
  PROD_FRICTION_COPY,
  shouldGateDestructiveApplyOnProd,
  shouldRequireProdFriction,
  shouldRequireProdFrictionForState,
  starterConfirmKind,
} from "../src/lib/store/prod-friction";

function main() {
  console.log("Azure TF Builder — Prod friction smoke test\n");

  const envs = defaultEnvironments();
  const prod = envs.find((e) => e.id === "prod")!;
  const dev = envs.find((e) => e.id === "dev")!;
  const staging = envs.find((e) => e.id === "staging")!;

  // --- Domain detection via Environment object ---
  {
    assert.equal(isProdEnvironment(prod), true);
    assert.equal(isProdEnvironment(dev), false);
    assert.equal(isProdEnvironment(staging), false);
    assert.equal(isProdEnvironment(null), false);
    assert.equal(isProdEnvironment(undefined), false);

    // displayName Prod / Production (custom id)
    const byName: Environment = {
      id: "live",
      displayName: "Production",
      knobs: defaultKnobsForId("live"),
    };
    assert.equal(isProdEnvironment(byName), true);
    assert.equal(
      isProdEnvironment({
        id: "live",
        displayName: "Prod",
        knobs: defaultKnobsForId("live"),
      }),
      true
    );

    // knobs tags Environment=prod
    const byTag: Environment = {
      id: "custom",
      displayName: "Custom Live",
      knobs: {
        ...defaultKnobsForId("custom"),
        tags: { Environment: "production" },
      },
    };
    assert.equal(isProdEnvironment(byTag), true);

    assert.equal(isActiveEnvironmentProd(envs, "prod"), true);
    assert.equal(isActiveEnvironmentProd(envs, "dev"), false);
    console.log("✓ isProdEnvironment via id / displayName / knobs tags");
  }

  // --- Gating helpers ---
  {
    assert.equal(shouldRequireProdFriction(prod), true);
    assert.equal(shouldRequireProdFriction(dev), false);
    assert.equal(
      shouldRequireProdFrictionForState({
        environments: envs,
        activeEnvironmentId: "prod",
      }),
      true
    );
    assert.equal(
      shouldRequireProdFrictionForState({
        environments: envs,
        activeEnvironmentId: "staging",
      }),
      false
    );
    console.log("✓ shouldRequireProdFriction for active Env");
  }

  // --- Starter confirm kind ---
  {
    // Prod: always prod friction (empty or not) — no silent bypass
    assert.equal(starterConfirmKind(0, prod), "prod");
    assert.equal(starterConfirmKind(3, prod), "prod");
    // Non-prod empty: immediate apply
    assert.equal(starterConfirmKind(0, dev), "none");
    // Non-prod with resources: normal Replace/Merge
    assert.equal(starterConfirmKind(2, staging), "normal");
    console.log("✓ starterConfirmKind: Prod always; else empty skips / non-empty normal");
  }

  // --- Import / wipe-graph gate ---
  {
    assert.equal(shouldGateDestructiveApplyOnProd("replace", prod), true);
    assert.equal(shouldGateDestructiveApplyOnProd("merge", prod), true);
    assert.equal(shouldGateDestructiveApplyOnProd("replace", dev), false);
    assert.equal(shouldGateDestructiveApplyOnProd("merge", staging), false);
    console.log("✓ Import Replace + Merge gated on Prod; not on Dev/Staging");
  }

  // --- Uxis copy locked ---
  {
    assert.equal(PROD_FRICTION_COPY.title, "This Environment is Production");
    assert.match(PROD_FRICTION_COPY.starterBody, /Prod/);
    assert.match(PROD_FRICTION_COPY.importBody, /Prod/);
    assert.equal(PROD_FRICTION_COPY.replaceLabel, "Replace on Prod");
    assert.equal(PROD_FRICTION_COPY.mergeStarterLabel, "Merge with starter");
    assert.equal(PROD_FRICTION_COPY.mergeImportLabel, "Merge instead");
    assert.equal(PROD_FRICTION_COPY.cancelLabel, "Cancel");
    console.log("✓ Uxis Prod friction copy constants");
  }

  console.log("\nAll Prod friction smoke tests passed.");
}

main();
