import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type KnowledgeItem = {
  id: string;
  category: string;
  title: string;
  content: string;
  tags: string[];
  updatedAt: string;
};

const KNOWLEDGE_SELECT = "id, category, title, content, tags, updated_at";

// Common, low-signal words stripped out of a caller's search text before
// matching — without this, "What documents do I need for this job?" would
// only ever match a knowledge item whose title/content/tags happened to
// contain that EXACT sentence verbatim, which essentially never happens: a
// customer's own phrasing never matches curated FAQ wording word-for-word.
// See the "significant words" matching below for how these are used.
const SEARCH_STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "your", "this", "that",
  "with", "have", "what", "when", "where", "which", "would", "could",
  "should", "about", "need", "needs", "needed", "want", "wants", "like",
  "please", "does", "doing", "do", "did", "am", "im", "a", "an", "of", "to",
  "in", "on", "is", "it", "if", "or", "be", "been", "was", "were", "will",
  "can", "could", "any", "some", "there", "here", "how", "who", "me", "my",
  "i", "we", "us", "our", "get", "got", "just",
]);

/** Lowercased, punctuation-stripped words of 3+ letters, minus stopwords. */
function significantWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !SEARCH_STOPWORDS.has(w));
}

/**
 * Read-only search over `public.knowledge_items` — the "structured
 * knowledge retrieval, not a single system prompt containing the whole
 * business" design already documented in ARCHITECTURE.md section 7. No
 * reader existed before Phase 3; this is the first one, added to back the
 * AI Core's `search_knowledge_base` tool. Only returns `is_active` rows.
 */
export async function searchKnowledgeItems(
  supabase: SupabaseClient,
  businessId: string,
  opts: { search?: string; category?: string; limit?: number } = {}
): Promise<KnowledgeItem[]> {
  let query = supabase
    .from("knowledge_items")
    .select(KNOWLEDGE_SELECT)
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(opts.limit ?? 10);

  if (opts.category) query = query.eq("category", opts.category);

  const { data, error } = await query;
  if (error) throw error;

  let items = (data ?? []).map((r) => ({
    id: r.id as string,
    category: r.category as string,
    title: r.title as string,
    content: r.content as string,
    tags: (r.tags as string[] | null) ?? [],
    updatedAt: r.updated_at as string,
  }));

  if (opts.search) {
    const rawTerm = opts.search.trim().toLowerCase();
    if (rawTerm) {
      // Word-overlap matching, not "does the entire search string appear
      // verbatim as one substring" — a real customer's question is rarely
      // worded exactly like a curated FAQ entry. An item matches if ANY
      // meaningful word from the search text appears in its title, content,
      // or tags (falling back to the old whole-string substring check only
      // if the search text has no words long/distinctive enough to use,
      // e.g. a bare short code).
      const words = significantWords(rawTerm);
      items =
        words.length > 0
          ? items.filter((i) => {
              const haystack = `${i.title} ${i.content} ${i.tags.join(" ")}`.toLowerCase();
              return words.some((w) => haystack.includes(w));
            })
          : items.filter(
              (i) =>
                i.title.toLowerCase().includes(rawTerm) ||
                i.content.toLowerCase().includes(rawTerm) ||
                i.tags.some((t) => t.toLowerCase().includes(rawTerm))
            );
    }
  }

  return items;
}
