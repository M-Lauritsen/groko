"use client";

import { useMemo, useState } from "react";
import { useProject } from "@/lib/store/project-context";
import {
  defaultKnobsForId,
  normalizeScope,
  resourcesVisibleInEnv,
  scopeLabel,
} from "@/lib/schema/environments";
import { getResourceType } from "@/lib/schema/resources";
import type { Environment } from "@/lib/schema/types";
import {
  Label,
  TextInput,
  Hint,
  Button,
  Card,
  SectionTitle,
  Badge,
  SelectInput,
  Checkbox,
} from "@/components/ui/Field";

export function EnvironmentsPanel() {
  const {
    state,
    setActiveEnvironment,
    updateEnvironment,
    addEnvironment,
    removeEnvironment,
  } = useProject();
  const { environments, activeEnvironmentId, resources } = state;
  const active =
    environments.find((e) => e.id === activeEnvironmentId) ?? environments[0];

  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");

  const visible = useMemo(
    () =>
      active ? resourcesVisibleInEnv(resources, active.id) : resources,
    [resources, active]
  );
  const shared = visible.filter((r) => normalizeScope(r.scope).kind === "shared");
  const scoped = visible.filter(
    (r) => normalizeScope(r.scope).kind === "environment"
  );

  if (!active) {
    return (
      <Card className="p-5">
        <SectionTitle>Environments</SectionTitle>
        <p className="text-sm text-slate-500">No environments defined.</p>
      </Card>
    );
  }

  function onAdd() {
    const id = newId
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!id) return;
    if (environments.some((e) => e.id === id)) return;
    const env: Environment = {
      id,
      displayName: newName.trim() || id,
      knobs: defaultKnobsForId(id),
    };
    addEnvironment(env);
    setNewId("");
    setNewName("");
  }

  const k = active.knobs;

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <SectionTitle>Environments</SectionTitle>
        <p className="text-sm text-slate-500 mb-4">
          Environments are first-class objects (not a string flag). Switch the
          active environment to edit knobs and see which resources are{" "}
          <strong>Shared</strong> vs scoped to this env. Export writes one
          tfvars / backend hcl per environment id.
        </p>

        <div className="flex flex-wrap gap-2 mb-4">
          {environments.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => setActiveEnvironment(e.id)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                e.id === active.id
                  ? "border-sky-500 bg-sky-50 dark:bg-sky-950/40 text-sky-800 dark:text-sky-200 ring-1 ring-sky-500"
                  : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-300"
              }`}
            >
              {e.displayName}
              <span className="ml-1.5 text-[10px] font-mono text-slate-400">
                {e.id}
              </span>
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-3 border-t border-slate-100 dark:border-slate-800 pt-4">
          <div>
            <Label htmlFor="env-display">Display name</Label>
            <TextInput
              id="env-display"
              value={active.displayName}
              onChange={(e) =>
                updateEnvironment(active.id, { displayName: e.target.value })
              }
            />
          </div>
          <div>
            <Label>Id / key</Label>
            <TextInput value={active.id} disabled className="opacity-70" />
            <Hint>Used as environments/&#123;id&#125;.tfvars filename</Hint>
          </div>
          <div className="flex items-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={environments.length <= 1}
              onClick={() => {
                if (
                  confirm(
                    `Remove environment "${active.displayName}"? Resources scoped to it become Shared.`
                  )
                ) {
                  removeEnvironment(active.id);
                }
              }}
            >
              Remove env
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <SectionTitle>
          Knobs — {active.displayName}
        </SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="knob-suffix">Naming suffix</Label>
            <TextInput
              id="knob-suffix"
              value={k.namingSuffix}
              onChange={(e) =>
                updateEnvironment(active.id, {
                  knobs: { namingSuffix: e.target.value },
                })
              }
              placeholder="-dev"
            />
            <Hint>
              tfvars naming_prefix = project prefix + suffix →{" "}
              <code className="text-sky-600">
                {state.config.namingPrefix}
                {k.namingSuffix}
              </code>
            </Hint>
          </div>
          <div>
            <Label htmlFor="knob-tag">Tag Environment=</Label>
            <TextInput
              id="knob-tag"
              value={k.tags.Environment ?? active.id}
              onChange={(e) =>
                updateEnvironment(active.id, {
                  knobs: {
                    tags: { ...k.tags, Environment: e.target.value },
                  },
                })
              }
            />
          </div>
          <div>
            <Label htmlFor="knob-acr">ACR SKU</Label>
            <SelectInput
              id="knob-acr"
              value={k.acrSku}
              onChange={(e) =>
                updateEnvironment(active.id, {
                  knobs: { acrSku: e.target.value },
                })
              }
            >
              <option value="Basic">Basic</option>
              <option value="Standard">Standard</option>
              <option value="Premium">Premium</option>
            </SelectInput>
          </div>
          <div>
            <Label htmlFor="knob-cpu">Container App CPU</Label>
            <TextInput
              id="knob-cpu"
              type="number"
              step="0.25"
              value={String(k.caCpu)}
              onChange={(e) =>
                updateEnvironment(active.id, {
                  knobs: { caCpu: Number(e.target.value) },
                })
              }
            />
          </div>
          <div>
            <Label htmlFor="knob-mem">Container App memory</Label>
            <TextInput
              id="knob-mem"
              value={k.caMemory}
              onChange={(e) =>
                updateEnvironment(active.id, {
                  knobs: { caMemory: e.target.value },
                })
              }
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="knob-min">Min replicas</Label>
              <TextInput
                id="knob-min"
                type="number"
                value={String(k.caMinReplicas)}
                onChange={(e) =>
                  updateEnvironment(active.id, {
                    knobs: { caMinReplicas: Number(e.target.value) },
                  })
                }
              />
            </div>
            <div>
              <Label htmlFor="knob-max">Max replicas</Label>
              <TextInput
                id="knob-max"
                type="number"
                value={String(k.caMaxReplicas)}
                onChange={(e) =>
                  updateEnvironment(active.id, {
                    knobs: { caMaxReplicas: Number(e.target.value) },
                  })
                }
              />
            </div>
          </div>
          <div className="sm:col-span-2">
            <Checkbox
              checked={k.caIngressExternal}
              onChange={(v) =>
                updateEnvironment(active.id, {
                  knobs: { caIngressExternal: v },
                })
              }
              label="External ingress (ca_ingress_external)"
            />
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <SectionTitle
          action={
            <Badge tone="slate">
              {visible.length} visible · {shared.length} shared · {scoped.length}{" "}
              scoped
            </Badge>
          }
        >
          Resources in {active.displayName}
        </SectionTitle>
        <p className="text-xs text-slate-500 mb-3">
          Shared resources appear in every environment view. Env-scoped
          resources only appear here. Reference pickers block cross-env refs.
        </p>
        {visible.length === 0 ? (
          <p className="text-sm text-slate-400">No resources yet for this view.</p>
        ) : (
          <ul className="space-y-1.5">
            {visible.map((r) => {
              const def = getResourceType(r.type);
              const scope = normalizeScope(r.scope);
              return (
                <li
                  key={r.id}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm"
                >
                  <span aria-hidden>{def?.icon ?? "📦"}</span>
                  <span className="font-medium text-slate-800 dark:text-slate-100">
                    {def?.label ?? r.type}
                  </span>
                  <code className="text-[10px] text-slate-400">.{r.tfName}</code>
                  <Badge tone={scope.kind === "shared" ? "violet" : "sky"}>
                    {scopeLabel(scope, environments)}
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card className="p-5">
        <SectionTitle>Add environment</SectionTitle>
        <div className="flex flex-wrap gap-2 items-end">
          <div>
            <Label htmlFor="new-env-id">Id</Label>
            <TextInput
              id="new-env-id"
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              placeholder="qa"
              className="!w-32"
            />
          </div>
          <div>
            <Label htmlFor="new-env-name">Display name</Label>
            <TextInput
              id="new-env-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="QA"
              className="!w-40"
            />
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={onAdd}>
            Add
          </Button>
        </div>
      </Card>
    </div>
  );
}
