import type { ResourceInstance, ReferenceValue } from "../schema/types";
import { isReferenceValue } from "../schema/types";
import { getResourceType } from "../schema/resources";

export interface DepEdge {
  fromId: string;
  toId: string;
  fieldKey: string;
  attr: string;
}

/** Collect all reference edges in the project. */
export function collectDeps(resources: ResourceInstance[]): DepEdge[] {
  const edges: DepEdge[] = [];
  for (const r of resources) {
    const def = getResourceType(r.type);
    if (!def) continue;
    for (const field of def.fields) {
      const val = r.values[field.key];
      if (isReferenceValue(val)) {
        edges.push({
          fromId: r.id,
          toId: (val as ReferenceValue).resourceId,
          fieldKey: field.key,
          attr: (val as ReferenceValue).attr,
        });
      }
    }
  }
  return edges;
}

/** Resources that this instance depends on. */
export function getDependencies(
  resourceId: string,
  resources: ResourceInstance[]
): ResourceInstance[] {
  const edges = collectDeps(resources).filter((e) => e.fromId === resourceId);
  return edges
    .map((e) => resources.find((r) => r.id === e.toId))
    .filter((r): r is ResourceInstance => !!r);
}

/** Resources that reference this instance. */
export function getUsedBy(
  resourceId: string,
  resources: ResourceInstance[]
): ResourceInstance[] {
  const edges = collectDeps(resources).filter((e) => e.toId === resourceId);
  return edges
    .map((e) => resources.find((r) => r.id === e.fromId))
    .filter((r): r is ResourceInstance => !!r);
}

export function formatResourceLabel(r: ResourceInstance): string {
  const def = getResourceType(r.type);
  return `${def?.label ?? r.type} (${r.tfName})`;
}
