import { notFound } from "next/navigation";
import { requireCurrentUser } from "@/lib/business/context";
import { getJob } from "@/lib/business/jobs";
import { updateJobAction } from "../../actions";
import { JobForm } from "../../JobForm";

export const dynamic = "force-dynamic";

export default async function EditJobPage({ params }: PageProps<"/jobs/[id]/edit">) {
  const { id } = await params;
  const { supabase } = await requireCurrentUser();

  const job = await getJob(supabase, id);
  if (!job) notFound();

  const boundUpdate = updateJobAction.bind(null, id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Edit job</h1>
        <p className="mt-1 text-sm text-slate-500">{job.title}</p>
      </div>
      <JobForm
        action={boundUpdate}
        submitLabel="Save changes"
        cancelHref={`/jobs/${id}`}
        defaultValues={{
          title: job.title,
          country: job.country ?? "",
          city: job.city ?? "",
          employer: job.employer ?? "",
          recruiterName: job.recruiterName ?? "",
          category: job.category ?? "",
          employmentType: job.employmentType ?? "",
          contractDuration: job.contractDuration ?? "",
          numVacancies: job.numVacancies,
          salaryAmount: job.salaryAmount,
          salaryCurrency: job.salaryCurrency ?? "",
          salaryPeriod: job.salaryPeriod ?? "",
          accommodationProvided: job.accommodationProvided,
          accommodation: job.accommodation ?? "",
          mealsProvided: job.mealsProvided,
          meals: job.meals ?? "",
          transportProvided: job.transportProvided,
          airfareProvided: job.airfareProvided,
          visaWorkPermitSupport: job.visaWorkPermitSupport,
          workingHours: job.workingHours ?? "",
          educationRequirement: job.educationRequirement ?? "",
          experienceRequirement: job.experienceRequirement ?? "",
          licenseRequirement: job.licenseRequirement ?? "",
          languageRequirement: job.languageRequirement ?? "",
          minAge: job.minAge,
          maxAge: job.maxAge,
          genderRequirement: job.genderRequirement ?? "",
          passportRequired: job.passportRequired,
          medicalRequirement: job.medicalRequirement ?? "",
          jobDescription: job.jobDescription ?? "",
          responsibilities: job.responsibilities ?? "",
          candidateRequirements: job.candidateRequirements ?? "",
          benefits: job.benefits ?? "",
          applicationProcess: job.applicationProcess ?? "",
          fees: job.fees ?? "",
          recruiterReference: job.recruiterReference ?? "",
          openingDate: job.openingDate ?? "",
          applicationDeadline: job.applicationDeadline ?? "",
          expiryAt: job.expiryAt ? job.expiryAt.slice(0, 10) : "",
          source: job.source ?? "",
          notes: job.notes ?? "",
        }}
      />
    </div>
  );
}
