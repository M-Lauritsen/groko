"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useProject } from "@/lib/store/project-context";
import {
  importFromFiles,
  type ImportSummary,
  type SkippedItem,
} from "@/lib/import";
import {
  Button,
  Card,
  SectionTitle,
  Badge,
  Hint,
} from "@/components/ui/Field";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { getResourceType } from "@/lib/schema/resources";
import {
  envScope,
  normalizeScope,
  scopeLabel,
  sharedScope,
  tierShortLabel,
} from "@/lib/schema/environments";
import type { ResourceInstance, ResourceScope } from "@/lib/schema/types";

type WizardStep = "upload" | "review" | "confirm";
type ApplyMode = "merge" | "replace";

function domainLabel(type: string): string {
  return (
    getResourceType(type)?.label ??
    type.replace(/^azurerm_/, "").replace(/_/g, " ")
  );
}

function resourceDisplayName(r: ResourceInstance): string {
  const fromValues =
    (typeof r.values.name === "string" && r.values.name) ||
    (typeof r.existingValues.name === "string" && r.existingValues.name) ||
    null;
  return fromValues || r.tfName;
}

function plainSkipReason(s: SkippedItem): string {
  const reason = s.reason;
  if (
    reason.includes("RESOURCE_CATALOGUE") ||
    reason.includes("not in the catalogue") ||
    reason.includes("not in catalogue")
  ) {
    return "Not in the builder catalogue yet";
  }
  if (/for_each/i.test(reason)) {
    return "Uses for_each (not supported in the importer)";
  }
  if (/\bcount\b/i.test(reason)) {
    return "Uses count (not supported in the importer)";
  }
  if (/module/i.test(reason)) {
    return "Module calls are not imported — add resources from the catalogue";
  }
  if (/non-azurerm|non-azure|provider/i.test(reason)) {
    return "Non-Azure provider — out of scope";
  }
  return reason;
}

function skippedTitle(s: SkippedItem): string {
  if (s.kind === "module") return `Module “${s.name}”`;
  return `${domainLabel(s.type)} (${s.name})`;
}

function groupSkipped(
  skipped: SkippedItem[]
): { title: string; count: number; items: SkippedItem[] }[] {
  const map = new Map<string, SkippedItem[]>();
  for (const s of skipped) {
    const key = plainSkipReason(s);
    const list = map.get(key) ?? [];
    list.push(s);
    map.set(key, list);
  }
  return [...map.entries()].map(([title, items]) => ({
    title,
    count: items.length,
    items,
  }));
}

export function ImportTerraform({
  onImported,
  compact = false,
}: {
  onImported?: () => void;
  compact?: boolean;
}) {
  const { importResources, state } = useProject();
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<WizardStep>("upload");
  const [fileCount, setFileCount] = useState(0);
  const [draft, setDraft] = useState<ResourceInstance[]>([]);
  const [skipped, setSkipped] = useState<SkippedItem[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [unmappedArgCount, setUnmappedArgCount] = useState(0);
  const [supportedCount, setSupportedCount] = useState(0);

  const titleId = useId();
  const environments = state.environments;

  const resetWizard = useCallback(() => {
    setStep("upload");
    setDraft([]);
    setSkipped([]);
    setWarnings([]);
    setFileCount(0);
    setUnmappedArgCount(0);
    setSupportedCount(0);
    setError(null);
  }, []);

  const onPick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const loadSummary = useCallback(
    (result: ImportSummary & { fileCount: number }) => {
      // Domain draft only — never keep parse/raw HCL on instances.
      setDraft(
        result.resources.map((r) => ({
          ...r,
          values: { ...r.values },
          existingValues: { ...r.existingValues },
          scope: normalizeScope(r.scope),
        }))
      );
      setSkipped(result.skipped);
      setWarnings(result.warnings);
      setFileCount(result.fileCount);
      setUnmappedArgCount(result.unmappedArgCount);
      setSupportedCount(result.supportedCount);
      if (result.resources.length === 0 && result.skipped.length === 0) {
        setError(result.warnings[0] ?? "Nothing to import.");
        setStep("upload");
        return;
      }
      setStep("review");
    },
    []
  );

  const onFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setBusy(true);
      setError(null);
      try {
        const result = await importFromFiles(files);
        loadSummary(result);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStep("upload");
      } finally {
        setBusy(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [loadSummary]
  );

  const updateDraft = useCallback((id: string, patch: Partial<ResourceInstance>) => {
    setDraft((rows) =>
      rows.map((r) => (r.id === id ? { ...r, ...patch } : r))
    );
  }, []);

  const setDraftScope = useCallback(
    (id: string, scope: ResourceScope) => {
      updateDraft(id, { scope: normalizeScope(scope) });
    },
    [updateDraft]
  );

  const setDraftExisting = useCallback(
    (id: string, useExisting: boolean) => {
      updateDraft(id, { useExisting });
    },
    [updateDraft]
  );

  const goConfirm = useCallback(() => {
    if (draft.length === 0) return;
    setStep("confirm");
  }, [draft.length]);

  const apply = useCallback(
    (mode: ApplyMode) => {
      if (draft.length === 0) return;
      // Commit domain ResourceInstances only (labels/scopes/existing/values).
      importResources(draft, mode);
      resetWizard();
      onImported?.();
    },
    [draft, importResources, onImported, resetWizard]
  );

  const cancelAll = useCallback(() => {
    resetWizard();
  }, [resetWizard]);

  useEffect(() => {
    const open =
      compact &&
      (step === "review" ||
        step === "confirm" ||
        (!!error && step === "upload"));
    if (!open && !(step === "confirm" && !compact)) return;
    const target = dialogRef.current;
    if (!target) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const focusables = () =>
      Array.from(
        target.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute("disabled") && el.tabIndex !== -1);

    focusables()[0]?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        if (step === "confirm") setStep("review");
        else cancelAll();
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) return;
      const firstEl = list[0];
      const lastEl = list[list.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused.current?.focus?.();
    };
  }, [compact, step, error, cancelAll]);

  const skippedGroups = useMemo(() => groupSkipped(skipped), [skipped]);

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept=".tf,.tfvars,.zip,application/zip"
      multiple
      className="hidden"
      onChange={(e) => onFiles(e.target.files)}
    />
  );

  const stepIndicator = (
    <ol
      className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 mb-3"
      aria-label="Import steps"
    >
      {(
        [
          ["upload", "1. Upload"],
          ["review", "2. Review mapping"],
          ["confirm", "3. Confirm"],
        ] as const
      ).map(([id, label]) => {
        const active = step === id;
        const done =
          (id === "upload" && step !== "upload") ||
          (id === "review" && step === "confirm");
        return (
          <li key={id}>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ${
                active
                  ? "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200"
                  : done
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                    : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
              }`}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );

  const reviewPanel = (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Badge tone="emerald">{supportedCount} mapped</Badge>
        <Badge tone="amber">{skipped.length} couldn’t map</Badge>
        <Badge tone="slate">{fileCount} file(s)</Badge>
        {unmappedArgCount > 0 && (
          <Badge tone="violet">{unmappedArgCount} field(s) skipped</Badge>
        )}
      </div>

      {draft.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm text-left">
            <caption className="sr-only">
              Mapped resources — edit scope and existing vs create before import
            </caption>
            <thead className="bg-slate-50 dark:bg-slate-950/80 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Type
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Name
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Existing / Create
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Scope
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {draft.map((r) => {
                const def = getResourceType(r.type);
                const scope = normalizeScope(r.scope);
                const scopeValue =
                  scope.kind === "shared" ? "shared" : scope.environmentId;
                return (
                  <tr key={r.id} className="bg-white dark:bg-slate-900">
                    <td className="px-3 py-2 align-top">
                      <div className="flex items-start gap-2 min-w-[8rem]">
                        <span aria-hidden className="mt-0.5">
                          {def?.icon ?? "📦"}
                        </span>
                        <div>
                          <div className="font-medium text-slate-900 dark:text-slate-100">
                            {domainLabel(r.type)}
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                            {r.type}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="text-slate-800 dark:text-slate-200">
                        {resourceDisplayName(r)}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        .{r.tfName}
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <SegmentedControl
                        ariaLabel={`Existing or create for ${domainLabel(r.type)} ${resourceDisplayName(r)}`}
                        size="sm"
                        value={r.useExisting ? "existing" : "create"}
                        onChange={(next) =>
                          setDraftExisting(r.id, next === "existing")
                        }
                        options={[
                          { value: "existing", label: "Existing" },
                          { value: "create", label: "Create" },
                        ]}
                      />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <label className="sr-only" htmlFor={`scope-${r.id}`}>
                        Scope for {domainLabel(r.type)} {resourceDisplayName(r)}
                      </label>
                      <select
                        id={`scope-${r.id}`}
                        className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                        value={scopeValue}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === "shared") setDraftScope(r.id, sharedScope());
                          else setDraftScope(r.id, envScope(v));
                        }}
                      >
                        <option value="shared">Shared</option>
                        {environments.map((env) => (
                          <option key={env.id} value={env.id}>
                            {tierShortLabel(env)} · {env.displayName}
                          </option>
                        ))}
                      </select>
                      <div className="text-[10px] text-slate-400 mt-1">
                        {scopeLabel(scope, environments)}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-slate-500">
          No catalogue resources mapped. You can still review what couldn’t be
          mapped below, then add types from the catalogue after closing.
        </p>
      )}

      {skipped.length > 0 && (
        <details className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/30 p-3">
          <summary className="cursor-pointer text-sm font-medium text-amber-900 dark:text-amber-200">
            Couldn’t map ({skipped.length})
          </summary>
          <ul className="mt-3 space-y-2 text-sm text-amber-900/90 dark:text-amber-100/90">
            {skippedGroups.map((g) => (
              <li key={g.title}>
                <p className="font-medium">
                  {g.title} <Badge tone="amber">{g.count}</Badge>
                </p>
                <ul className="mt-1 ml-3 list-disc text-xs text-amber-800 dark:text-amber-200/80 space-y-0.5">
                  {g.items.slice(0, 12).map((s, i) => (
                    <li key={`${s.type}-${s.name}-${i}`}>{skippedTitle(s)}</li>
                  ))}
                  {g.items.length > 12 && (
                    <li>…and {g.items.length - 12} more</li>
                  )}
                </ul>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-amber-800/80 dark:text-amber-200/70">
            Skipped types stay out of the project until you add them from the
            catalogue.
          </p>
        </details>
      )}

      {warnings.length > 0 && (
        <details className="text-xs text-slate-600 dark:text-slate-400">
          <summary className="cursor-pointer font-medium text-slate-700 dark:text-slate-300">
            Show detail ({warnings.length} note
            {warnings.length === 1 ? "" : "s"})
          </summary>
          <ul className="mt-2 max-h-36 overflow-auto space-y-1 list-disc pl-4">
            {warnings.slice(0, 40).map((w, i) => (
              <li key={i}>
                {w.replace(/resource "|data "/g, "").replace(/"/g, "")}
              </li>
            ))}
            {warnings.length > 40 && (
              <li>…and {warnings.length - 40} more</li>
            )}
          </ul>
        </details>
      )}

      <div className="flex flex-wrap gap-2 justify-end">
        <Button type="button" variant="secondary" size="sm" onClick={cancelAll}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={draft.length === 0}
          onClick={goConfirm}
        >
          Continue ({draft.length})
        </Button>
      </div>
    </div>
  );

  const confirmPanel = (
    <div className="space-y-3">
      <p
        id={titleId}
        className="text-sm font-medium text-slate-900 dark:text-slate-100"
      >
        Import {draft.length} resource{draft.length === 1 ? "" : "s"}?
      </p>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        {state.resources.length > 0
          ? `Your project already has ${state.resources.length} resource(s). Choose how to apply — nothing changes until you pick an option. Esc goes back to review.`
          : "Nothing is changed until you confirm. Esc goes back to review."}
      </p>
      <ul className="text-xs text-slate-500 max-h-28 overflow-auto space-y-1 border border-slate-200 dark:border-slate-700 rounded-lg p-2">
        {draft.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-1.5">
            <span aria-hidden>{getResourceType(r.type)?.icon ?? "📦"}</span>
            <span className="font-medium text-slate-700 dark:text-slate-200">
              {domainLabel(r.type)}
            </span>
            <span>{resourceDisplayName(r)}</span>
            <Badge tone={r.useExisting ? "amber" : "emerald"}>
              {r.useExisting ? "existing" : "create"}
            </Badge>
            <Badge
              tone={
                normalizeScope(r.scope).kind === "shared" ? "violet" : "sky"
              }
            >
              {scopeLabel(r.scope, environments)}
            </Badge>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => apply("replace")}
        >
          Replace all
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => apply("merge")}
        >
          Merge into current
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setStep("review")}
        >
          Back
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={cancelAll}>
          Cancel
        </Button>
      </div>
    </div>
  );

  const uploadPanel = (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        variant={compact ? "secondary" : "primary"}
        size="sm"
        disabled={busy}
        onClick={onPick}
      >
        {busy ? "Reading…" : "Upload Terraform"}
      </Button>
      {!compact && (
        <Hint>
          Client-side only — files never leave your browser. Current project has{" "}
          {state.resources.length} resource(s).
        </Hint>
      )}
    </div>
  );

  const body = (
    <>
      {stepIndicator}
      {step === "upload" && uploadPanel}
      {error && step === "upload" && (
        <div className="mt-3 rounded-lg border border-rose-300 bg-rose-50 dark:bg-rose-950/40 dark:border-rose-700 p-3 text-sm text-rose-800 dark:text-rose-200">
          {error}
          <div className="mt-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setError(null)}
            >
              Dismiss
            </Button>
          </div>
        </div>
      )}
      {step === "review" && reviewPanel}
      {step === "confirm" && confirmPanel}
    </>
  );

  if (compact) {
    const showModal =
      step === "review" ||
      step === "confirm" ||
      (!!error && step === "upload" && !busy);
    return (
      <>
        {fileInput}
        {step === "upload" && !error && uploadPanel}
        {busy && step === "upload" && (
          <Button type="button" variant="secondary" size="sm" disabled>
            Reading…
          </Button>
        )}
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              className="w-full max-w-3xl max-h-[90vh] overflow-auto rounded-2xl bg-white dark:bg-slate-900 shadow-xl p-5"
            >
              <div className="flex items-center justify-between mb-3">
                <h3
                  id={titleId}
                  className="text-base font-semibold text-slate-900 dark:text-white"
                >
                  Import existing
                </h3>
                <Badge tone="violet">Beta</Badge>
              </div>
              {body}
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <SectionTitle>Import existing</SectionTitle>
          <p className="text-sm text-slate-500 mt-1">
            Upload Terraform files or a zip of a root module. Supported Azure
            types are mapped into <strong>domain resources</strong> (Resource
            Group, VNet, …) — no HCL in the primary review. Fix scope and
            Existing/Create, then Replace or Merge like starters.
          </p>
        </div>
        <Badge tone="violet">Beta</Badge>
      </div>
      {fileInput}
      <div
        className="mt-4"
        ref={step === "confirm" || step === "review" ? dialogRef : undefined}
      >
        {body}
      </div>
    </Card>
  );
}
