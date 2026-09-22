import type { ExportConfig, ResourceInstance } from "../schema/types";
import { getResourceType } from "../schema/resources";
import { resolveExportMap } from "./export-map";

export interface ExistingIdentifierIssue {
  code: "missing-existing-identifier";
  /** Domain navigation target for Resource details. */
  resourceId: string;
  /** Catalogue label, rather than a provider type. */
  resourceLabel: string;
  /** User-facing Resource name. */
  resourceName: string;
  fieldKey: string;
  fieldLabel: string;
  /** Whether this Resource is included by the current folder map. */
  included: boolean;
  message: string;
}

export interface ExistingIdentifierValidation {
  issues: ExistingIdentifierIssue[];
  /** Only included Resources should block a future Copy or ZIP gate. */
  includedIssues: ExistingIdentifierIssue[];
}

/** User-safe failure returned by ZIP boundaries when the UI gate is bypassed. */
export class MissingExistingIdentifierError extends Error {
  readonly code = "missing-existing-identifier" as const;
  readonly issues: ExistingIdentifierIssue[];

  constructor(issues: ExistingIdentifierIssue[]) {
    super(
      "Export cannot continue because one or more Existing identifiers are missing."
    );
    this.name = "MissingExistingIdentifierError";
    this.issues = issues;
  }
}

/**
 * The literal identifier to use for Existing mode. A present snapshot,
 * including an intentionally empty one, takes precedence over the source
 * field. Strings are normalized only at this export boundary.
 */
export function existingIdentifierValue(
  resource: ResourceInstance,
  fieldKey: string
): string | undefined {
  const snapshots = resource.existingValues ?? {};
  const hasSnapshot = Object.prototype.hasOwnProperty.call(snapshots, fieldKey);
  const value = hasSnapshot ? snapshots[fieldKey] : resource.values[fieldKey];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

/**
 * High-level domain/Export seam for Existing identifiers.
 *
 * It intentionally returns issues for mapped and unmapped Resources. Review
 * can therefore diagnose every Resource, while Copy/ZIP callers can reuse
 * `includedIssues` after the orphan decision without duplicating validation.
 */
export function validateExistingIdentifiers(
  resources: ResourceInstance[],
  exportConfig?: ExportConfig | null
): ExistingIdentifierValidation {
  const { orphans } = resolveExportMap(resources, exportConfig);
  const orphanIds = new Set(orphans.map((resource) => resource.id));
  const issues: ExistingIdentifierIssue[] = [];

  for (const resource of resources) {
    if (!resource.useExisting) continue;
    const definition = getResourceType(resource.type);
    if (!definition) continue;

    for (const field of definition.fields) {
      if (!field.existingKey || existingIdentifierValue(resource, field.key)) {
        continue;
      }
      const resourceName =
        typeof resource.values.name === "string" && resource.values.name.trim()
          ? resource.values.name
          : resource.tfName;
      issues.push({
        code: "missing-existing-identifier",
        resourceId: resource.id,
        resourceLabel: definition.label,
        resourceName,
        fieldKey: field.key,
        fieldLabel: field.label,
        included: !orphanIds.has(resource.id),
        message: `${definition.label} "${resourceName}" needs an Existing ${field.label} identifier.`,
      });
    }
  }

  return {
    issues,
    includedIssues: issues.filter((issue) => issue.included),
  };
}

/**
 * Export gate shared by Copy, Download ZIP, and ZIP creation.  Orphans are
 * deliberately excluded from `includedIssues`; their explicit omission is
 * decided by the separate orphan confirmation gate.
 */
export function canExportWithValidExistingIdentifiers(
  resources: ResourceInstance[],
  exportConfig?: ExportConfig | null
): ExistingIdentifierValidation & { ok: boolean; reason?: string } {
  const validation = validateExistingIdentifiers(resources, exportConfig);
  return validation.includedIssues.length === 0
    ? { ...validation, ok: true }
    : {
        ...validation,
        ok: false,
        reason: "Fix the Existing identifiers shown in Review changes before exporting.",
      };
}

/** Enforce the identifier gate at an artifact-creation boundary. */
export function assertExportableExistingIdentifiers(
  resources: ResourceInstance[],
  exportConfig?: ExportConfig | null
): void {
  const validation = canExportWithValidExistingIdentifiers(
    resources,
    exportConfig
  );
  if (!validation.ok) {
    throw new MissingExistingIdentifierError(validation.includedIssues);
  }
}
