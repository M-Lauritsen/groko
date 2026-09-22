import { getResourceType } from "../schema/resources";
import { canReference } from "../schema/environments";
import {
  isReferenceValue,
  type ResourceInstance,
} from "../schema/types";

function hasOwn(object: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isSnapshotIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Produces a stable Existing identifier from one field's current value.
 *
 * References are deliberately resolved at most one hop: a direct target's
 * saved Existing value wins, then its literal value. A target Ref is not
 * followed, so a snapshot can never conceal a mutable reference chain.
 */
export function deriveExistingSnapshot(
  resource: ResourceInstance,
  key: string,
  resources: ResourceInstance[]
): string | undefined {
  const source = resource.values[key];
  if (typeof source === "string") {
    return isSnapshotIdentifier(source) ? source : undefined;
  }
  return resolveExistingSnapshotReference(resource, key, resources)?.value;
}

export interface ExistingSnapshotReference {
  source: ResourceInstance;
  value: string;
}

/**
 * Resolves a field's current direct Resource reference for a user-requested
 * snapshot refresh. The source is returned so callers can describe exactly
 * which Resource supplied the value without reimplementing the safety rule.
 */
export function resolveExistingSnapshotReference(
  resource: ResourceInstance,
  key: string,
  resources: ResourceInstance[]
): ExistingSnapshotReference | undefined {
  const source = resource.values[key];
  if (!isReferenceValue(source)) return undefined;

  const target = resources.find((candidate) => candidate.id === source.resourceId);
  if (!target || !canReference(resource, target)) return undefined;

  const existing = target.existingValues?.[source.attr];
  if (isSnapshotIdentifier(existing)) {
    return { source: target, value: existing };
  }

  const literal = target.values[source.attr];
  return isSnapshotIdentifier(literal)
    ? { source: target, value: literal }
    : undefined;
}

/** Clears one snapshot to an intentional present-empty value. */
export function clearExistingSnapshot(
  resource: ResourceInstance,
  key: string
): ResourceInstance {
  return {
    ...resource,
    existingValues: { ...resource.existingValues, [key]: "" },
  };
}

/** Refreshes one snapshot only when its current direct Resource Ref is safe. */
export function refreshExistingSnapshot(
  resource: ResourceInstance,
  key: string,
  resources: ResourceInstance[]
): ResourceInstance {
  const resolved = resolveExistingSnapshotReference(resource, key, resources);
  return resolved
    ? {
        ...resource,
        existingValues: { ...resource.existingValues, [key]: resolved.value },
      }
    : resource;
}

/** Adds only absent existingKey snapshots; explicit, including empty, wins. */
export function withDerivedExistingSnapshots(
  resource: ResourceInstance,
  resources: ResourceInstance[]
): ResourceInstance {
  const definition = getResourceType(resource.type);
  if (!definition) return resource;

  const existingValues = resource.existingValues ?? {};
  let snapshots: Record<string, unknown> | undefined;
  for (const field of definition.fields) {
    if (!field.existingKey || hasOwn(existingValues, field.key)) continue;
    const value = deriveExistingSnapshot(resource, field.key, resources);
    if (value === undefined) continue;
    snapshots ??= { ...existingValues };
    snapshots[field.key] = value;
  }

  return snapshots ? { ...resource, existingValues: snapshots } : resource;
}

/** Repairs version-1 Existing Resource snapshots without changing file metadata. */
export function repairExistingSnapshots(
  resources: ResourceInstance[]
): ResourceInstance[] {
  return resources.map((resource) =>
    resource.useExisting
      ? withDerivedExistingSnapshots(resource, resources)
      : resource
  );
}
