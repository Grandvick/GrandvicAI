export function StatCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number | string;
  tone?: "default" | "hot" | "warm" | "good";
}) {
  const toneClasses: Record<string, string> = {
    default: "text-slate-900",
    hot: "text-red-600",
    warm: "text-amber-600",
    good: "text-emerald-600",
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`mt-1 text-3xl font-semibold ${toneClasses[tone]}`}>{value}</p>
    </div>
  );
}
