const TONE_CLASSES: Record<string, string> = {
  slate: "bg-slate-100 text-slate-600",
  hot: "bg-red-50 text-red-700",
  warm: "bg-amber-50 text-amber-700",
  nurture: "bg-slate-100 text-slate-500",
  good: "bg-emerald-50 text-emerald-700",
  info: "bg-blue-50 text-blue-700",
  danger: "bg-red-50 text-red-700",
};

export function Badge({ tone = "slate", children }: { tone?: keyof typeof TONE_CLASSES; children: React.ReactNode }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}>
      {children}
    </span>
  );
}

export function temperatureTone(temperature: string): keyof typeof TONE_CLASSES {
  if (temperature === "hot") return "hot";
  if (temperature === "warm") return "warm";
  return "nurture";
}

export function priorityTone(priority: string): keyof typeof TONE_CLASSES {
  if (priority === "urgent" || priority === "high") return "hot";
  if (priority === "medium") return "warm";
  return "slate";
}

export function statusTone(status: string): keyof typeof TONE_CLASSES {
  if (["done", "approved", "accepted", "paid", "published", "completed"].includes(status)) return "good";
  if (["cancelled", "rejected", "failed", "withdrawn", "expired"].includes(status)) return "danger";
  if (["pending", "in_progress", "under_review", "pending_review", "requested", "uploaded"].includes(status))
    return "info";
  return "slate";
}
