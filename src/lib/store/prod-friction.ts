/**
 * Prod friction — extra confirm gating for destructive apply on Production.
 * Pure helpers (no React) for tests.
 */

import {
  isActiveEnvironmentProd,
  isProdEnvironment,
} from "../schema/environments";
import type { Environment } from "../schema/types";
import { shouldConfirmStarterApply } from "./starter-apply";

export type ProdFrictionVariant = "starter" | "import";

export type DestructiveApplyMode = "replace" | "merge";

/** Uxis Prod friction copy (draft locked for Develops #1). */
export const PROD_FRICTION_COPY = {
  title: "This Environment is Production",
  starterBody:
    "Applying a starter on Prod will change this Environment’s resources.",
  importBody:
    "You’re about to replace or apply changes on Prod. That can wipe or overwrite resources in this Environment’s graph. Dev and Staging won’t be affected.",
  replaceLabel: "Replace on Prod",
  mergeStarterLabel: "Merge with starter",
  mergeImportLabel: "Merge instead",
  cancelLabel: "Cancel",
} as const;

/**
 * Destructive graph apply (starter / import replace|merge) needs Prod confirm
 * when the active Environment is Prod — no silent bypass on empty canvas either.
 */
export function shouldRequireProdFriction(
  env: Environment | undefined | null
): boolean {
  return isProdEnvironment(env);
}

export function shouldRequireProdFrictionForState(state: {
  environments: Environment[];
  activeEnvironmentId: string;
}): boolean {
  return isActiveEnvironmentProd(
    state.environments,
    state.activeEnvironmentId
  );
}

/**
 * Starter click: open which dialog?
 * - prod → always Prod friction (even empty canvas)
 * - non-prod + resources → normal Replace/Merge confirm
 * - non-prod + empty → apply immediately (no dialog)
 */
export type StarterConfirmKind = "none" | "normal" | "prod";

export function starterConfirmKind(
  resourceCount: number,
  activeEnv: Environment | undefined | null
): StarterConfirmKind {
  if (shouldRequireProdFriction(activeEnv)) return "prod";
  if (shouldConfirmStarterApply(resourceCount)) return "normal";
  return "none";
}

/**
 * Import / wipe-graph: after user picks Replace or Merge, Prod needs a second
 * confirm. Merge is included because it can overwrite colliding tfNames.
 */
export function shouldGateDestructiveApplyOnProd(
  mode: DestructiveApplyMode,
  activeEnv: Environment | undefined | null
): boolean {
  if (!shouldRequireProdFriction(activeEnv)) return false;
  return mode === "replace" || mode === "merge";
}

export { isProdEnvironment, isActiveEnvironmentProd };
