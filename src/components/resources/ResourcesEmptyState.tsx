"use client";

import { Button } from "@/components/ui/Field";
import {
  CATALOGUE_PANEL_SEARCH_ID,
  EMPTY_RESOURCES_COPY,
  emptyResourcesBody,
  emptyResourcesTitle,
  type ResourcesEmptyVariant,
} from "@/lib/store/empty-resources";

export { CATALOGUE_PANEL_SEARCH_ID };

export function ResourcesEmptyState({
  variant,
  envLabel,
  hiddenInOtherEnvs = 0,
  onAddFromCatalogue,
  onImportExisting,
}: {
  variant: ResourcesEmptyVariant;
  /** Active Environment display name (domain). */
  envLabel: string;
  /** Resources that exist but are scoped to other Environments. */
  hiddenInOtherEnvs?: number;
  onAddFromCatalogue: () => void;
  /** Navigate to Environment step (Import existing lives there). */
  onImportExisting: () => void;
}) {
  const title = emptyResourcesTitle(variant);
  const body = emptyResourcesBody(variant);
  const icon = variant === "graph" ? "🕸" : "📦";

  return (
    <div
      className="flex-1 flex items-center justify-center text-center px-4 py-6"
      role="status"
    >
      <div className="max-w-sm">
        <div className="text-3xl mb-3" aria-hidden>
          {icon}
        </div>
        <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-1">
          {title}
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">{body}</p>
        {hiddenInOtherEnvs > 0 && (
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
            {EMPTY_RESOURCES_COPY.hiddenNote(hiddenInOtherEnvs, envLabel)}
          </p>
        )}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-2 mt-3">
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={onAddFromCatalogue}
            aria-label={EMPTY_RESOURCES_COPY.primaryAddLabel}
          >
            + {EMPTY_RESOURCES_COPY.primaryAddLabel}
          </Button>
          <button
            type="button"
            className="text-sm font-medium text-sky-700 dark:text-sky-400 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 rounded px-1 py-0.5"
            onClick={onImportExisting}
          >
            {EMPTY_RESOURCES_COPY.secondaryImportLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Focus the List-column catalogue search (primary CTA when catalogue is visible). */
export function focusCataloguePanelSearch(): void {
  const el = document.getElementById(CATALOGUE_PANEL_SEARCH_ID);
  if (el instanceof HTMLInputElement) {
    el.focus();
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}
