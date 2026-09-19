"use client";

import { useState } from "react";
import { useProject } from "@/lib/store/project-context";
import { STARTERS } from "@/lib/schema/starters";
import { AZURE_LOCATIONS } from "@/lib/schema/types";
import {
  Label,
  TextInput,
  SelectInput,
  Hint,
  Button,
  Card,
  SectionTitle,
  Badge,
} from "@/components/ui/Field";
import { ImportTerraform } from "@/components/project/ImportTerraform";

export function ProjectSetup() {
  const { state, setConfig, applyStarter } = useProject();
  const { config } = state;
  const [tagKey, setTagKey] = useState("");
  const [tagVal, setTagVal] = useState("");
  const [confirmStarter, setConfirmStarter] = useState<string | null>(null);

  function addTag() {
    if (!tagKey.trim()) return;
    setConfig({ tags: { ...config.tags, [tagKey.trim()]: tagVal } });
    setTagKey("");
    setTagVal("");
  }

  function removeTag(key: string) {
    const next = { ...config.tags };
    delete next[key];
    setConfig({ tags: next });
  }

  function onStarterClick(id: string) {
    if (state.resources.length > 0 && id !== config.starter) {
      setConfirmStarter(id);
    } else {
      applyStarter(id);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <SectionTitle>Project settings</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="proj-name" required>
              Project name
            </Label>
            <TextInput
              id="proj-name"
              value={config.name}
              onChange={(e) => setConfig({ name: e.target.value })}
              placeholder="my-azure-project"
            />
          </div>
          <div>
            <Label htmlFor="proj-location" required>
              Location / region
            </Label>
            <SelectInput
              id="proj-location"
              value={config.location}
              onChange={(e) => setConfig({ location: e.target.value })}
            >
              {AZURE_LOCATIONS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </SelectInput>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="proj-prefix">Naming prefix</Label>
            <TextInput
              id="proj-prefix"
              value={config.namingPrefix}
              onChange={(e) => setConfig({ namingPrefix: e.target.value })}
              placeholder="myapp"
            />
            <Hint>
              Used when naming new resources (e.g.{" "}
              <code className="text-sky-600">{config.namingPrefix || "prefix"}-rg</code>
              ).
            </Hint>
          </div>
        </div>

        <div className="mt-4">
          <Label>Tags</Label>
          <div className="flex flex-wrap gap-2 mb-2">
            {Object.entries(config.tags).map(([k, v]) => (
              <span
                key={k}
                className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-xs"
              >
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  {k}
                </span>
                <span className="text-slate-400">=</span>
                <span className="text-slate-600 dark:text-slate-300">{v}</span>
                <button
                  type="button"
                  onClick={() => removeTag(k)}
                  className="ml-1 text-slate-400 hover:text-rose-500"
                  aria-label={`Remove tag ${k}`}
                >
                  ×
                </button>
              </span>
            ))}
            {Object.keys(config.tags).length === 0 && (
              <span className="text-xs text-slate-400">No tags yet</span>
            )}
          </div>
          <div className="flex gap-2">
            <TextInput
              placeholder="Key"
              value={tagKey}
              onChange={(e) => setTagKey(e.target.value)}
              className="!w-32"
            />
            <TextInput
              placeholder="Value"
              value={tagVal}
              onChange={(e) => setTagVal(e.target.value)}
              className="!w-40"
              onKeyDown={(e) => e.key === "Enter" && addTag()}
            />
            <Button type="button" variant="secondary" size="sm" onClick={addTag}>
              Add
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <SectionTitle>Starters</SectionTitle>
        <p className="text-sm text-slate-500 mb-4">
          Scaffold a common topology. Applying a starter replaces your current
          resource list.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {STARTERS.map((s) => {
            const isActive =
              config.starter === s.id &&
              (s.id === "blank" ? state.resources.length === 0 : true);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onStarterClick(s.id)}
                className={`text-left rounded-xl border p-4 transition-all hover:border-sky-400 hover:shadow-md ${
                  isActive
                    ? "border-sky-500 bg-sky-50 dark:bg-sky-950/40 ring-1 ring-sky-500"
                    : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="text-2xl" aria-hidden>
                    {s.icon}
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {s.label}
                      </span>
                      {isActive && <Badge tone="sky">Active</Badge>}
                    </div>
                    <p className="mt-1 text-xs text-slate-500 leading-relaxed">
                      {s.description}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {confirmStarter && (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-700 p-4">
            <p className="text-sm text-amber-900 dark:text-amber-200 mb-3">
              Applying a starter will replace your {state.resources.length}{" "}
              current resource(s). Continue?
            </p>
            <div className="flex gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  applyStarter(confirmStarter);
                  setConfirmStarter(null);
                }}
              >
                Replace & apply
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setConfirmStarter(null)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Card>

      <ImportTerraform />
    </div>
  );
}
