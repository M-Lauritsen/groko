/** Field kinds supported by resource forms and HCL emission. */
export type FieldType =
  | "string"
  | "number"
  | "boolean"
  | "select"
  | "tags"
  | "list"
  | "reference"
  | "sensitive"
  | "env_list"
  | "secret_list";

export type ReferenceAttr = "id" | "name" | "location" | "resource_group_name" | "login_server" | "admin_username" | "principal_id" | "vault_uri";

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  description?: string;
  required?: boolean;
  defaultValue?: unknown;
  advanced?: boolean;
  /** For select fields */
  options?: FieldOption[];
  /** For reference fields: which resource types can be picked */
  refTypes?: string[];
  /** Attribute to emit from the referenced resource (default: id) */
  refAttr?: ReferenceAttr;
  /** When "use existing", collect this identifying value */
  existingKey?: boolean;
  /** Map to HCL argument name (defaults to key) */
  hclKey?: string;
  placeholder?: string;
}

export interface ResourceTypeDef {
  type: string;
  label: string;
  category: string;
  description: string;
  icon: string;
  /** Data source type when "use existing" is checked (defaults to same type) */
  dataSourceType?: string;
  fields: FieldDef[];
  /** Attributes this resource exposes for references */
  outputs: ReferenceAttr[];
  /** Suggested default instance name */
  defaultName: string;
  /** When true, catalogue add defaults Use existing on (e.g. shared hub Private DNS). */
  preferUseExisting?: boolean;
}

/** Per-environment sizing / naming knobs (drive environments/*.tfvars). */
export interface EnvironmentKnobs {
  /** Appended to project namingPrefix in tfvars (e.g. "-dev", "-stg", "-prd"). */
  namingSuffix: string;
  /** Tags merged into var.tags (typically Environment=…). */
  tags: Record<string, string>;
  acrSku: string;
  caCpu: number;
  caMemory: string;
  caMinReplicas: number;
  caMaxReplicas: number;
  caIngressExternal: boolean;
}

/** First-class deploy environment (dev / staging / prod / custom). */
export interface Environment {
  id: string;
  displayName: string;
  knobs: EnvironmentKnobs;
}

/** Resource visibility: shared across all envs, or scoped to one environment. */
export type ResourceScope =
  | { kind: "shared" }
  | { kind: "environment"; environmentId: string };

export interface ResourceInstance {
  id: string;
  type: string;
  /** Terraform local name, e.g. "main" or "web" */
  tfName: string;
  useExisting: boolean;
  values: Record<string, unknown>;
  /** Identifying values when useExisting */
  existingValues: Record<string, unknown>;
  /** Shared across envs, or visible only in one environment */
  scope: ResourceScope;
}

export interface ProjectConfig {
  name: string;
  location: string;
  namingPrefix: string;
  tags: Record<string, string>;
  starter: string;
}

export interface ProjectState {
  config: ProjectConfig;
  /** First-class environments (drive tfvars / backend hcl keys). */
  environments: Environment[];
  /** Active environment for UI filtering (not an undo concern by itself). */
  activeEnvironmentId: string;
  resources: ResourceInstance[];
  selectedResourceId: string | null;
}

export interface ReferenceValue {
  resourceId: string;
  attr: ReferenceAttr;
}

export function isReferenceValue(v: unknown): v is ReferenceValue {
  return (
    typeof v === "object" &&
    v !== null &&
    "resourceId" in v &&
    "attr" in v &&
    typeof (v as ReferenceValue).resourceId === "string"
  );
}


/** Container App environment variable row. */
export interface ContainerEnvVar {
  name: string;
  value?: string;
  secret_name?: string;
}

/** Container App secret: plain value (sensitive var) or Key Vault reference. */
export interface ContainerAppSecret {
  name: string;
  source: "value" | "key_vault";
  value?: string;
  key_vault_id?: ReferenceValue;
  /** Key Vault secret name (not the Container App secret name). */
  secret_name?: string;
}

export const AZURE_LOCATIONS: FieldOption[] = [
  { value: "westeurope", label: "West Europe" },
  { value: "northeurope", label: "North Europe" },
  { value: "eastus", label: "East US" },
  { value: "eastus2", label: "East US 2" },
  { value: "westus2", label: "West US 2" },
  { value: "uksouth", label: "UK South" },
  { value: "australiaeast", label: "Australia East" },
  { value: "southeastasia", label: "Southeast Asia" },
];

export const TERRAFORM_VERSION = ">= 1.5.0, < 2.0.0";
export const AZURERM_VERSION = "~> 4.0";
