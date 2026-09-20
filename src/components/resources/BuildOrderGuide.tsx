import { RESOURCE_BUILD_STAGES } from "@/lib/generate/modules";

export function BuildOrderGuide() {
  return (
    <div className="rounded-lg border border-sky-100 bg-sky-50/70 px-3 py-2.5 dark:border-sky-900/60 dark:bg-sky-950/30">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-800 dark:text-sky-200">
        Recommended build and review sequence
      </p>
      <ol
        className="mt-1.5 flex flex-wrap gap-1.5"
        aria-label="Recommended build and review sequence"
      >
        {RESOURCE_BUILD_STAGES.map((stage, index) => (
          <li
            key={stage.id}
            className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-white px-2 py-0.5 text-[11px] text-slate-700 dark:border-sky-800 dark:bg-slate-900 dark:text-slate-300"
          >
            <span className="font-semibold text-sky-700 dark:text-sky-300">
              {index + 1}
            </span>
            {stage.label}
          </li>
        ))}
      </ol>
      <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
        This is a recommended sequence, not a strict apply order. References schedule dependencies.
      </p>
    </div>
  );
}