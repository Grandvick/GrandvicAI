import { describe, expect, it } from "vitest";
import {
  customerSchema,
  leadSchema,
  leadNoteSchema,
  taskSchema,
  applicationSchema,
  applicationStatusChangeSchema,
  documentRequestSchema,
  jobSchema,
  jobDocumentRequirementSchema,
} from "./validation";

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";

describe("customerSchema", () => {
  it("accepts a minimal valid customer", () => {
    expect(customerSchema.safeParse({ fullName: "Jane Doe" }).success).toBe(true);
  });

  it("rejects a name that's too short", () => {
    expect(customerSchema.safeParse({ fullName: "J" }).success).toBe(false);
  });

  it("rejects an invalid email but allows an empty one", () => {
    expect(customerSchema.safeParse({ fullName: "Jane Doe", email: "not-an-email" }).success).toBe(
      false
    );
    expect(customerSchema.safeParse({ fullName: "Jane Doe", email: "" }).success).toBe(true);
  });
});

describe("leadSchema", () => {
  it("requires a valid customer id", () => {
    expect(leadSchema.safeParse({ customerId: "not-a-uuid" }).success).toBe(false);
    expect(leadSchema.safeParse({ customerId: CUSTOMER_ID }).success).toBe(true);
  });

  it("defaults stage, score, and temperature when omitted", () => {
    const result = leadSchema.parse({ customerId: CUSTOMER_ID });
    expect(result.stage).toBe("new");
    expect(result.score).toBe(0);
    expect(result.temperature).toBe("nurture");
  });

  it("coerces a string score into a number and rejects out-of-range values", () => {
    expect(leadSchema.parse({ customerId: CUSTOMER_ID, score: "42" }).score).toBe(42);
    expect(leadSchema.safeParse({ customerId: CUSTOMER_ID, score: "150" }).success).toBe(false);
    expect(leadSchema.safeParse({ customerId: CUSTOMER_ID, score: "-1" }).success).toBe(false);
  });

  it("rejects an unrecognized temperature", () => {
    expect(leadSchema.safeParse({ customerId: CUSTOMER_ID, temperature: "boiling" }).success).toBe(
      false
    );
  });
});

describe("leadNoteSchema", () => {
  it("rejects an empty note", () => {
    expect(leadNoteSchema.safeParse({ leadId: CUSTOMER_ID, note: "" }).success).toBe(false);
  });

  it("accepts a non-empty note", () => {
    expect(leadNoteSchema.safeParse({ leadId: CUSTOMER_ID, note: "Called, no answer." }).success).toBe(
      true
    );
  });
});

describe("taskSchema", () => {
  it("rejects a title that's too short", () => {
    expect(taskSchema.safeParse({ title: "X" }).success).toBe(false);
  });

  it("defaults priority and status", () => {
    const result = taskSchema.parse({ title: "Follow up with customer" });
    expect(result.priority).toBe("medium");
    expect(result.status).toBe("pending");
  });

  it("rejects an unrecognized priority", () => {
    expect(taskSchema.safeParse({ title: "Follow up", priority: "meh" }).success).toBe(false);
  });
});

describe("applicationSchema", () => {
  it("requires a customer and defaults status to new", () => {
    expect(applicationSchema.safeParse({}).success).toBe(false);
    expect(applicationSchema.parse({ customerId: CUSTOMER_ID }).status).toBe("new");
  });

  it("rejects an unrecognized status", () => {
    expect(applicationSchema.safeParse({ customerId: CUSTOMER_ID, status: "ghosted" }).success).toBe(
      false
    );
  });

  it("accepts every Phase 2 recruitment pipeline stage (spec section 9)", () => {
    const stages = [
      "new",
      "screening",
      "documents_pending",
      "documents_complete",
      "shortlisted",
      "submitted_to_recruiter",
      "interview_scheduled",
      "interview_completed",
      "selected",
      "offer_received",
      "visa_processing",
      "deployment_pending",
      "placed",
      "rejected",
      "withdrawn",
    ];
    for (const status of stages) {
      expect(applicationSchema.safeParse({ customerId: CUSTOMER_ID, status }).success).toBe(true);
    }
  });

  it("accepts an optional rejection reason", () => {
    const result = applicationSchema.safeParse({
      customerId: CUSTOMER_ID,
      status: "rejected",
      rejectionReason: "Did not meet the experience requirement.",
    });
    expect(result.success).toBe(true);
  });
});

describe("applicationStatusChangeSchema", () => {
  it("requires a valid application id and status", () => {
    expect(
      applicationStatusChangeSchema.safeParse({ applicationId: CUSTOMER_ID, status: "shortlisted" }).success
    ).toBe(true);
    expect(applicationStatusChangeSchema.safeParse({ applicationId: "not-a-uuid", status: "new" }).success).toBe(
      false
    );
  });
});

describe("jobSchema", () => {
  it("accepts a minimal job with just a title", () => {
    const result = jobSchema.safeParse({ title: "Registered Nurse — Germany" });
    expect(result.success).toBe(true);
    if (result.success) {
      // Booleans default sensibly even when omitted from the form.
      expect(result.data.passportRequired).toBe(true);
      expect(result.data.accommodationProvided).toBe(false);
    }
  });

  it("rejects a title that's too short", () => {
    expect(jobSchema.safeParse({ title: "A" }).success).toBe(false);
  });

  it("rejects an invalid employment type or salary period", () => {
    expect(jobSchema.safeParse({ title: "Nurse", employmentType: "whenever" }).success).toBe(false);
    expect(jobSchema.safeParse({ title: "Nurse", salaryPeriod: "biannual" }).success).toBe(false);
  });

  it("coerces numeric fields from form-data strings", () => {
    const result = jobSchema.safeParse({ title: "Nurse", numVacancies: "5", salaryAmount: "2400" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.numVacancies).toBe(5);
      expect(result.data.salaryAmount).toBe(2400);
    }
  });
});

describe("jobDocumentRequirementSchema", () => {
  it("requires a job id and a document type of at least 2 characters", () => {
    expect(
      jobDocumentRequirementSchema.safeParse({ opportunityId: CUSTOMER_ID, documentType: "cv" }).success
    ).toBe(true);
    expect(
      jobDocumentRequirementSchema.safeParse({ opportunityId: CUSTOMER_ID, documentType: "x" }).success
    ).toBe(false);
  });

  it("defaults isMandatory to true", () => {
    const result = jobDocumentRequirementSchema.safeParse({ opportunityId: CUSTOMER_ID, documentType: "passport" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.isMandatory).toBe(true);
  });
});

describe("documentRequestSchema", () => {
  it("requires a customer and a document type", () => {
    expect(documentRequestSchema.safeParse({ customerId: CUSTOMER_ID }).success).toBe(false);
    expect(
      documentRequestSchema.safeParse({ customerId: CUSTOMER_ID, documentType: "Passport" }).success
    ).toBe(true);
  });
});
