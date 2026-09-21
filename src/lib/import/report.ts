import { getResourceType } from "../schema/resources";
import type { ImportSummary, MappedItem, SkippedItem } from "./mapToProject";
import type { ParseResult } from "./parse";

export const IMPORT_DIAGNOSTIC_REPORT_FILE_NAME = "groko-import-report.json";

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

function skippedReason(item: SkippedItem): { reasonCode: string; reason: string } {
  if (item.kind === "module") {
    if (item.reason.includes("remote")) {
      return { reasonCode: "module_source_remote", reason: item.reason };
    }
    if (item.reason.includes("not found")) {
      return { reasonCode: "local_module_unavailable", reason: item.reason };
    }
    if (item.reason.includes("static local path")) {
      return { reasonCode: "module_source_dynamic", reason: item.reason };
    }
    if (item.reason.includes("for_each") || item.reason.includes("count")) {
      return { reasonCode: "module_instance_not_supported", reason: item.reason };
    }
    return { reasonCode: "module_not_supported", reason: item.reason };
  }
  if (item.reason.includes("Unresolved module output")) {
    return { reasonCode: "module_output_unresolved", reason: item.reason };
  }
  if (item.reason.includes("Non-azurerm")) {
    return { reasonCode: "provider_not_supported", reason: item.reason };
  }
  if (item.reason.includes("RESOURCE_CATALOGUE")) {
    return { reasonCode: "resource_type_not_supported", reason: item.reason };
  }
  if (item.reason.includes("for_each")) {
    return { reasonCode: "for_each_not_supported", reason: item.reason };
  }
  if (item.reason.includes("count")) {
    return { reasonCode: "count_not_supported", reason: item.reason };
  }
  return { reasonCode: "not_supported", reason: item.reason };
}

function sourcePath(path: string | undefined): string | null {
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
    sourcePath: sourcePath(item.sourceHint),
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
    sourcePath: sourcePath(item.sourceHint),
    kind: item.kind,
    sourceType: item.type,
    sourceName: item.name,
    ...skippedReason(item),
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
      .map((path, uploadIndex) => ({ uploadIndex, path: sourcePath(path) }))
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