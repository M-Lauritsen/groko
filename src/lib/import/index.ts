/**
 * Client-side Terraform import: parse HCL → ResourceInstance[].
 */

import JSZip from "jszip";
import { parseHclFiles, type ParseResult } from "./parse";
import {
  mapToProject,
  mergeImportedResources,
  type ImportSummary,
  type MappedItem,
  type SkippedItem,
} from "./mapToProject";
import {
  createImportDiagnosticReport,
  getImportSkipDiagnostic,
  IMPORT_DIAGNOSTIC_REPORT_FILE_NAME,
  safeImportSourcePath,
  type ImportDiagnosticReport,
  type ImportSkipDiagnostic,
  type ImportSkipReasonCode,
} from "./report";
import {
  findInvalidImportReferences,
  validateImportReference,
  type InvalidImportReference,
} from "./references";

export type {
  ImportDiagnosticReport,
  ImportSkipDiagnostic,
  ImportSkipReasonCode,
  ImportSummary,
  InvalidImportReference,
  MappedItem,
  SkippedItem,
  ParseResult,
};
export {
  createImportDiagnosticReport,
  getImportSkipDiagnostic,
  IMPORT_DIAGNOSTIC_REPORT_FILE_NAME,
  safeImportSourcePath,
  parseHclFiles,
  mapToProject,
  mergeImportedResources,
  findInvalidImportReferences,
  validateImportReference,
};
export { parseHcl } from "./parse";

const TF_EXT = /\.(tf|tfvars)$/i;

export type UploadedTerraformFile = { name: string; content: string };

export type RootTfvarsProfile = {
  path: string;
  label: string;
  rootOnly: true;
};

export type ImportUpload = {
  files: UploadedTerraformFile[];
  rootProfiles: RootTfvarsProfile[];
};

function profileLabel(path: string): string {
  return path.split("/").at(-1)?.replace(/\.tfvars$/i, "") ?? path;
}

// Whether a zip entry path looks like an uploaded Terraform source file we should read.
export function shouldExtractTfPath(path: string): boolean {
  const norm = path.replace(/\\/g, "/");
  if (norm.includes("__MACOSX/")) return false;
  if (!TF_EXT.test(norm)) return false;
  // Skip .terraform provider caches
  if (norm.includes("/.terraform/") || norm.startsWith(".terraform/")) return false;
  return true;
}

export async function readFilesFromUpload(
  fileList: FileList | File[]
): Promise<UploadedTerraformFile[]> {
  const files = Array.from(fileList);
  const out: UploadedTerraformFile[] = [];

  for (const file of files) {
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".zip")) {
      const buf = await file.arrayBuffer();
      const zip = await JSZip.loadAsync(buf);
      const entries = Object.keys(zip.files);
      for (const path of entries) {
        const entry = zip.files[path];
        if (entry.dir) continue;
        if (!shouldExtractTfPath(path)) continue;
        const content = await entry.async("string");
        out.push({ name: path, content });
      }
    } else if (TF_EXT.test(file.name)) {
      const content = await file.text();
      out.push({ name: file.name, content });
    }
  }

  return out;
}

/** Reads upload contents and exposes only safe root-level profile choices. */
export async function readImportUpload(
  fileList: FileList | File[]
): Promise<ImportUpload> {
  const files = await readFilesFromUpload(fileList);
  const parsed = parseHclFiles(files);
  const profiles = new Map<string, RootTfvarsProfile>();
  for (const block of parsed.blocks) {
    if (block.kind !== "other" || block.type !== "tfvars" || !block.sourceHint) continue;
    const path = safeImportSourcePath(block.sourceHint);
    if (!path) continue;
    profiles.set(path, { path, label: profileLabel(path), rootOnly: true });
  }
  return {
    files,
    rootProfiles: [...profiles.values()].sort((left, right) =>
      left.path.localeCompare(right.path)
    ),
  };
}

export function importFromUpload(
  upload: ImportUpload,
  selectedRootProfile?: string
): ImportSummary & { fileCount: number; parse: ParseResult } {
  const parse = parseHclFiles(upload.files, selectedRootProfile);
  const summary = mapToProject(parse);
  return {
    ...summary,
    mapped: summary.mapped.map((item) => ({
      ...item,
      sourcePath: safeImportSourcePath(item.sourceHint),
    })),
    skipped: summary.skipped.map((item) => ({
      ...item,
      sourcePath: safeImportSourcePath(item.sourceHint),
    })),
    fileCount: upload.files.length,
    parse,
  };
}

export async function importFromFiles(
  fileList: FileList | File[],
  selectedRootProfile?: string
): Promise<ImportSummary & { fileCount: number; parse: ParseResult }> {
  const upload = await readImportUpload(fileList);
  if (upload.files.length === 0) {
    return {
      resources: [],
      warnings: ["No .tf / .tfvars files found in the upload."],
      skipped: [],
      mapped: [],
      supportedCount: 0,
      unsupportedTypeCount: 0,
      unmappedArgCount: 0,
      fileCount: 0,
      parse: { blocks: [], warnings: [] },
    };
  }
  return importFromUpload(upload, selectedRootProfile);
}
