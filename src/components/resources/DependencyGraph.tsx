"use client";

import { useMemo, useRef, useEffect } from "react";
import { useProject } from "@/lib/store/project-context";
import { getResourceType } from "@/lib/schema/resources";
import {
  normalizeScope,
  resourcesVisibleInEnv,
  scopeLabel,
  tierShortLabel,
} from "@/lib/schema/environments";
import { layoutDependencyGraph } from "@/lib/generate/graph-layout";
import { Card, SectionTitle, Badge } from "@/components/ui/Field";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { UndoRedoControls } from "@/components/history/UndoRedoControls";
import { TierBadge } from "@/components/project/TierBadge";

export type ResourcesViewMode = "list" | "graph";

export function ResourcesViewToggle({
  value,
  onChange,
}: {
  value: ResourcesViewMode;
  onChange: (v: ResourcesViewMode) => void;
}) {
  return (
    <SegmentedControl
      ariaLabel="Resources view"
      size="sm"
      value={value}
      onChange={onChange}
      options={[
        { value: "list", label: "List" },
        { value: "graph", label: "Graph" },
      ]}
    />
  );
}

/** SVG dependency graph — selection uses the shared selectedResourceId store. */
export function DependencyGraph({
  viewMode,
  onViewModeChange,
}: {
  viewMode: ResourcesViewMode;
  onViewModeChange: (v: ResourcesViewMode) => void;
}) {
  const { state, selectResource, setActiveEnvironment } = useProject();
  const { resources, selectedResourceId, environments, activeEnvironmentId } =
    state;

  const visible = useMemo(
    () => resourcesVisibleInEnv(resources, activeEnvironmentId),
    [resources, activeEnvironmentId]
  );

  const layout = useMemo(
    () => layoutDependencyGraph(visible, resources, { omitInvalidEdges: true }),
    [visible, resources]
  );

  const nodeById = useMemo(() => {
    const m = new Map(layout.nodes.map((n) => [n.id, n]));
    return m;
  }, [layout.nodes]);

  const resourceById = useMemo(() => {
    const m = new Map(resources.map((r) => [r.id, r]));
    return m;
  }, [resources]);

  const sharedCount = visible.filter(
    (r) => normalizeScope(r.scope).kind === "shared"
  ).length;
  const scopedCount = visible.length - sharedCount;
  const activeEnv =
    environments.find((e) => e.id === activeEnvironmentId) ?? environments[0];

  const selectedRef = useRef<SVGGElement | null>(null);
  useEffect(() => {
    if (selectedResourceId && selectedRef.current) {
      selectedRef.current.focus({ preventScroll: false });
    }
  }, [selectedResourceId]);

  return (
    <Card className="p-4 flex flex-col h-full min-h-0">
      <SectionTitle
        action={
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <ResourcesViewToggle value={viewMode} onChange={onViewModeChange} />
            <UndoRedoControls compact />
            <TierBadge />
            <Badge tone="slate">{visible.length}</Badge>
          </div>
        }
      >
        Dependency graph
      </SectionTitle>

      <div className="mb-3">
        <SegmentedControl
          ariaLabel="Filter by environment tier"
          size="sm"
          value={activeEnvironmentId}
          onChange={setActiveEnvironment}
          options={environments.map((e) => ({
            value: e.id,
            label: e.displayName,
            shortLabel: tierShortLabel(e),
          }))}
        />
      </div>
      <p className="text-[11px] text-slate-400 mb-2">
        Showing shared + {activeEnv?.displayName ?? "env"} · {sharedCount}{" "}
        shared · {scopedCount} scoped · edges from Environment refs (cross-env
        blocked omitted)
        {resources.length !== visible.length
          ? ` · ${resources.length - visible.length} hidden (other envs)`
          : ""}
      </p>

      {visible.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-center px-4">
          <div>
            <p className="text-sm text-slate-500 mb-1">No resources in this view</p>
            <p className="text-xs text-slate-400">
              Switch to List and add from the catalogue, or pick a starter.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-950/40">
          <svg
            role="img"
            aria-label="Resource dependency graph"
            width={Math.max(layout.width, 320)}
            height={Math.max(layout.height, 200)}
            className="block"
          >
            <defs>
              <marker
                id="dep-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" className="fill-slate-400" />
              </marker>
            </defs>

            {/* Edges: from (dependent) → to (dependency). Draw leftward toward deps. */}
            {layout.edges.map((e) => {
              const from = nodeById.get(e.fromId);
              const to = nodeById.get(e.toId);
              if (!from || !to) return null;
              const x1 = from.x;
              const y1 = from.y + from.height / 2;
              const x2 = to.x + to.width;
              const y2 = to.y + to.height / 2;
              const mid = (x1 + x2) / 2;
              const dim = !e.valid;
              return (
                <path
                  key={`${e.fromId}-${e.toId}-${e.fieldKey}`}
                  d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  strokeWidth={dim ? 1 : 1.5}
                  strokeDasharray={dim ? "4 3" : undefined}
                  markerEnd="url(#dep-arrow)"
                  className={
                    dim
                      ? "stroke-slate-300 dark:stroke-slate-600 opacity-40"
                      : "stroke-slate-400 dark:stroke-slate-500"
                  }
                  aria-hidden
                />
              );
            })}

            {layout.nodes.map((n) => {
              const r = resourceById.get(n.id);
              if (!r) return null;
              const def = getResourceType(r.type);
              const selected = r.id === selectedResourceId;
              const scope = normalizeScope(r.scope);
              const isShared = scope.kind === "shared";
              const label = def?.label ?? r.type;
              return (
                <g
                  key={n.id}
                  ref={selected ? selectedRef : undefined}
                  transform={`translate(${n.x}, ${n.y})`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${label} ${r.tfName}${selected ? ", selected" : ""}`}
                  aria-pressed={selected}
                  className="cursor-pointer outline-none"
                  onClick={() => selectResource(r.id)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                      ev.preventDefault();
                      selectResource(r.id);
                    }
                  }}
                >
                  <rect
                    width={n.width}
                    height={n.height}
                    rx={10}
                    className={
                      selected
                        ? "fill-sky-50 dark:fill-sky-950/60 stroke-sky-500"
                        : isShared
                          ? "fill-violet-50 dark:fill-violet-950/40 stroke-violet-300 dark:stroke-violet-700"
                          : "fill-white dark:fill-slate-900 stroke-sky-300 dark:stroke-sky-700"
                    }
                    strokeWidth={selected ? 2 : 1.25}
                  />
                  <text
                    x={12}
                    y={22}
                    className="fill-slate-900 dark:fill-slate-100 text-[12px] font-medium"
                    style={{ fontSize: 12, fontWeight: 600 }}
                  >
                    {(def?.icon ?? "📦") + " "}
                    {label.length > 16 ? label.slice(0, 15) + "…" : label}
                  </text>
                  <text
                    x={12}
                    y={40}
                    className="fill-slate-500 dark:fill-slate-400"
                    style={{ fontSize: 10, fontFamily: "ui-monospace, monospace" }}
                  >
                    .{r.tfName.length > 18 ? r.tfName.slice(0, 17) + "…" : r.tfName}
                  </text>
                  {/* Mode badge strip */}
                  <rect
                    x={n.width - 52}
                    y={8}
                    width={44}
                    height={16}
                    rx={8}
                    className={
                      r.useExisting
                        ? "fill-amber-100 dark:fill-amber-900/60"
                        : "fill-emerald-100 dark:fill-emerald-900/60"
                    }
                  />
                  <text
                    x={n.width - 30}
                    y={19.5}
                    textAnchor="middle"
                    style={{ fontSize: 9, fontWeight: 600 }}
                    className={
                      r.useExisting
                        ? "fill-amber-800 dark:fill-amber-200"
                        : "fill-emerald-800 dark:fill-emerald-200"
                    }
                  >
                    {r.useExisting ? "exist" : "create"}
                  </text>
                  <title>
                    {label} .{r.tfName} ·{" "}
                    {r.useExisting ? "Existing" : "Create"} ·{" "}
                    {scopeLabel(scope, environments)}
                  </title>
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </Card>
  );
}
