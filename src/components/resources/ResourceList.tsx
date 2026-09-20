"use client";

import { useMemo } from "react";
import { useProject } from "@/lib/store/project-context";
import { getResourceType } from "@/lib/schema/resources";
import { getUsedBy } from "@/lib/generate/deps";
import {
  normalizeScope,
  resourcesVisibleInEnv,
  scopeLabel,
} from "@/lib/schema/environments";
import { Card, SectionTitle, Badge, Button } from "@/components/ui/Field";
import { UndoRedoControls } from "@/components/history/UndoRedoControls";

export function ResourceList() {
  const { state, selectResource, removeResource, setActiveEnvironment } =
    useProject();
  const { resources, selectedResourceId, environments, activeEnvironmentId } =
    state;

  const visible = useMemo(
    () => resourcesVisibleInEnv(resources, activeEnvironmentId),
    [resources, activeEnvironmentId]
  );

  const sharedCount = visible.filter(
    (r) => normalizeScope(r.scope).kind === "shared"
  ).length;
  const scopedCount = visible.length - sharedCount;

  const activeEnv =
    environments.find((e) => e.id === activeEnvironmentId) ?? environments[0];

  return (
    <Card className="p-4 flex flex-col h-full min-h-0">
      <SectionTitle
        action={
          <div className="flex items-center gap-2">
            <UndoRedoControls compact />
            <Badge tone="slate">{visible.length}</Badge>
          </div>
        }
      >
        Project resources
      </SectionTitle>

      <div className="mb-3 flex flex-wrap gap-1">
        {environments.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => setActiveEnvironment(e.id)}
            className={`rounded-md px-2 py-0.5 text-[11px] font-medium border ${
              e.id === activeEnvironmentId
                ? "border-sky-500 bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300"
                : "border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-300"
            }`}
          >
            {e.displayName}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-slate-400 mb-2">
        Showing shared + {activeEnv?.displayName ?? "env"} · {sharedCount}{" "}
        shared · {scopedCount} scoped
        {resources.length !== visible.length
          ? ` · ${resources.length - visible.length} hidden (other envs)`
          : ""}
      </p>

      {visible.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-center px-4">
          <div>
            <p className="text-sm text-slate-500 mb-1">No resources in this view</p>
            <p className="text-xs text-slate-400">
              Pick a starter or add from the catalogue →
            </p>
          </div>
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto space-y-1 pr-1">
          {visible.map((r) => {
            const def = getResourceType(r.type);
            const selected = r.id === selectedResourceId;
            const usedBy = getUsedBy(r.id, resources);
            const scope = normalizeScope(r.scope);
            return (
              <li key={r.id}>
                <div
                  className={`rounded-lg border px-2.5 py-2 cursor-pointer transition-colors ${
                    selected
                      ? "border-sky-500 bg-sky-50 dark:bg-sky-950/40 ring-1 ring-sky-500"
                      : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600"
                  }`}
                  onClick={() => selectResource(r.id)}
                  onKeyDown={(e) => e.key === "Enter" && selectResource(r.id)}
                  role="button"
                  tabIndex={0}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-base mt-0.5" aria-hidden>
                      {def?.icon ?? "📦"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                          {def?.label ?? r.type}
                        </span>
                        <code className="text-[10px] text-slate-400 font-mono">
                          .{r.tfName}
                        </code>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        {r.useExisting ? (
                          <Badge tone="amber">data / existing</Badge>
                        ) : (
                          <Badge tone="emerald">resource</Badge>
                        )}
                        <Badge tone={scope.kind === "shared" ? "violet" : "sky"}>
                          {r.type ===
                          "azurerm_private_dns_zone_virtual_network_link"
                            ? scope.kind === "shared"
                              ? "VNet link · Shared hub"
                              : `VNet link · ${scopeLabel(scope, environments)}`
                            : scopeLabel(scope, environments)}
                        </Badge>
                        {usedBy.length > 0 && (
                          <Badge tone="violet">
                            used by {usedBy.length}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="!px-1.5 !py-0.5 text-slate-400 hover:!text-rose-500"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeResource(r.id);
                      }}
                      title="Remove"
                    >
                      ×
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
