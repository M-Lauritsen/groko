"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type {
  ProjectConfig,
  ProjectState,
  ResourceInstance,
} from "../schema/types";
import { getResourceType } from "../schema/resources";
import { getStarter } from "../schema/starters";
import { mergeImportedResources } from "../import/mapToProject";

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

interface ProjectContextValue {
  state: ProjectState;
  setConfig: (partial: Partial<ProjectConfig>) => void;
  applyStarter: (starterId: string) => void;
  addResource: (type: string) => string;
  updateResource: (id: string, patch: Partial<ResourceInstance>) => void;
  updateResourceValue: (id: string, key: string, value: unknown) => void;
  updateExistingValue: (id: string, key: string, value: unknown) => void;
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
  const [state, setState] = useState<ProjectState>({
    config: defaultConfig,
    resources: [],
    selectedResourceId: null,
  });

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
    setState((s) => ({
      ...s,
      config: { ...s.config, ...partial },
    }));
  }, []);

  const applyStarter = useCallback((starterId: string) => {
    setState((s) => {
      const starter = getStarter(starterId);
      if (!starter) return s;
      const config = { ...s.config, starter: starterId };
      const resources = starter.build(config, uid);
      return {
        config,
        resources,
        selectedResourceId: resources[0]?.id ?? null,
      };
    });
  }, []);

  const addResource = useCallback(
    (type: string) => {
      const def = getResourceType(type);
      if (!def) return "";
      const id = uid();

      setState((s) => {
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
          // Include tfName so multiple instances do not collide in Azure
          const suffix = tfName === "main" || tfName === "app" || tfName === "default"
            ? ""
            : `-${tfName.replace(/_/g, "-")}`;
          values.name = prefix ? `${prefix}-${short}${suffix}` : `${short}${suffix}`;
          if (type === "azurerm_storage_account") {
            const p = prefix.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 12);
            const n = (tfName.replace(/[^a-z0-9]/gi, "") || "sa").slice(0, 6);
            values.name = `${p}${n}001`.toLowerCase().slice(0, 24);
          }
          if (type === "azurerm_container_registry") {
            const p = prefix.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 30);
            const n = tfName.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 10);
            values.name = `${p || "acr"}${n || "registry"}`.slice(0, 50);
          }
          if (type === "azurerm_container_app") {
            values.name = prefix
              ? `${prefix}-ca-${tfName.replace(/_/g, "-")}`
              : `ca-${tfName.replace(/_/g, "-")}`;
          }
        }

        // Auto-wire Container Apps Environment / ACR / identity
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

        const instance: ResourceInstance = {
          id,
          type,
          tfName,
          useExisting: false,
          values,
          existingValues: {},
        };

        return {
          ...s,
          resources: [...s.resources, instance],
          selectedResourceId: id,
        };
      });

      return id;
    },
    []
  );

  const updateResource = useCallback(
    (id: string, patch: Partial<ResourceInstance>) => {
      setState((s) => ({
        ...s,
        resources: s.resources.map((r) =>
          r.id === id ? { ...r, ...patch } : r
        ),
      }));
    },
    []
  );

  const updateResourceValue = useCallback(
    (id: string, key: string, value: unknown) => {
      setState((s) => ({
        ...s,
        resources: s.resources.map((r) =>
          r.id === id
            ? { ...r, values: { ...r.values, [key]: value } }
            : r
        ),
      }));
    },
    []
  );

  const updateExistingValue = useCallback(
    (id: string, key: string, value: unknown) => {
      setState((s) => ({
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
    []
  );

  const removeResource = useCallback((id: string) => {
    setState((s) => {
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
  }, []);


  const importResources = useCallback(
    (resources: ResourceInstance[], mode: "merge" | "replace") => {
      setState((s) => {
        const next = mergeImportedResources(s.resources, resources, mode);
        return {
          ...s,
          config: { ...s.config, starter: mode === "replace" ? "imported" : s.config.starter },
          resources: next,
          selectedResourceId: next[0]?.id ?? null,
        };
      });
    },
    []
  );

  const selectResource = useCallback((id: string | null) => {
    setState((s) => ({ ...s, selectedResourceId: id }));
  }, []);

  const value = useMemo<ProjectContextValue>(
    () => ({
      state,
      setConfig,
      applyStarter,
      addResource,
      updateResource,
      updateResourceValue,
      updateExistingValue,
      removeResource,
      selectResource,
      getUniqueTfName,
      importResources,
    }),
    [
      state,
      setConfig,
      applyStarter,
      addResource,
      updateResource,
      updateResourceValue,
      updateExistingValue,
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
