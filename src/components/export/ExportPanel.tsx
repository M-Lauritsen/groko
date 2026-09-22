"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useProject } from "@/lib/store/project-context";
import { previewHcl, generateProject } from "@/lib/generate/hcl";
import { downloadProjectZip } from "@/lib/generate/zip";
import {
  buildExportReviewSummary,
  canCopyWithMap,
  canDownloadWithMap,
  shortResourceInfo,
} from "@/lib/generate/export-map";
import { canExportWithValidExistingIdentifiers } from "@/lib/generate/existing-identifiers";
import { Button, Card, SectionTitle, Badge } from "@/components/ui/Field";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { TierBadge } from "@/components/project/TierBadge";
import { FolderStructurePanel } from "./FolderStructurePanel";
import { ReviewChangesPanel } from "./ReviewChangesPanel";

type Tab = "review" | "structure" | "preview" | "files";

export function ExportPanel({
  onOpenResource,
}: {
  onOpenResource?: (resourceId: string) => void;
}) {
  const { state } = useProject();
  const [tab, setTab] = useState<Tab>("review");
  const [mapMode, setMapMode] = useState(false);
  const [leaveUnmappedAction, setLeaveUnmappedAction] = useState<
    "download" | "copy"
  >("download");
  const [pendingCopyText, setPendingCopyText] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const leaveConfirmRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const copyButtonRef = useRef<HTMLButtonElement>(null);
  const leaveConfirmReturnTab = useRef<Tab | null>(null);
  const leaveConfirmTitleId = useId();
  const leaveConfirmDescriptionId = useId();

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
  const identifierGate = useMemo(
    () =>
      canExportWithValidExistingIdentifiers(
        state.resources,
        state.exportConfig
      ),
    [state.resources, state.exportConfig]
  );

  const gateClear = downloadGate.ok && identifierGate.ok;
  const hasOrphans = downloadGate.orphans.length > 0;

  useEffect(() => {
    if (!leaveConfirmOpen || !hasOrphans) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const root = leaveConfirmRef.current;
    if (!root) return;

    const focusables = () =>
      Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => !element.hasAttribute("disabled") && element.tabIndex !== -1);

    focusables()[0]?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeLeaveConfirmation();
        return;
      }

      if (event.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) return;

      const first = list[0];
      const last = list[list.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previouslyFocused.current?.focus?.();
    };
  }, [leaveConfirmOpen, hasOrphans]);

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
    if (!identifierGate.ok) {
      setLeaveConfirmOpen(false);
      setTab("review");
      return;
    }
    setBusy(true);
    try {
      await downloadProjectZip(
        state.config,
        state.resources,
        state.environments,
        state.exportConfig,
        { leaveUnmappedConfirmed }
      );
      setLeaveConfirmOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function onDownload() {
    if (!identifierGate.ok) {
      setLeaveConfirmOpen(false);
      setTab("review");
      return;
    }
    if (hasOrphans) {
      setLeaveUnmappedAction("download");
      setLeaveConfirmOpen(true);
      setTab("review");
      return;
    }
    await doDownload(false);
  }

  async function onCopy() {
    const gate = canCopyWithMap(state.resources, state.exportConfig, {
      mapMode,
    });
    const text =
      tab === "files" && activeFile
        ? generated.files[activeFile]
        : preview;
    if (!identifierGate.ok) {
      setTab("review");
      return;
    }
    if (!gate.ok) {
      setLeaveUnmappedAction("copy");
      setPendingCopyText(text);
      leaveConfirmReturnTab.current = tab;
      setLeaveConfirmOpen(true);
      setTab("review");
      return;
    }
    await copyGeneratedContent(text);
  }

  async function copyGeneratedContent(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function confirmLeaveUnmapped() {
    if (leaveUnmappedAction === "copy") {
      await copyGeneratedContent(pendingCopyText);
      closeLeaveConfirmation();
      return;
    }
    await doDownload(true);
  }

  const moduleCount = fileNames.filter((f) =>
    f.startsWith("modules/")
  ).length;
  const caCount = state.resources.filter(
    (r) => r.type === "azurerm_container_app"
  ).length;

  function openMapForOrphans() {
    leaveConfirmReturnTab.current = null;
    setTab("structure");
    setMapMode(true);
    setLeaveConfirmOpen(false);
  }

  function closeLeaveConfirmation() {
    const returnTab = leaveConfirmReturnTab.current;
    leaveConfirmReturnTab.current = null;
    setLeaveConfirmOpen(false);
    if (returnTab) {
      setTab(returnTab);
      requestAnimationFrame(() => copyButtonRef.current?.focus());
    }
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
            <Button
              variant="secondary"
              size="sm"
              ref={copyButtonRef}
              onClick={onCopy}
              disabled={!identifierGate.ok}
              title={identifierGate.reason}
            >
              {copied ? "Copied!" : "Copy"}
            </Button>
          )}
          {gateClear ? (
            <Button
              variant="primary"
              size="sm"
              onClick={onDownload}
              disabled={busy}
              title={identifierGate.reason ?? downloadGate.reason}
            >
              {busy ? "Zipping…" : "Download ZIP"}
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={onDownload}
                disabled={busy || !identifierGate.ok}
                title={identifierGate.reason ?? downloadGate.reason}
              >
                {busy ? "Zipping…" : "Download ZIP"}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setLeaveUnmappedAction("download");
                  setLeaveConfirmOpen(true);
                  setTab("review");
                }}
                disabled={busy || !identifierGate.ok}
              >
                Leave unmapped…
              </Button>
            </>
          )}
        </div>
      </div>

      {leaveConfirmOpen && hasOrphans && (
        <div
          ref={leaveConfirmRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={leaveConfirmTitleId}
          aria-describedby={leaveConfirmDescriptionId}
          className="mx-4 mt-3 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/50 p-4 shadow-sm"
        >
          <h3
            id={leaveConfirmTitleId}
            className="text-sm font-semibold text-amber-950 dark:text-amber-100"
          >
            Leave {downloadGate.orphans.length} resource
            {downloadGate.orphans.length === 1 ? "" : "s"} unmapped?
          </h3>
          <p
            id={leaveConfirmDescriptionId}
            className="mt-1 text-xs text-amber-900 dark:text-amber-200"
          >
            They will be omitted from exported content. This is never silent —
            confirm only if you intend to exclude them. Prefer assigning folders
            in Map mode.
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
              onClick={confirmLeaveUnmapped}
            >
              {leaveUnmappedAction === "copy"
                ? "Copy without them"
                : busy
                  ? "Zipping…"
                  : "Download without them"}
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
              onClick={closeLeaveConfirmation}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {tab === "review" ? (
        <ReviewChangesPanel
          onOpenMap={openMapForOrphans}
          onOpenResource={onOpenResource}
        />
      ) : tab === "preview" ? (
        <div className="flex-1 min-h-0 flex flex-col">
          {generated.validationIssues.length > 0 && (
            <p role="alert" className="mx-4 mt-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-900 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-100">
              Invalid preview—not exportable. Fix the Existing identifiers shown in Review changes.
            </p>
          )}
          <pre className="flex-1 overflow-auto p-4 text-[12px] leading-relaxed font-mono text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-950/50">
            {preview}
          </pre>
        </div>
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
            {generated.validationIssues.length > 0 && (
              <p role="alert" className="mx-3 mt-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-900 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-100">
                Invalid preview—not exportable. Fix the Existing identifiers shown in Review changes.
              </p>
            )}
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
