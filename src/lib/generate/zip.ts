import JSZip from "jszip";
import { saveAs } from "file-saver";
import type {
  Environment,
  ExportConfig,
  ProjectConfig,
  ResourceInstance,
} from "../schema/types";
import { generateProject } from "./hcl";

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

export async function downloadProjectZip(
  config: ProjectConfig,
  resources: ResourceInstance[],
  environments?: Environment[],
  exportConfig?: ExportConfig | null
): Promise<void> {
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
  exportConfig?: ExportConfig | null
): Promise<Buffer> {
  const { files } = generateProject(config, resources, environments, exportConfig);
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) {
    zip.file(name, content);
  }
  zip.file(".gitignore", GITIGNORE);
  return zip.generateAsync({ type: "nodebuffer" });
}
