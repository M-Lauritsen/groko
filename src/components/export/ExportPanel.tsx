"use client";

import { useMemo, useState } from "react";
import { useProject } from "@/lib/store/project-context";
import { previewHcl, generateProject } from "@/lib/generate/hcl";
import { downloadProjectZip } from "@/lib/generate/zip";
import {
  buildExportReviewSummary,
  canDownloadWithMap,
  shortResourceInfo,
} from "@/lib/generate/export-map";
import { Button, Card, SectionTitle, Badge } from "@/components/ui/Field";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { TierBadge } from "@/components/project/TierBadge";
import { FolderStructurePanel } from "./FolderStructurePanel";
import { ReviewChangesPanel } from "./ReviewChangesPanel";

type Tab = "review" | "structure" | "preview" | "files";

export function ExportPanel() {
  const { state } = useProject();
  const [tab, setTab] = useState<Tab>("review");
  const [mapMode, setMapMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);

  const preview = useMemo(
    () =>
      previewHcl(
        state.config,
        state.resources,
        state.environments,
        state.exportConfig
      ),
    [state.config, state.resources, state.environments, state.exportConfig]
  );

  const generated = useMemo(
    () =>
      generateProject(
        state.config,
        state.resources,
        state.environments,
        state.exportConfig
      ),
    [state.config, state.resources, state.environments, state.exportConfig]
  );

  const review = useMemo(
    () => buildExportReviewSummary(state.resources, state.exportConfig),
    [state.resources, state.exportConfig]
  );

  const fileNames = useMemo(() => {
    const paths = Object.keys(generated.files);
    const rank = (p: string) => {
      if (!p.includes("/")) return 0;
      if (p.startsWith("environments/")) return 1;
      if (p.startsWith("modules/")) return 2;
      return 3;
    };
    return paths.sort((a, b) => {
      const d = rank(a) - rank(b);
      return d !== 0 ? d : a.localeCompare(b);
    });
  }, [generated.files]);

  const activeFile =
    selectedFile && generated.files[selectedFile]
      ? selectedFile
      : (fileNames[0] ?? null);

  const downloadGate = canDownloadWithMap(
    state.resources,
    state.exportConfig,
    { mapMode }
  );

  const gateClear = downloadGate.ok;
  const hasOrphans = downloadGate.orphans.length > 0;

  async function doDownload(leaveUnmappedConfirmed: boolean) {
    const gate = canDownloadWithMap(state.resources, state.exportConfig, {
      mapMode,
      leaveUnmappedConfirmed,
    });
    if (!gate.ok) {
      setLeaveConfirmOpen(true);
      setTab("review");
      return;
    }
    setBusy(true);
    try {
      await downloadProjectZip(
        state.config,
        state.resources,
        state.environments,
        state.exportConfig
      );
      setLeaveConfirmOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function onDownload() {
    if (hasOrphans) {
      setLeaveConfirmOpen(true);
      setTab("review");
      return;
    }
    await doDownload(false);
  }

  async function onCopy() {
    const text =
      tab === "files" && activeFile
        ? generated.files[activeFile]
        : preview;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const moduleCount = fileNames.filter((f) =>
    f.startsWith("modules/")
  ).length;
  const caCount = state.resources.filter(
    (r) => r.type === "azurerm_container_app"
  ).length;

  function openMapForOrphans() {
    setTab("structure");
    setMapMode(true);
    setLeaveConfirmOpen(false);
  }

  return (
    <Card className="flex flex-col h-full min-h-0 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <SectionTitle>Export</SectionTitle>
          <TierBadge />
          <Badge tone="sky">{state.resources.length} resources</Badge>
          <Badge tone="violet">{state.environments.length} envs</Badge>
          <Badge tone="violet">{moduleCount} module files</Badge>
          <Badge tone="emerald">{review.counts.adds} adds</Badge>
          <Badge tone="sky">{review.counts.existing} Existing</Badge>
          {review.counts.updates > 0 && (
            <Badge tone="violet">{review.counts.updates} updates</Badge>
          )}
          {hasOrphans && (
            <Badge tone="amber">
              {downloadGate.orphans.length} unassigned
            </Badge>
          )}
          {caCount > 0 && (
            <Badge tone="emerald">
              {caCount} container app{caCount === 1 ? "" : "s"}
            </Badge>
          )}
          {generated.sensitiveVars.length > 0 && (
            <Badge tone="amber">
              {generated.sensitiveVars.length} sensitive vars
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <SegmentedControl
            ariaLabel="Export view"
            size="sm"
            value={tab}
            onChange={setTab}
            options={[
              { value: "review", label: "Review changes" },
              { value: "structure", label: "Folder structure" },
              { value: "preview", label: "Live HCL" },
              { value: "files", label: "Files" },
            ]}
          />
          {(tab === "preview" || tab === "files") && (
            <Button variant="secondary" size="sm" onClick={onCopy}>
              {copied ? "Copied!" : "Copy"}
            </Button>
          )}
          {gateClear ? (
            <Button
              variant="primary"
              size="sm"
              onClick={onDownload}
              disabled={busy}
            >
              {busy ? "Zipping…" : "Download ZIP"}
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={onDownload}
                disabled={busy}
                title={downloadGate.reason}
              >
                {busy ? "Zipping…" : "Download ZIP"}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setLeaveConfirmOpen(true);
                  setTab("review");
                }}
                disabled={busy}
              >
                Leave unmapped…
              </Button>
            </>
          )}
        </div>
      </div>

      {leaveConfirmOpen && hasOrphans && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="leave-unmapped-title"
          className="mx-4 mt-3 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/50 p-4 shadow-sm"
        >
          <h3
            id="leave-unmapped-title"
            className="text-sm font-semibold text-amber-950 dark:text-amber-100"
          >
            Leave {downloadGate.orphans.length} resource
            {downloadGate.orphans.length === 1 ? "" : "s"} unmapped?
          </h3>
          <p className="mt-1 text-xs text-amber-900 dark:text-amber-200">
            They will be omitted from the ZIP. This is never silent — confirm
            only if you intend to exclude them. Prefer assigning folders in Map
            mode.
          </p>
          <ul className="mt-2 max-h-28 overflow-y-auto text-xs list-disc pl-5 text-amber-900 dark:text-amber-200 space-y-0.5">
            {downloadGate.orphans.map((r) => {
              const info = shortResourceInfo(r);
              return (
                <li key={r.id}>
                  {info.typeLabel} · {info.label}
                </li>
              );
            })}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="danger"
              size="sm"
              disabled={busy}
              onClick={() => doDownload(true)}
            >
              {busy ? "Zipping…" : "Download without them"}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={openMapForOrphans}
            >
              Assign folders instead
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLeaveConfirmOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {tab === "review" ? (
        <ReviewChangesPanel onOpenMap={openMapForOrphans} />
      ) : tab === "preview" ? (
        <pre className="flex-1 overflow-auto p-4 text-[12px] leading-relaxed font-mono text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-950/50">
          {preview}
        </pre>
      ) : tab === "structure" ? (
        <FolderStructurePanel
          mapMode={mapMode}
          onMapModeChange={setMapMode}
        />
      ) : (
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-12">
          <aside className="md:col-span-4 border-b md:border-b-0 md:border-r border-slate-200 dark:border-slate-700 overflow-y-auto p-2 bg-slate-50 dark:bg-slate-950/40">
            <ul className="space-y-0.5">
              {fileNames.map((name) => (
                <li key={name}>
                  <button
                    type="button"
                    onClick={() => setSelectedFile(name)}
                    className={`w-full text-left rounded-md px-2 py-1.5 text-[11px] font-mono truncate focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                      activeFile === name
                        ? "bg-sky-600 text-white"
                        : "text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800"
                    }`}
                  >
                    {name}
                  </button>
                </li>
              ))}
            </ul>
          </aside>
          <div className="md:col-span-8 min-h-0 flex flex-col">
            <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 text-xs font-mono text-sky-700 dark:text-sky-300">
              {activeFile}
            </div>
            <pre className="flex-1 overflow-auto p-4 text-[11px] leading-relaxed font-mono text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900">
              {activeFile ? generated.files[activeFile] : ""}
            </pre>
          </div>
        </div>
      )}
    </Card>
  );
}
