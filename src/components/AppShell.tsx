"use client";

import { useState } from "react";
import { ProjectProvider, useProject } from "@/lib/store/project-context";
import { ProjectSetup } from "@/components/project/ProjectSetup";
import { EnvironmentsPanel } from "@/components/project/EnvironmentsPanel";
import { Catalogue } from "@/components/resources/Catalogue";
import { ResourceList } from "@/components/resources/ResourceList";
import { ResourceForm } from "@/components/resources/ResourceForm";
import { ExportPanel } from "@/components/export/ExportPanel";
import { Button, Badge } from "@/components/ui/Field";
import { ImportTerraform } from "@/components/project/ImportTerraform";
import { UndoRedoControls, UndoRedoKeyboard } from "@/components/history/UndoRedoControls";

type MainTab = "setup" | "environments" | "builder" | "export";

function ActiveEnvBadge() {
  const { state } = useProject();
  const env =
    state.environments.find((e) => e.id === state.activeEnvironmentId) ??
    state.environments[0];
  if (!env) return null;
  return (
    <Badge tone="violet">
      env: {env.displayName}
    </Badge>
  );
}

function ShellInner() {
  const [tab, setTab] = useState<MainTab>("setup");

  return (
    <div className="min-h-screen flex flex-col bg-slate-100 dark:bg-slate-950">
      <UndoRedoKeyboard />
      <header className="sticky top-0 z-20 border-b border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 text-white text-lg shadow-sm">
              ☁
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-bold text-slate-900 dark:text-white truncate">
                Azure TF Builder
              </h1>
              <p className="text-[11px] text-slate-500 truncate">
                Environment → Resources → Refs · export azurerm Terraform
              </p>
            </div>
            <Badge tone="sky">v1 · Azure</Badge>
            <ActiveEnvBadge />
          </div>

          <nav className="flex items-center gap-1 rounded-xl border border-slate-200 dark:border-slate-700 p-1 bg-slate-50 dark:bg-slate-950 overflow-x-auto">
            {(
              [
                { id: "setup", label: "1. Setup" },
                { id: "environments", label: "2. Environments" },
                { id: "builder", label: "3. Resources" },
                { id: "export", label: "4. Export" },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap ${
                  tab === t.id
                    ? "bg-white dark:bg-slate-800 text-sky-700 dark:text-sky-300 shadow-sm"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="hidden sm:flex items-center gap-2">
            <UndoRedoControls compact />
            <ImportTerraform
              compact
              onImported={() => setTab("builder")}
            />
            {tab !== "export" && (
              <Button variant="primary" size="sm" onClick={() => setTab("export")}>
                Preview & download →
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-6 py-5">
        {tab === "setup" && (
          <div className="max-w-3xl mx-auto">
            <ProjectSetup />
            <div className="mt-6 flex justify-end">
              <Button variant="primary" onClick={() => setTab("environments")}>
                Continue to environments →
              </Button>
            </div>
          </div>
        )}

        {tab === "environments" && (
          <div className="max-w-3xl mx-auto">
            <EnvironmentsPanel />
            <div className="mt-6 flex justify-end">
              <Button variant="primary" onClick={() => setTab("builder")}>
                Continue to resources →
              </Button>
            </div>
          </div>
        )}

        {tab === "builder" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-[calc(100vh-8.5rem)] min-h-[520px]">
            <div className="lg:col-span-3 min-h-0">
              <ResourceList />
            </div>
            <div className="lg:col-span-5 min-h-0">
              <ResourceForm />
            </div>
            <div className="lg:col-span-4 min-h-0">
              <Catalogue />
            </div>
          </div>
        )}

        {tab === "export" && (
          <div className="h-[calc(100vh-8.5rem)] min-h-[520px]">
            <ExportPanel />
          </div>
        )}
      </main>

      <footer className="border-t border-slate-200 dark:border-slate-800 py-3 text-center text-[11px] text-slate-400">
        Azure TF Builder · client-side generation · no secrets leave your browser ·
        azurerm {'~>'} 4.0
      </footer>
    </div>
  );
}

export function AppShell() {
  return (
    <ProjectProvider>
      <ShellInner />
    </ProjectProvider>
  );
}
