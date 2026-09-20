"use client";

import { useState } from "react";
import { ProjectProvider, useProject } from "@/lib/store/project-context";
import { ProjectSetup } from "@/components/project/ProjectSetup";
import { EnvironmentsPanel } from "@/components/project/EnvironmentsPanel";
import { Catalogue } from "@/components/resources/Catalogue";
import { ResourceList } from "@/components/resources/ResourceList";
import { ResourceForm } from "@/components/resources/ResourceForm";
import {
  DependencyGraph,
  type ResourcesViewMode,
} from "@/components/resources/DependencyGraph";
import { ExportPanel } from "@/components/export/ExportPanel";
import { Button, Badge } from "@/components/ui/Field";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ImportTerraform } from "@/components/project/ImportTerraform";
import { UndoRedoControls, UndoRedoKeyboard } from "@/components/history/UndoRedoControls";
import { tierShortLabel } from "@/lib/schema/environments";
import { TierBadge } from "@/components/project/TierBadge";

type MainTab = "environment" | "builder" | "export";

const MAIN_TABS: { id: MainTab; label: string }[] = [
  { id: "environment", label: "1. Environment" },
  { id: "builder", label: "2. Resources" },
  { id: "export", label: "3. Export" },
];


function ShellInner() {
  const [tab, setTab] = useState<MainTab>("environment");
  const [resourcesView, setResourcesView] =
    useState<ResourcesViewMode>("list");
  const { state, setActiveEnvironment } = useProject();

  const activeId =
    state.activeEnvironmentId || state.environments[0]?.id || "dev";

  const envOptions = state.environments.map((e) => ({
    value: e.id,
    label: e.displayName,
    shortLabel: tierShortLabel(e),
  }));

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
                Environment → Resources → Export · azurerm Terraform
              </p>
            </div>
            <Badge tone="sky">v1 · Azure</Badge>
            {(tab === "builder" || tab === "export") && <TierBadge />}
          </div>

          <SegmentedControl
            ariaLabel="Main steps"
            value={tab}
            onChange={setTab}
            options={MAIN_TABS.map((t) => ({
              value: t.id,
              label: t.label,
            }))}
          />

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
        {tab === "environment" && (
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm p-5">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Active environment
                  </h2>
                  <p className="text-sm text-slate-500 mt-1">
                    Choose <strong>Dev</strong>, <strong>Staging</strong>, or{" "}
                    <strong>Prod</strong> (required). Knobs and resource
                    visibility follow this tier.
                  </p>
                </div>
                <TierBadge />
              </div>
              {envOptions.length > 0 && (
                <SegmentedControl
                  ariaLabel="Active environment tier"
                  value={activeId}
                  onChange={setActiveEnvironment}
                  options={envOptions}
                  className="mt-3"
                />
              )}
            </div>

            <ProjectSetup />
            <EnvironmentsPanel hideActiveSwitcher />
            <div className="flex justify-end">
              <Button variant="primary" onClick={() => setTab("builder")}>
                Continue to resources →
              </Button>
            </div>
          </div>
        )}

        {tab === "builder" && resourcesView === "list" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-[calc(100vh-8.5rem)] min-h-[520px]">
            <div className="lg:col-span-3 min-h-0">
              <ResourceList
                viewMode={resourcesView}
                onViewModeChange={setResourcesView}
              />
            </div>
            <div className="lg:col-span-5 min-h-0">
              <ResourceForm />
            </div>
            <div className="lg:col-span-4 min-h-0">
              <Catalogue />
            </div>
          </div>
        )}

        {tab === "builder" && resourcesView === "graph" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-[calc(100vh-8.5rem)] min-h-[520px]">
            <div className="lg:col-span-7 min-h-0">
              <DependencyGraph
                viewMode={resourcesView}
                onViewModeChange={setResourcesView}
              />
            </div>
            <div className="lg:col-span-5 min-h-0">
              {/* Same ResourceForm + selectedResourceId — no parallel detail schema */}
              <ResourceForm />
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
