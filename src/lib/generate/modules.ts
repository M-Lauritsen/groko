import type {
  ProjectConfig,
  ResourceInstance,
  ReferenceValue,
} from "../schema/types";
import { isReferenceValue } from "../schema/types";
import { getResourceType } from "../schema/resources";

/** Module grouping for generated Terraform layout. */
export interface ModuleDef {
  id: string;
  label: string;
  types: string[];
}

/**
 * Stable human-readable build order for generated resource blocks.
 * Terraform still schedules resources from references between them.
 */
export const RESOURCE_TYPE_ORDER = [
  "azurerm_resource_group",
  "azurerm_virtual_network",
  "azurerm_subnet",
  "azurerm_network_security_group",
  "azurerm_subnet_network_security_group_association",
  "azurerm_public_ip",
  "azurerm_network_interface",
  "azurerm_storage_account",
  "azurerm_key_vault",
  "azurerm_service_plan",
  "azurerm_log_analytics_workspace",
  "azurerm_application_insights",
  "azurerm_container_registry",
  "azurerm_user_assigned_identity",
  "azurerm_role_assignment",
  "azurerm_linux_virtual_machine",
  "azurerm_linux_web_app",
  "azurerm_linux_function_app",
  "azurerm_mssql_server",
  "azurerm_mssql_database",
  "azurerm_container_app_environment",
  "azurerm_container_app",
  "azurerm_private_dns_zone",
  "azurerm_private_dns_zone_virtual_network_link",
  "azurerm_private_endpoint",
] as const;

export interface ResourceBuildStage {
  id: string;
  label: string;
  types: readonly string[];
}

export const RESOURCE_BUILD_STAGES: readonly ResourceBuildStage[] = [
  {
    id: "foundation",
    label: "Resource Group & foundation",
    types: ["azurerm_resource_group"],
  },
  {
    id: "networking",
    label: "Networking",
    types: [
      "azurerm_virtual_network",
      "azurerm_subnet",
      "azurerm_network_security_group",
      "azurerm_subnet_network_security_group_association",
      "azurerm_public_ip",
      "azurerm_network_interface",
    ],
  },
  {
    id: "platform-prerequisites",
    label: "Storage, security & platform prerequisites",
    types: [
      "azurerm_storage_account",
      "azurerm_key_vault",
      "azurerm_service_plan",
      "azurerm_log_analytics_workspace",
      "azurerm_application_insights",
      "azurerm_container_registry",
    ],
  },
  {
    id: "identity",
    label: "Identity & RBAC",
    types: ["azurerm_user_assigned_identity", "azurerm_role_assignment"],
  },
  {
    id: "workloads",
    label: "Workloads",
    types: [
      "azurerm_linux_virtual_machine",
      "azurerm_linux_web_app",
      "azurerm_linux_function_app",
      "azurerm_mssql_server",
      "azurerm_mssql_database",
      "azurerm_container_app_environment",
      "azurerm_container_app",
    ],
  },
  {
    id: "private-networking",
    label: "Private networking integrations",
    types: [
      "azurerm_private_dns_zone",
      "azurerm_private_dns_zone_virtual_network_link",
      "azurerm_private_endpoint",
    ],
  },
];

const resourceTypeOrder = new Map<string, number>(
  RESOURCE_TYPE_ORDER.map((type, index) => [type, index])
);

export function resourceTypeBuildOrder(type: string): number {
  return resourceTypeOrder.get(type) ?? Number.MAX_SAFE_INTEGER;
}

export function resourceBuildStageForType(
  type: string
): ResourceBuildStage | undefined {
  return RESOURCE_BUILD_STAGES.find((stage) => stage.types.includes(type));
}

export function sortResourcesByBuildOrder(
  resources: ResourceInstance[]
): ResourceInstance[] {
  return [...resources].sort((a, b) => {
    const ai = resourceTypeBuildOrder(a.type);
    const bi = resourceTypeBuildOrder(b.type);
    if (ai !== bi) return ai - bi;
    return a.tfName.localeCompare(b.tfName);
  });
}

export const MODULE_DEFS: ModuleDef[] = [
  {
    id: "resource_group",
    label: "Resource Group",
    types: ["azurerm_resource_group"],
  },
  {
    id: "networking",
    label: "Networking",
    types: [
      "azurerm_virtual_network",
      "azurerm_subnet",
      "azurerm_network_security_group",
      "azurerm_subnet_network_security_group_association",
      "azurerm_public_ip",
      "azurerm_network_interface",
    ],
  },
  {
    id: "compute",
    label: "Compute",
    types: ["azurerm_linux_virtual_machine"],
  },
  {
    id: "storage",
    label: "Storage",
    types: ["azurerm_storage_account"],
  },
  {
    id: "security",
    label: "Security",
    types: ["azurerm_key_vault"],
  },
  {
    id: "app_service",
    label: "App Service",
    types: [
      "azurerm_service_plan",
      "azurerm_linux_web_app",
      "azurerm_linux_function_app",
      "azurerm_application_insights",
    ],
  },
  {
    id: "database",
    label: "Database",
    types: ["azurerm_mssql_server", "azurerm_mssql_database"],
  },
  {
    id: "container_registry",
    label: "Container Registry",
    types: ["azurerm_container_registry"],
  },
  {
    id: "private_networking",
    label: "Private Networking",
    types: [
      "azurerm_private_dns_zone",
      "azurerm_private_dns_zone_virtual_network_link",
      "azurerm_private_endpoint",
    ],
  },
  {
    id: "identity",
    label: "Identity & RBAC",
    types: ["azurerm_user_assigned_identity", "azurerm_role_assignment"],
  },
  {
    id: "container_apps",
    label: "Container Apps",
    types: [
      "azurerm_log_analytics_workspace",
      "azurerm_container_app_environment",
      "azurerm_container_app",
    ],
  },
];

export function moduleIdForType(type: string): string | null {
  for (const m of MODULE_DEFS) {
    if (m.types.includes(type)) return m.id;
  }
  return null;
}

export function partitionByModule(
  resources: ResourceInstance[]
): Map<string, ResourceInstance[]> {
  const map = new Map<string, ResourceInstance[]>();
  for (const r of resources) {
    const mid = moduleIdForType(r.type) ?? "other";
    const list = map.get(mid) ?? [];
    list.push(r);
    map.set(mid, list);
  }
  return map;
}

/** Stable input/output token for a resource attribute across modules. */
export function ioToken(r: ResourceInstance, attr: string): string {
  const short = r.type.replace("azurerm_", "");
  return `${short}_${r.tfName}_${attr}`.replace(/[^a-zA-Z0-9_]/g, "_");
}

export function outputName(r: ResourceInstance, attr: string): string {
  return ioToken(r, attr);
}

export interface CrossModuleInput {
  varName: string;
  fromModuleId: string;
  fromResource: ResourceInstance;
  attr: string;
}

export interface ModularRefContext {
  currentModuleId: string;
  moduleOf: Map<string, string>; // resourceId -> moduleId
  /** Mutated while emitting: inputs this module needs from others */
  inputs: Map<string, CrossModuleInput>;
}

export function createModuleOfMap(
  resources: ResourceInstance[]
): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of resources) {
    m.set(r.id, moduleIdForType(r.type) ?? "other");
  }
  return m;
}

export function localAddress(
  r: ResourceInstance,
  attr: string
): string {
  const prefix = r.useExisting
    ? `data.${r.type}.${r.tfName}`
    : `${r.type}.${r.tfName}`;
  return `${prefix}.${attr}`;
}

export function resolveModularRef(
  ref: { resourceId: string; attr: string },
  resources: ResourceInstance[],
  ctx: ModularRefContext
): string {
  const target = resources.find((r) => r.id === ref.resourceId);
  if (!target) return `"UNRESOLVED_REF"`;
  const targetMod = ctx.moduleOf.get(target.id) ?? "other";
  if (targetMod === ctx.currentModuleId) {
    return localAddress(target, ref.attr);
  }
  const varName = `in_${ioToken(target, ref.attr)}`;
  if (!ctx.inputs.has(varName)) {
    ctx.inputs.set(varName, {
      varName,
      fromModuleId: targetMod,
      fromResource: target,
      attr: ref.attr,
    });
  }
  return `var.${varName}`;
}

/** Collect every reference edge from resources in a module. */
export function collectRefsFromResources(
  moduleResources: ResourceInstance[]
): ReferenceValue[] {
  const refs: ReferenceValue[] = [];
  for (const r of moduleResources) {
    const def = getResourceType(r.type);
    if (!def) continue;
    for (const field of def.fields) {
      const val = r.values[field.key];
      if (isReferenceValue(val)) refs.push(val);
      if (field.key === "app_secrets" && Array.isArray(val)) {
        for (const item of val) {
          if (
            item &&
            typeof item === "object" &&
            isReferenceValue((item as Record<string, unknown>).key_vault_id)
          ) {
            refs.push(
              (item as Record<string, unknown>).key_vault_id as ReferenceValue
            );
          }
        }
      }
    }
  }
  return refs;
}

export function moduleOrder(moduleIds: string[]): string[] {
  const order = MODULE_DEFS.map((module) => {
    const firstType = module.types.reduce(
      (first, type) =>
        Math.min(first, resourceTypeOrder.get(type) ?? Number.MAX_SAFE_INTEGER),
      Number.MAX_SAFE_INTEGER
    );
    return { id: module.id, order: firstType };
  });
  return [...moduleIds].sort((a, b) => {
    const ai =
      order.find((item) => item.id === a)?.order ?? Number.MAX_SAFE_INTEGER;
    const bi =
      order.find((item) => item.id === b)?.order ?? Number.MAX_SAFE_INTEGER;
    return ai - bi || a.localeCompare(b);
  });
}

export function envTags(
  config: ProjectConfig,
  envId: string,
  envTagsOverride?: Record<string, string>
): Record<string, string> {
  return {
    ...config.tags,
    Environment: envId,
    ...(envTagsOverride ?? {}),
  };
}
