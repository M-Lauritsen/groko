/**
 * Export folder-structure map — one exporter config object.
 * Defaults reuse MODULE_DEFS / moduleIdForType; overrides are domain→folder only.
 */

import type { ExportConfig, ResourceInstance } from "../schema/types";
import { defaultExportConfig } from "../schema/types";
import { getResourceType } from "../schema/resources";
import {
  MODULE_DEFS,
  moduleIdForType,
  moduleOrder,
} from "./modules";

export type FolderKind = "root" | "dir" | "file";

export interface FolderTreeNode {
  /** Path relative to ZIP root, e.g. "modules/networking" or "config.tf" */
  path: string;
  name: string;
  kind: FolderKind;
  children?: FolderTreeNode[];
  /** Resource ids that land in this file/folder (files under modules/<id>/). */
  resourceIds: string[];
}

export interface ResolvedExportMap {
  /** resourceId → module folder id (never null for assigned). */
  moduleOf: Map<string, string>;
  /** Resources explicitly or effectively without a folder. */
  orphans: ResourceInstance[];
  /** moduleId → resources assigned there. */
  byModule: Map<string, ResourceInstance[]>;
}

/** Effective module folder for a resource (null = orphan). */
export function resolveModuleId(
  resource: ResourceInstance,
  exportConfig?: ExportConfig | null
): string | null {
  const overrides = exportConfig?.moduleByResourceId;
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, resource.id)) {
    return overrides[resource.id];
  }
  return moduleIdForType(resource.type) ?? "other";
}

/** Build resolved map from graph + exportConfig overrides. */
export function resolveExportMap(
  resources: ResourceInstance[],
  exportConfig?: ExportConfig | null
): ResolvedExportMap {
  const moduleOf = new Map<string, string>();
  const byModule = new Map<string, ResourceInstance[]>();
  const orphans: ResourceInstance[] = [];

  for (const r of resources) {
    const mid = resolveModuleId(r, exportConfig);
    if (mid === null) {
      orphans.push(r);
      continue;
    }
    moduleOf.set(r.id, mid);
    const list = byModule.get(mid) ?? [];
    list.push(r);
    byModule.set(mid, list);
  }

  return { moduleOf, orphans, byModule };
}

export function listOrphans(
  resources: ResourceInstance[],
  exportConfig?: ExportConfig | null
): ResourceInstance[] {
  return resolveExportMap(resources, exportConfig).orphans;
}

export function hasOrphans(
  resources: ResourceInstance[],
  exportConfig?: ExportConfig | null
): boolean {
  return listOrphans(resources, exportConfig).length > 0;
}

/** Module folder options for Map mode (domain folders only). */
export function moduleFolderOptions(): { id: string; label: string; path: string }[] {
  const opts = MODULE_DEFS.map((m) => ({
    id: m.id,
    label: m.label,
    path: `modules/${m.id}`,
  }));
  opts.push({ id: "other", label: "Other", path: "modules/other" });
  return opts;
}

/**
 * Live ZIP folder tree derived from Environment graph + export map.
 * Root files, environments/*, modules/<id>/{main,variables,outputs}.tf
 */
export function buildFolderTree(
  resources: ResourceInstance[],
  environmentIds: string[],
  exportConfig?: ExportConfig | null
): FolderTreeNode[] {
  const { byModule, orphans } = resolveExportMap(resources, exportConfig);
  const ordered = moduleOrder(Array.from(byModule.keys()));

  const rootFiles: FolderTreeNode[] = [
    { path: "config.tf", name: "config.tf", kind: "file", resourceIds: [] },
    { path: "main.tf", name: "main.tf", kind: "file", resourceIds: [] },
    { path: "variables.tf", name: "variables.tf", kind: "file", resourceIds: [] },
    { path: "outputs.tf", name: "outputs.tf", kind: "file", resourceIds: [] },
    { path: "README.md", name: "README.md", kind: "file", resourceIds: [] },
  ];

  const envChildren: FolderTreeNode[] = [];
  for (const envId of environmentIds) {
    envChildren.push({
      path: `environments/${envId}.tfvars`,
      name: `${envId}.tfvars`,
      kind: "file",
      resourceIds: [],
    });
    envChildren.push({
      path: `environments/backend.${envId}.hcl`,
      name: `backend.${envId}.hcl`,
      kind: "file",
      resourceIds: [],
    });
  }
  const environmentsDir: FolderTreeNode = {
    path: "environments",
    name: "environments",
    kind: "dir",
    resourceIds: [],
    children: envChildren,
  };

  const moduleChildren: FolderTreeNode[] = ordered.map((mid) => {
    const res = byModule.get(mid) ?? [];
    const ids = res.map((r) => r.id);
    const label =
      MODULE_DEFS.find((m) => m.id === mid)?.label ?? mid;
    return {
      path: `modules/${mid}`,
      name: mid,
      kind: "dir",
      resourceIds: ids,
      children: [
        {
          path: `modules/${mid}/main.tf`,
          name: "main.tf",
          kind: "file",
          resourceIds: ids,
        },
        {
          path: `modules/${mid}/variables.tf`,
          name: "variables.tf",
          kind: "file",
          resourceIds: ids,
        },
        {
          path: `modules/${mid}/outputs.tf`,
          name: "outputs.tf",
          kind: "file",
          resourceIds: ids,
        },
      ],
      // stash label via name display — UI can look up MODULE_DEFS
    };
  });

  // Annotate module dirs with human label in a synthetic meta path comment via name
  for (const node of moduleChildren) {
    const mid = node.name;
    const label = MODULE_DEFS.find((m) => m.id === mid)?.label;
    if (label) node.name = `${mid}/  (${label})`;
  }

  const modulesDir: FolderTreeNode = {
    path: "modules",
    name: "modules",
    kind: "dir",
    resourceIds: Array.from(byModule.values()).flat().map((r) => r.id),
    children: moduleChildren,
  };

  const tree: FolderTreeNode[] = [...rootFiles, environmentsDir, modulesDir];

  if (orphans.length > 0) {
    tree.push({
      path: "__orphans__",
      name: `⚠ Unassigned (${orphans.length})`,
      kind: "dir",
      resourceIds: orphans.map((r) => r.id),
      children: [],
    });
  }

  return tree;
}

/** Resources that land at a tree path (file or folder). */
export function resourcesAtPath(
  path: string,
  resources: ResourceInstance[],
  exportConfig?: ExportConfig | null
): ResourceInstance[] {
  const { byModule, orphans } = resolveExportMap(resources, exportConfig);
  if (path === "__orphans__") return orphans;

  const modMatch = path.match(/^modules\/([^/]+)/);
  if (modMatch) {
    return byModule.get(modMatch[1]) ?? [];
  }
  if (path === "modules") {
    return Array.from(byModule.values()).flat();
  }
  return [];
}

export function shortResourceInfo(r: ResourceInstance): {
  id: string;
  label: string;
  typeLabel: string;
  type: string;
  tfName: string;
  moduleId: string | null;
  scopeLabel: string;
} {
  const def = getResourceType(r.type);
  const scopeLabel =
    r.scope?.kind === "environment"
      ? `Env: ${r.scope.environmentId}`
      : "Shared";
  return {
    id: r.id,
    label: String(r.values.name ?? r.tfName),
    typeLabel: def?.label ?? r.type,
    type: r.type,
    tfName: r.tfName,
    moduleId: moduleIdForType(r.type) ?? "other",
    scopeLabel,
  };
}

/** Assign one resource to a module folder (or null = orphan). Undoable via exportConfig. */
export function withResourceModule(
  config: ExportConfig,
  resourceId: string,
  moduleId: string | null
): ExportConfig {
  return {
    ...config,
    moduleByResourceId: {
      ...config.moduleByResourceId,
      [resourceId]: moduleId,
    },
  };
}

/** Assign all resources of a catalogue type to a module folder. */
export function withTypeGroupModule(
  config: ExportConfig,
  resources: ResourceInstance[],
  type: string,
  moduleId: string | null
): ExportConfig {
  const next = { ...config.moduleByResourceId };
  for (const r of resources) {
    if (r.type === type) next[r.id] = moduleId;
  }
  return { ...config, moduleByResourceId: next };
}

/** Assign every resource currently in a MODULE_DEFS domain group. */
export function withDomainGroupModule(
  config: ExportConfig,
  resources: ResourceInstance[],
  fromModuleId: string,
  toModuleId: string | null
): ExportConfig {
  const next = { ...config.moduleByResourceId };
  for (const r of resources) {
    const effective = resolveModuleId(r, config);
    if (effective === fromModuleId) next[r.id] = toModuleId;
  }
  return { ...config, moduleByResourceId: next };
}

/** Clear all overrides — back to generateProject / MODULE_DEFS defaults. */
export function resetExportConfig(): ExportConfig {
  return defaultExportConfig();
}

/** Drop overrides for deleted resource ids. */
export function pruneExportConfig(
  config: ExportConfig,
  resources: ResourceInstance[]
): ExportConfig {
  const alive = new Set(resources.map((r) => r.id));
  const next: Record<string, string | null> = {};
  for (const [id, mid] of Object.entries(config.moduleByResourceId)) {
    if (alive.has(id)) next[id] = mid;
  }
  return { moduleByResourceId: next };
}

/** True when override differs from default grouping. */
export function isOverride(
  resource: ResourceInstance,
  exportConfig?: ExportConfig | null
): boolean {
  if (
    !exportConfig ||
    !Object.prototype.hasOwnProperty.call(
      exportConfig.moduleByResourceId,
      resource.id
    )
  ) {
    return false;
  }
  const override = exportConfig.moduleByResourceId[resource.id];
  const def = moduleIdForType(resource.type) ?? "other";
  return override !== def;
}


/**
 * Download policy (Develops):
 * - Orphans → block unless caller has explicit leaveUnmappedConfirm.
 * - Never silently drop unmapped resources from a ZIP the user thinks is complete.
 */
export function canDownloadWithMap(
  resources: ResourceInstance[],
  exportConfig: ExportConfig | null | undefined,
  opts: { mapMode: boolean; leaveUnmappedConfirmed?: boolean }
): { ok: boolean; orphans: ResourceInstance[]; reason?: string } {
  const orphans = listOrphans(resources, exportConfig);
  if (orphans.length === 0) return { ok: true, orphans };
  if (opts.leaveUnmappedConfirmed) {
    return { ok: true, orphans };
  }
  if (!opts.mapMode) {
    // Overrides with null still produce orphans outside Map UI — block to be safe.
    return {
      ok: false,
      orphans,
      reason: `${orphans.length} resource(s) have no module folder. Open Map mode to assign them, or confirm leave unmapped.`,
    };
  }
  return {
    ok: false,
    orphans,
    reason: `${orphans.length} unassigned resource(s). Assign each to a module folder, or confirm leave unmapped.`,
  };
}

/** Copy exports the same generated artifact, so it has the identical orphan gate. */
export function canCopyWithMap(
  resources: ResourceInstance[],
  exportConfig: ExportConfig | null | undefined,
  opts: { mapMode: boolean; leaveUnmappedConfirmed?: boolean }
): { ok: boolean; orphans: ResourceInstance[]; reason?: string } {
  return canDownloadWithMap(resources, exportConfig, opts);
}


/**
 * Domain-language export review (Uxis): adds / updates / Existing / orphans.
 * No HCL — counts + short resource lists from Environment graph + export map.
 *
 * - Adds: Create (useExisting false), assigned to a module folder
 * - Existing: lookups (useExisting true), assigned
 * - Updates: folder-map overrides (domain→folder differs from default)
 * - Orphans: leave-unmapped / no folder
 */
export interface ExportReviewItem {
  id: string;
  label: string;
  typeLabel: string;
  scopeLabel: string;
  mode: "add" | "existing" | "orphan";
  moduleId: string | null;
  moduleLabel: string | null;
  folderOverride: boolean;
}

export interface ExportReviewFolderCount {
  moduleId: string;
  label: string;
  path: string;
  count: number;
}

export interface ExportReviewSummary {
  adds: ExportReviewItem[];
  existing: ExportReviewItem[];
  updates: ExportReviewItem[];
  orphans: ExportReviewItem[];
  folderCounts: ExportReviewFolderCount[];
  counts: {
    adds: number;
    existing: number;
    updates: number;
    orphans: number;
    total: number;
  };
}

function moduleLabelFor(moduleId: string | null): string | null {
  if (moduleId === null) return null;
  if (moduleId === "other") return "Other";
  return MODULE_DEFS.find((m) => m.id === moduleId)?.label ?? moduleId;
}

export function buildExportReviewSummary(
  resources: ResourceInstance[],
  exportConfig?: ExportConfig | null
): ExportReviewSummary {
  const { orphans: orphanResources } = resolveExportMap(resources, exportConfig);
  const orphanIds = new Set(orphanResources.map((r) => r.id));

  const adds: ExportReviewItem[] = [];
  const existing: ExportReviewItem[] = [];
  const updates: ExportReviewItem[] = [];
  const orphans: ExportReviewItem[] = [];
  const byFolder = new Map<string, number>();

  for (const r of resources) {
    const info = shortResourceInfo(r);
    const mid = resolveModuleId(r, exportConfig);
    const folderOverride = isOverride(r, exportConfig);
    const item: ExportReviewItem = {
      id: r.id,
      label: info.label,
      typeLabel: info.typeLabel,
      scopeLabel: info.scopeLabel,
      mode: orphanIds.has(r.id)
        ? "orphan"
        : r.useExisting
          ? "existing"
          : "add",
      moduleId: mid,
      moduleLabel: moduleLabelFor(mid),
      folderOverride,
    };

    if (item.mode === "orphan") {
      orphans.push(item);
    } else if (item.mode === "existing") {
      existing.push(item);
      if (mid) byFolder.set(mid, (byFolder.get(mid) ?? 0) + 1);
    } else {
      adds.push(item);
      if (mid) byFolder.set(mid, (byFolder.get(mid) ?? 0) + 1);
    }

    if (folderOverride && item.mode !== "orphan") {
      updates.push(item);
    }
  }

  const folderCounts: ExportReviewFolderCount[] = moduleOrder(
    Array.from(byFolder.keys())
  ).map((moduleId) => ({
    moduleId,
    label: moduleLabelFor(moduleId) ?? moduleId,
    path: `modules/${moduleId}`,
    count: byFolder.get(moduleId) ?? 0,
  }));

  return {
    adds,
    existing,
    updates,
    orphans,
    folderCounts,
    counts: {
      adds: adds.length,
      existing: existing.length,
      updates: updates.length,
      orphans: orphans.length,
      total: resources.length,
    },
  };
}
