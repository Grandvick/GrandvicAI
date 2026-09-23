import { describe, expect, it } from "vitest";
import { searchKnowledgeItems } from "./knowledge";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Phase 4 live-testing follow-up (third diagnostic pass): after the Bug B
 * intent-detection fix, the mock Sales Agent correctly reached
 * `search_knowledge_base` for document/tour/fee/etc. questions, but almost
 * always got the honest "I don't have verified information" fallback
 * anyway — even for "What documents do I need for this job?", despite a
 * seeded FAQ item that answers EXACTLY that question
 * (supabase/seed.sql's "[DEMO] What documents do I need for Jobs Abroad
 * applications?").
 *
 * Root cause: `searchKnowledgeItems` required the ENTIRE `search` string
 * (the dev-mock provider passes the customer's raw message, untouched — see
 * dev-mock.ts's `planSalesAgentFirstPass`) to appear as ONE literal,
 * contiguous substring in an item's title/content/tags. A customer's own
 * phrasing essentially never matches a curated FAQ's wording verbatim, so
 * this was silently unusable for almost any real customer message —
 * independent of provider (mock OR the real OpenAI-driven one, if it ever
 * passes the user's own wording through rather than hand-picked keywords).
 *
 * Fixed to word-overlap matching: strip common low-signal words, then match
 * an item if ANY remaining significant word from the search text appears in
 * its title, content, or tags.
 */

function makeFakeSupabase(rows: unknown[]): SupabaseClient {
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => Promise.resolve({ data: rows, error: null }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: () => builder } as any;
}

function knowledgeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "k1",
    category: "faqs",
    title: "[DEMO] What documents do I need for Jobs Abroad applications?",
    content:
      "Typical documents requested include a valid passport, CV, academic certificates, " +
      "a Good Conduct Certificate, and passport photos. Exact requirements vary by " +
      "opportunity — always confirm against the specific opportunity record before " +
      "telling a customer what is required.",
    tags: ["jobs_abroad", "documents", "demo"],
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("searchKnowledgeItems word-overlap matching (Phase 4 diagnostic, third pass)", () => {
  it("matches a customer's own natural phrasing against a seeded FAQ, not just the FAQ's exact wording", async () => {
    const supabase = makeFakeSupabase([knowledgeRow()]);
    const items = await searchKnowledgeItems(supabase, "business-1", {
      search: "What documents do I need for this job?",
    });
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("k1");
  });

  it("still matches when the search text uses different surrounding words entirely, as long as one significant word overlaps", async () => {
    const supabase = makeFakeSupabase([knowledgeRow()]);
    const items = await searchKnowledgeItems(supabase, "business-1", {
      search: "Can you tell me which documents are required before I apply?",
    });
    expect(items).toHaveLength(1);
  });

  it("returns no matches, honestly, when nothing in the knowledge base is actually about the topic asked", async () => {
    const supabase = makeFakeSupabase([knowledgeRow()]);
    const items = await searchKnowledgeItems(supabase, "business-1", {
      search: "Do you have any tours to the coast?",
    });
    // Genuinely correct: this seeded knowledge base has no tour content at
    // all, so finding nothing is the right, honest outcome — never a false
    // match just because the search became more lenient.
    expect(items).toHaveLength(0);
  });

  it("does not match on common low-signal words alone (e.g. two unrelated questions both containing 'do you')", async () => {
    const supabase = makeFakeSupabase([knowledgeRow()]);
    const items = await searchKnowledgeItems(supabase, "business-1", {
      search: "Do you have a WhatsApp number I can message?",
    });
    expect(items).toHaveLength(0);
  });

  it("falls back to whole-string matching when the search text has no significant words at all (e.g. only stopwords)", async () => {
    // "how" and "do" are both filtered out as stopwords, so `words` comes
    // back empty and the OLD whole-string substring check is used as a
    // last resort instead of matching everything indiscriminately.
    const matchingTag = knowledgeRow({ id: "k1", tags: ["how do"] });
    const nonMatching = knowledgeRow({ id: "k2", tags: ["unrelated"] });
    const supabase = makeFakeSupabase([matchingTag, nonMatching]);
    const items = await searchKnowledgeItems(supabase, "business-1", { search: "how do" });
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("k1");
  });

  it("is case-insensitive", async () => {
    const supabase = makeFakeSupabase([knowledgeRow()]);
    const items = await searchKnowledgeItems(supabase, "business-1", { search: "DOCUMENTS NEEDED" });
    expect(items).toHaveLength(1);
  });

  it("with no search term at all, returns every active item unfiltered (category-only or browse-all lookups still work)", async () => {
    const supabase = makeFakeSupabase([knowledgeRow(), knowledgeRow({ id: "k2", title: "Unrelated item" })]);
    const items = await searchKnowledgeItems(supabase, "business-1", {});
    expect(items).toHaveLength(2);
  });
});
