"use client";

import { useCallback, useId, useRef, useState } from "react";
import { useProject } from "@/lib/store/project-context";
import {
  importFromFiles,
  type ImportSummary,
} from "@/lib/import";
import {
  Button,
  Card,
  SectionTitle,
  Badge,
  Hint,
} from "@/components/ui/Field";
import { getResourceType } from "@/lib/schema/resources";

type Mode = "merge" | "replace";

export function ImportTerraform({
  onImported,
  compact = false,
}: {
  onImported?: () => void;
  compact?: boolean;
}) {
  const { importResources, state } = useProject();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<(ImportSummary & { fileCount: number }) | null>(
    null
  );
  const [mode, setMode] = useState<Mode>("merge");
  const radioName = useId();

  const onPick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const onFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      const result = await importFromFiles(files);
      setSummary(result);
      if (result.resources.length === 0 && result.skipped.length === 0) {
        setError(result.warnings[0] ?? "Nothing to import.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, []);

  const apply = useCallback(() => {
    if (!summary || summary.resources.length === 0) return;
    importResources(summary.resources, mode);
    setSummary(null);
    onImported?.();
  }, [summary, mode, importResources, onImported]);

  const cancel = useCallback(() => setSummary(null), []);

  const summaryPanel = summary ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/60 p-4">
            <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-3">
              Import summary
            </h4>
            <div className="flex flex-wrap gap-2 mb-3">
              <Badge tone="emerald">
                {summary.supportedCount} supported
              </Badge>
              <Badge tone="amber">
                {summary.skipped.length} skipped
              </Badge>
              <Badge tone="slate">
                {summary.fileCount} file(s)
              </Badge>
              {summary.unmappedArgCount > 0 && (
                <Badge tone="violet">
                  {summary.unmappedArgCount} unmapped arg(s)
                </Badge>
              )}
            </div>

            {summary.resources.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-medium text-slate-500 mb-1.5">
                  Will import
                </p>
                <ul className="max-h-40 overflow-auto text-sm space-y-1">
                  {summary.resources.map((r) => {
                    const def = getResourceType(r.type);
                    return (
                      <li
                        key={r.id}
                        className="flex items-center gap-2 text-slate-700 dark:text-slate-300"
                      >
                        <span aria-hidden>{def?.icon ?? "📦"}</span>
                        <code className="text-xs text-sky-700 dark:text-sky-300">
                          {r.useExisting ? "data." : ""}
                          {r.type}.{r.tfName}
                        </code>
                        {r.useExisting && (
                          <Badge tone="sky">use existing</Badge>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {summary.skipped.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-medium text-slate-500 mb-1.5">
                  Skipped
                </p>
                <ul className="max-h-32 overflow-auto text-xs space-y-1 text-slate-600 dark:text-slate-400">
                  {summary.skipped.map((s, i) => (
                    <li key={`${s.type}-${s.name}-${i}`}>
                      <code>
                        {s.kind} {s.type}.{s.name}
                      </code>
                      — {s.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {summary.warnings.length > 0 && (
              <details className="text-xs text-amber-800 dark:text-amber-200">
                <summary className="cursor-pointer font-medium">
                  {summary.warnings.length} warning(s)
                </summary>
                <ul className="mt-2 max-h-36 overflow-auto space-y-1 list-disc pl-4">
                  {summary.warnings.slice(0, 40).map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                  {summary.warnings.length > 40 && (
                    <li>…and {summary.warnings.length - 40} more</li>
                  )}
                </ul>
              </details>
            )}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <fieldset className="flex items-center gap-4 text-sm">
              <legend className="sr-only">Import mode</legend>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name={radioName}
                  checked={mode === "merge"}
                  onChange={() => setMode("merge")}
                />
                <span>
                  Merge into current
                  {state.resources.length > 0
                    ? ` (${state.resources.length})`
                    : ""}
                </span>
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name={radioName}
                  checked={mode === "replace"}
                  onChange={() => setMode("replace")}
                />
                <span>Replace current list</span>
              </label>
            </fieldset>
            <div className="flex gap-2 sm:ml-auto">
              <Button type="button" variant="secondary" size="sm" onClick={cancel}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={summary.resources.length === 0}
                onClick={apply}
              >
                Import {summary.resources.length} resource
                {summary.resources.length === 1 ? "" : "s"}
              </Button>
            </div>
          </div>
        </div>
  ) : null;

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

  if (compact) {
    return (
      <>
        {fileInput}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={onPick}
        >
          {busy ? "Reading…" : "Upload Terraform"}
        </Button>
        {error && !summary && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
            <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 shadow-xl p-5">
              <p className="text-sm text-rose-700 dark:text-rose-300 mb-3">{error}</p>
              <Button type="button" variant="secondary" size="sm" onClick={() => setError(null)}>
                Close
              </Button>
            </div>
          </div>
        )}
        {summary && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
            <div className="w-full max-w-xl max-h-[90vh] overflow-auto rounded-2xl bg-white dark:bg-slate-900 shadow-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                  Import Terraform
                </h3>
                <Badge tone="violet">Beta</Badge>
              </div>
              {summaryPanel}
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
          <SectionTitle>Import existing Terraform</SectionTitle>
          <p className="text-sm text-slate-500 mt-1">
            Upload <code className="text-sky-600">.tf</code> /{" "}
            <code className="text-sky-600">.tfvars</code> files or a{" "}
            <code className="text-sky-600">.zip</code> of a root module. Supported
            azurerm types from the catalogue are mapped into the builder; modules,
            for_each/count, and complex expressions are skipped with warnings.
          </p>
        </div>
        <Badge tone="violet">Beta</Badge>
      </div>

      {fileInput}

      {!summary && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="primary"
            disabled={busy}
            onClick={onPick}
          >
            {busy ? "Reading files…" : "Upload Terraform"}
          </Button>
          <Hint>
            Client-side only — files never leave your browser. Current project has{" "}
            {state.resources.length} resource(s).
          </Hint>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg border border-rose-300 bg-rose-50 dark:bg-rose-950/40 dark:border-rose-700 p-3 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </div>
      )}

      {summary && <div className="mt-4">{summaryPanel}</div>}
    </Card>
  );
}
