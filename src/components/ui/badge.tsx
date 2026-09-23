const TONE_CLASSES: Record<string, string> = {
  slate: "bg-slate-100 text-slate-600",
  hot: "bg-red-50 text-red-700",
  warm: "bg-amber-50 text-amber-700",
  nurture: "bg-slate-100 text-slate-500",
  good: "bg-emerald-50 text-emerald-700",
  info: "bg-blue-50 text-blue-700",
  danger: "bg-red-50 text-red-700",
};

/** Some Phase 2 statuses have more than one underscore (e.g. "submitted_to_recruiter") — replace all of them, not just the first. */
export function formatStatusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

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
  if (
    [
      "done",
      "approved",
      "accepted",
      "paid",
      "published",
      "completed",
      "open",
      "selected",
      "offer_received",
      "placed",
      "documents_complete",
      "shortlisted",
      "interview_completed",
    ].includes(status)
  )
    return "good";
  if (["cancelled", "rejected", "failed", "withdrawn", "expired", "closed"].includes(status)) return "danger";
  if (
    [
      "pending",
      "in_progress",
      "under_review",
      "pending_review",
      "requested",
      "uploaded",
      "screening",
      "documents_pending",
      "submitted_to_recruiter",
      "interview_scheduled",
      "visa_processing",
      "deployment_pending",
      "paused",
    ].includes(status)
  )
    return "info";
  return "slate";
}

/** Job status tone — `paused` reads as a caution state, not the neutral info blue used elsewhere. */
export function jobStatusTone(status: string): keyof typeof TONE_CLASSES {
  if (status === "open") return "good";
  if (status === "paused") return "warm";
  if (status === "closed" || status === "expired") return "danger";
  return "slate"; // draft, pending_review
}
