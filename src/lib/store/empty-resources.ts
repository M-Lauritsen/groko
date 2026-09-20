/**
 * Uxis empty-state copy (Develops #3) — Resources List & Graph.
 * Domain language only; no .tf / Terraform jargon in the empty UI.
 */

export type ResourcesEmptyVariant = "list" | "graph";

/** Stable id for the List-column catalogue search (List empty primary CTA focus). */
export const CATALOGUE_PANEL_SEARCH_ID = "catalogue-panel-search";

/** Locked Uxis strings for empty Resources views. */
export const EMPTY_RESOURCES_COPY = {
  listTitle: "No resources in this Environment yet.",
  graphTitle: "Nothing to show for this tier.",
  /** Short domain hint under the heading (shared + active tier). */
  listBody:
    "This view shows Shared resources plus the active Environment. Add a building block from the catalogue, or import an existing project from Environment.",
  graphBody:
    "The graph shows Shared resources plus the active Environment. Add from the catalogue to place the first node, or import an existing project from Environment.",
  primaryAddLabel: "Add from catalogue",
  secondaryImportLabel: "Import existing",
  /** When resources exist but none are visible for shared + active tier. */
  hiddenNote: (n: number, envLabel: string) =>
    n === 1
      ? `1 resource is in another Environment — switch the tier above, or add something for ${envLabel}.`
      : `${n} resources are in other Environments — switch the tier above, or add something for ${envLabel}.`,
} as const;

export function emptyResourcesTitle(variant: ResourcesEmptyVariant): string {
  return variant === "list"
    ? EMPTY_RESOURCES_COPY.listTitle
    : EMPTY_RESOURCES_COPY.graphTitle;
}

export function emptyResourcesBody(variant: ResourcesEmptyVariant): string {
  return variant === "list"
    ? EMPTY_RESOURCES_COPY.listBody
    : EMPTY_RESOURCES_COPY.graphBody;
}
