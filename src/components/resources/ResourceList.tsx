'use client';

import { useMemo } from 'react';
import { useProject } from '@/lib/store/project-context';
import { getResourceType } from '@/lib/schema/resources';
import { getUsedBy } from '@/lib/generate/deps';
import { sortResourcesByBuildOrder } from '@/lib/generate/modules';
import { hubOwnershipBadgeText, isHubDnsType, linkedEnvCountBadge } from '@/lib/store/hub-dns-ownership';
import { normalizeScope, resourcesVisibleInEnv, scopeLabel, tierShortLabel } from '@/lib/schema/environments';
import { Card, SectionTitle, Badge, Button } from '@/components/ui/Field';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { UndoRedoControls } from '@/components/history/UndoRedoControls';
import { TierBadge } from '@/components/project/TierBadge';
import { ResourcesViewToggle, type ResourcesViewMode } from './DependencyGraph';
import { ResourcesEmptyState, focusCataloguePanelSearch } from './ResourcesEmptyState';
import { BuildOrderGuide } from './BuildOrderGuide';

export function ResourceList({
	viewMode = 'list',
	onViewModeChange,
	onGoToEnvironment,
}: {
	viewMode?: ResourcesViewMode;
	onViewModeChange?: (v: ResourcesViewMode) => void;
	/** Navigate to Environment step (Import existing / starters). */
	onGoToEnvironment?: () => void;
} = {}) {
	const { state, selectResource, removeResource, setActiveEnvironment } = useProject();
	const { resources, selectedResourceId, environments, activeEnvironmentId } = state;

	const visible = useMemo(
		() => sortResourcesByBuildOrder(resourcesVisibleInEnv(resources, activeEnvironmentId)),
		[resources, activeEnvironmentId],
	);

	const sharedCount = visible.filter((r) => normalizeScope(r.scope).kind === 'shared').length;
	const scopedCount = visible.length - sharedCount;

	const activeEnv = environments.find((e) => e.id === activeEnvironmentId) ?? environments[0];

	return (
		<Card className="p-4 flex flex-col h-full min-h-0">
			<SectionTitle
				action={
					<div className="flex items-center gap-2 flex-wrap justify-end">
						{onViewModeChange && (
							<ResourcesViewToggle
								value={viewMode}
								onChange={onViewModeChange}
							/>
						)}
						<UndoRedoControls compact />
						<TierBadge />
						<Badge tone="slate">{visible.length}</Badge>
					</div>
				}>
				Project resources
			</SectionTitle>

			<div className="mb-3">
				<SegmentedControl
					ariaLabel="Filter by environment tier"
					size="sm"
					value={activeEnvironmentId}
					onChange={setActiveEnvironment}
					options={environments.map((e) => ({
						value: e.id,
						label: e.displayName,
						shortLabel: tierShortLabel(e),
					}))}
				/>
			</div>
			<p className="text-[11px] text-slate-400 mb-2">
				Showing shared + {activeEnv?.displayName ?? 'env'} · {sharedCount} shared · {scopedCount} scoped
				{resources.length !== visible.length ? ` · ${resources.length - visible.length} hidden (other envs)` : ''}
			</p>
			<div className="mb-3">
				<BuildOrderGuide />
			</div>

			{visible.length === 0 ? (
				<ResourcesEmptyState
					variant="list"
					envLabel={activeEnv?.displayName ?? 'Environment'}
					hiddenInOtherEnvs={resources.length - visible.length}
					onAddFromCatalogue={focusCataloguePanelSearch}
					onImportExisting={() => onGoToEnvironment?.()}
				/>
			) : (
				<ul className="flex-1 overflow-y-auto space-y-1 pr-1">
					{visible.map((r) => {
						const def = getResourceType(r.type);
						const selected = r.id === selectedResourceId;
						const usedBy = getUsedBy(r.id, resources);
						const scope = normalizeScope(r.scope);
						return (
							<li key={r.id}>
								<div
									className={`rounded-lg border px-2.5 py-2 cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
										selected
											? 'border-sky-500 bg-sky-50 dark:bg-sky-950/40 ring-1 ring-sky-500'
											: 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
									}`}
									onClick={() => selectResource(r.id)}
									onKeyDown={(e) => e.key === 'Enter' && selectResource(r.id)}
									role="button"
									tabIndex={0}
									aria-label={`${def?.label ?? r.type} ${r.tfName}`}>
									<div className="flex items-start gap-2">
										<span
											className="text-base mt-0.5"
											aria-hidden>
											{def?.icon ?? '📦'}
										</span>
										<div className="min-w-0 flex-1">
											<div className="flex items-center gap-1.5 flex-wrap">
												<span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
													{def?.label ?? r.type}
												</span>
												<code className="text-[10px] text-slate-400 font-mono">.{r.tfName}</code>
											</div>
											<div className="flex items-center gap-1.5 mt-1 flex-wrap">
												{r.useExisting ? <Badge tone="amber">existing</Badge> : <Badge tone="emerald">create</Badge>}
												<Badge tone={scope.kind === 'shared' ? 'violet' : 'sky'}>
													{isHubDnsType(r.type)
														? (hubOwnershipBadgeText(r, resources, environments) ?? scopeLabel(scope, environments))
														: scopeLabel(scope, environments)}
												</Badge>
												{(() => {
													const linked = linkedEnvCountBadge(r, resources, environments);
													if (linked) {
														return <Badge tone="violet">{linked}</Badge>;
													}
													if (usedBy.length > 0 && !isHubDnsType(r.type)) {
														return <Badge tone="violet">used by {usedBy.length}</Badge>;
													}
													return null;
												})()}
											</div>
										</div>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											className="!px-1.5 !py-0.5 text-slate-400 hover:!text-rose-500"
											onClick={(e) => {
												e.stopPropagation();
												removeResource(r.id);
											}}
											aria-label={`Remove ${def?.label ?? r.type} ${r.tfName}`}
											title="Remove">
											×
										</Button>
									</div>
								</div>
							</li>
						);
					})}
				</ul>
			)}
		</Card>
	);
}
