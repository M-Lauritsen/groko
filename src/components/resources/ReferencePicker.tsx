"use client";

import type {
  Environment,
  FieldDef,
  ReferenceValue,
  ResourceInstance,
} from "@/lib/schema/types";
import { isReferenceValue } from "@/lib/schema/types";
import { getResourceType } from "@/lib/schema/resources";
import {
  canReference,
  filterRefCandidates,
  scopeLabel,
} from "@/lib/schema/environments";
import { Label, Hint, SelectInput, Badge } from "@/components/ui/Field";

interface Props {
  field: FieldDef;
  value: unknown;
  resources: ResourceInstance[];
  currentId: string;
  activeEnvironmentId: string;
  environments: Environment[];
  onChange: (value: ReferenceValue | undefined) => void;
  onSelectResource?: (id: string) => void;
}

export function ReferencePicker({
  field,
  value,
  resources,
  currentId,
  activeEnvironmentId,
  environments,
  onChange,
  onSelectResource,
}: Props) {
  const refTypes = field.refTypes ?? [];
  const attr = field.refAttr ?? "id";
  const currentResource = resources.find((r) => r.id === currentId);
  const candidates = filterRefCandidates(resources, {
    currentId,
    refTypes,
    activeEnvironmentId,
    current: currentResource,
  });

  const current: ReferenceValue | undefined = isReferenceValue(value)
    ? value
    : undefined;

  const selected = current
    ? resources.find((r) => r.id === current.resourceId)
    : undefined;

  const illegalSelected =
    Boolean(selected) &&
    Boolean(currentResource) &&
    selected !== undefined &&
    currentResource !== undefined &&
    !canReference(currentResource, selected);

  return (
    <div>
      <Label required={field.required}>{field.label}</Label>
      {candidates.length === 0 ? (
        <div className="rounded-lg border border-dashed border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-200">
          No compatible resources in this environment. Add a{" "}
          <strong>
            {refTypes
              .map((t) => getResourceType(t)?.label ?? t)
              .join(" or ")}
          </strong>{" "}
          that is <em>Shared</em> or scoped to the same environment (cross-env
          refs are blocked).
        </div>
      ) : (
        <SelectInput
          value={current?.resourceId ?? ""}
          onChange={(e) => {
            const id = e.target.value;
            if (!id) {
              onChange(undefined);
              return;
            }
            onChange({ resourceId: id, attr });
          }}
        >
          <option value="">— Select {field.label.toLowerCase()} —</option>
          {candidates.map((r) => {
            const def = getResourceType(r.type);
            const nameHint =
              typeof r.values.name === "string" && r.values.name
                ? ` · ${r.values.name}`
                : "";
            return (
              <option key={r.id} value={r.id}>
                {def?.icon ?? ""} {def?.label ?? r.type}.{r.tfName}
                {nameHint}
                {r.useExisting ? " (existing)" : ""}
                {" · "}
                {scopeLabel(r.scope, environments)}
              </option>
            );
          })}
        </SelectInput>
      )}

      {illegalSelected && (
        <div className="mt-1.5 text-[11px] text-rose-600 dark:text-rose-400">
          Current reference targets another environment — pick a shared or
          same-env resource.
        </div>
      )}

      {selected && !illegalSelected && (
        <div className="mt-1.5 flex items-center gap-2 flex-wrap">
          <code className="text-[11px] font-mono text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/40 px-1.5 py-0.5 rounded">
            {selected.useExisting ? "data." : ""}
            {selected.type}.{selected.tfName}.{attr}
          </code>
          <Badge tone={selected.useExisting ? "amber" : "emerald"}>
            {selected.useExisting ? "data" : "resource"}
          </Badge>
          <Badge tone={selected.scope?.kind === "shared" ? "violet" : "sky"}>
            {scopeLabel(selected.scope, environments)}
          </Badge>
          {onSelectResource && (
            <button
              type="button"
              className="text-[11px] text-sky-600 hover:underline"
              onClick={() => onSelectResource(selected.id)}
            >
              Open →
            </button>
          )}
        </div>
      )}

      {field.description && <Hint>{field.description}</Hint>}
      <Hint>
        Accepts:{" "}
        {refTypes.map((t) => getResourceType(t)?.label ?? t).join(", ")} · emits
        .{attr} · shared + same-env only
      </Hint>
    </div>
  );
}
