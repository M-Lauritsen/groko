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
import { SegmentedControl } from "@/components/ui/SegmentedControl";

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
            Choose one from the List or Graph view, or add from the catalogue.
            Selection is shared across views. Use reference pickers to wire
            dependencies between resources.
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

  function setUseExisting(v: boolean) {
    updateResource(resource!.id, { useExisting: v });
    if (v) {
      const seed: Record<string, unknown> = {
        ...resource!.existingValues,
      };
      for (const f of existingFields) {
        const cur = resource!.values[f.key];
        if (typeof cur === "string" && cur && !seed[f.key]) {
          seed[f.key] = cur;
        }
      }
      updateResource(resource!.id, { existingValues: seed });
    }
  }

  function renderField(field: FieldDef) {
    if (resource!.useExisting && !field.existingKey) {
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
            Existing id/name used to look up this resource in Azure (not
            managed by this project).
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
            onChange={(e) => {
              const next = e.target.value;
              updateResourceValue(resource!.id, field.key, next);
              // PE: suggest connection name from target type when still default-ish
              if (
                resource!.type === "azurerm_private_endpoint" &&
                field.key === "subresource_names"
              ) {
                const suggested =
                  next === "vault"
                    ? "psc-kv"
                    : next === "sqlServer"
                      ? "psc-sql"
                      : next === "registry"
                        ? "psc-acr"
                        : "psc";
                const cur = String(
                  resource!.values.private_connection_name ?? ""
                );
                if (
                  !cur ||
                  cur === "psc" ||
                  cur === "psc-acr" ||
                  cur === "psc-kv" ||
                  cur === "psc-sql"
                ) {
                  updateResourceValue(
                    resource!.id,
                    "private_connection_name",
                    suggested
                  );
                }
              }
            }}
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
            className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
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
              "Emitted as a sensitive variable — never hardcoded in the export."}
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

  const mode = resource.useExisting ? "existing" : "create";

  return (
    <Card className="p-5 flex flex-col h-full min-h-0 overflow-y-auto">
      {/* Existing | Create at top */}
      <div className="mb-4">
        <Label>Resource mode</Label>
        <SegmentedControl
          ariaLabel="Existing or create resource"
          value={mode}
          onChange={(next) => setUseExisting(next === "existing")}
          options={[
            { value: "existing", label: "Existing" },
            { value: "create", label: "Create" },
          ]}
          className="mt-1"
        />
        <Hint>
          {resource.type === "azurerm_private_dns_zone"
            ? "Private DNS defaults to Existing (shared hub zone). Switch to Create only if this project should own the zone."
            : resource.useExisting
              ? "Look up an existing Azure resource by id/name — this project will not create or destroy it."
              : "Create and manage this resource in the exported Terraform."}
        </Hint>
      </div>

      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xl" aria-hidden>
              {def.icon}
            </span>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {def.label}
            </h2>
            {resource.useExisting ? (
              <Badge tone="amber">existing</Badge>
            ) : (
              <Badge tone="emerald">create</Badge>
            )}
          </div>
          {resource.useExisting && (
            <p className="text-xs text-slate-400">
              Local name: <code className="font-mono">{resource.tfName}</code>
            </p>
          )}
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
        {resource.useExisting && (
          <div>
            <Label htmlFor="tf-name" required>
              Local name
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
                Duplicate local name — another {def.label} already uses
                &quot;{resource.tfName}&quot;. Rename to avoid collisions.
              </p>
            )}
            <Hint>
              Short id used when wiring references
              {resource.type === "azurerm_container_app" &&
                " — add more from the catalogue (app, app_2, …)"}
              .
            </Hint>
          </div>
        )}

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
            {resource.type ===
            "azurerm_private_dns_zone_virtual_network_link" ? (
              <>
                VNet DNS links are usually <strong>Shared</strong> (hub
                networking). The badge shows which environment owns an
                env-scoped link; prefer Shared so every env resolves
                privatelink zones.
              </>
            ) : (
              <>
                Shared resources appear in every environment view. Env-scoped
                resources only appear in their environment. Refs cannot cross
                environments.
              </>
            )}
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

          <div className="mb-4">
            <button
              type="button"
              className="text-sm font-medium text-sky-600 hover:text-sky-500 mb-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 rounded"
              onClick={() => setShowAdvanced((s) => !s)}
              aria-expanded={showAdvanced}
            >
              {showAdvanced ? "▾ Hide advanced" : "▸ Show advanced"} (
              {advancedFields.length + 1})
            </button>
            {showAdvanced && (
              <div className="space-y-4 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
                <div>
                  <Label htmlFor="tf-name" required>
                    Local name
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
                      Duplicate local name — another {def.label} already uses
                      &quot;{resource.tfName}&quot;. Rename to avoid collisions.
                    </p>
                  )}
                  <Hint>
                    Short id used when wiring references
                    {resource.type === "azurerm_container_app" &&
                      " — add more from the catalogue (app, app_2, …)"}
                    .
                  </Hint>
                </div>
                {advancedFields.map((f) => renderField(f))}
              </div>
            )}
          </div>
        </>
      )}

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
                      className="text-sky-600 hover:underline text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 rounded"
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
                      className="text-sky-600 hover:underline text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 rounded"
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
