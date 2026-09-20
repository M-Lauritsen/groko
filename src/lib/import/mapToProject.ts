/**
 * Map parsed HCL resource/data blocks into ResourceInstance[] for the builder.
 */

import { getResourceType, RESOURCE_CATALOGUE } from "../schema/resources";
import type {
  Environment,
  FieldDef,
  ReferenceAttr,
  ReferenceValue,
  ResourceInstance,
} from "../schema/types";
import {
  defaultEnvironments,
  defaultScopeForNewResource,
  inferScopeFromName,
  sharedScope,
} from "../schema/environments";
import type { HclBody, HclValue, ParsedBlock, ParseResult } from "./parse";
import { isSimpleRef } from "./parse";

const SUPPORTED = new Set(RESOURCE_CATALOGUE.map((r) => r.type));

const REF_ATTRS = new Set<string>([
  "id",
  "name",
  "location",
  "resource_group_name",
  "login_server",
  "admin_username",
  "principal_id",
  "vault_uri",
  "primary_access_key",
  "connection_string",
  "instrumentation_key",
]);

export interface SkippedItem {
  kind: string;
  type: string;
  name: string;
  reason: string;
}

export interface ImportSummary {
  resources: ResourceInstance[];
  warnings: string[];
  skipped: SkippedItem[];
  supportedCount: number;
  unsupportedTypeCount: number;
  unmappedArgCount: number;
}

function uid(): string {
  return `r_${Math.random().toString(36).slice(2, 10)}`;
}

function isRef(v: HclValue): v is { __ref: string } {
  return typeof v === "object" && v !== null && "__ref" in v;
}

function isExpr(v: HclValue): v is { __expr: string } {
  return typeof v === "object" && v !== null && "__expr" in v;
}

function isPlainObject(v: HclValue): v is { [key: string]: HclValue } {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    !("__ref" in v) &&
    !("__expr" in v) &&
    !("__raw_block" in v)
  );
}

function fieldByHclKey(def: FieldDef[], key: string): FieldDef | undefined {
  return def.find((f) => (f.hclKey ?? f.key) === key);
}

function coerceForField(field: FieldDef, value: HclValue): unknown {
  if (isRef(value) || isExpr(value)) return value; // resolved later

  switch (field.type) {
    case "string":
    case "sensitive":
    case "select":
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return String(value);
      }
      return undefined;
    case "number":
      if (typeof value === "number") return value;
      if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
        return Number(value);
      }
      return undefined;
    case "boolean":
      if (typeof value === "boolean") return value;
      if (value === "true" || value === "false") return value === "true";
      return undefined;
    case "list":
      if (Array.isArray(value)) {
        return value.map((item) => {
          if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
            return String(item);
          }
          if (isRef(item) || isExpr(item)) return item;
          return String(item ?? "");
        });
      }
      if (typeof value === "string") return [value];
      return undefined;
    case "tags":
      if (isPlainObject(value)) {
        const tags: Record<string, string> = {};
        for (const [k, v] of Object.entries(value)) {
          if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
            tags[k] = String(v);
          }
        }
        return tags;
      }
      return undefined;
    case "reference":
      // leave ref/expr for resolve pass; string literal stays as string (existing name)
      if (typeof value === "string" || typeof value === "number") return String(value);
      return value;
    case "env_list":
    case "secret_list":
      // nested structures — skip unless already shaped
      return undefined;
    default:
      return undefined;
  }
}

function parseRefExpr(expr: string): {
  isData: boolean;
  type: string;
  tfName: string;
  attr: ReferenceAttr;
} | null {
  if (!isSimpleRef(expr)) return null;
  const parts = expr.split(".");
  if (parts[0] === "data") {
    const attr = parts[3];
    if (!REF_ATTRS.has(attr)) return null;
    return {
      isData: true,
      type: parts[1],
      tfName: parts[2],
      attr: attr as ReferenceAttr,
    };
  }
  const attr = parts[2];
  if (!REF_ATTRS.has(attr)) return null;
  return {
    isData: false,
    type: parts[0],
    tfName: parts[1],
    attr: attr as ReferenceAttr,
  };
}

/** Try to lift common nested blocks into flat catalogue fields. */
function applyNestedHeuristics(
  type: string,
  body: HclBody,
  values: Record<string, unknown>,
  warnings: string[],
  label: string
): number {
  let unmapped = 0;
  for (const block of body.blocks) {
    // subnet delegation { service_delegation { name = "Microsoft.App/environments" } }
    if (type === "azurerm_subnet" && block.type === "delegation") {
      const sd = block.body.blocks.find((b) => b.type === "service_delegation");
      const name = sd?.body.attrs.name;
      if (typeof name === "string") {
        values.delegation = name;
        continue;
      }
    }

    // NSG security_rule blocks — catalogue uses toggles; warn
    if (type === "azurerm_network_security_group" && block.type === "security_rule") {
      warnings.push(
        `${label}: nested security_rule blocks are not imported (use builder toggles)`
      );
      unmapped++;
      continue;
    }

    // Function App site_config / application_stack — flatten to runtime_*
    if (type === "azurerm_linux_function_app" && block.type === "site_config") {
      const stack = block.body.blocks.find((b) => b.type === "application_stack");
      if (stack) {
        const a = stack.body.attrs;
        if (typeof a.node_version === "string" || typeof a.node_version === "number") {
          values.runtime_stack = "node";
          values.runtime_version = String(a.node_version);
        } else if (
          typeof a.python_version === "string" ||
          typeof a.python_version === "number"
        ) {
          values.runtime_stack = "python";
          values.runtime_version = String(a.python_version);
        } else if (
          typeof a.dotnet_version === "string" ||
          typeof a.dotnet_version === "number"
        ) {
          values.runtime_stack = "dotnet";
          values.runtime_version = String(a.dotnet_version);
        }
      }
      continue;
    }

    // Function App identity block
    if (type === "azurerm_linux_function_app" && block.type === "identity") {
      const t = block.body.attrs.type;
      if (typeof t === "string") values.identity_type = t;
      continue;
    }

    // container_app template / ingress — best-effort flatten
    if (type === "azurerm_container_app") {
      if (block.type === "template") {
        const minR = block.body.attrs.min_replicas;
        const maxR = block.body.attrs.max_replicas;
        if (typeof minR === "number") values.min_replicas = minR;
        if (typeof maxR === "number") values.max_replicas = maxR;
        const container = block.body.blocks.find((b) => b.type === "container");
        if (container) {
          const c = container.body.attrs;
          if (typeof c.name === "string") values.container_name = c.name;
          if (typeof c.image === "string") values.container_image = c.image;
          if (typeof c.cpu === "number" || typeof c.cpu === "string") {
            values.container_cpu = String(c.cpu);
          }
          if (typeof c.memory === "string") values.container_memory = c.memory;
        }
        continue;
      }
      if (block.type === "ingress") {
        values.ingress_enabled = true;
        const port = block.body.attrs.target_port;
        if (typeof port === "number") values.ingress_target_port = port;
        const ext = block.body.attrs.external_enabled;
        if (typeof ext === "boolean") values.ingress_enabled = ext;
        continue;
      }
    }

    warnings.push(
      `${label}: skipped nested block "${block.type}"${
        block.labels.length ? ` (${block.labels.join(", ")})` : ""
      }`
    );
    unmapped++;
  }
  return unmapped;
}

export function mapToProject(
  parsed: ParseResult,
  environments: Environment[] = defaultEnvironments()
): ImportSummary {
  const warnings = [...parsed.warnings];
  const skipped: SkippedItem[] = [];
  let unmappedArgCount = 0;
  let unsupportedTypeCount = 0;

  // First pass: create instances without resolving refs
  type Pending = {
    block: ParsedBlock;
    instance: ResourceInstance;
    rawAttrs: Record<string, HclValue>;
  };
  const pending: Pending[] = [];
  const usedTfNames = new Map<string, Set<string>>(); // type -> names

  function claimTfName(type: string, preferred: string): string {
    let set = usedTfNames.get(type);
    if (!set) {
      set = new Set();
      usedTfNames.set(type, set);
    }
    let name = preferred.replace(/[^a-zA-Z0-9_]/g, "_") || "main";
    if (!/^[a-zA-Z_]/.test(name)) name = `r_${name}`;
    if (!set.has(name)) {
      set.add(name);
      return name;
    }
    let i = 2;
    while (set.has(`${name}_${i}`)) i++;
    const next = `${name}_${i}`;
    set.add(next);
    return next;
  }

  for (const block of parsed.blocks) {
    if (block.kind === "module") {
      skipped.push({
        kind: "module",
        type: "module",
        name: block.name,
        reason: "Modules are not imported (root resources only)",
      });
      continue;
    }
    if (block.kind === "other") {
      // locals / variables etc. — silent skip unless locals-heavy note
      if (block.type === "locals") {
        warnings.push(
          `Skipped locals block — complex expressions are not imported`
        );
      }
      continue;
    }
    if (block.kind !== "resource" && block.kind !== "data") continue;

    const label = `${block.kind} "${block.type}" "${block.name}"`;

    if (!block.type.startsWith("azurerm_")) {
      skipped.push({
        kind: block.kind,
        type: block.type,
        name: block.name,
        reason: "Non-azurerm provider / unknown type",
      });
      unsupportedTypeCount++;
      continue;
    }

    if (!SUPPORTED.has(block.type)) {
      skipped.push({
        kind: block.kind,
        type: block.type,
        name: block.name,
        reason: "Type not in RESOURCE_CATALOGUE",
      });
      unsupportedTypeCount++;
      continue;
    }

    if (block.body.meta?.hasForEach || block.body.meta?.hasCount) {
      skipped.push({
        kind: block.kind,
        type: block.type,
        name: block.name,
        reason: block.body.meta.hasForEach
          ? "for_each is not supported"
          : "count is not supported",
      });
      continue;
    }

    const typeDef = getResourceType(block.type)!;
    const tfName = claimTfName(block.type, block.name);
    const useExisting = block.kind === "data";
    const values: Record<string, unknown> = {};
    const existingValues: Record<string, unknown> = {};

    // defaults
    for (const f of typeDef.fields) {
      if (f.defaultValue !== undefined && !useExisting) {
        values[f.key] =
          f.type === "tags" && typeof f.defaultValue === "object"
            ? { ...(f.defaultValue as object) }
            : f.defaultValue;
      }
    }

    for (const [key, raw] of Object.entries(block.body.attrs)) {
      if (key === "for_each" || key === "count" || key === "provider" || key === "depends_on" || key === "lifecycle") {
        if (key === "depends_on" || key === "lifecycle") {
          warnings.push(`${label}: ignored meta attribute "${key}"`);
        }
        continue;
      }
      // Function App: storage_account_name → catalogue storage_account_id (access key derived)
      let mapKey = key;
      if (
        block.type === "azurerm_linux_function_app" &&
        key === "storage_account_name"
      ) {
        mapKey = "storage_account_id";
      }
      if (
        block.type === "azurerm_linux_function_app" &&
        key === "storage_account_access_key"
      ) {
        // Derived from storage_account_id on emit — skip
        continue;
      }
      // Function App: AI connection string / key → catalogue application_insights_id
      if (
        block.type === "azurerm_linux_function_app" &&
        (key === "application_insights_connection_string" ||
          key === "application_insights_key")
      ) {
        mapKey = "application_insights_id";
      }
      const field = fieldByHclKey(typeDef.fields, mapKey);
      if (!field) {
        unmappedArgCount++;
        warnings.push(`${label}: unmapped argument "${key}"`);
        continue;
      }
      if (isExpr(raw)) {
        warnings.push(
          `${label}: complex expression for "${key}" (${raw.__expr}) — left empty`
        );
        unmappedArgCount++;
        continue;
      }
      const coerced = coerceForField(field, raw);
      if (coerced === undefined) {
        unmappedArgCount++;
        warnings.push(`${label}: could not map "${key}" to field ${field.key}`);
        continue;
      }
      if (useExisting && field.existingKey) {
        if (typeof coerced === "string" || typeof coerced === "number" || typeof coerced === "boolean") {
          existingValues[field.key] = coerced;
        } else if (isRef(coerced as HclValue)) {
          // store ref temporarily in values for resolve; also try string later
          values[field.key] = coerced;
        } else {
          existingValues[field.key] = coerced;
        }
      } else {
        values[field.key] = coerced;
      }
    }

    unmappedArgCount += applyNestedHeuristics(
      block.type,
      block.body,
      values,
      warnings,
      label
    );

    const nameHint =
      typeof values.name === "string"
        ? values.name
        : typeof existingValues.name === "string"
          ? existingValues.name
          : undefined;
    const tags = values.tags;
    const tagEnv =
      tags &&
      typeof tags === "object" &&
      tags !== null &&
      !Array.isArray(tags) &&
      typeof (tags as Record<string, unknown>).Environment === "string"
        ? String((tags as Record<string, unknown>).Environment)
        : undefined;
    // Prefer the first hint that actually yields an env scope (name, then tag, then tfName)
    let scope = sharedScope();
    let matchedFromHint = false;
    for (const hint of [nameHint, tagEnv, tfName]) {
      if (!hint) continue;
      const guessed = inferScopeFromName(hint, environments);
      if (guessed.kind === "environment") {
        scope = guessed;
        matchedFromHint = true;
        break;
      }
    }
    if (!matchedFromHint) {
      // Cheap fallback: catalogue types that are usually env-scoped → first env
      const fallback = defaultScopeForNewResource(
        block.type,
        environments[0]?.id ?? "dev"
      );
      if (fallback.kind === "environment") {
        scope = fallback;
      }
    }
    const instance: ResourceInstance = {
      id: uid(),
      type: block.type,
      tfName,
      useExisting,
      values,
      existingValues,
      // Domain scope only — never store raw HCL on the instance
      scope,
    };
    pending.push({ block, instance, rawAttrs: block.body.attrs });
  }

  // Index for ref resolution: type+tfName (+ data flag)
  const byAddr = new Map<string, ResourceInstance>();
  for (const p of pending) {
    const key = `${p.instance.useExisting ? "data." : ""}${p.instance.type}.${p.instance.tfName}`;
    byAddr.set(key, p.instance);
    // Also allow lookup by original block name if renamed
    if (p.block.name !== p.instance.tfName) {
      const orig = `${p.instance.useExisting ? "data." : ""}${p.instance.type}.${p.block.name}`;
      if (!byAddr.has(orig)) byAddr.set(orig, p.instance);
    }
  }

  function resolveOne(
    field: FieldDef | undefined,
    value: unknown,
    label: string,
    key: string
  ): unknown {
    if (value && typeof value === "object" && value !== null && "__ref" in value) {
      const expr = (value as { __ref: string }).__ref;
      const parsed = parseRefExpr(expr);
      if (!parsed) {
        warnings.push(`${label}: could not parse reference ${expr} for "${key}"`);
        return undefined;
      }
      const addr = `${parsed.isData ? "data." : ""}${parsed.type}.${parsed.tfName}`;
      const target = byAddr.get(addr);
      if (!target) {
        warnings.push(
          `${label}: reference ${expr} for "${key}" — target not in import set`
        );
        return undefined;
      }
      const preferredAttr =
        (field?.refAttr as ReferenceAttr | undefined) ?? parsed.attr;
      const ref: ReferenceValue = {
        resourceId: target.id,
        attr: preferredAttr,
      };
      return ref;
    }
    // list items may contain refs
    if (Array.isArray(value)) {
      return value.map((item, idx) => {
        if (item && typeof item === "object" && item !== null && "__ref" in item) {
          const resolved = resolveOne(field, item, label, `${key}[${idx}]`);
          return resolved ?? "";
        }
        if (item && typeof item === "object" && item !== null && "__expr" in item) {
          warnings.push(`${label}: list item expression dropped for "${key}"`);
          return "";
        }
        return item;
      });
    }
    return value;
  }

  for (const p of pending) {
    const label = `${p.block.kind} "${p.block.type}" "${p.block.name}"`;
    const typeDef = getResourceType(p.instance.type)!;
    const nextValues: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(p.instance.values)) {
      const field = typeDef.fields.find((f) => f.key === k);
      nextValues[k] = resolveOne(field, v, label, k);
      // clean undefined
      if (nextValues[k] === undefined) delete nextValues[k];
    }
    p.instance.values = nextValues;

    // For data sources: copy identifying string values into existingValues if still empty
    if (p.instance.useExisting) {
      for (const f of typeDef.fields) {
        if (!f.existingKey) continue;
        if (p.instance.existingValues[f.key] !== undefined) continue;
        const v = p.instance.values[f.key];
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
          p.instance.existingValues[f.key] = v;
        }
      }
    }
  }

  return {
    resources: pending.map((p) => p.instance),
    warnings,
    skipped,
    supportedCount: pending.length,
    unsupportedTypeCount,
    unmappedArgCount,
  };
}

/**
 * Merge imported resources into an existing list, uniquifying tfNames.
 * Rewrites ReferenceValue targets that point at imported ids (already unique).
 */
export function mergeImportedResources(
  existing: ResourceInstance[],
  imported: ResourceInstance[],
  mode: "merge" | "replace"
): ResourceInstance[] {
  if (mode === "replace") return imported.map((r) => ({ ...r, values: { ...r.values }, existingValues: { ...r.existingValues } }));

  const result = existing.map((r) => ({
    ...r,
    values: { ...r.values },
    existingValues: { ...r.existingValues },
  }));
  const used = new Map<string, Set<string>>();
  for (const r of result) {
    let set = used.get(r.type);
    if (!set) {
      set = new Set();
      used.set(r.type, set);
    }
    set.add(r.tfName);
  }

  const idRemap = new Map<string, string>();

  for (const raw of imported) {
    const inst = {
      ...raw,
      id: uid(),
      values: { ...raw.values },
      existingValues: { ...raw.existingValues },
    };
    idRemap.set(raw.id, inst.id);

    let set = used.get(inst.type);
    if (!set) {
      set = new Set();
      used.set(inst.type, set);
    }
    if (set.has(inst.tfName)) {
      let i = 2;
      const base = inst.tfName;
      while (set.has(`${base}_${i}`)) i++;
      inst.tfName = `${base}_${i}`;
    }
    set.add(inst.tfName);
    result.push(inst);
  }

  // Fix references inside newly merged instances to new ids
  const importedIds = new Set(idRemap.keys());
  for (const r of result) {
    if (![...idRemap.values()].includes(r.id)) continue;
    for (const [k, v] of Object.entries(r.values)) {
      if (
        typeof v === "object" &&
        v !== null &&
        "resourceId" in v &&
        importedIds.has((v as ReferenceValue).resourceId)
      ) {
        const newId = idRemap.get((v as ReferenceValue).resourceId);
        if (newId) {
          r.values[k] = { ...(v as ReferenceValue), resourceId: newId };
        }
      }
    }
  }

  return result;
}
