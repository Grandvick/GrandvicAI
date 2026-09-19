export function ComingSoon({
  title,
  phase,
  description,
}: {
  title: string;
  phase: number;
  description: string;
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-xl">
          🚧
        </div>
        <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
        <p className="mt-2 text-sm text-slate-500">{description}</p>
        <span className="mt-4 inline-block rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white">
          Coming in Phase {phase}
        </span>
        <p className="mt-4 text-xs text-slate-400">
          See DEVELOPMENT_PROGRESS.md for the full build roadmap.
        </p>
      </div>
    </div>
  );
}
