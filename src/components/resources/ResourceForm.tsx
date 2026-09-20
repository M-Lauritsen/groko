"use client";

import { useState } from "react";
import { useProject } from "@/lib/store/project-context";
import { getResourceType } from "@/lib/schema/resources";
import {
  getDependencies,
  getUsedBy,
  formatResourceLabel,
} from "@/lib/generate/deps";
import type { FieldDef, ReferenceValue } from "@/lib/schema/types";
import { envScope, sharedScope } from "@/lib/schema/environments";
import { ReferencePicker } from "./ReferencePicker";
import { EnvVarsEditor, AppSecretsEditor } from "./ContainerAppExtras";
import {
  Card,
  SectionTitle,
  Label,
  TextInput,
  SelectInput,
  Checkbox,
  Hint,
  Button,
  Badge,
} from "@/components/ui/Field";

export function ResourceForm() {
  const {
    state,
    updateResource,
    updateResourceValue,
    updateExistingValue,
    setResourceScope,
    selectResource,
    removeResource,
  } = useProject();
  const [showAdvanced, setShowAdvanced] = useState(false);

  const resource = state.resources.find(
    (r) => r.id === state.selectedResourceId
  );

  if (!resource) {
    return (
      <Card className="p-8 flex items-center justify-center h-full min-h-[280px]">
        <div className="text-center max-w-sm">
          <div className="text-3xl mb-3" aria-hidden>
            ✏️
          </div>
          <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-1">
            Select a resource
          </h3>
          <p className="text-sm text-slate-500">
            Choose one from the project list, or add from the catalogue. Use
            reference pickers to wire dependencies between resources.
          </p>
        </div>
      </Card>
    );
  }

  const def = getResourceType(resource.type);
  if (!def) {
    return <Card className="p-4">Unknown resource type</Card>;
  }

  const deps = getDependencies(resource.id, state.resources);
  const usedBy = getUsedBy(resource.id, state.resources);
  const basicFields = def.fields.filter((f) => !f.advanced);
  const advancedFields = def.fields.filter((f) => f.advanced);
  const existingFields = def.fields.filter((f) => f.existingKey);

  function renderField(field: FieldDef) {
    if (resource!.useExisting && !field.existingKey) {
      // Still show references? No — when existing, only identifying fields
      return null;
    }

    if (resource!.useExisting && field.existingKey) {
      return (
        <div key={field.key}>
          <Label htmlFor={`ex-${field.key}`} required={field.required}>
            {field.label}{" "}
            <Badge tone="amber">existing</Badge>
          </Label>
          <TextInput
            id={`ex-${field.key}`}
            value={String(
              resource!.existingValues[field.key] ??
                (typeof resource!.values[field.key] === "string"
                  ? resource!.values[field.key]
                  : "") ??
                ""
            )}
            onChange={(e) =>
              updateExistingValue(resource!.id, field.key, e.target.value)
            }
            placeholder={field.placeholder}
          />
          <Hint>
            Identifying value for{" "}
            <code>data.{resource!.type}.{resource!.tfName}</code>
          </Hint>
        </div>
      );
    }

    if (field.type === "reference") {
      return (
        <ReferencePicker
          key={field.key}
          field={field}
          value={resource!.values[field.key]}
          resources={state.resources}
          currentId={resource!.id}
          activeEnvironmentId={state.activeEnvironmentId}
          environments={state.environments}
          onChange={(v: ReferenceValue | undefined) =>
            updateResourceValue(resource!.id, field.key, v)
          }
          onSelectResource={selectResource}
        />
      );
    }

    if (field.type === "boolean") {
      return (
        <div key={field.key}>
          <Checkbox
            checked={Boolean(resource!.values[field.key])}
            onChange={(v) => updateResourceValue(resource!.id, field.key, v)}
            label={field.label}
            description={field.description}
          />
        </div>
      );
    }

    if (field.type === "select") {
      return (
        <div key={field.key}>
          <Label htmlFor={field.key} required={field.required}>
            {field.label}
          </Label>
          <SelectInput
            id={field.key}
            value={String(resource!.values[field.key] ?? "")}
            onChange={(e) =>
              updateResourceValue(resource!.id, field.key, e.target.value)
            }
          >
            {(field.options ?? []).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </SelectInput>
          {field.description && <Hint>{field.description}</Hint>}
        </div>
      );
    }

    if (field.type === "number") {
      return (
        <div key={field.key}>
          <Label htmlFor={field.key} required={field.required}>
            {field.label}
          </Label>
          <TextInput
            id={field.key}
            type="number"
            value={String(resource!.values[field.key] ?? "")}
            onChange={(e) =>
              updateResourceValue(
                resource!.id,
                field.key,
                e.target.value === "" ? "" : Number(e.target.value)
              )
            }
          />
          {field.description && <Hint>{field.description}</Hint>}
        </div>
      );
    }

    if (field.type === "env_list") {
      return (
        <EnvVarsEditor
          key={field.key}
          value={resource!.values[field.key]}
          onChange={(next) =>
            updateResourceValue(resource!.id, field.key, next)
          }
        />
      );
    }

    if (field.type === "secret_list") {
      return (
        <AppSecretsEditor
          key={field.key}
          value={resource!.values[field.key]}
          resources={state.resources}
          currentId={resource!.id}
          onChange={(next) =>
            updateResourceValue(resource!.id, field.key, next)
          }
        />
      );
    }

    if (field.type === "list") {
      const list = Array.isArray(resource!.values[field.key])
        ? (resource!.values[field.key] as string[])
        : [];
      return (
        <div key={field.key}>
          <Label htmlFor={field.key} required={field.required}>
            {field.label}
          </Label>
          <TextInput
            id={field.key}
            value={list.join(", ")}
            onChange={(e) =>
              updateResourceValue(
                resource!.id,
                field.key,
                e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean)
              )
            }
            placeholder={field.placeholder ?? "item1, item2"}
          />
          <Hint>Comma-separated list</Hint>
        </div>
      );
    }

    if (field.type === "tags") {
      const tags =
        typeof resource!.values[field.key] === "object" &&
        resource!.values[field.key] !== null
          ? (resource!.values[field.key] as Record<string, string>)
          : {};
      const asText = Object.entries(tags)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n");
      return (
        <div key={field.key}>
          <Label htmlFor={field.key}>{field.label}</Label>
          <textarea
            id={field.key}
            rows={3}
            value={asText}
            onChange={(e) => {
              const next: Record<string, string> = {};
              for (const line of e.target.value.split("\n")) {
                const eq = line.indexOf("=");
                if (eq === -1) continue;
                const k = line.slice(0, eq).trim();
                const v = line.slice(eq + 1).trim();
                if (k) next[k] = v;
              }
              updateResourceValue(resource!.id, field.key, next);
            }}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
            placeholder={"Environment=dev\nManagedBy=terraform"}
          />
          <Hint>One key=value per line</Hint>
        </div>
      );
    }

    if (field.type === "sensitive") {
      return (
        <div key={field.key}>
          <Label htmlFor={field.key} required={field.required}>
            {field.label} <Badge tone="amber">sensitive → variable</Badge>
          </Label>
          <TextInput
            id={field.key}
            type="password"
            autoComplete="off"
            value={String(resource!.values[field.key] ?? "")}
            onChange={(e) =>
              updateResourceValue(resource!.id, field.key, e.target.value)
            }
            placeholder={field.placeholder ?? "Will become a Terraform variable"}
          />
          <Hint>
            {field.description ||
              "Emitted as a sensitive variable — never hardcoded in HCL."}
          </Hint>
        </div>
      );
    }

    // string
    return (
      <div key={field.key}>
        <Label htmlFor={field.key} required={field.required}>
          {field.label}
        </Label>
        <TextInput
          id={field.key}
          value={String(resource!.values[field.key] ?? "")}
          onChange={(e) =>
            updateResourceValue(resource!.id, field.key, e.target.value)
          }
          placeholder={field.placeholder}
        />
        {field.description && <Hint>{field.description}</Hint>}
      </div>
    );
  }

  return (
    <Card className="p-5 flex flex-col h-full min-h-0 overflow-y-auto">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xl">{def.icon}</span>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {def.label}
            </h2>
            {resource.useExisting ? (
              <Badge tone="amber">existing / data</Badge>
            ) : (
              <Badge tone="emerald">managed</Badge>
            )}
          </div>
          <code className="text-xs font-mono text-slate-400">
            {resource.useExisting ? "data." : ""}
            {resource.type}.{resource.tfName}
          </code>
        </div>
        <Button
          variant="danger"
          size="sm"
          onClick={() => removeResource(resource.id)}
        >
          Remove
        </Button>
      </div>

      <div className="space-y-4 mb-5">
        <div>
          <Label htmlFor="tf-name" required>
            Terraform name
          </Label>
          <TextInput
            id="tf-name"
            value={resource.tfName}
            onChange={(e) => {
              const cleaned = e.target.value
                .replace(/[^a-zA-Z0-9_]/g, "_")
                .replace(/^(\d)/, "_$1");
              updateResource(resource.id, { tfName: cleaned || "app" });
            }}
          />
          {state.resources.some(
            (r) =>
              r.id !== resource.id &&
              r.type === resource.type &&
              r.tfName === resource.tfName
          ) && (
            <p className="mt-1 text-xs text-rose-600">
              Duplicate Terraform name — another {resource.type} already uses
              &quot;{resource.tfName}&quot;. Rename to avoid HCL collisions.
            </p>
          )}
          <Hint>
            Local name in HCL:{" "}
            <code>
              {resource.type}.{resource.tfName}
            </code>
            {resource.type === "azurerm_container_app" &&
              " — add more from the catalogue (app, app_2, …)"}
          </Hint>
        </div>

        <Checkbox
          checked={resource.useExisting}
          onChange={(v) => {
            updateResource(resource.id, { useExisting: v });
            if (v) {
              // Seed existing values from current name/rg fields
              const seed: Record<string, unknown> = {
                ...resource.existingValues,
              };
              for (const f of existingFields) {
                const cur = resource.values[f.key];
                if (typeof cur === "string" && cur && !seed[f.key]) {
                  seed[f.key] = cur;
                }
              }
              updateResource(resource.id, { existingValues: seed });
            }
          }}
          label="Use existing resource"
          description="Emit a data source instead of managing this resource. Fill identifying name / resource group below."
        />

        <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
          <Label>Scope</Label>
          <SelectInput
            value={
              resource.scope?.kind === "environment"
                ? resource.scope.environmentId
                : "shared"
            }
            onChange={(e) => {
              const v = e.target.value;
              setResourceScope(
                resource.id,
                v === "shared" ? sharedScope() : envScope(v)
              );
            }}
          >
            <option value="shared">Shared (all environments)</option>
            {state.environments.map((env) => (
              <option key={env.id} value={env.id}>
                Scoped to {env.displayName}
              </option>
            ))}
          </SelectInput>
          <Hint>
            Shared resources appear in every environment view. Env-scoped
            resources only appear in their environment. Refs cannot cross
            environments.
          </Hint>
        </div>
      </div>

      {resource.useExisting ? (
        <div className="space-y-4 mb-5 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 p-4">
          <SectionTitle>Existing resource identity</SectionTitle>
          <p className="text-xs text-amber-800 dark:text-amber-200 -mt-2 mb-2">
            These values look up the resource in Azure. Terraform will not
            create or destroy it.
          </p>
          {existingFields.map((f) => renderField(f))}
          {existingFields.length === 0 && (
            <p className="text-sm text-slate-500">
              This resource type has no identifying fields configured.
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="space-y-4 mb-4">
            <SectionTitle>Configuration</SectionTitle>
            {basicFields.map((f) => renderField(f))}
          </div>

          {advancedFields.length > 0 && (
            <div className="mb-4">
              <button
                type="button"
                className="text-sm font-medium text-sky-600 hover:text-sky-500 mb-3"
                onClick={() => setShowAdvanced((s) => !s)}
              >
                {showAdvanced ? "▾ Hide advanced" : "▸ Show advanced"} (
                {advancedFields.length})
              </button>
              {showAdvanced && (
                <div className="space-y-4 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
                  {advancedFields.map((f) => renderField(f))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Dependencies */}
      <div className="mt-auto pt-4 border-t border-slate-200 dark:border-slate-700">
        <SectionTitle>Dependencies</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 text-sm">
          <div>
            <div className="text-xs font-medium text-slate-500 mb-1.5">
              Depends on
            </div>
            {deps.length === 0 ? (
              <span className="text-xs text-slate-400">None</span>
            ) : (
              <ul className="space-y-1">
                {deps.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      className="text-sky-600 hover:underline text-xs"
                      onClick={() => selectResource(d.id)}
                    >
                      {formatResourceLabel(d)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <div className="text-xs font-medium text-slate-500 mb-1.5">
              Used by
            </div>
            {usedBy.length === 0 ? (
              <span className="text-xs text-slate-400">None</span>
            ) : (
              <ul className="space-y-1">
                {usedBy.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      className="text-sky-600 hover:underline text-xs"
                      onClick={() => selectResource(d.id)}
                    >
                      {formatResourceLabel(d)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
