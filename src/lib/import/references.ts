import { getResourceType } from "../schema/resources";
import { canReference } from "../schema/environments";
import { isReferenceValue, type FieldDef, type ReferenceValue, type ResourceInstance } from "../schema/types";

export interface InvalidImportReference {
  resourceId: string;
  fieldKey: string;
  reference: ReferenceValue;
  reason: string;
}

/** Validates the domain contract for one reference value. */
export function validateImportReference(
  source: ResourceInstance,
  field: FieldDef | undefined,
  reference: ReferenceValue,
  resources: ResourceInstance[]
): string | null {
  if (!field || field.type !== "reference") {
    return "the receiving field does not accept references";
  }
  const target = resources.find((resource) => resource.id === reference.resourceId);
  if (!target) return "the target is not in the imported resources";
  if (!field.refTypes?.includes(target.type)) {
    return `target type ${target.type} is not allowed`;
  }
  if (field.refAttr && reference.attr !== field.refAttr) {
    return `attribute ${reference.attr} is not allowed; expected ${field.refAttr}`;
  }
  if (!getResourceType(target.type)?.outputs.includes(reference.attr)) {
    return `target does not expose attribute ${reference.attr}`;
  }
  if (!canReference(source, target)) {
    return "target is outside the allowed scope";
  }
  return null;
}

/** Finds references invalidated by edits such as a later scope change. */
export function findInvalidImportReferences(
  resources: ResourceInstance[]
): InvalidImportReference[] {
  const invalid: InvalidImportReference[] = [];
  for (const resource of resources) {
    const fields = getResourceType(resource.type)?.fields ?? [];
    for (const [fieldKey, value] of Object.entries(resource.values)) {
      if (!isReferenceValue(value)) continue;
      const reason = validateImportReference(
        resource,
        fields.find((field) => field.key === fieldKey),
        value,
        resources
      );
      if (reason) {
        invalid.push({ resourceId: resource.id, fieldKey, reference: value, reason });
      }
    }
  }
  return invalid;
}