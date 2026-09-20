"use client";

import { useProject } from "@/lib/store/project-context";
import { tierShortLabel } from "@/lib/schema/environments";
import { Badge } from "@/components/ui/Field";

/** Tier badge — Dev / Staging / Prod (or custom) for the active environment. */
export function TierBadge({ className = "" }: { className?: string }) {
  const { state } = useProject();
  const env =
    state.environments.find((e) => e.id === state.activeEnvironmentId) ??
    state.environments[0];
  if (!env) return null;
  return (
    <Badge tone="violet">
      <span className={className}>
        Tier: <strong className="font-semibold">{tierShortLabel(env)}</strong>
      </span>
    </Badge>
  );
}
