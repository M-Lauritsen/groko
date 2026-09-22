import JSZip from "jszip";
import { saveAs } from "file-saver";
import type {
  Environment,
  ExportConfig,
  ProjectConfig,
  ResourceInstance,
} from "../schema/types";
import { generateProject } from "./hcl";
import { assertExportableExistingIdentifiers } from "./existing-identifiers";
import { canDownloadWithMap } from "./export-map";

const GITIGNORE = `# Terraform
.terraform/
*.tfstate
*.tfstate.*
crash.log
crash.*.log
*.tfvars
!environments/*.tfvars
!environments/*.hcl
override.tf
override.tf.json
*_override.tf
*_override.tf.json
.terraformrc
terraform.rc
`;

/** Explicit user decision required when an export map omits resources. */
export interface ZipExportOptions {
  leaveUnmappedConfirmed?: boolean;
}

/** Raised at ZIP API boundaries rather than silently dropping unmapped resources. */
export class OrphanConfirmationRequiredError extends Error {
  readonly code = "orphan-confirmation-required" as const;
  readonly orphans: ResourceInstance[];

  constructor(orphans: ResourceInstance[]) {
    super(
      "Export cannot continue until unmapped resources are explicitly confirmed for exclusion."
    );
    this.name = "OrphanConfirmationRequiredError";
    this.orphans = orphans;
  }
}

function assertZipExportAllowed(
  resources: ResourceInstance[],
  exportConfig: ExportConfig | null | undefined,
  options?: ZipExportOptions
): void {
  // Preserve the Existing identifier failure for resources that are included.
  assertExportableExistingIdentifiers(resources, exportConfig);
  const gate = canDownloadWithMap(resources, exportConfig, {
    mapMode: false,
    leaveUnmappedConfirmed: options?.leaveUnmappedConfirmed,
  });
  if (!gate.ok) throw new OrphanConfirmationRequiredError(gate.orphans);
}

export async function downloadProjectZip(
  config: ProjectConfig,
  resources: ResourceInstance[],
  environments?: Environment[],
  exportConfig?: ExportConfig | null,
  options?: ZipExportOptions
): Promise<void> {
  assertZipExportAllowed(resources, exportConfig, options);
  const { files } = generateProject(config, resources, environments, exportConfig);
  const zip = new JSZip();
  const folder = zip.folder(sanitizeFolderName(config.name)) ?? zip;

  for (const [name, content] of Object.entries(files)) {
    folder.file(name, content);
  }
  folder.file(".gitignore", GITIGNORE);

  const blob = await zip.generateAsync({ type: "blob" });
  const filename = `${sanitizeFolderName(config.name) || "azure-tf"}-terraform.zip`;
  saveAs(blob, filename);
}

function sanitizeFolderName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** Node-friendly: return zip as Buffer (for tests). */
export async function buildProjectZipBuffer(
  config: ProjectConfig,
  resources: ResourceInstance[],
  environments?: Environment[],
  exportConfig?: ExportConfig | null,
  options?: ZipExportOptions
): Promise<Buffer> {
  assertZipExportAllowed(resources, exportConfig, options);
  const { files } = generateProject(config, resources, environments, exportConfig);
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) {
    zip.file(name, content);
  }
  zip.file(".gitignore", GITIGNORE);
  return zip.generateAsync({ type: "nodebuffer" });
}
