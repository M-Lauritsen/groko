"use client";

import { useProject } from "@/lib/store/project-context";
import { getResourceType } from "@/lib/schema/resources";
import { getUsedBy } from "@/lib/generate/deps";
import { Card, SectionTitle, Badge, Button } from "@/components/ui/Field";

export function ResourceList() {
  const { state, selectResource, removeResource } = useProject();
  const { resources, selectedResourceId } = state;

  return (
    <Card className="p-4 flex flex-col h-full min-h-0">
      <SectionTitle
        action={
          <Badge tone="slate">{resources.length}</Badge>
        }
      >
        Project resources
      </SectionTitle>

      {resources.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-center px-4">
          <div>
            <p className="text-sm text-slate-500 mb-1">No resources yet</p>
            <p className="text-xs text-slate-400">
              Pick a starter or add from the catalogue →
            </p>
          </div>
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto space-y-1 pr-1">
          {resources.map((r) => {
            const def = getResourceType(r.type);
            const selected = r.id === selectedResourceId;
            const usedBy = getUsedBy(r.id, resources);
            return (
              <li key={r.id}>
                <div
                  className={`rounded-lg border px-2.5 py-2 cursor-pointer transition-colors ${
                    selected
                      ? "border-sky-500 bg-sky-50 dark:bg-sky-950/40 ring-1 ring-sky-500"
                      : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600"
                  }`}
                  onClick={() => selectResource(r.id)}
                  onKeyDown={(e) => e.key === "Enter" && selectResource(r.id)}
                  role="button"
                  tabIndex={0}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-base mt-0.5" aria-hidden>
                      {def?.icon ?? "📦"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                          {def?.label ?? r.type}
                        </span>
                        <code className="text-[10px] text-slate-400 font-mono">
                          .{r.tfName}
                        </code>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        {r.useExisting ? (
                          <Badge tone="amber">data / existing</Badge>
                        ) : (
                          <Badge tone="emerald">resource</Badge>
                        )}
                        {usedBy.length > 0 && (
                          <Badge tone="violet">
                            used by {usedBy.length}
                          </Badge>
                        )}
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
                      title="Remove"
                    >
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
