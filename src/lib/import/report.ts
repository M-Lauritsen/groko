import { getResourceType } from "../schema/resources";
import type { ImportSummary, MappedItem, SkippedItem } from "./mapToProject";
import type { ParseResult } from "./parse";

export const IMPORT_DIAGNOSTIC_REPORT_FILE_NAME = "groko-import-report.json";

export type ImportSkipReasonCode =
  | "module_source_remote"
  | "local_module_unavailable"
  | "module_source_dynamic"
  | "module_instance_not_supported"
  | "module_cycle"
  | "module_not_supported"
  | "module_output_unresolved"
  | "provider_not_supported"
  | "configuration_lookup"
  | "resource_type_not_supported"
  | "for_each_not_supported"
  | "count_not_supported"
  | "not_supported";

export type ImportSkipDiagnostic = {
  reasonCode: ImportSkipReasonCode;
  title: string;
  actionability: "repair" | "informational";
  help?: string;
};

export interface ImportDiagnosticReport {
  reportVersion: 2;
  generatedAt: string;
  uploadManifest: Array<{ uploadIndex: number; path: string }>;
  summary: {
    filesRead: number;
    mappedResources: number;
    couldNotMap: number;
    partiallyMappedFields: number;
    notes: number;
  };
  outcomes: {
    mapped: Array<{
      uploadIndex: number | null;
      sourcePath: string | null;
      kind: "resource" | "data";
      catalogueLabel: string;
      sourceType: string;
      sourceName: string;
      mappingStatus: "mapped" | "partiallyMapped";
      mappedFieldNames: string[];
      unmappedFieldNames: string[];
      unsupportedConstructs: string[];
    }>;
    skipped: Array<{
      uploadIndex: number | null;
      sourcePath: string | null;
      kind: string;
      sourceType: string;
      sourceName: string;
      reasonCode: string;
      reason: string;
    }>;
  };
  notes: Array<{
    uploadIndex: number | null;
    category: "parse" | "mapping";
    message: string;
  }>;
}

function uploadIndex(index: number | null | undefined): number | null {
  return Number.isInteger(index) && index! >= 0 ? index! : null;
}

export function getImportSkipDiagnostic(item: SkippedItem): ImportSkipDiagnostic {
  if (item.kind === "module") {
    if (item.reason.includes("remote")) {
      return { reasonCode: "module_source_remote", title: "Remote module source", actionability: "repair", help: "Upload a local copy of this module, then import the files together." };
    }
    if (item.reason.includes("not found")) {
      return { reasonCode: "local_module_unavailable", title: "Local module files missing", actionability: "repair", help: "Include the local module files in the upload, then try again." };
    }
    if (item.reason.includes("static local path")) {
      return { reasonCode: "module_source_dynamic", title: "Dynamic module source", actionability: "repair", help: "Use a fixed local module source or add its resources from the catalogue." };
    }
    if (item.reason.includes("for_each") || item.reason.includes("count")) {
      return { reasonCode: "module_instance_not_supported", title: "Module instance count could not be resolved", actionability: "repair", help: "Select a root profile that resolves count to 0 or 1, or add the instances from the catalogue." };
    }
    if (item.reason.includes("cycle")) {
      return { reasonCode: "module_cycle", title: "Module cycle", actionability: "repair", help: "Break the module cycle, then upload the local modules again." };
    }
    return { reasonCode: "module_not_supported", title: "Module could not be expanded", actionability: "repair", help: "Add the module's resources from the catalogue after import." };
  }
  if (item.reason.includes("Unresolved module output")) {
    return { reasonCode: "module_output_unresolved", title: "Unresolved module output", actionability: "repair", help: "Add the dependent resource from the catalogue and connect it after import." };
  }
  if (item.reason.includes("Non-azurerm")) {
    return { reasonCode: "provider_not_supported", title: item.type.startsWith("azapi_") ? "Azure AzAPI provider is not supported" : "Provider is not supported", actionability: "informational" };
  }
  if (item.reason.includes("Client configuration lookup")) {
    return { reasonCode: "configuration_lookup", title: "Client configuration lookup (not a resource)", actionability: "informational", help: "Values that depend on the current client must be supplied explicitly." };
  }
  if (item.reason.includes("RESOURCE_CATALOGUE")) {
    return { reasonCode: "resource_type_not_supported", title: "Not in the builder catalogue yet", actionability: "informational" };
  }
  if (item.reason.includes("for_each")) {
    return { reasonCode: "for_each_not_supported", title: "Uses for_each (not supported in the importer)", actionability: "informational" };
  }
  if (item.reason.includes("count")) {
    return { reasonCode: "count_not_supported", title: "Count must resolve to 0 or 1", actionability: "repair", help: "Select a root profile or add unsupported instances from the catalogue." };
  }
  return { reasonCode: "not_supported", title: "Could not map this item", actionability: "informational" };
}

export function safeImportSourcePath(path: string | undefined): string | null {
  if (!path) return null;
  const normalized = path.replace(/\\/g, "/");
  const isAbsolute = /^[a-zA-Z]:\//.test(normalized) || normalized.startsWith("/");
  const segments = normalized.split("/").filter(Boolean);
  const hasTraversal = segments.includes("..");
  if (isAbsolute || hasTraversal) return null;
  const safeSegments = segments.filter((segment) => segment !== "." && segment !== "..");
  if (safeSegments.length === 0) return null;
  return safeSegments.join("/");
}

function mappedOutcome(item: MappedItem): ImportDiagnosticReport["outcomes"]["mapped"][number] {
  const partiallyMapped =
    item.unmappedFieldNames.length > 0 || item.unsupportedConstructs.length > 0;
  return {
    uploadIndex: uploadIndex(item.sourceIndex),
    sourcePath: item.sourcePath ?? safeImportSourcePath(item.sourceHint),
    kind: item.kind,
    catalogueLabel: getResourceType(item.type)?.label ?? "Unknown resource",
    sourceType: item.type,
    sourceName: item.name,
    mappingStatus: partiallyMapped ? "partiallyMapped" : "mapped",
    mappedFieldNames: [...item.mappedFieldNames],
    unmappedFieldNames: [...item.unmappedFieldNames],
    unsupportedConstructs: [...item.unsupportedConstructs],
  };
}

function parseDiagnosticMessage(warning: string): string {
  const markers = [
    "Parse error:",
    "Unexpected tokens after block type",
    "Unexpected token after",
    "Unsupported value at",
    "Fatal parse error:",
    "Configuration ignored:",
  ];
  const markerIndex = markers
    .map((marker) => warning.indexOf(marker))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  return markerIndex === undefined
    ? "Some source content could not be read."
    : warning.slice(markerIndex);
}

/** Builds an export-safe diagnostic boundary from transient parser and mapper outcomes. */
export function createImportDiagnosticReport(
  filesRead: number,
  parsed: ParseResult,
  summary: ImportSummary,
  generatedAt = new Date().toISOString(),
  uploadPaths: string[] = []
): ImportDiagnosticReport {
  const mapped = summary.mapped.map(mappedOutcome);
  const skipped = summary.skipped.map((item) => ({
    uploadIndex: uploadIndex(item.sourceIndex),
    sourcePath: item.sourcePath ?? safeImportSourcePath(item.sourceHint),
    kind: item.kind,
    sourceType: item.type,
    sourceName: item.name,
    reasonCode: getImportSkipDiagnostic(item).reasonCode,
    reason: item.reason,
  }));
  const notes: ImportDiagnosticReport["notes"] = [
    ...mapped
      .filter((item) => item.mappingStatus === "partiallyMapped")
      .map((item) => ({
        uploadIndex: item.uploadIndex,
        category: "mapping" as const,
        message: "Some fields could not be mapped.",
      })),
    ...parsed.warnings.map((_, index) => ({
      uploadIndex: uploadIndex(parsed.warningUploadIndexes?.[index]),
      category: "parse" as const,
      message: parseDiagnosticMessage(parsed.warnings[index]),
    })),
  ];

  return {
    reportVersion: 2,
    generatedAt,
    uploadManifest: (uploadPaths.length > 0 ? uploadPaths : parsed.uploadPaths ?? [])
      .map((path, uploadIndex) => ({ uploadIndex, path: safeImportSourcePath(path) }))
      .filter((entry): entry is { uploadIndex: number; path: string } => entry.path !== null),
    summary: {
      filesRead,
      mappedResources: mapped.length,
      couldNotMap: skipped.length,
      partiallyMappedFields: summary.unmappedArgCount,
      notes: notes.length,
    },
    outcomes: { mapped, skipped },
    notes,
  };
}