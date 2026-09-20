/**
 * Pure starter apply helpers (replace / merge) — testable without React.
 */

import { getStarter } from "../schema/starters";
import { mergeImportedResources } from "../import/mapToProject";
import type { ProjectState } from "../schema/types";
import { defaultExportConfig } from "../schema/types";
import { pruneExportConfig } from "../generate/export-map";

export type StarterApplyMode = "replace" | "merge";

/** Non-empty canvas must confirm before applying a starter. */
export function shouldConfirmStarterApply(resourceCount: number): boolean {
  return resourceCount > 0;
}

/**
 * Apply a starter to project state.
 * - replace: wipe resources and use starter scaffold
 * - merge: append starter resources (tfNames uniquified) via import merge
 * Empty canvas always behaves like replace regardless of mode.
 * Environments / activeEnvironmentId are preserved.
 */
export function applyStarterToState(
  state: ProjectState,
  starterId: string,
  mode: StarterApplyMode,
  makeId: () => string
): ProjectState {
  const starter = getStarter(starterId);
  if (!starter) return state;

  const config = { ...state.config, starter: starterId };
  const built = starter.build(config, makeId);

  if (mode === "replace" || state.resources.length === 0) {
    return {
      ...state,
      config,
      resources: built,
      selectedResourceId: built[0]?.id ?? null,
      exportConfig: defaultExportConfig(),
    };
  }

  const resources = mergeImportedResources(state.resources, built, "merge");
  return {
    ...state,
    config,
    resources,
    selectedResourceId: resources.find((r) => r.id === state.selectedResourceId)
      ? state.selectedResourceId
      : (resources[0]?.id ?? null),
    exportConfig: pruneExportConfig(state.exportConfig, resources),
  };
}
