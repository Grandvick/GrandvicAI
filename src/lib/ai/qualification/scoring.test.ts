import { describe, expect, it } from "vitest";
import {
  computeLeadScore,
  recommendTemperature,
  qualificationLabel,
  recommendQualification,
  QUALIFICATION_WEIGHTS,
} from "./scoring";

describe("computeLeadScore", () => {
  it("returns 0 for all-zero factors", () => {
    expect(
      computeLeadScore({
        intentClarity: 0,
        fit: 0,
        urgency: 0,
        completeness: 0,
        engagement: 0,
        opportunityRelevance: 0,
      })
    ).toBe(0);
  });

  it("returns 100 for all-perfect factors", () => {
    expect(
      computeLeadScore({
        intentClarity: 1,
        fit: 1,
        urgency: 1,
        completeness: 1,
        engagement: 1,
        opportunityRelevance: 1,
      })
    ).toBe(100);
  });

  it("weights sum to 1.0", () => {
    const sum = Object.values(QUALIFICATION_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it("treats missing factors as 0 rather than throwing", () => {
    expect(computeLeadScore({ intentClarity: 1 })).toBe(20);
  });

  it("clamps out-of-range factors instead of producing a nonsensical score", () => {
    expect(computeLeadScore({ intentClarity: 5, fit: -3 })).toBe(20); // 1*0.2 + 0*0.2
  });

  it("clamps non-finite factors to 0", () => {
    expect(computeLeadScore({ intentClarity: NaN })).toBe(0);
  });
});

describe("recommendTemperature", () => {
  it("returns hot at and above 70", () => {
    expect(recommendTemperature(70)).toBe("hot");
    expect(recommendTemperature(100)).toBe("hot");
  });

  it("returns warm between 40 and 69", () => {
    expect(recommendTemperature(40)).toBe("warm");
    expect(recommendTemperature(69)).toBe("warm");
  });

  it("returns nurture below 40", () => {
    expect(recommendTemperature(39)).toBe("nurture");
    expect(recommendTemperature(0)).toBe("nurture");
  });
});

describe("qualificationLabel", () => {
  it("returns cold only below 15, distinct from the stored nurture range", () => {
    expect(qualificationLabel(14)).toBe("cold");
    expect(qualificationLabel(15)).toBe("nurture");
    expect(qualificationLabel(39)).toBe("nurture");
  });

  it("matches recommendTemperature at the hot/warm boundaries", () => {
    expect(qualificationLabel(70)).toBe("hot");
    expect(qualificationLabel(40)).toBe("warm");
  });
});

describe("recommendQualification", () => {
  it("combines score, temperature, and label consistently", () => {
    const result = recommendQualification({
      intentClarity: 0.9,
      fit: 0.8,
      urgency: 0.7,
      completeness: 0.6,
      engagement: 0.9,
      opportunityRelevance: 1,
    });
    expect(result.score).toBeGreaterThan(0);
    expect(result.temperature).toBe(recommendTemperature(result.score));
    expect(result.label).toBe(qualificationLabel(result.score));
  });
});
