"use client";

import { useMemo, useState } from "react";
import { useProject } from "@/lib/store/project-context";
import {
  buildFolderTree,
  canDownloadWithMap,
  moduleFolderOptions,
  resolveModuleId,
  resourcesAtPath,
  shortResourceInfo,
  type FolderTreeNode,
} from "@/lib/generate/export-map";
import { MODULE_DEFS } from "@/lib/generate/modules";
import {
  Badge,
  Button,
  Hint,
  SelectInput,
} from "@/components/ui/Field";

function TreeNodeRow({
  node,
  depth,
  selected,
  onSelect,
}: {
  node: FolderTreeNode;
  depth: number;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const isSelected = selected === node.path;
  const isOrphan = node.path === "__orphans__";
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(node.path)}
        className={`w-full text-left rounded-md px-2 py-1.5 text-[11px] font-mono truncate focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
          isSelected
            ? isOrphan
              ? "bg-amber-600 text-white"
              : "bg-sky-600 text-white"
            : isOrphan
              ? "text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40"
              : "text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800"
        }`}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
        aria-current={isSelected ? "true" : undefined}
      >
        {node.kind === "dir" ? "📁 " : "📄 "}
        {node.name}
        {node.resourceIds.length > 0 && node.path !== "modules" && (
          <span className="opacity-70 ml-1">· {node.resourceIds.length}</span>
        )}
      </button>
      {node.children && node.children.length > 0 && (
        <ul className="space-y-0.5">
          {node.children.map((c) => (
            <TreeNodeRow
              key={c.path}
              node={c}
              depth={depth + 1}
              selected={selected}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function FolderStructurePanel({
  mapMode,
  onMapModeChange,
}: {
  mapMode: boolean;
  onMapModeChange: (v: boolean) => void;
}) {
  const {
    state,
    setResourceModule,
    setDomainGroupModule,
    resetFolderMap,
  } = useProject();
  const [selectedPath, setSelectedPath] = useState<string | null>("modules");
  const [groupTarget, setGroupTarget] = useState<string>("");

  const envIds = state.environments.map((e) => e.id);
  const tree = useMemo(
    () => buildFolderTree(state.resources, envIds, state.exportConfig),
    [state.resources, envIds, state.exportConfig]
  );

  const atPath = useMemo(
    () =>
      selectedPath
        ? resourcesAtPath(selectedPath, state.resources, state.exportConfig)
        : [],
    [selectedPath, state.resources, state.exportConfig]
  );

  const downloadGate = canDownloadWithMap(
    state.resources,
    state.exportConfig,
    { mapMode }
  );

  const folderOpts = moduleFolderOptions();
  const overrideCount = Object.keys(state.exportConfig.moduleByResourceId).length;

  // Module id from selected path for group remapping
  const selectedModuleId = useMemo(() => {
    if (!selectedPath) return null;
    const m = selectedPath.match(/^modules\/([^/]+)/);
    return m?.[1] ?? null;
  }, [selectedPath]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/40">
        <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={mapMode}
            onChange={(e) => onMapModeChange(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
          />
          Map mode
        </label>
        <Hint>
          Assign resources to module folders (domain→folder). Defaults match
          export grouping.
        </Hint>
        {overrideCount > 0 && (
          <Badge tone="violet">{overrideCount} override{overrideCount === 1 ? "" : "s"}</Badge>
        )}
        {downloadGate.orphans.length > 0 && (
          <Badge tone="amber">
            {downloadGate.orphans.length} orphan{downloadGate.orphans.length === 1 ? "" : "s"}
          </Badge>
        )}
        {overrideCount > 0 && (
          <Button variant="ghost" size="sm" onClick={() => resetFolderMap()}>
            Reset to defaults
          </Button>
        )}
      </div>

      {mapMode && downloadGate.orphans.length > 0 && (
        <div
          role="alert"
          className="mx-3 mt-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-700 px-3 py-2 text-xs text-amber-900 dark:text-amber-200"
        >
          <strong>Unassigned resources block Download ZIP.</strong> Assign each
          to a module folder below, or use “Leave unmapped…” on Download (explicit
          confirm). Unmapped resources are never silently dropped.
          <ul className="mt-1.5 list-disc pl-4 space-y-0.5">
            {downloadGate.orphans.map((r) => {
              const info = shortResourceInfo(r);
              return (
                <li key={r.id}>
                  {info.typeLabel} · {info.label}{" "}
                  <span className="opacity-70">({info.tfName})</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-12">
        <aside className="md:col-span-5 border-b md:border-b-0 md:border-r border-slate-200 dark:border-slate-700 overflow-y-auto p-2 bg-slate-50 dark:bg-slate-950/40">
          <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-slate-500 font-semibold">
            ZIP folder structure
          </p>
          <ul className="space-y-0.5" role="tree" aria-label="Export folder tree">
            {tree.map((n) => (
              <TreeNodeRow
                key={n.path}
                node={n}
                depth={0}
                selected={selectedPath}
                onSelect={setSelectedPath}
              />
            ))}
          </ul>
        </aside>

        <div className="md:col-span-7 min-h-0 flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 text-xs font-mono text-sky-700 dark:text-sky-300 truncate">
            {selectedPath ?? "Select a folder or file"}
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {selectedPath?.startsWith("modules/") && mapMode && selectedModuleId && (
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                  Remap group → folder
                </p>
                <p className="text-[11px] text-slate-500">
                  Move all resources currently in{" "}
                  <code className="font-mono">modules/{selectedModuleId}</code>{" "}
                  to another domain folder.
                </p>
                <div className="flex flex-wrap gap-2 items-center">
                  <SelectInput
                    aria-label="Target module folder"
                    value={groupTarget}
                    onChange={(e) => setGroupTarget(e.target.value)}
                    className="max-w-xs text-xs py-1.5"
                  >
                    <option value="">Choose folder…</option>
                    {folderOpts
                      .filter((o) => o.id !== selectedModuleId)
                      .map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.path} — {o.label}
                        </option>
                      ))}
                    <option value="__orphan__">Leave unmapped (orphan)</option>
                  </SelectInput>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!groupTarget}
                    onClick={() => {
                      const to =
                        groupTarget === "__orphan__" ? null : groupTarget;
                      setDomainGroupModule(selectedModuleId, to);
                      setGroupTarget("");
                    }}
                  >
                    Apply to group
                  </Button>
                </div>
              </div>
            )}

            {atPath.length === 0 ? (
              <p className="text-sm text-slate-500">
                {selectedPath?.startsWith("environments/") ||
                selectedPath === "config.tf" ||
                selectedPath === "main.tf" ||
                selectedPath === "variables.tf" ||
                selectedPath === "outputs.tf" ||
                selectedPath === "README.md"
                  ? "Root / env files — no catalogue resources land here (wiring + tfvars only)."
                  : "No resources in this path."}
              </p>
            ) : (
              <ul className="space-y-2">
                {atPath.map((r) => {
                  const info = shortResourceInfo(r);
                  const effective = resolveModuleId(r, state.exportConfig);
                  const defaultMod =
                    MODULE_DEFS.find((m) => m.types.includes(r.type))?.id ??
                    "other";
                  return (
                    <li
                      key={r.id}
                      className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
                            {info.typeLabel}
                          </p>
                          <p className="text-xs text-slate-500 truncate">
                            {info.label} · <span className="font-mono">{info.tfName}</span>{" "}
                            · {info.scopeLabel}
                          </p>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            Folder:{" "}
                            {effective === null ? (
                              <span className="text-amber-700 dark:text-amber-300 font-medium">
                                unassigned
                              </span>
                            ) : (
                              <code className="font-mono">modules/{effective}</code>
                            )}
                            {effective !== defaultMod && (
                              <span className="ml-1 text-violet-600 dark:text-violet-300">
                                (override; default {defaultMod})
                              </span>
                            )}
                          </p>
                        </div>
                        {mapMode && (
                          <SelectInput
                            aria-label={`Module folder for ${info.label}`}
                            value={effective ?? "__orphan__"}
                            onChange={(e) => {
                              const v = e.target.value;
                              setResourceModule(
                                r.id,
                                v === "__orphan__" ? null : v
                              );
                            }}
                            className="max-w-[200px] text-xs py-1.5"
                          >
                            {folderOpts.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.label}
                              </option>
                            ))}
                            <option value="__orphan__">Unassigned</option>
                          </SelectInput>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Expose gate for ExportPanel download button. */
export { canDownloadWithMap };
