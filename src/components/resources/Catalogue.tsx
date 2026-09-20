"use client";

import { useId, useMemo, useState } from "react";
import {
  RESOURCE_CATALOGUE,
  getCategories,
} from "@/lib/schema/resources";
import { useProject } from "@/lib/store/project-context";
import {
  Card,
  SectionTitle,
  TextInput,
  Badge,
  Label,
  Button,
} from "@/components/ui/Field";
import { CATALOGUE_PANEL_SEARCH_ID } from "@/lib/store/empty-resources";

export function Catalogue({
  onAdded,
  onClose,
  autoFocusSearch = false,
  variant = "panel",
}: {
  /** Called after a catalogue add (new resource id). addResource already selects it. */
  onAdded?: (id: string) => void;
  /** When set, shows a Close control in the header (drawer/popover use). */
  onClose?: () => void;
  autoFocusSearch?: boolean;
  /** panel = List column; drawer = compact overlay body. */
  variant?: "panel" | "drawer";
} = {}) {
  const { addResource } = useProject();
  const [query, setQuery] = useState("");
  const categories = getCategories();
  const searchId = useId();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return RESOURCE_CATALOGUE;
    return RESOURCE_CATALOGUE.filter(
      (r) =>
        r.label.toLowerCase().includes(q) ||
        r.type.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q)
    );
  }, [query]);

  function handleAdd(type: string) {
    const id = addResource(type);
    if (id) onAdded?.(id);
  }

  const body = (
    <>
      <SectionTitle
        action={
          onClose ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              aria-label="Close catalogue"
            >
              Close
            </Button>
          ) : undefined
        }
      >
        Catalogue
      </SectionTitle>
      <div className="mb-3">
        <Label htmlFor={variant === "panel" ? CATALOGUE_PANEL_SEARCH_ID : searchId}>Search resources</Label>
        <TextInput
          id={variant === "panel" ? CATALOGUE_PANEL_SEARCH_ID : searchId}
          placeholder="Search by name or category…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search catalogue resources"
          autoFocus={autoFocusSearch}
        />
      </div>
      <div className="flex-1 overflow-y-auto space-y-4 pr-1 min-h-0">
        {categories.map((cat) => {
          const items = filtered.filter((r) => r.category === cat);
          if (items.length === 0) return null;
          return (
            <div key={cat}>
              <div className="sticky top-0 bg-white dark:bg-slate-900 py-1 mb-1">
                <Badge tone="violet">{cat}</Badge>
              </div>
              <ul className="space-y-1">
                {items.map((r) => (
                  <li key={r.type}>
                    <button
                      type="button"
                      onClick={() => handleAdd(r.type)}
                      className="w-full text-left rounded-lg px-2.5 py-2 hover:bg-sky-50 dark:hover:bg-sky-950/40 border border-transparent hover:border-sky-200 dark:hover:border-sky-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1"
                      title={`Add ${r.label}`}
                      aria-label={`Add ${r.label}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-base" aria-hidden>
                          {r.icon}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
                            {r.label}
                          </div>
                          <div className="text-[11px] text-slate-400 truncate">
                            {r.description}
                          </div>
                        </div>
                        <span
                          className="text-sky-500 text-lg leading-none shrink-0"
                          aria-hidden
                        >
                          +
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-6">
            No resources match “{query}”
          </p>
        )}
      </div>
    </>
  );

  if (variant === "drawer") {
    return <div className="flex flex-col h-full min-h-0">{body}</div>;
  }

  return <Card className="p-4 flex flex-col h-full min-h-0">{body}</Card>;
}
