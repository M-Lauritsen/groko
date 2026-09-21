'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { ProjectProvider, useProject } from '@/lib/store/project-context';
import { ProjectSetup } from '@/components/project/ProjectSetup';
import { EnvironmentsPanel } from '@/components/project/EnvironmentsPanel';
import { Catalogue } from '@/components/resources/Catalogue';
import { ResourceList } from '@/components/resources/ResourceList';
import { ResourceForm } from '@/components/resources/ResourceForm';
import { DependencyGraph, type ResourcesViewMode } from '@/components/resources/DependencyGraph';
import { ExportPanel } from '@/components/export/ExportPanel';
import { Button, Badge } from '@/components/ui/Field';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ImportTerraform } from '@/components/project/ImportTerraform';
import { UndoRedoControls, UndoRedoKeyboard } from '@/components/history/UndoRedoControls';
import { tierShortLabel } from '@/lib/schema/environments';
import { normalizeScope, resourcesVisibleInEnv } from '@/lib/schema/environments';
import { TierBadge } from '@/components/project/TierBadge';
import { Tooltip } from '@/components/ui/Tooltip';
import { ResourceGuide } from '@/components/resources/ResourceGuide';
import { ProjectPersistence } from '@/components/project/ProjectPersistence';

type MainTab = 'environment' | 'builder' | 'export';
type EnvironmentView = 'overview' | 'setup' | 'environments';
type Theme = 'light' | 'dark';

const THEME_KEY = 'groko-theme';

function getTheme(): Theme {
	if (typeof window === 'undefined') return 'light';
	const stored = window.localStorage.getItem(THEME_KEY);
	if (stored === 'dark' || stored === 'light') return stored;
	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function subscribeToTheme(onChange: () => void) {
	window.addEventListener('storage', onChange);
	return () => window.removeEventListener('storage', onChange);
}

const MAIN_TABS: { id: MainTab; label: string }[] = [
	{ id: 'environment', label: '1. Environment' },
	{ id: 'builder', label: '2. Resources' },
	{ id: 'export', label: '3. Export' },
];

function ThemeToggle() {
	const theme = useSyncExternalStore(subscribeToTheme, getTheme, () => 'light');

	useEffect(() => {
		document.documentElement.classList.toggle('dark', theme === 'dark');
	}, [theme]);

	function toggleTheme() {
		const nextTheme: Theme = theme === 'dark' ? 'light' : 'dark';
		window.localStorage.setItem(THEME_KEY, nextTheme);
		window.dispatchEvent(new Event('storage'));
	}

	return (
		<Tooltip content={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
			<Button
				variant="secondary"
				size="sm"
				onClick={toggleTheme}
				aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
				<span aria-hidden>{theme === 'dark' ? '☀' : '☾'}</span>
				<span className="hidden lg:inline">{theme === 'dark' ? 'Light' : 'Dark'}</span>
			</Button>
		</Tooltip>
	);
}

function ShellInner() {
	const [tab, setTab] = useState<MainTab>('environment');
	const [environmentView, setEnvironmentView] = useState<EnvironmentView>('setup');
	const [resourcesView, setResourcesView] = useState<ResourcesViewMode>('list');
	const [guideOpen, setGuideOpen] = useState(false);
	const { state, setActiveEnvironment } = useProject();

	const activeId = state.activeEnvironmentId || state.environments[0]?.id || 'dev';

	const envOptions = state.environments.map((e) => ({
		value: e.id,
		label: e.displayName,
		shortLabel: tierShortLabel(e),
	}));
	const activeEnvironment = state.environments.find((e) => e.id === activeId) ?? state.environments[0];
	const visibleResources = activeEnvironment
		? resourcesVisibleInEnv(state.resources, activeEnvironment.id)
		: state.resources;
	const sharedResourceCount = visibleResources.filter(
		(resource) => normalizeScope(resource.scope).kind === 'shared',
	).length;
	const scopedResourceCount = visibleResources.length - sharedResourceCount;

	return (
		<div className="min-h-screen flex flex-col bg-slate-100 dark:bg-[#0f172a]">
			<UndoRedoKeyboard />
			<header className="sticky top-0 z-20 border-b border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-[#142338]/90 backdrop-blur">
				<div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
					<div className="flex items-center gap-3 min-w-0">
						<div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 text-white text-lg shadow-sm">
							☁
						</div>
						<div className="min-w-0">
							<h1 className="text-base font-bold text-slate-900 dark:text-white truncate">Azure TF Builder</h1>
							<p className="text-[11px] text-slate-500 truncate">
								Environment → Resources → Export · azurerm Terraform
							</p>
						</div>
						<Badge tone="sky">v1 · Azure</Badge>
						{(tab === 'builder' || tab === 'export') && <TierBadge />}
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

					<ThemeToggle />
					<ProjectPersistence />
					<Button
						variant="secondary"
						size="sm"
						aria-label="Resource guide"
						onClick={() => setGuideOpen(true)}>
						<span className="hidden sm:inline">Resource guide</span>
						<span
							className="sm:hidden"
							aria-hidden>
							Guide
						</span>
					</Button>
					<div className="hidden sm:flex items-center gap-2">
						<UndoRedoControls compact />
						<ImportTerraform
							compact
							onImported={() => setTab('builder')}
						/>
						{tab !== 'export' && (
							<Button
								variant="primary"
								size="sm"
								onClick={() => setTab('export')}>
								Preview & download →
							</Button>
						)}
					</div>
				</div>
			</header>

			<main className="flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-6 py-5">
				{tab === 'environment' && (
					<div className="max-w-5xl mx-auto space-y-5">
						<div className="rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-[#172638] shadow-sm p-5">
							<div className="flex flex-wrap items-center justify-between gap-3 mb-2">
								<div>
									<h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
										Active environment
									</h2>
									<p className="text-sm text-slate-500 dark:text-slate-300 mt-1">
										This is the environment you are currently editing. It sets the active tier (<strong>Dev</strong>,
										<strong>Staging</strong>, or <strong>Prod</strong>) and controls the knobs, rules, and resource
										visibility for this workspace. For example, switching to <strong>Prod</strong> applies production-focused
										settings and stricter review checks.
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

						<div className="flex flex-wrap items-center justify-between gap-3">
							<div>
								<h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Environment workspace</h2>
								<p className="text-sm text-slate-500 mt-1">
									Step 1 of 3: configure your Environment before defining Resources and preparing Export.
								</p>
							</div>
							<SegmentedControl
								ariaLabel="Environment workspace view"
								value={environmentView}
								onChange={setEnvironmentView}
								size="sm"
								options={[
									{ value: 'overview', label: 'Overview' },
									{ value: 'setup', label: 'Project setup' },
									{ value: 'environments', label: 'Environments' },
								]}
							/>
						</div>

						{environmentView === 'overview' && (
							<div className="space-y-4">
								<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
									<div className="rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-[#172638] p-4">
										<p className="text-xs font-medium uppercase tracking-wide text-slate-500">Project</p>
										<p className="mt-2 truncate text-lg font-semibold text-slate-900 dark:text-slate-100">
											{state.config.name || 'Unnamed project'}
										</p>
										<p className="mt-1 text-xs text-slate-500">{state.config.location || 'Location not set'}</p>
									</div>
									<div className="rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-[#172638] p-4">
										<p className="text-xs font-medium uppercase tracking-wide text-slate-500">Active environment</p>
										<p className="mt-2 truncate text-lg font-semibold text-slate-900 dark:text-slate-100">
											{activeEnvironment?.displayName ?? 'None'}
										</p>
										<p className="mt-1 text-xs text-slate-500">
											{activeEnvironment ? tierShortLabel(activeEnvironment) : 'Add an environment to begin'}
										</p>
									</div>
									<div className="rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-[#172638] p-4">
										<p className="text-xs font-medium uppercase tracking-wide text-slate-500">Resources in view</p>
										<p className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
											{visibleResources.length}
										</p>
										<p className="mt-1 text-xs text-slate-500">
											{sharedResourceCount} shared · {scopedResourceCount} environment-scoped
										</p>
									</div>
									<div className="rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-[#172638] p-4">
										<p className="text-xs font-medium uppercase tracking-wide text-slate-500">Environments</p>
										<p className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
											{state.environments.length}
										</p>
										<p className="mt-1 text-xs text-slate-500">Each gets its own knobs and export files</p>
									</div>
								</div>

								<div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
									<div className="rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-[#172638] p-5">
										<div className="flex flex-wrap items-start justify-between gap-3">
											<div>
												<h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
													Ready for the next step?
												</h2>
												<p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
													Resources are filtered by the active environment. Shared resources appear in every environment
													view.
												</p>
											</div>
											<TierBadge />
										</div>
										<div className="mt-4 flex flex-wrap gap-2">
											<Button
												variant="primary"
												onClick={() => setTab('builder')}>
												Continue to resources →
											</Button>
											<Button
												variant="secondary"
												onClick={() => setEnvironmentView('setup')}>
												Edit project setup
											</Button>
											<Button
												variant="secondary"
												onClick={() => setEnvironmentView('environments')}>
												Manage environments
											</Button>
										</div>
									</div>
									<div className="rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-[#172638] p-5">
										<h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
											Configuration snapshot
										</h2>
										<dl className="mt-3 space-y-2 text-sm">
											<div className="flex justify-between gap-3">
												<dt className="text-slate-500">Naming prefix</dt>
												<dd className="truncate font-medium text-slate-800 dark:text-slate-200">
													{state.config.namingPrefix || 'Not set'}
												</dd>
											</div>
											<div className="flex justify-between gap-3">
												<dt className="text-slate-500">Project tags</dt>
												<dd className="font-medium text-slate-800 dark:text-slate-200">
													{Object.keys(state.config.tags).length}
												</dd>
											</div>
										</dl>
									</div>
								</div>
							</div>
						)}

						{environmentView === 'setup' && <ProjectSetup onContinue={() => setTab('builder')} />}
						{environmentView === 'environments' && <EnvironmentsPanel hideActiveSwitcher />}
					</div>
				)}

				{tab === 'builder' && resourcesView === 'list' && (
					<div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-[calc(100vh-8.5rem)] min-h-[520px]">
						<div className="lg:col-span-3 min-h-0">
							<ResourceList
								viewMode={resourcesView}
								onViewModeChange={setResourcesView}
								onGoToEnvironment={() => setTab('environment')}
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

				{tab === 'builder' && resourcesView === 'graph' && (
					<div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-[calc(100vh-8.5rem)] min-h-[520px]">
						<div className="lg:col-span-7 min-h-0">
							<DependencyGraph
								viewMode={resourcesView}
								onViewModeChange={setResourcesView}
								onGoToEnvironment={() => setTab('environment')}
							/>
						</div>
						<div className="lg:col-span-5 min-h-0">
							{/* Same ResourceForm + selectedResourceId — no parallel detail schema */}
							<ResourceForm />
						</div>
					</div>
				)}

				{tab === 'export' && (
					<div className="h-[calc(100vh-8.5rem)] min-h-[520px]">
						<ExportPanel />
					</div>
				)}
			</main>

			{guideOpen && <ResourceGuide onClose={() => setGuideOpen(false)} />}

			<footer className="border-t border-slate-200 dark:border-slate-800 py-3 text-center text-[11px] text-slate-400">
				Azure TF Builder · client-side generation · no secrets leave your browser · azurerm {'~>'} 4.0
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
