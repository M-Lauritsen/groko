"use client";

import { useMemo, useState } from "react";
import { useProject } from "@/lib/store/project-context";
import { previewHcl, generateProject } from "@/lib/generate/hcl";
import { downloadProjectZip } from "@/lib/generate/zip";
import { Button, Card, SectionTitle, Badge } from "@/components/ui/Field";

type Tab = "preview" | "files";

export function ExportPanel() {
  const { state } = useProject();
  const [tab, setTab] = useState<Tab>("preview");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const preview = useMemo(
    () => previewHcl(state.config, state.resources, state.environments),
    [state.config, state.resources, state.environments]
  );

  const generated = useMemo(
    () => generateProject(state.config, state.resources, state.environments),
    [state.config, state.resources, state.environments]
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

  const activeFile = selectedFile && generated.files[selectedFile]
    ? selectedFile
    : fileNames[0] ?? null;

  async function onDownload() {
    setBusy(true);
    try {
      await downloadProjectZip(state.config, state.resources, state.environments);
    } finally {
      setBusy(false);
    }
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

  return (
    <Card className="flex flex-col h-full min-h-0 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <SectionTitle>Export</SectionTitle>
          <Badge tone="sky">{state.resources.length} resources</Badge>
          <Badge tone="violet">{state.environments.length} envs</Badge>
          <Badge tone="violet">{moduleCount} module files</Badge>
          {caCount > 0 && (
            <Badge tone="emerald">{caCount} container app{caCount === 1 ? "" : "s"}</Badge>
          )}
          {generated.sensitiveVars.length > 0 && (
            <Badge tone="amber">
              {generated.sensitiveVars.length} sensitive vars
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden text-xs">
            <button
              type="button"
              className={`px-3 py-1.5 ${
                tab === "preview"
                  ? "bg-sky-600 text-white"
                  : "bg-white dark:bg-slate-900 text-slate-600"
              }`}
              onClick={() => setTab("preview")}
            >
              Live HCL
            </button>
            <button
              type="button"
              className={`px-3 py-1.5 ${
                tab === "files"
                  ? "bg-sky-600 text-white"
                  : "bg-white dark:bg-slate-900 text-slate-600"
              }`}
              onClick={() => setTab("files")}
            >
              Files
            </button>
          </div>
          <Button variant="secondary" size="sm" onClick={onCopy}>
            {copied ? "Copied!" : "Copy"}
          </Button>
          <Button variant="primary" size="sm" onClick={onDownload} disabled={busy}>
            {busy ? "Zipping…" : "Download ZIP"}
          </Button>
        </div>
      </div>

      {tab === "preview" ? (
        <pre className="flex-1 overflow-auto p-4 text-[12px] leading-relaxed font-mono text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-950/50">
          {preview}
        </pre>
      ) : (
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-12">
          <aside className="md:col-span-4 border-b md:border-b-0 md:border-r border-slate-200 dark:border-slate-700 overflow-y-auto p-2 bg-slate-50 dark:bg-slate-950/40">
            <ul className="space-y-0.5">
              {fileNames.map((name) => (
                <li key={name}>
                  <button
                    type="button"
                    onClick={() => setSelectedFile(name)}
                    className={`w-full text-left rounded-md px-2 py-1.5 text-[11px] font-mono truncate ${
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
