'use client';

import { useMemo, useRef, useState } from 'react';
import { useProject } from '@/lib/store/project-context';
import { serializeProject } from '@/lib/store/project-persistence';
import { defaultEnvironments, envScope, sharedScope } from '@/lib/schema/environments';
import { Button, Card, Hint, Label, TextInput } from '@/components/ui/Field';

const DRAFTS_KEY = 'groko-project-drafts';

type Draft = { name: string; savedAt: string; payload: string };

const SAMPLE_PROJECT_DRAFT: Draft = {
	name: 'Sample project',
	savedAt: '2024-01-01T00:00:00.000Z',
	payload: serializeProject({
		config: {
			name: 'demo-azure-project',
			location: 'westeurope',
			namingPrefix: 'demoapp',
			tags: { Environment: 'dev', ManagedBy: 'terraform', Owner: 'platform-team' },
			starter: 'web-sql',
		},
		environments: defaultEnvironments(),
		activeEnvironmentId: 'dev',
		resources: [
			{
				id: 'sample-rg',
				type: 'azurerm_resource_group',
				tfName: 'main',
				useExisting: false,
				values: {
					name: 'demoapp-rg',
					location: 'westeurope',
					tags: { Environment: 'dev', ManagedBy: 'terraform', Owner: 'platform-team' },
				},
				existingValues: {},
				scope: sharedScope(),
			},
			{
				id: 'sample-plan',
				type: 'azurerm_service_plan',
				tfName: 'main',
				useExisting: false,
				values: {
					name: 'demoapp-asp',
					resource_group_name: { resourceId: 'sample-rg', attr: 'name' },
					location: { resourceId: 'sample-rg', attr: 'location' },
					os_type: 'Linux',
					sku_name: 'B1',
					tags: { Environment: 'dev', ManagedBy: 'terraform', Owner: 'platform-team' },
				},
				existingValues: {},
				scope: envScope('dev'),
			},
			{
				id: 'sample-app',
				type: 'azurerm_linux_web_app',
				tfName: 'main',
				useExisting: false,
				values: {
					name: 'demoapp-web',
					resource_group_name: { resourceId: 'sample-rg', attr: 'name' },
					location: { resourceId: 'sample-rg', attr: 'location' },
					service_plan_id: { resourceId: 'sample-plan', attr: 'id' },
					https_only: true,
					node_version: '20-lts',
					tags: { Environment: 'dev', ManagedBy: 'terraform', Owner: 'platform-team' },
				},
				existingValues: {},
				scope: envScope('dev'),
			},
			{
				id: 'sample-sql',
				type: 'azurerm_mssql_server',
				tfName: 'main',
				useExisting: false,
				values: {
					name: 'demoapp-sql',
					resource_group_name: { resourceId: 'sample-rg', attr: 'name' },
					location: { resourceId: 'sample-rg', attr: 'location' },
					version: '12.0',
					administrator_login: 'sqladmin',
					administrator_login_password: 'Replace-With-Strong-Password!',
					minimum_tls_version: '1.2',
					tags: { Environment: 'dev', ManagedBy: 'terraform', Owner: 'platform-team' },
				},
				existingValues: {},
				scope: envScope('dev'),
			},
			{
				id: 'sample-db',
				type: 'azurerm_mssql_database',
				tfName: 'main',
				useExisting: false,
				values: {
					name: 'demoapp-db',
					server_id: { resourceId: 'sample-sql', attr: 'id' },
					collation: 'SQL_Latin1_General_CP1_CI_AS',
					max_size_gb: 2,
					sku_name: 'Basic',
					tags: { Environment: 'dev', ManagedBy: 'terraform', Owner: 'platform-team' },
				},
				existingValues: {},
				scope: envScope('dev'),
			},
		],
		selectedResourceId: null,
		exportConfig: { moduleByResourceId: {} },
	}),
};

function readDrafts(): Draft[] {
	try {
		const value = JSON.parse(window.localStorage.getItem(DRAFTS_KEY) ?? '[]');
		const drafts = Array.isArray(value)
			? value.filter((draft) => draft && typeof draft.name === 'string' && typeof draft.payload === 'string')
			: [];
		if (!drafts.some((draft) => draft.name === SAMPLE_PROJECT_DRAFT.name)) {
			return [SAMPLE_PROJECT_DRAFT, ...drafts].sort((left, right) => right.savedAt.localeCompare(left.savedAt));
		}
		return drafts.sort((left, right) => right.savedAt.localeCompare(left.savedAt));
	} catch {
		return [SAMPLE_PROJECT_DRAFT];
	}
}

function writeDrafts(drafts: Draft[]) {
	window.localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
}

export function ProjectPersistence() {
	const { state, replaceProject } = useProject();
	const [open, setOpen] = useState(false);
	const [draftName, setDraftName] = useState(state.config.name || 'untitled-project');
	const [drafts, setDrafts] = useState<Draft[]>([]);
	const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
	const [savedSnapshot, setSavedSnapshot] = useState('');
	const fileInputRef = useRef<HTMLInputElement>(null);

	const currentSnapshot = useMemo(
		() =>
			JSON.stringify({
				config: state.config,
				environments: state.environments,
				activeEnvironmentId: state.activeEnvironmentId,
				resources: state.resources,
				exportConfig: state.exportConfig,
			}),
		[state],
	);
	const isDirty = currentSnapshot !== savedSnapshot;

	function refreshDrafts() {
		setDrafts(readDrafts().sort((left, right) => right.savedAt.localeCompare(left.savedAt)));
	}

	function saveDraft() {
		const name = draftName.trim() || state.config.name.trim() || 'untitled-project';
		const savedAt = new Date().toISOString();
		const nextDraft = { name, savedAt, payload: serializeProject(state, savedAt) };
		try {
			writeDrafts([nextDraft, ...readDrafts().filter((draft) => draft.name !== name)]);
			setDrafts(readDrafts().sort((left, right) => right.savedAt.localeCompare(left.savedAt)));
			setLastSavedAt(savedAt);
			setSavedSnapshot(currentSnapshot);
		} catch {
			setLastSavedAt(null);
		}
	}

	function downloadProject() {
		const name = draftName.trim() || state.config.name.trim() || 'untitled-project';
		const blob = new Blob([serializeProject(state)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = `${name.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-|-$/g, '') || 'groko-project'}.groko.json`;
		link.click();
		URL.revokeObjectURL(url);
	}

	function loadProject(payload: string) {
		if (
			isDirty &&
			(state.resources.length > 0 || state.config.name !== 'my-azure-project') &&
			!window.confirm('Replace the current project with this saved project?')
		)
			return;
		try {
			replaceProject(payload);
			setSavedSnapshot(JSON.stringify(JSON.parse(payload).state));
			setLastSavedAt(new Date().toISOString());
			setOpen(false);
		} catch (error) {
			window.alert(error instanceof Error ? error.message : 'This project could not be opened.');
		}
	}

	function importProject(event: React.ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0];
		if (!file) return;
		void file
			.text()
			.then(loadProject)
			.finally(() => {
				event.target.value = '';
			});
	}

	return (
		<div className="relative">
			<div className="flex items-center gap-2">
				<span
					className={`hidden lg:inline text-[11px] ${isDirty ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
					{isDirty ? 'Unsaved changes' : lastSavedAt ? 'Saved locally' : 'Not saved'}
				</span>
				<Button
					variant="secondary"
					size="sm"
					onClick={() => {
						setOpen((value) => !value);
						refreshDrafts();
					}}>
					Project
				</Button>
			</div>

			{open && (
				<Card className="absolute right-0 top-10 z-30 w-[min(22rem,calc(100vw-2rem))] p-4">
					<div className="flex items-start justify-between gap-3">
						<div>
							<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Project files</h2>
							<Hint>Save the editable project model, not generated infrastructure files.</Hint>
						</div>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setOpen(false)}
							aria-label="Close project menu">
							Close
						</Button>
					</div>
					<div className="mt-4">
						<Label htmlFor="project-draft-name">Project name</Label>
						<TextInput
							id="project-draft-name"
							value={draftName}
							onChange={(event) => setDraftName(event.target.value)}
						/>
					</div>
					<div className="mt-3 flex flex-wrap gap-2">
						<Button
							size="sm"
							onClick={saveDraft}>
							Save draft
						</Button>
						<Button
							variant="secondary"
							size="sm"
							onClick={downloadProject}>
							Download project file
						</Button>
					</div>
					<div className="mt-2 flex flex-wrap gap-2">
						<Button
							variant="secondary"
							size="sm"
							onClick={() => fileInputRef.current?.click()}>
							Import project file
						</Button>
						<input
							ref={fileInputRef}
							type="file"
							accept="application/json,.json,.groko.json"
							onChange={importProject}
							className="sr-only"
						/>
					</div>
					<div className="mt-5 border-t border-slate-200 pt-3 dark:border-slate-700">
						<h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Saved drafts</h3>
						{drafts.length === 0 ? (
							<p className="mt-2 text-xs text-slate-500">No browser drafts yet.</p>
						) : (
							<ul className="mt-2 space-y-1">
								{drafts.map((draft) => (
									<li
										key={`${draft.name}-${draft.savedAt}`}
										className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800">
										<span className="min-w-0 truncate text-xs text-slate-700 dark:text-slate-200">{draft.name}</span>
										<Button
											variant="ghost"
											size="sm"
											onClick={() => loadProject(draft.payload)}>
											Open
										</Button>
									</li>
								))}
							</ul>
						)}
					</div>
				</Card>
			)}
		</div>
	);
}
