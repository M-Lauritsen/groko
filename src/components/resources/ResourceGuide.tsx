'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { RESOURCE_CATALOGUE } from '@/lib/schema/resources';
import { RESOURCE_ASSISTANCE } from '@/lib/help/assistance';
import { MODULE_DEFS, resourceBuildStageForType } from '@/lib/generate/modules';
import { Badge, Button, Hint, Label, TextInput } from '@/components/ui/Field';

export function ResourceGuide({ onClose }: { onClose: () => void }) {
	const [query, setQuery] = useState('');
	const [selectedType, setSelectedType] = useState(RESOURCE_CATALOGUE[0]?.type ?? '');
	const dialogRef = useRef<HTMLDivElement>(null);

	const filtered = useMemo(() => {
		const normalized = query.trim().toLowerCase();
		if (!normalized) return RESOURCE_CATALOGUE;
		return RESOURCE_CATALOGUE.filter((resource) =>
			[resource.label, resource.category, resource.description, resource.type].some((value) =>
				value.toLowerCase().includes(normalized),
			),
		);
	}, [query]);

	const selected = RESOURCE_CATALOGUE.find((resource) => resource.type === selectedType) ?? filtered[0];
	const assistance = selected ? RESOURCE_ASSISTANCE[selected.type] : undefined;
	const moduleDefinition = selected
		? MODULE_DEFS.find((definition) => definition.types.includes(selected.type))
		: undefined;
	const stage = selected ? resourceBuildStageForType(selected.type) : undefined;

	useEffect(() => {
		const root = dialogRef.current;
		if (!root) return;
		const focusables = () =>
			Array.from(root.querySelectorAll<HTMLElement>('button, input')).filter(
				(element) => !element.hasAttribute('disabled'),
			);
		focusables()[0]?.focus();
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === 'Escape') {
				event.preventDefault();
				onClose();
				return;
			}
			if (event.key !== 'Tab') return;
			const items = focusables();
			if (items.length < 2) return;
			const first = items[0];
			const last = items[items.length - 1];
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		}
		document.addEventListener('keydown', onKeyDown);
		return () => document.removeEventListener('keydown', onKeyDown);
	}, [onClose]);

	return (
		<div
			className="fixed inset-0 z-40 bg-slate-950/50 p-4 sm:p-8"
			role="presentation"
			onMouseDown={onClose}>
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby="resource-guide-title"
				className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
				onMouseDown={(event) => event.stopPropagation()}>
				<header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
					<div>
						<h2
							id="resource-guide-title"
							className="text-lg font-semibold text-slate-900 dark:text-slate-100">
							Resource guide
						</h2>
						<p className="mt-1 text-sm text-slate-500">
							Understand what each resource does, when to use it, and what to consider before export.
						</p>
					</div>
					<Button
						variant="ghost"
						size="sm"
						onClick={onClose}
						aria-label="Close resource guide">
						Close
					</Button>
				</header>

				<div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(220px,0.8fr)_minmax(0,1.7fr)]">
					<aside className="min-h-0 overflow-y-auto border-b border-slate-200 p-4 dark:border-slate-700 md:border-b-0 md:border-r">
						<Label htmlFor="resource-guide-search">Search resources</Label>
						<TextInput
							id="resource-guide-search"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Search by name or category"
						/>
						<div className="mt-4 space-y-1">
							{filtered.map((resource) => (
								<button
									key={resource.type}
									type="button"
									onClick={() => setSelectedType(resource.type)}
									className={`w-full rounded-lg border px-3 py-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${selected?.type === resource.type ? 'border-sky-300 bg-sky-50 dark:border-sky-700 dark:bg-sky-950/40' : 'border-transparent hover:border-slate-200 hover:bg-slate-50 dark:hover:border-slate-700 dark:hover:bg-slate-800'}`}>
									<div className="flex items-center gap-2">
										<span aria-hidden>{resource.icon}</span>
										<span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
											{resource.label}
										</span>
									</div>
									<span className="mt-0.5 block truncate text-xs text-slate-500">{resource.category}</span>
								</button>
							))}
							{filtered.length === 0 && (
								<p className="px-2 py-4 text-sm text-slate-500">No resources match that search.</p>
							)}
						</div>
					</aside>

					<section className="min-h-0 overflow-y-auto p-5 sm:p-7">
						{selected && assistance ? (
							<div className="max-w-2xl space-y-6">
								<div>
									<div className="flex flex-wrap items-center gap-2">
										<span
											className="text-3xl"
											aria-hidden>
											{selected.icon}
										</span>
										<h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{selected.label}</h3>
										<Badge tone="sky">{selected.category}</Badge>
									</div>
									<p className="mt-3 text-base leading-7 text-slate-600 dark:text-slate-300">{assistance.summary}</p>
									<div className="mt-3 flex flex-wrap gap-2">
										{moduleDefinition && <Badge tone="violet">{moduleDefinition.label} module</Badge>}
										{stage && <Badge tone="emerald">Build stage: {stage.label}</Badge>}
									</div>
								</div>
								<div className="grid gap-4 sm:grid-cols-2">
									<div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
										<h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">When to use it</h4>
										<p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{assistance.whenToUse}</p>
									</div>
									<div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
										<h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Catalogue description</h4>
										<p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{selected.description}</p>
									</div>
								</div>
								<div className="grid gap-4 sm:grid-cols-2">
									<div>
										<h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
											Security considerations
										</h4>
										<ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-600 dark:text-slate-300">
											{assistance.security.map((item) => (
												<li key={item}>{item}</li>
											))}
										</ul>
									</div>
									<div>
										<h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Recommendations</h4>
										<ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-600 dark:text-slate-300">
											{assistance.tips.map((item) => (
												<li key={item}>{item}</li>
											))}
										</ul>
									</div>
								</div>
								<Hint>
									Configure this resource from the Resources catalogue. Existing versus Create and Shared versus
									Environment scope remain explicit in the resource form.
								</Hint>
							</div>
						) : (
							<p className="text-sm text-slate-500">Select a resource to view its guidance.</p>
						)}
					</section>
				</div>
			</div>
		</div>
	);
}
