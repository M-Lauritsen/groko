import type { ProjectState } from "../schema/types";
import { defaultExportConfig } from "../schema/types";
import { defaultEnvironments } from "../schema/environments";
import { repairExistingSnapshots } from "./existing-snapshots";

export const PROJECT_FILE_VERSION = 1;

export interface ProjectFile {
  format: "groko-project";
  version: typeof PROJECT_FILE_VERSION;
  savedAt: string;
  state: Omit<ProjectState, "selectedResourceId">;
}

export function projectFileFromState(state: ProjectState, savedAt = new Date().toISOString()): ProjectFile {
  return {
    format: "groko-project",
    version: PROJECT_FILE_VERSION,
    savedAt,
    state: {
      config: state.config,
      environments: state.environments,
      activeEnvironmentId: state.activeEnvironmentId,
      resources: state.resources,
      exportConfig: state.exportConfig,
    },
  };
}

export function serializeProject(state: ProjectState, savedAt?: string): string {
  return JSON.stringify(projectFileFromState(state, savedAt), null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseProjectFile(input: string | unknown): ProjectState {
  let value: unknown = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch {
      throw new Error("This project file is not valid JSON.");
    }
  }

  if (!isRecord(value) || value.format !== "groko-project" || value.version !== PROJECT_FILE_VERSION) {
    throw new Error(`Unsupported project file. Expected Groko project format v${PROJECT_FILE_VERSION}.`);
  }

  const state = value.state;
  if (!isRecord(state) || !isRecord(state.config) || !Array.isArray(state.environments) || !Array.isArray(state.resources)) {
    throw new Error("This project file is missing required project data.");
  }

  const environments = state.environments.length > 0 ? state.environments : defaultEnvironments();
  const activeEnvironmentId =
    typeof state.activeEnvironmentId === "string" && environments.some((environment) => environment.id === state.activeEnvironmentId)
      ? state.activeEnvironmentId
      : environments[0].id;
  const resources = repairExistingSnapshots(
    state.resources.filter(
      (resource) => isRecord(resource) && typeof resource.id === "string"
    ) as ProjectState["resources"]
  );

  return {
    config: state.config as unknown as ProjectState["config"],
    environments: environments as ProjectState["environments"],
    activeEnvironmentId,
    resources,
    selectedResourceId: null,
    exportConfig: isRecord(state.exportConfig)
      ? (state.exportConfig as unknown as ProjectState["exportConfig"])
      : defaultExportConfig(),
  };
}