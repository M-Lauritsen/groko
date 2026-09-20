"use client";

import { useMemo } from "react";
import { useProject } from "@/lib/store/project-context";
import {
  buildExportReviewSummary,
  type ExportReviewItem,
} from "@/lib/generate/export-map";
import { Badge, Hint } from "@/components/ui/Field";

function ReviewList({
  title,
  items,
  empty,
  tone,
}: {
  title: string;
  items: ExportReviewItem[];
  empty: string;
  tone: "emerald" | "sky" | "violet" | "amber";
}) {
  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
      <header className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          {title}
        </h3>
        <Badge tone={tone}>{items.length}</Badge>
      </header>
      {items.length === 0 ? (
        <p className="px-3 py-3 text-xs text-slate-500">{empty}</p>
      ) : (
        <ul className="max-h-44 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
          {items.map((item) => (
            <li key={item.id} className="px-3 py-2 text-xs">
              <p className="font-medium text-slate-800 dark:text-slate-100 truncate">
                {item.typeLabel}
              </p>
              <p className="text-slate-500 truncate">
                {item.label}
                <span className="opacity-70"> · {item.scopeLabel}</span>
                {item.moduleLabel && (
                  <span className="opacity-70"> · {item.moduleLabel}</span>
                )}
                {item.folderOverride && (
                  <span className="ml-1 text-violet-600 dark:text-violet-300">
                    (folder override)
                  </span>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Export Review changes — domain summary only (no HCL).
 * Chips: adds / updates / Existing / orphans + optional folder destination counts.
 */
export function ReviewChangesPanel({
  onOpenMap,
}: {
  /** Jump to Folder structure Map mode to assign orphans. */
  onOpenMap?: () => void;
}) {
  const { state } = useProject();
  const summary = useMemo(
    () => buildExportReviewSummary(state.resources, state.exportConfig),
    [state.resources, state.exportConfig]
  );

  const { counts, folderCounts } = summary;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          Review changes
        </h2>
        <Hint>
          Domain summary of what this Environment will export — Adds (Create),
          Existing lookups, folder overrides, and orphans. No HCL here; use Live
          HCL or Files for generated text.
        </Hint>
      </div>

      <div className="flex flex-wrap gap-2" aria-label="Export change counts">
        <Badge tone="emerald">{counts.adds} add{counts.adds === 1 ? "" : "s"}</Badge>
        <Badge tone="violet">
          {counts.updates} update{counts.updates === 1 ? "" : "s"}
        </Badge>
        <Badge tone="sky">
          {counts.existing} Existing
        </Badge>
        <Badge tone={counts.orphans > 0 ? "amber" : "slate"}>
          {counts.orphans} orphan{counts.orphans === 1 ? "" : "s"}
        </Badge>
        <Badge tone="slate">{counts.total} total</Badge>
      </div>

      {counts.orphans > 0 && (
        <div
          role="alert"
          className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-700 px-3 py-2 text-xs text-amber-900 dark:text-amber-200"
        >
          <strong>Unassigned resources block Download ZIP.</strong> Assign each
          to a module folder in Map mode, or use Leave unmapped… (explicit
          confirm). Unmapped resources are never silently dropped.
          {onOpenMap && (
            <button
              type="button"
              onClick={onOpenMap}
              className="ml-2 font-semibold text-amber-950 dark:text-amber-100 underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded"
            >
              Open Map mode
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <ReviewList
          title="Adds (Create)"
          items={summary.adds}
          empty="No resources marked Create."
          tone="emerald"
        />
        <ReviewList
          title="Existing lookups"
          items={summary.existing}
          empty="No Existing lookups."
          tone="sky"
        />
        <ReviewList
          title="Updates (folder overrides)"
          items={summary.updates}
          empty="No folder overrides — defaults match export grouping."
          tone="violet"
        />
        <ReviewList
          title="Orphans / leave-unmapped"
          items={summary.orphans}
          empty="All resources have a module folder."
          tone="amber"
        />
      </div>

      {folderCounts.length > 0 && (
        <section className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <header className="px-3 py-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
              Module folder destinations
            </h3>
          </header>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {folderCounts.map((f) => (
              <li
                key={f.moduleId}
                className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
              >
                <span className="text-slate-700 dark:text-slate-200">
                  {f.label}{" "}
                  <span className="font-mono text-slate-400">{f.path}</span>
                </span>
                <Badge tone="slate">{f.count}</Badge>
              </li>
            ))}
          </ul>
        </section>
      )}

      {counts.total === 0 && (
        <p className="text-sm text-slate-500">
          No resources in this Environment yet. Add from the catalogue on
          Resources, then return here to review before Download ZIP.
        </p>
      )}
    </div>
  );
}
