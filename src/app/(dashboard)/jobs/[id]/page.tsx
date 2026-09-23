import { notFound } from "next/navigation";
import Link from "next/link";
import { requireCurrentUser } from "@/lib/business/context";
import { getJob } from "@/lib/business/jobs";
import { listApplications } from "@/lib/business/applications";
import { listJobDocumentRequirements, getApplicationDocumentChecklist } from "@/lib/business/job-documents";
import { Badge, jobStatusTone, statusTone, formatStatusLabel } from "@/components/ui/badge";
import { JobStatusActions } from "./JobStatusActions";
import { DocumentRequirementsEditor } from "./DocumentRequirementsEditor";

export const dynamic = "force-dynamic";

function money(amount: number | null, currency: string | null, period: string | null): string | null {
  if (amount == null) return null;
  const parts = [currency ? `${currency} ${amount.toLocaleString()}` : amount.toLocaleString()];
  if (period) parts.push(`/ ${period}`);
  return parts.join(" ");
}

export default async function JobDetailPage({ params }: PageProps<"/jobs/[id]">) {
  const { id } = await params;
  const { supabase } = await requireCurrentUser();

  const job = await getJob(supabase, id);
  if (!job) notFound();

  const [applications, requirements] = await Promise.all([
    listApplications(supabase, job.businessId, { opportunityId: id }),
    listJobDocumentRequirements(supabase, id),
  ]);

  // Missing-document count per applicant (spec section 11 — the job view
  // should surface which candidates still owe documents). Fine to run one
  // query per applicant at today's scale — same trade-off the rest of this
  // app makes (see DEVELOPMENT_PROGRESS.md "no pagination yet").
  const missingDocCounts = new Map<string, number>();
  if (requirements.length > 0) {
    await Promise.all(
      applications.map(async (a) => {
        const checklist = await getApplicationDocumentChecklist(supabase, a.id);
        const missing = checklist.filter((c) => c.isMandatory && c.status === "missing").length;
        if (missing > 0) missingDocCounts.set(a.id, missing);
      })
    );
  }

  const salary = money(job.salaryAmount, job.salaryCurrency, job.salaryPeriod);
  const vacanciesRemaining =
    job.numVacancies != null
      ? Math.max(job.numVacancies - applications.filter((a) => a.status === "placed").length, 0)
      : null;

  const benefitFlags = [
    job.accommodationProvided && "Accommodation",
    job.mealsProvided && "Meals",
    job.transportProvided && "Transport",
    job.airfareProvided && "Airfare",
    job.visaWorkPermitSupport && "Visa / work permit support",
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">Job Abroad</p>
          <h1 className="text-2xl font-semibold text-slate-900">{job.title}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {[job.city, job.country].filter(Boolean).join(", ") || "No location set"}
            {job.employer ? ` · ${job.employer}` : ""}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone={jobStatusTone(job.effectiveStatus)}>{formatStatusLabel(job.effectiveStatus)}</Badge>
            {job.status === "open" && job.effectiveStatus === "expired" && (
              <span className="text-xs text-red-600">Expired — no longer shown as open</span>
            )}
            {job.category && <span className="text-xs text-slate-400">{job.category}</span>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Link href={`/jobs/${id}/edit`} className="text-sm text-slate-500 hover:underline">
            Edit job →
          </Link>
          <Link href="/jobs" className="text-sm text-slate-500 hover:underline">
            ← All jobs
          </Link>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Status</h2>
        <JobStatusActions jobId={id} status={job.status} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-1">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Key facts</h2>
            <dl className="space-y-2 text-sm">
              {job.recruiterName && (
                <div className="flex justify-between">
                  <dt className="text-slate-500">Recruiter</dt>
                  <dd className="text-slate-900">{job.recruiterName}</dd>
                </div>
              )}
              {job.employmentType && (
                <div className="flex justify-between">
                  <dt className="text-slate-500">Employment</dt>
                  <dd className="text-slate-900">{formatStatusLabel(job.employmentType)}</dd>
                </div>
              )}
              {job.contractDuration && (
                <div className="flex justify-between">
                  <dt className="text-slate-500">Duration</dt>
                  <dd className="text-slate-900">{job.contractDuration}</dd>
                </div>
              )}
              {salary && (
                <div className="flex justify-between">
                  <dt className="text-slate-500">Salary</dt>
                  <dd className="text-slate-900">{salary}</dd>
                </div>
              )}
              {job.numVacancies != null && (
                <div className="flex justify-between">
                  <dt className="text-slate-500">Vacancies</dt>
                  <dd className="text-slate-900">
                    {vacanciesRemaining} remaining of {job.numVacancies}
                  </dd>
                </div>
              )}
              {job.applicationDeadline && (
                <div className="flex justify-between">
                  <dt className="text-slate-500">Deadline</dt>
                  <dd className="text-slate-900">{new Date(job.applicationDeadline).toLocaleDateString()}</dd>
                </div>
              )}
              {job.expiryAt && (
                <div className="flex justify-between">
                  <dt className="text-slate-500">Expires</dt>
                  <dd className="text-slate-900">{new Date(job.expiryAt).toLocaleDateString()}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-slate-500">Applicants</dt>
                <dd className="text-slate-900">{applications.length}</dd>
              </div>
            </dl>
            {benefitFlags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {benefitFlags.map((b) => (
                  <Badge key={b} tone="good">
                    {b}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {(job.educationRequirement ||
            job.experienceRequirement ||
            job.licenseRequirement ||
            job.languageRequirement ||
            job.medicalRequirement ||
            job.passportRequired ||
            job.minAge ||
            job.maxAge ||
            job.genderRequirement) && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">Requirements</h2>
              <ul className="space-y-1.5 text-sm text-slate-700">
                {job.educationRequirement && <li>Education: {job.educationRequirement}</li>}
                {job.experienceRequirement && <li>Experience: {job.experienceRequirement}</li>}
                {job.licenseRequirement && <li>Licensing: {job.licenseRequirement}</li>}
                {job.languageRequirement && <li>Language: {job.languageRequirement}</li>}
                {job.medicalRequirement && <li>Medical: {job.medicalRequirement}</li>}
                {(job.minAge || job.maxAge) && (
                  <li>
                    Age: {job.minAge ?? "—"}
                    {" – "}
                    {job.maxAge ?? "—"}
                  </li>
                )}
                {job.genderRequirement && job.genderRequirement !== "any" && <li>Gender: {job.genderRequirement}</li>}
                {job.passportRequired && <li>Valid passport required</li>}
              </ul>
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Required documents</h2>
            <DocumentRequirementsEditor opportunityId={id} requirements={requirements} />
          </div>
        </div>

        <div className="space-y-6 lg:col-span-2">
          {(job.jobDescription || job.responsibilities || job.candidateRequirements) && (
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">Description</h2>
              {job.jobDescription && <p className="whitespace-pre-wrap text-sm text-slate-700">{job.jobDescription}</p>}
              {job.responsibilities && (
                <>
                  <h3 className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Responsibilities
                  </h3>
                  <p className="whitespace-pre-wrap text-sm text-slate-700">{job.responsibilities}</p>
                </>
              )}
              {job.candidateRequirements && (
                <>
                  <h3 className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Candidate requirements
                  </h3>
                  <p className="whitespace-pre-wrap text-sm text-slate-700">{job.candidateRequirements}</p>
                </>
              )}
            </section>
          )}

          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Applicants ({applications.length})</h2>
              <Link
                href={`/applications/new?opportunityId=${id}`}
                className="text-xs font-medium text-slate-600 hover:underline"
              >
                + New application
              </Link>
            </div>
            {applications.length === 0 ? (
              <p className="text-sm text-slate-500">No candidates have applied to this job yet.</p>
            ) : (
              <ul className="space-y-2">
                {applications.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm"
                  >
                    <Link href={`/applications/${a.id}`} className="font-medium text-slate-900 hover:underline">
                      {a.customerName}
                    </Link>
                    <div className="flex items-center gap-1.5">
                      {missingDocCounts.has(a.id) && (
                        <Badge tone="danger">{missingDocCounts.get(a.id)} doc{missingDocCounts.get(a.id) === 1 ? "" : "s"} missing</Badge>
                      )}
                      <Badge tone={statusTone(a.status)}>{formatStatusLabel(a.status)}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {job.notes && (
            <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-4">
              <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Internal notes</h2>
              <p className="whitespace-pre-wrap text-sm text-slate-600">{job.notes}</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
