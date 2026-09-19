import { describe, expect, it } from "vitest";
import { shouldNotifyHotLead, buildHotLeadNotification } from "./hot-lead";

describe("shouldNotifyHotLead", () => {
  it("notifies on a transition into hot", () => {
    expect(shouldNotifyHotLead("warm", "hot")).toBe(true);
    expect(shouldNotifyHotLead("nurture", "hot")).toBe(true);
    expect(shouldNotifyHotLead(undefined, "hot")).toBe(true);
    expect(shouldNotifyHotLead(null, "hot")).toBe(true);
  });

  it("does not notify when already hot or moving away from hot", () => {
    expect(shouldNotifyHotLead("hot", "hot")).toBe(false);
    expect(shouldNotifyHotLead("hot", "warm")).toBe(false);
    expect(shouldNotifyHotLead("warm", "nurture")).toBe(false);
  });
});

describe("buildHotLeadNotification", () => {
  it("includes the customer, service, destination, and score", () => {
    const { title, body, level } = buildHotLeadNotification({
      customerName: "Jane Doe",
      service: "Registered Nurse",
      targetCountry: "UAE",
      score: 87,
    });

    expect(title).toContain("Jane Doe");
    expect(body).toContain("Registered Nurse");
    expect(body).toContain("UAE");
    expect(body).toContain("87");
    expect(level).toBe("important");
  });

  it("omits service/destination lines when they aren't provided", () => {
    const { body } = buildHotLeadNotification({ customerName: "Jane Doe", score: 50 });
    expect(body).not.toContain("Service:");
    expect(body).not.toContain("Destination:");
  });
});
