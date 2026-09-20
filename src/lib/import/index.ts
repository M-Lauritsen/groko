/**
 * Client-side Terraform import: parse HCL → ResourceInstance[].
 */

import JSZip from "jszip";
import { parseHclFiles, type ParseResult } from "./parse";
import {
  mapToProject,
  mergeImportedResources,
  type ImportSummary,
  type SkippedItem,
} from "./mapToProject";

export type { ImportSummary, SkippedItem, ParseResult };
export { parseHclFiles, mapToProject, mergeImportedResources };
export { parseHcl } from "./parse";

const TF_EXT = /\.(tf|tfvars)$/i;

// Whether a zip entry path looks like a root or modules/<name>/main.tf we should read.
export function shouldExtractTfPath(path: string): boolean {
  const norm = path.replace(/\\/g, "/");
  if (norm.includes("__MACOSX/") || norm.startsWith(".")) return false;
  if (!TF_EXT.test(norm)) return false;
  // Skip .terraform provider caches
  if (norm.includes("/.terraform/") || norm.startsWith(".terraform/")) return false;
  const parts = norm.split("/").filter(Boolean);
  // Prefer root *.tf and modules/<name>/main.tf (optional flatten)
  const file = parts[parts.length - 1];
  if (parts.includes("modules")) {
    // modules/<name>/main.tf only
    const mi = parts.indexOf("modules");
    return parts.length === mi + 3 && file === "main.tf";
  }
  // Any depth of non-module .tf — but skip nested examples noise beyond 3 levels
  if (parts.length > 4) return false;
  return true;
}

export async function readFilesFromUpload(
  fileList: FileList | File[]
): Promise<{ name: string; content: string }[]> {
  const files = Array.from(fileList);
  const out: { name: string; content: string }[] = [];

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

export async function importFromFiles(
  fileList: FileList | File[]
): Promise<ImportSummary & { fileCount: number; parse: ParseResult }> {
  const files = await readFilesFromUpload(fileList);
  if (files.length === 0) {
    return {
      resources: [],
      warnings: ["No .tf / .tfvars files found in the upload."],
      skipped: [],
      supportedCount: 0,
      unsupportedTypeCount: 0,
      unmappedArgCount: 0,
      fileCount: 0,
      parse: { blocks: [], warnings: [] },
    };
  }
  const parse = parseHclFiles(files);
  const summary = mapToProject(parse);
  return { ...summary, fileCount: files.length, parse };
}
