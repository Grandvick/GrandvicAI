import { describe, expect, it } from "vitest";
import {
  customerSchema,
  leadSchema,
  leadNoteSchema,
  taskSchema,
  applicationSchema,
  documentRequestSchema,
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
  it("requires a customer and defaults status to draft", () => {
    expect(applicationSchema.safeParse({}).success).toBe(false);
    expect(applicationSchema.parse({ customerId: CUSTOMER_ID }).status).toBe("draft");
  });

  it("rejects an unrecognized status", () => {
    expect(applicationSchema.safeParse({ customerId: CUSTOMER_ID, status: "ghosted" }).success).toBe(
      false
    );
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
