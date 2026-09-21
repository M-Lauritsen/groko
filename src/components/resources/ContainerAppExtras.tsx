"use client";

import { useId } from "react";
import type { ContainerEnvVar, ContainerAppSecret, ReferenceValue, ResourceInstance } from "@/lib/schema/types";
import { isReferenceValue } from "@/lib/schema/types";
import { getResourceType } from "@/lib/schema/resources";
import { canReference } from "@/lib/schema/environments";
import {
  Label,
  Hint,
  TextInput,
  SelectInput,
  Button,
  Badge,
} from "@/components/ui/Field";

function asEnvList(raw: unknown): ContainerEnvVar[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((e) => {
    const o = (e ?? {}) as Record<string, unknown>;
    return {
      name: String(o.name ?? ""),
      value: o.value !== undefined ? String(o.value) : "",
      secret_name: o.secret_name !== undefined ? String(o.secret_name) : "",
    };
  });
}

function asSecretList(raw: unknown): ContainerAppSecret[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((e) => {
    const o = (e ?? {}) as Record<string, unknown>;
    const item: ContainerAppSecret = {
      name: String(o.name ?? ""),
      source: o.source === "key_vault" ? "key_vault" : "value",
    };
    if (o.value !== undefined) item.value = String(o.value);
    if (o.secret_name !== undefined) item.secret_name = String(o.secret_name);
    if (isReferenceValue(o.key_vault_id)) item.key_vault_id = o.key_vault_id;
    return item;
  });
}

export function EnvVarsEditor({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (next: ContainerEnvVar[]) => void;
}) {
  const rows = asEnvList(value);
  const editorId = useId();

  function update(i: number, patch: Partial<ContainerEnvVar>) {
    const next = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    onChange(next);
  }

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Label>Environment variables</Label>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() =>
            onChange([...rows, { name: "", value: "", secret_name: "" }])
          }
        >
          + Add
        </Button>
      </div>
      <Hint>
        Emits <code>env &#123; name / value &#125;</code> or{" "}
        <code>secret_name</code> inside the container template.
      </Hint>
      {rows.length === 0 && (
        <p className="text-xs text-slate-400">No environment variables yet.</p>
      )}
      {rows.map((row, i) => (
        <div
          key={i}
          className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] items-end rounded-md bg-slate-50 dark:bg-slate-900/50 p-2"
        >
          <div>
            <Label htmlFor={`${editorId}-env-name-${i}`}>Name</Label>
            <TextInput
              id={`${editorId}-env-name-${i}`}
              value={row.name}
              onChange={(e) => update(i, { name: e.target.value })}
              placeholder="ASPNETCORE_ENVIRONMENT"
            />
          </div>
          <div>
            <Label htmlFor={`${editorId}-env-val-${i}`}>Value</Label>
            <TextInput
              id={`${editorId}-env-val-${i}`}
              value={row.value ?? ""}
              onChange={(e) =>
                update(i, { value: e.target.value, secret_name: "" })
              }
              placeholder="Production"
              disabled={Boolean(row.secret_name)}
            />
          </div>
          <div>
            <Label htmlFor={`${editorId}-env-sec-${i}`}>Secret name</Label>
            <TextInput
              id={`${editorId}-env-sec-${i}`}
              value={row.secret_name ?? ""}
              onChange={(e) =>
                update(i, {
                  secret_name: e.target.value,
                  value: e.target.value ? "" : row.value,
                })
              }
              placeholder="(optional)"
            />
          </div>
          <Button
            type="button"
            size="sm"
            variant="danger"
            onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
          >
            Remove
          </Button>
        </div>
      ))}
    </div>
  );
}

export function AppSecretsEditor({
  value,
  onChange,
  resources,
  currentId,
  errorId,
}: {
  value: unknown;
  onChange: (next: ContainerAppSecret[]) => void;
  resources: ResourceInstance[];
  currentId: string;
  errorId?: string;
}) {
  const rows = asSecretList(value);
  const editorId = useId();
  const current = resources.find((resource) => resource.id === currentId);
  const vaults = resources.filter(
    (resource) =>
      resource.id !== currentId &&
      resource.type === "azurerm_key_vault" &&
      (current ? canReference(current, resource) : false)
  );

  function update(i: number, patch: Partial<ContainerAppSecret>) {
    const next = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    onChange(next);
  }

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Label>App secrets</Label>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() =>
            onChange([
              ...rows,
              { name: "", source: "value", value: "", secret_name: "" },
            ])
          }
        >
          + Add
        </Button>
      </div>
      <Hint>
        Plain values become sensitive Terraform variables. Key Vault refs emit{" "}
        <code>key_vault_secret_id</code> using the vault URI + secret name
        (azurerm 4.x) and optionally grant Key Vault Secrets User to the app
        identity.
      </Hint>
      {rows.length === 0 && (
        <p className="text-xs text-slate-400">No app secrets yet.</p>
      )}
      {rows.map((row, i) => (
        <div
          key={i}
          className="space-y-2 rounded-md bg-slate-50 dark:bg-slate-900/50 p-3"
        >
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] items-end">
            <div>
              <Label htmlFor={`${editorId}-sec-name-${i}`}>Secret name</Label>
              <TextInput
                id={`${editorId}-sec-name-${i}`}
                value={row.name}
                onChange={(e) => update(i, { name: e.target.value })}
                placeholder="db-password"
              />
            </div>
            <div>
              <Label htmlFor={`${editorId}-sec-src-${i}`}>Source</Label>
              <SelectInput
                id={`${editorId}-sec-src-${i}`}
                value={row.source}
                onChange={(e) =>
                  update(i, {
                    source: e.target.value === "key_vault" ? "key_vault" : "value",
                  })
                }
              >
                <option value="value">Plain value (sensitive var)</option>
                <option value="key_vault">Key Vault reference</option>
              </SelectInput>
            </div>
            <Button
              type="button"
              size="sm"
              variant="danger"
              onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
            >
              Remove
            </Button>
          </div>
          {row.source === "value" ? (
            <div>
              <Label htmlFor={`${editorId}-sec-val-${i}`}>
                Value <Badge tone="amber">sensitive → variable</Badge>
              </Label>
              <TextInput
                id={`${editorId}-sec-val-${i}`}
                type="password"
                autoComplete="off"
                value={row.value ?? ""}
                onChange={(e) => update(i, { value: e.target.value })}
                placeholder="Will become a Terraform variable"
              />
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <Label htmlFor={`${editorId}-sec-vault-${i}`}>Key Vault</Label>
                {vaults.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                    Add a Key Vault resource first.
                  </div>
                ) : (
                  <SelectInput
                    id={`${editorId}-sec-vault-${i}`}
                    aria-invalid={Boolean(errorId)}
                    aria-describedby={errorId}
                    value={
                      isReferenceValue(row.key_vault_id)
                        ? row.key_vault_id.resourceId
                        : ""
                    }
                    onChange={(e) => {
                      const id = e.target.value;
                      update(
                        i,
                        id
                          ? {
                              key_vault_id: {
                                resourceId: id,
                                attr: "id",
                              } as ReferenceValue,
                            }
                          : { key_vault_id: undefined }
                      );
                    }}
                  >
                    <option value="">— Select Key Vault —</option>
                    {vaults.map((r) => {
                      const def = getResourceType(r.type);
                      const nameHint =
                        typeof r.values.name === "string" && r.values.name
                          ? ` · ${r.values.name}`
                          : "";
                      return (
                        <option key={r.id} value={r.id}>
                          {def?.icon ?? ""} {def?.label ?? r.type}.{r.tfName}
                          {nameHint}
                        </option>
                      );
                    })}
                  </SelectInput>
                )}
              </div>
              <div>
                <Label htmlFor={`${editorId}-sec-kvname-${i}`}>KV secret name</Label>
                <TextInput
                  id={`${editorId}-sec-kvname-${i}`}
                  value={row.secret_name ?? ""}
                  onChange={(e) => update(i, { secret_name: e.target.value })}
                  placeholder="my-app-secret"
                />
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
