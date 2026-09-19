"use client";

import { useMemo, useState } from "react";
import {
  RESOURCE_CATALOGUE,
  getCategories,
} from "@/lib/schema/resources";
import { useProject } from "@/lib/store/project-context";
import { Card, SectionTitle, TextInput, Badge } from "@/components/ui/Field";

export function Catalogue() {
  const { addResource } = useProject();
  const [query, setQuery] = useState("");
  const categories = getCategories();

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

  return (
    <Card className="p-4 flex flex-col h-full min-h-0">
      <SectionTitle>Catalogue</SectionTitle>
      <TextInput
        placeholder="Search resources…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="mb-3"
      />
      <div className="flex-1 overflow-y-auto space-y-4 pr-1">
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
                      onClick={() => addResource(r.type)}
                      className="w-full text-left rounded-lg px-2.5 py-2 hover:bg-sky-50 dark:hover:bg-sky-950/40 border border-transparent hover:border-sky-200 dark:hover:border-sky-800 transition-colors group"
                      title={`Add ${r.label}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-base" aria-hidden>
                          {r.icon}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate group-hover:text-sky-700 dark:group-hover:text-sky-300">
                            {r.label}
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono truncate">
                            {r.type}
                          </div>
                        </div>
                        <span className="text-sky-500 opacity-0 group-hover:opacity-100 text-lg leading-none">
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
    </Card>
  );
}
