'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useProject } from '@/lib/store/project-context';
import { STARTERS } from '@/lib/schema/starters';
import { AZURE_LOCATIONS } from '@/lib/schema/types';
import { starterConfirmKind } from '@/lib/store/prod-friction';
import { Label, TextInput, SelectInput, Hint, Button, Card, SectionTitle, Badge } from '@/components/ui/Field';
import { ProdFrictionDialog } from '@/components/project/ProdFrictionDialog';

export function ProjectSetup({ onContinue }: { onContinue?: () => void }) {
	const { state, setConfig, applyStarter } = useProject();
	const { config } = state;
	const [tagKey, setTagKey] = useState('');
	const [tagVal, setTagVal] = useState('');
	const [confirmStarter, setConfirmStarter] = useState<string | null>(null);
	const [prodStarter, setProdStarter] = useState<string | null>(null);
	const dialogRef = useRef<HTMLDivElement>(null);
	const previouslyFocused = useRef<HTMLElement | null>(null);
	const titleId = useId();

	const activeEnv = useMemo(
		() => state.environments.find((e) => e.id === state.activeEnvironmentId) ?? state.environments[0],
		[state.environments, state.activeEnvironmentId],
	);

	function addTag() {
		if (!tagKey.trim()) return;
		setConfig({ tags: { ...config.tags, [tagKey.trim()]: tagVal } });
		setTagKey('');
		setTagVal('');
	}

	function removeTag(key: string) {
		const next = { ...config.tags };
		delete next[key];
		setConfig({ tags: next });
	}

	function onStarterClick(id: string) {
		const kind = starterConfirmKind(state.resources.length, activeEnv);
		if (kind === 'prod') {
			previouslyFocused.current = document.activeElement as HTMLElement | null;
			setProdStarter(id);
			setConfirmStarter(null);
		} else if (kind === 'normal') {
			previouslyFocused.current = document.activeElement as HTMLElement | null;
			setConfirmStarter(id);
			setProdStarter(null);
		} else {
			applyStarter(id, 'replace');
		}
	}

	function closeConfirm() {
		setConfirmStarter(null);
		previouslyFocused.current?.focus?.();
	}

	function closeProdConfirm() {
		setProdStarter(null);
		previouslyFocused.current?.focus?.();
	}

	// Focus trap + Esc for starter confirm dialog
	useEffect(() => {
		if (!confirmStarter) return;
		const root = dialogRef.current;
		if (!root) return;

		const focusables = () =>
			Array.from(
				root.querySelectorAll<HTMLElement>(
					'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
				),
			).filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1);

		const first = focusables()[0];
		first?.focus();

		function onKeyDown(e: KeyboardEvent) {
			if (e.key === 'Escape') {
				e.preventDefault();
				closeConfirm();
				return;
			}
			if (e.key !== 'Tab' || !root) return;
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

		document.addEventListener('keydown', onKeyDown);
		return () => document.removeEventListener('keydown', onKeyDown);
	}, [confirmStarter]);

	const pendingLabel = STARTERS.find((s) => s.id === confirmStarter)?.label ?? confirmStarter;

	return (
		<div className="space-y-6">
			<Card className="p-5">
				<SectionTitle>Environment</SectionTitle>
				<div className="grid gap-4 sm:grid-cols-2">
					<div>
						<Label
							htmlFor="proj-name"
							required>
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
						<Label
							htmlFor="proj-location"
							required>
							Location / region
						</Label>
						<SelectInput
							id="proj-location"
							value={config.location}
							onChange={(e) => setConfig({ location: e.target.value })}>
							{AZURE_LOCATIONS.map((l) => (
								<option
									key={l.value}
									value={l.value}>
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
							Used when naming new resources (e.g.{' '}
							<code className="text-sky-600">{config.namingPrefix || 'prefix'}-rg</code>
							).
						</Hint>
					</div>
				</div>

				<div className="mt-4">
					<Label>Tags</Label>
					<p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
						Tags are metadata key/value pairs attached to generated resources. Use them for ownership, cost tracking,
						and filtering. Example: <span className="font-medium text-slate-700 dark:text-slate-200">Environment=dev</span>
						, <span className="font-medium text-slate-700 dark:text-slate-200">ManagedBy=terraform</span>.
					</p>
					<div className="flex flex-wrap gap-2 mb-2 mt-3">
						{Object.entries(config.tags).map(([k, v]) => (
							<span
								key={k}
								className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-xs">
								<span className="font-medium text-slate-700 dark:text-slate-200">{k}</span>
								<span className="text-slate-400">=</span>
								<span className="text-slate-600 dark:text-slate-300">{v}</span>
								<button
									type="button"
									onClick={() => removeTag(k)}
									className="ml-1 text-slate-400 hover:text-rose-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 rounded"
									aria-label={`Remove tag ${k}`}>
									×
								</button>
							</span>
						))}
						{Object.keys(config.tags).length === 0 && <span className="text-xs text-slate-400">No tags yet</span>}
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
							onKeyDown={(e) => e.key === 'Enter' && addTag()}
						/>
						<Button
							type="button"
							variant="secondary"
							size="sm"
							onClick={addTag}>
							Add
						</Button>
					</div>
				</div>
			</Card>

			<Card className="p-5">
				<SectionTitle>Starters</SectionTitle>
				<p className="text-sm text-slate-500 mb-4">
					Scaffold a common topology. On an empty canvas the starter applies immediately; if you already have resources
					you can replace or merge.
				</p>
				<div
					className="grid gap-3 sm:grid-cols-2"
					role="group"
					aria-label="Starter templates">
					{STARTERS.map((s) => {
						const isActive = config.starter === s.id && (s.id === 'blank' ? state.resources.length === 0 : true);
						return (
							<button
								key={s.id}
								type="button"
								onClick={() => onStarterClick(s.id)}
								aria-pressed={isActive}
								className={`text-left rounded-xl border p-4 transition-all hover:border-sky-400 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 ${
									isActive
										? 'border-sky-500 bg-sky-50 dark:bg-sky-950/40 ring-1 ring-sky-500'
										: 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'
								}`}>
								<div className="flex items-start gap-3">
									<span
										className="text-2xl"
										aria-hidden>
										{s.icon}
									</span>
									<div>
										<div className="flex items-center gap-2">
											<span className="font-semibold text-slate-900 dark:text-slate-100">{s.label}</span>
											{isActive && <Badge tone="sky">Active</Badge>}
										</div>
										<p className="mt-1 text-xs text-slate-500 leading-relaxed">{s.description}</p>
									</div>
								</div>
							</button>
						);
					})}
				</div>

				{confirmStarter && (
					<div
						ref={dialogRef}
						role="dialog"
						aria-modal="true"
						aria-labelledby={titleId}
						className="mt-4 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-700 p-4">
						<p
							id={titleId}
							className="text-sm text-amber-900 dark:text-amber-200 mb-1 font-medium">
							Apply starter “{pendingLabel}”?
						</p>
						<p className="text-sm text-amber-800 dark:text-amber-300/90 mb-3">
							Your canvas already has {state.resources.length} resource(s). Choose how to apply the starter — nothing is
							changed until you pick an option. Press Esc to cancel.
						</p>
						<div className="flex flex-wrap gap-2">
							<Button
								variant="primary"
								size="sm"
								onClick={() => {
									applyStarter(confirmStarter, 'replace');
									closeConfirm();
								}}>
								Replace all
							</Button>
							<Button
								variant="secondary"
								size="sm"
								onClick={() => {
									applyStarter(confirmStarter, 'merge');
									closeConfirm();
								}}>
								Merge with starter
							</Button>
							<Button
								variant="ghost"
								size="sm"
								onClick={closeConfirm}>
								Cancel
							</Button>
						</div>
					</div>
				)}

				{prodStarter && activeEnv && (
					<ProdFrictionDialog
						environment={activeEnv}
						variant="starter"
						showMerge
						onReplace={() => {
							applyStarter(prodStarter, 'replace');
							closeProdConfirm();
						}}
						onMerge={() => {
							applyStarter(prodStarter, 'merge');
							closeProdConfirm();
						}}
						onCancel={closeProdConfirm}
					/>
				)}
			</Card>

			<Card className="p-5">
				<SectionTitle>Environment ready</SectionTitle>
				<p className="text-sm text-slate-600 dark:text-slate-300">
					Your Environment is configured. Next, define its resources. Choose a starter above to add a common resource
					set, or continue to Resources to add building blocks individually from the catalogue. When your resource set
					is ready, review it in Export.
				</p>
				<p className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
					Environment complete -&gt; Resources next -&gt; Export when ready
				</p>
				<div className="mt-4">
					<Button
						type="button"
						variant="primary"
						onClick={() => onContinue?.()}>
						Continue to Resources
					</Button>
				</div>
			</Card>
		</div>
	);
}
