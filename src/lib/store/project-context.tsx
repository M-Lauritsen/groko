"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  Environment,
  EnvironmentKnobs,
  ProjectConfig,
  ProjectState,
  ResourceInstance,
  ResourceScope,
} from "../schema/types";
import { getResourceType } from "../schema/resources";
import {
  defaultEnvironments,
  defaultScopeForNewResource,
} from "../schema/environments";
import { mergeImportedResources } from "../import/mapToProject";
import {
  canRedo as historyCanRedo,
  canUndo as historyCanUndo,
  cloneProjectState,
  createHistory,
  mutateWithHistory,
  redo as historyRedo,
  undo as historyUndo,
  VALUE_EDIT_DEBOUNCE_MS,
  type HistoryStack,
} from "./history";
import {
  applyStarterToState,
  type StarterApplyMode,
} from "./starter-apply";

function uid(): string {
  return `r_${Math.random().toString(36).slice(2, 10)}`;
}

const defaultConfig: ProjectConfig = {
  name: "my-azure-project",
  location: "westeurope",
  namingPrefix: "myapp",
  tags: { Environment: "dev", ManagedBy: "terraform" },
  starter: "blank",
};

const initialEnvironments = defaultEnvironments();

const initialState: ProjectState = {
  config: defaultConfig,
  environments: initialEnvironments,
  activeEnvironmentId: initialEnvironments[0]?.id ?? "dev",
  resources: [],
  selectedResourceId: null,
};

interface ProjectContextValue {
  state: ProjectState;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  setConfig: (partial: Partial<ProjectConfig>) => void;
  setActiveEnvironment: (id: string) => void;
  updateEnvironment: (
    id: string,
    patch: Partial<Omit<Environment, "id" | "knobs">> & {
      knobs?: Partial<EnvironmentKnobs>;
    }
  ) => void;
  addEnvironment: (env: Environment) => void;
  removeEnvironment: (id: string) => void;
  applyStarter: (starterId: string, mode?: StarterApplyMode) => void;
  addResource: (type: string) => string;
  updateResource: (id: string, patch: Partial<ResourceInstance>) => void;
  updateResourceValue: (id: string, key: string, value: unknown) => void;
  updateExistingValue: (id: string, key: string, value: unknown) => void;
  setResourceScope: (id: string, scope: ResourceScope) => void;
  removeResource: (id: string) => void;
  selectResource: (id: string | null) => void;
  getUniqueTfName: (type: string, preferred?: string) => string;
  importResources: (
    resources: ResourceInstance[],
    mode: "merge" | "replace"
  ) => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [history, setHistory] = useState<HistoryStack<ProjectState>>(() =>
    createHistory(initialState)
  );
  const state = history.present;

  /** Coalesce rapid value edits into one undo step. */
  const valueEditCoalesceRef = useRef(false);
  const valueEditTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearValueEditCoalesce = useCallback(() => {
    valueEditCoalesceRef.current = false;
    if (valueEditTimerRef.current) {
      clearTimeout(valueEditTimerRef.current);
      valueEditTimerRef.current = null;
    }
  }, []);

  const armValueEditCoalesce = useCallback(() => {
    valueEditCoalesceRef.current = true;
    if (valueEditTimerRef.current) clearTimeout(valueEditTimerRef.current);
    valueEditTimerRef.current = setTimeout(() => {
      valueEditCoalesceRef.current = false;
      valueEditTimerRef.current = null;
    }, VALUE_EDIT_DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (valueEditTimerRef.current) clearTimeout(valueEditTimerRef.current);
    };
  }, []);

  /** Snapshot then mutate (non-debounced structural edits). */
  const commit = useCallback(
    (mutator: (s: ProjectState) => ProjectState) => {
      clearValueEditCoalesce();
      setHistory((h) =>
        mutateWithHistory(h, mutator, { clone: cloneProjectState })
      );
    },
    [clearValueEditCoalesce]
  );

  /** Debounced value edits — one history entry per typing burst. */
  const commitValueEdit = useCallback(
    (mutator: (s: ProjectState) => ProjectState) => {
      const coalesce = valueEditCoalesceRef.current;
      armValueEditCoalesce();
      setHistory((h) =>
        mutateWithHistory(h, mutator, {
          coalesce,
          clone: cloneProjectState,
        })
      );
    },
    [armValueEditCoalesce]
  );

  const undo = useCallback(() => {
    clearValueEditCoalesce();
    setHistory((h) => historyUndo(h, cloneProjectState));
  }, [clearValueEditCoalesce]);

  const redo = useCallback(() => {
    clearValueEditCoalesce();
    setHistory((h) => historyRedo(h, cloneProjectState));
  }, [clearValueEditCoalesce]);

  const getUniqueTfName = useCallback(
    (type: string, preferred?: string) => {
      const def = getResourceType(type);
      const base = preferred || def?.defaultName || "main";
      const existing = new Set(
        state.resources.filter((r) => r.type === type).map((r) => r.tfName)
      );
      if (!existing.has(base)) return base;
      let i = 2;
      while (existing.has(`${base}_${i}`)) i++;
      return `${base}_${i}`;
    },
    [state.resources]
  );

  const setConfig = useCallback((partial: Partial<ProjectConfig>) => {
    // Config-only edits are not undoable (per feature scope).
    setHistory((h) => ({
      ...h,
      present: {
        ...h.present,
        config: { ...h.present.config, ...partial },
      },
    }));
  }, []);

  const setActiveEnvironment = useCallback((id: string) => {
    // View switch — not an undo step.
    setHistory((h) => ({
      ...h,
      present: { ...h.present, activeEnvironmentId: id },
    }));
  }, []);

  const updateEnvironment = useCallback(
    (
      id: string,
      patch: Partial<Omit<Environment, "id" | "knobs">> & {
        knobs?: Partial<EnvironmentKnobs>;
      }
    ) => {
      commit((s) => ({
        ...s,
        environments: s.environments.map((e) =>
          e.id === id
            ? {
                ...e,
                ...("displayName" in patch
                  ? { displayName: patch.displayName! }
                  : {}),
                knobs: patch.knobs ? { ...e.knobs, ...patch.knobs } : e.knobs,
              }
            : e
        ),
      }));
    },
    [commit]
  );

  const addEnvironment = useCallback(
    (env: Environment) => {
      commit((s) => {
        if (s.environments.some((e) => e.id === env.id)) return s;
        return {
          ...s,
          environments: [...s.environments, env],
          activeEnvironmentId: env.id,
        };
      });
    },
    [commit]
  );

  const removeEnvironment = useCallback(
    (id: string) => {
      commit((s) => {
        if (s.environments.length <= 1) return s;
        const environments = s.environments.filter((e) => e.id !== id);
        const activeEnvironmentId =
          s.activeEnvironmentId === id
            ? environments[0].id
            : s.activeEnvironmentId;
        // Re-scope resources that pointed at the removed env → shared
        const resources = s.resources.map((r) => {
          if (
            r.scope?.kind === "environment" &&
            r.scope.environmentId === id
          ) {
            return { ...r, scope: { kind: "shared" as const } };
          }
          return r;
        });
        return { ...s, environments, activeEnvironmentId, resources };
      });
    },
    [commit]
  );

  const applyStarter = useCallback(
    (starterId: string, mode: StarterApplyMode = "replace") => {
      commit((s) => applyStarterToState(s, starterId, mode, uid));
    },
    [commit]
  );

  const addResource = useCallback(
    (type: string) => {
      const def = getResourceType(type);
      if (!def) return "";
      const id = uid();

      commit((s) => {
        const existingNames = new Set(
          s.resources.filter((r) => r.type === type).map((r) => r.tfName)
        );
        let tfName = def.defaultName || "main";
        if (existingNames.has(tfName)) {
          let i = 2;
          while (existingNames.has(`${tfName}_${i}`)) i++;
          tfName = `${tfName}_${i}`;
        }

        const values: Record<string, unknown> = {};
        for (const f of def.fields) {
          if (f.defaultValue !== undefined) {
            values[f.key] =
              f.type === "tags" ? { ...s.config.tags } : f.defaultValue;
          }
        }

        if (values.name === "" || values.name === undefined) {
          const prefix = s.config.namingPrefix;
          const short = type.replace("azurerm_", "").replace(/_/g, "-");
          const suffix =
            tfName === "main" || tfName === "app" || tfName === "default"
              ? ""
              : `-${tfName.replace(/_/g, "-")}`;
          values.name = prefix
            ? `${prefix}-${short}${suffix}`
            : `${short}${suffix}`;
          if (type === "azurerm_storage_account") {
            const p = prefix
              .replace(/[^a-z0-9]/gi, "")
              .toLowerCase()
              .slice(0, 12);
            const n = (tfName.replace(/[^a-z0-9]/gi, "") || "sa").slice(0, 6);
            values.name = `${p}${n}001`.toLowerCase().slice(0, 24);
          }
          if (type === "azurerm_container_registry") {
            const p = prefix
              .replace(/[^a-z0-9]/gi, "")
              .toLowerCase()
              .slice(0, 30);
            const n = tfName
              .replace(/[^a-z0-9]/gi, "")
              .toLowerCase()
              .slice(0, 10);
            values.name = `${p || "acr"}${n || "registry"}`.slice(0, 50);
          }
          if (type === "azurerm_container_app") {
            values.name = prefix
              ? `${prefix}-ca-${tfName.replace(/_/g, "-")}`
              : `ca-${tfName.replace(/_/g, "-")}`;
          }
        }

        if (type === "azurerm_container_app") {
          const env = s.resources.find(
            (r) => r.type === "azurerm_container_app_environment"
          );
          if (env) {
            values.container_app_environment_id = {
              resourceId: env.id,
              attr: "id",
            };
          }
          const acr = s.resources.find(
            (r) => r.type === "azurerm_container_registry"
          );
          if (acr) {
            values.container_registry_id = {
              resourceId: acr.id,
              attr: "id",
            };
          }
          const uai = s.resources.find(
            (r) => r.type === "azurerm_user_assigned_identity"
          );
          if (uai) {
            values.user_assigned_identity_id = {
              resourceId: uai.id,
              attr: "id",
            };
            values.acr_auth_mode = "managed_identity";
            values.identity_type = "UserAssigned";
          }
        }
        if (type === "azurerm_role_assignment") {
          const acr = s.resources.find(
            (r) => r.type === "azurerm_container_registry"
          );
          const uai = s.resources.find(
            (r) => r.type === "azurerm_user_assigned_identity"
          );
          if (acr) {
            values.scope = { resourceId: acr.id, attr: "id" };
          }
          if (uai) {
            values.principal_id = {
              resourceId: uai.id,
              attr: "principal_id",
            };
          }
          values.role_definition_name = "AcrPull";
        }
        if (type === "azurerm_container_app_environment") {
          const caeSubnet = s.resources.find(
            (r) =>
              r.type === "azurerm_subnet" &&
              r.values.delegation === "Microsoft.App/environments"
          );
          if (caeSubnet) {
            values.infrastructure_subnet_id = {
              resourceId: caeSubnet.id,
              attr: "id",
            };
          }
          const law = s.resources.find(
            (r) => r.type === "azurerm_log_analytics_workspace"
          );
          if (law) {
            values.log_analytics_workspace_id = {
              resourceId: law.id,
              attr: "id",
            };
          }
        }

        if (type === "azurerm_resource_group") {
          values.location = s.config.location;
        }

        const rg = s.resources.find((r) => r.type === "azurerm_resource_group");
        if (rg) {
          for (const f of def.fields) {
            if (
              f.type === "reference" &&
              f.refTypes?.includes("azurerm_resource_group")
            ) {
              values[f.key] = {
                resourceId: rg.id,
                attr: f.refAttr ?? "id",
              };
            }
          }
        }

        const useExisting = Boolean(def.preferUseExisting);
        const existingValues: Record<string, unknown> = {};
        if (useExisting) {
          for (const f of def.fields) {
            if (f.existingKey) {
              const cur = values[f.key];
              if (typeof cur === "string" && cur) {
                existingValues[f.key] = cur;
              } else if (f.defaultValue !== undefined && typeof f.defaultValue === "string") {
                existingValues[f.key] = f.defaultValue;
              }
            }
          }
        }

        const instance: ResourceInstance = {
          id,
          type,
          tfName,
          useExisting,
          values,
          existingValues,
          scope: defaultScopeForNewResource(type, s.activeEnvironmentId),
        };

        return {
          ...s,
          resources: [...s.resources, instance],
          selectedResourceId: id,
        };
      });

      return id;
    },
    [commit]
  );

  const updateResource = useCallback(
    (id: string, patch: Partial<ResourceInstance>) => {
      commit((s) => ({
        ...s,
        resources: s.resources.map((r) =>
          r.id === id ? { ...r, ...patch } : r
        ),
      }));
    },
    [commit]
  );

  const updateResourceValue = useCallback(
    (id: string, key: string, value: unknown) => {
      commitValueEdit((s) => ({
        ...s,
        resources: s.resources.map((r) =>
          r.id === id
            ? { ...r, values: { ...r.values, [key]: value } }
            : r
        ),
      }));
    },
    [commitValueEdit]
  );

  const updateExistingValue = useCallback(
    (id: string, key: string, value: unknown) => {
      commitValueEdit((s) => ({
        ...s,
        resources: s.resources.map((r) =>
          r.id === id
            ? {
                ...r,
                existingValues: { ...r.existingValues, [key]: value },
              }
            : r
        ),
      }));
    },
    [commitValueEdit]
  );

  const setResourceScope = useCallback(
    (id: string, scope: ResourceScope) => {
      commit((s) => ({
        ...s,
        resources: s.resources.map((r) =>
          r.id === id ? { ...r, scope } : r
        ),
      }));
    },
    [commit]
  );

  const removeResource = useCallback(
    (id: string) => {
      commit((s) => {
        const resources = s.resources
          .filter((r) => r.id !== id)
          .map((r) => {
            const values = { ...r.values };
            for (const [k, v] of Object.entries(values)) {
              if (
                typeof v === "object" &&
                v !== null &&
                "resourceId" in v &&
                (v as { resourceId: string }).resourceId === id
              ) {
                delete values[k];
              }
            }
            return { ...r, values };
          });
        return {
          ...s,
          resources,
          selectedResourceId:
            s.selectedResourceId === id ? null : s.selectedResourceId,
        };
      });
    },
    [commit]
  );

  const importResources = useCallback(
    (resources: ResourceInstance[], mode: "merge" | "replace") => {
      commit((s) => {
        const next = mergeImportedResources(s.resources, resources, mode);
        // Land on Resources with the first newly imported instance selected.
        const selectId =
          mode === "replace"
            ? next[0]?.id ?? null
            : next[Math.max(0, next.length - resources.length)]?.id ??
              next[0]?.id ??
              null;
        return {
          ...s,
          config: {
            ...s.config,
            starter: mode === "replace" ? "imported" : s.config.starter,
          },
          resources: next,
          selectedResourceId: selectId,
        };
      });
    },
    [commit]
  );

  const selectResource = useCallback((id: string | null) => {
    // Selection-only — not an undo step.
    setHistory((h) => ({
      ...h,
      present: { ...h.present, selectedResourceId: id },
    }));
  }, []);

  const value = useMemo<ProjectContextValue>(
    () => ({
      state,
      canUndo: historyCanUndo(history),
      canRedo: historyCanRedo(history),
      undo,
      redo,
      setConfig,
      setActiveEnvironment,
      updateEnvironment,
      addEnvironment,
      removeEnvironment,
      applyStarter,
      addResource,
      updateResource,
      updateResourceValue,
      updateExistingValue,
      setResourceScope,
      removeResource,
      selectResource,
      getUniqueTfName,
      importResources,
    }),
    [
      state,
      history,
      undo,
      redo,
      setConfig,
      setActiveEnvironment,
      updateEnvironment,
      addEnvironment,
      removeEnvironment,
      applyStarter,
      addResource,
      updateResource,
      updateResourceValue,
      updateExistingValue,
      setResourceScope,
      removeResource,
      selectResource,
      getUniqueTfName,
      importResources,
    ]
  );

  return (
    <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
  );
}

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be used within ProjectProvider");
  return ctx;
}
