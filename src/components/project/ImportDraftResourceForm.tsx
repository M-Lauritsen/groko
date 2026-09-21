"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Environment, FieldDef, ResourceInstance } from "@/lib/schema/types";
import { isReferenceValue } from "@/lib/schema/types";
import { getResourceType } from "@/lib/schema/resources";
import { ReferencePicker } from "@/components/resources/ReferencePicker";
import { AppSecretsEditor, EnvVarsEditor } from "@/components/resources/ContainerAppExtras";
import { Button, Hint, Label, SelectInput, TextArea, TextInput } from "@/components/ui/Field";

function CollectionInput({
  field, value, onChange, id, errorId,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
  id: string;
  errorId?: string;
}) {
  const [text, setText] = useState(() => field.type === "list"
    ? (Array.isArray(value) ? value.join(", ") : "")
    : Object.entries(value && typeof value === "object" ? value : {})
      .map(([key, item]) => `${key}=${item}`).join("\n"));
  return (
    <TextArea
      id={id}
      rows={field.type === "list" ? 2 : 3}
      value={text}
      aria-invalid={Boolean(errorId)}
      aria-describedby={errorId}
      placeholder={field.type === "list" ? "item1, item2" : "Team=platform"}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        onChange(field.type === "list"
          ? next.split(",").map((item) => item.trim()).filter(Boolean)
          : Object.fromEntries(next.split("\n").flatMap((line) => {
            const separator = line.indexOf("=");
            const key = line.slice(0, separator).trim();
            return separator > 0 && key ? [[key, line.slice(separator + 1).trim()]] : [];
          })));
      }}
    />
  );
}

export function ImportDraftResourceForm({
  resource, resources, environments, activeEnvironmentId,
  missingFields, invalidReferences, invalidCompatibility, onChange, onClose,
}: {
  resource: ResourceInstance;
  resources: ResourceInstance[];
  environments: Environment[];
  activeEnvironmentId: string;
  missingFields: string[];
  invalidReferences: string[];
  invalidCompatibility: string[];
  onChange: (key: string, value: unknown) => void;
  onClose: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const formId = useId();
  const definition = getResourceType(resource.type);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  if (!definition) return null;
  const fields = definition.fields.filter((field) => !resource.useExisting || field.existingKey);
  return (
    <section
      id={`import-editor-${resource.id}`}
      aria-labelledby={`${formId}-heading`}
      className="min-w-0 border-y border-sky-200 dark:border-sky-800 py-4 space-y-4"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 ref={headingRef} id={`${formId}-heading`} tabIndex={-1} className="text-sm font-semibold break-words min-w-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
          Edit {definition.label}: {resource.tfName}
        </h3>
        <Button type="button" variant="secondary" size="sm" onClick={onClose}>Done</Button>
      </div>
      <div className="grid grid-cols-1 min-[540px]:grid-cols-2 gap-4">
        {fields.map((field) => {
          const value = resource.useExisting
            ? resource.existingValues[field.key] ?? resource.values[field.key]
            : resource.values[field.key];
          const id = `${formId}-${field.key}`;
          const compatibilityError = invalidCompatibility.length > 0 && (
            (resource.type === "azurerm_private_endpoint" && ["private_connection_resource_id", "subresource_names"].includes(field.key)) ||
            (resource.type === "azurerm_role_assignment" && ["scope", "role_definition_name"].includes(field.key))
          );
          const error = invalidReferences.includes(field.label)
            ? "Choose a compatible selected resource in Shared or the same environment."
            : compatibilityError
              ? "The selected resource and this option are incompatible. Change either selection."
              : missingFields.includes(field.label) ? `${field.label} is required.` : undefined;
          const errorId = error ? `${id}-error` : undefined;
          const change = (next: unknown) => onChange(field.key, next);
          const reference = field.type === "reference" || isReferenceValue(value);
          return (
            <div key={field.key} className={`min-w-0 ${["tags", "env_list", "secret_list"].includes(field.type) ? "min-[540px]:col-span-2" : ""}`}>
              {reference && (!resource.useExisting || isReferenceValue(value)) ? (
                <>
                  <ReferencePicker
                    field={{
                      ...field,
                      required: resource.useExisting || field.required,
                      refAttr: field.refAttr ?? (isReferenceValue(value) ? value.attr : "id"),
                      refTypes: field.refTypes ?? resources.filter((candidate) =>
                        isReferenceValue(value) && getResourceType(candidate.type)?.outputs.includes(value.attr)
                      ).map((candidate) => candidate.type),
                    }}
                    value={value}
                    resources={resources}
                    currentId={resource.id}
                    activeEnvironmentId={activeEnvironmentId}
                    environments={environments}
                    onChange={change}
                    errorId={errorId}
                    domainOnly
                  />
                  {resource.useExisting && <Button type="button" size="sm" variant="ghost" onClick={() => change("")}>Enter lookup value</Button>}
                </>
              ) : (
                <>
                  {(resource.useExisting || !["env_list", "secret_list"].includes(field.type)) && <Label htmlFor={id} required={resource.useExisting || field.required}>{field.label}</Label>}
                  {!resource.useExisting && field.type === "boolean" ? (
                    <input id={id} type="checkbox" checked={Boolean(value)} onChange={(event) => change(event.target.checked)} aria-invalid={Boolean(error)} aria-describedby={errorId} className="h-4 w-4 accent-sky-600" />
                  ) : !resource.useExisting && field.type === "select" ? (
                    <SelectInput id={id} value={String(value ?? "")} onChange={(event) => change(event.target.value)} aria-invalid={Boolean(error)} aria-describedby={errorId}>
                      <option value="">Select {field.label.toLowerCase()}</option>
                      {value && !field.options?.some((option) => option.value === value) ? <option value={String(value)}>{String(value)} (imported)</option> : null}
                      {field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </SelectInput>
                  ) : !resource.useExisting && (field.type === "list" || field.type === "tags") ? (
                    <CollectionInput field={field} value={value} onChange={change} id={id} errorId={errorId} />
                  ) : !resource.useExisting && field.type === "env_list" ? (
                    <EnvVarsEditor value={value} onChange={change} />
                  ) : !resource.useExisting && field.type === "secret_list" ? (
                    <AppSecretsEditor value={value} onChange={change} resources={resources} currentId={resource.id} errorId={errorId} />
                  ) : (
                    <TextInput
                      id={id}
                      type={!resource.useExisting && field.type === "sensitive" ? "password" : !resource.useExisting && field.type === "number" ? "number" : "text"}
                      step={field.type === "number" ? "any" : undefined}
                      autoComplete="off"
                      value={String(value ?? "")}
                      placeholder={field.placeholder}
                      aria-invalid={Boolean(error)}
                      aria-describedby={errorId}
                      onChange={(event) => change(!resource.useExisting && field.type === "number" && event.target.value !== "" ? Number(event.target.value) : event.target.value)}
                    />
                  )}
                  {resource.useExisting && field.type === "reference" && <Button type="button" size="sm" variant="ghost" onClick={() => change({ resourceId: "", attr: field.refAttr ?? "id" })}>Choose draft resource</Button>}
                  {field.description && <Hint>{field.description}</Hint>}
                </>
              )}
              {error && <p id={errorId} className="mt-1 text-xs text-rose-700 dark:text-rose-300">{error}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}