# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.5.7] — Phase 4 proactive review: returning customers' fresh signal was silently dropped

Continued proactive review (user: "let's continue with Phase 4 testing").
`update_lead` was registered as a Sales Agent tool — and named directly in
the spec's own acceptance example, which says the agent "creates OR
UPDATES a lead with a deterministically computed temperature/score" — but
no code path in `dev-mock.ts` ever called it, confirmed via
`grep -n '"update_lead"'` across the provider and its tests.

### Root cause
`create_lead` deliberately REUSES an existing active lead for a customer
rather than creating a duplicate (correct, spec-required behavior). But
its handler returns that existing lead's stored score/temperature
UNCHANGED — it never recomputes them from the current turn's
qualification info. So a returning customer who now gives real signal
("it's urgent," a specific destination, a stated profession) had that
signal silently discarded: nothing in the mock ever fed it to
`update_lead`, the one tool built for exactly this.

### Fixed
- **`src/lib/ai/provider/dev-mock.ts`** — added a new branch to
  `planSalesAgentFollowUp`: once `create_lead` comes back with
  `created: false` (an existing lead was reused) and this turn's message
  contains real profession/destination/urgency signal, it plans an
  `update_lead` call with the recomputed qualification factors.
  **Deliberately conservative**: `update_lead` fully OVERWRITES
  score/temperature from whatever `qualification` it's given — it does
  NOT merge with whatever factors originally produced the existing score,
  and this mock only ever sees 3 of the 6 factors (fit/opportunityRelevance/
  urgency) from a single message, never the richer set (intentClarity/
  completeness/engagement) that may have built up a high score over many
  prior turns. So this only fires when the recomputed score would be
  HIGHER than what's already on file (using the same `computeLeadScore`
  the real scoring module exposes for exactly this kind of reuse) — it
  never downgrades an already-strong lead just because one new message
  alone can't capture as much as a fuller conversation history did.

### Added
- 2 new tests in `dev-mock.test.ts`: a low-score existing lead (e.g. a
  bare walk-in record) gets a real, recomputed `update_lead` call once
  genuine signal is given, with the loop still terminating cleanly
  afterward; an already-"hot" existing lead (score 91) is NEVER touched by
  the same new message, proving the one-directional safety rule holds.

### Verified
- `npx vitest run` — 209/209 passing (22 test files).
- `npx eslint .` — clean.
- `npx tsc --noEmit` — clean.
- `npm run build` — succeeds.

### Confirmed unchanged / not done
- No database migration; `update_lead`'s own tool schema/handler
  (`src/lib/ai/tools/write.ts`) is untouched — only the mock provider's
  planning logic now calls it.
- `create_lead`'s reuse-existing-lead behavior is untouched — still never
  duplicates a customer's active lead.
- Does not attempt to merge old and new qualification factors (the mock
  has no persisted memory of the original factors to merge with) — the
  "never downgrade" rule is the safety net in place of a proper merge.
- The real `OpenAiProvider` and `AI_PROVIDER=mock` switch are both intact.

## [0.5.6] — Phase 4 enhancement: phone matching normalized (formatting-insensitive, country-code-sensitive)

Live-testing follow-up to 0.5.5: a customer created via `/customers/new`
with phone `799999911` didn't match when the Sales Agent chat test typed
`+254799999911` — traced to `findCustomerByContact` using a raw
column-level `.eq()`, so any formatting difference (a leading `+`, spaces,
dashes, parentheses, or a missing/present country code) was treated as a
completely different number. Requested explicitly: the user wants this
normalized because they get clients from outside Kenya too, so the country
code itself must stay meaningful — not be stripped or guessed at.

### Fixed
- **`src/lib/business/customers.ts`** — added `normalizePhone()`, a small
  exported helper that strips everything except digits (spaces, dashes,
  dots, parentheses, and a leading `+`) while leaving every actual digit —
  including the country code — untouched. `findCustomerByContact` now
  compares phones via `normalizePhone(candidate) === normalizePhone(search)`
  instead of a raw `.eq()`. Since a computed comparison can't be pushed
  into a plain column filter, phone matching is done in application code:
  when a phone is given, the query widens to the business's full customer
  list (still scoped by `business_id`) and the final match is applied in
  JS — the same "fetch broader, refine in code" trade-off already used for
  the knowledge-base search fix (0.5.5), reasonable at this app's scale.
  Email matching is untouched — still an exact, case-insensitive,
  database-level check.
- Deliberately conservative: only formatting characters are stripped,
  never digits, so two numbers that happen to share trailing digits but
  have different country codes (e.g. a Kenyan `+254799999911` vs a
  different country's `+1799999911`) are correctly never treated as the
  same customer. This was a specific, explicit requirement, not an
  incidental side effect.

### Added
- 7 new tests in `customers.test.ts`: the same number matches whether
  typed/stored with or without a `+`, with or without spaces/dashes/
  parens, or in a different form than what was originally stored;
  numbers sharing trailing digits but differing in country code never
  match; a genuinely different number still correctly returns no match;
  phone matching still works as an OR alongside a non-matching email;
  plus direct unit tests of `normalizePhone` itself.

### Verified
- `npx vitest run` — 207/207 passing (22 test files).
- `npx eslint .` — clean.
- `npx tsc --noEmit` — clean.
- `npm run build` — succeeds.

### Confirmed unchanged / not done
- No database migration, no change to how phone numbers are STORED or
  displayed — this only changes how they're MATCHED.
- Email matching, `create_customer`, and `create_lead` are all untouched.
- No attempt to normalize across genuinely different formats that imply a
  different actual number (e.g. a local `0799999911` vs an international
  `+254799999911`) — that requires per-country trunk-prefix knowledge this
  fix deliberately doesn't guess at, to avoid ever merging two different
  people's numbers.

## [0.5.5] — Phase 4 diagnostic: knowledge-base search never matched real customer phrasing

Live-testing follow-up to 0.5.4: after the intent-keyword fix, the Sales
Agent correctly called `update_conversation_state` + `search_knowledge_base`
for document/tour/fee/etc. questions (confirmed — the two tool calls
appeared together, proving the intent WAS detected), but almost every
message still got the honest "I don't have verified information in our
knowledge base yet" fallback, including "What documents do I need for this
job?" despite a seeded FAQ item that answers exactly that question.

### Root cause
Two separate, easily-conflated things were going on:
1. **A real bug.** `searchKnowledgeItems` (`src/lib/business/knowledge.ts`)
   required the ENTIRE `search` string to appear as ONE literal, contiguous
   substring in an item's title, content, or tags. The mock provider (and
   potentially the real OpenAI provider, if it ever passes a customer's
   wording through unchanged) passes the customer's raw message as `search`
   — e.g. `"What documents do I need for this job?"` — which will almost
   never appear verbatim inside a curated FAQ entry like `"[DEMO] What
   documents do I need for Jobs Abroad applications?"`, even though the two
   are obviously about the same thing to a human reader. This made
   `search_knowledge_base` effectively unusable for real customer phrasing.
2. **Not a bug — expected behavior.** `supabase/seed.sql` only seeds ONE
   knowledge-base item (the documents FAQ). Test prompts about tours, fees,
   vacancies, or requirements have genuinely NO backing content, so an
   honest "I don't have verified information" for those is the CORRECT
   response (spec: never invent an answer) — not something a code fix
   should change. My own earlier testing guidance conflated this with the
   real bug by suggesting several prompts with no seeded content as if they
   should all get a "specific" reply.

### Fixed
- **`src/lib/business/knowledge.ts`** — `searchKnowledgeItems` now does
  word-overlap matching instead of whole-string matching: the search text
  is split into lowercase words, common low-signal words are stripped
  (`SEARCH_STOPWORDS` — "what", "do", "need", "this", etc.), and an item
  matches if ANY remaining significant word appears in its title, content,
  or tags. Falls back to the old whole-string substring check only when the
  search text has no significant words at all (e.g. a bare short code).
  This is a fix to real business logic used by both AI providers, not
  something scoped to the mock provider — the underlying search was always
  too strict, regardless of which provider constructs the `search` argument.

### Added
- 7 new tests in `knowledge.test.ts`: natural customer phrasing now matches
  a seeded FAQ; different surrounding wording still matches on the shared
  significant word; a genuinely uncovered topic (tours) still correctly
  returns nothing; two unrelated questions sharing only common words
  ("do you") don't falsely match; the whole-string fallback still works for
  a short-code-style search with no significant words; matching is
  case-insensitive; an empty search term still returns everything
  unfiltered.

### Verified
- `npx vitest run` — 200/200 passing (22 test files).
- `npx eslint .` — clean.
- `npx tsc --noEmit` — clean.
- `npm run build` — succeeds.

### Confirmed unchanged / not done
- No database migration, no change to seeded data.
- `search_knowledge_base`'s tool schema and permission are untouched — only
  the underlying business-logic search function's matching algorithm
  changed.
- Category-only lookups (no `search` text) are unaffected — still return
  every active item in that category, unfiltered.
- To actually see a *different* answer for tours/fees/vacancies/etc. in
  live testing, real knowledge-base entries for those topics need to be
  added first (via the app) — no code change makes up for missing content,
  by design.

## [0.5.4] — Phase 4 proactive review: intent-keyword plural matching, missing follow-up task

Not a live-testing bug report this round — the user asked to "keep testing
on Phase 4," so this pass was a proactive code review of the mock provider
looking for gaps before they surfaced live. Found and fixed two real,
confirmed issues.

### Bug B — intent keywords silently failed to match plural/suffixed forms

`INTENT_KEYWORDS` (and `extractUrgency`, and the `wantsMoreDetail` check in
`planSalesAgentFirstPass`) all used the shape `\b(alt1|alt2|...)\b` — a
regex alternation with a boundary on BOTH sides. A trailing `\b` right
after an alternation anchors to wherever the MATCHED alternative's text
ends, not to the end of the surrounding word, so:
- A plain singular noun never matched its own natural plural — "document"
  didn't match "documents", "tour" didn't match "tours", "requirement"
  didn't match "requirements", "fee" didn't match "fees". Two of the exact
  broken phrases are this app's OWN suggested example prompts
  (`SALES_AGENT_EXAMPLE_PROMPTS` in `src/app/(dashboard)/ai/page.tsx`):
  "What documents do I need for this job?" and "Do you have any tours to
  the coast?" — both silently fell through to no detected intent.
- An intentional word stem meant to catch several suffixed forms never
  matched ANYTHING — "vacan" (for "vacancy"/"vacancies"), "qualif" (for
  "qualify"/"qualification"), "eligib" (for "eligible"/"eligibility"),
  "recruit" (for "recruiting"/"recruitment") were all dead code in
  practice, because the character right after the stem is never a word
  boundary.
- Confirmed empirically (`node -e`, not just by inspection) across 7
  realistic customer messages before fixing.

**Fixed**: changed every such regex from `\b(alt1|alt2|...)\b` to
`\b(?:alt1|alt2|...)` — a LEADING boundary only, non-capturing group — in
`INTENT_KEYWORDS`, `extractUrgency`, and the inline `wantsMoreDetail`
regex in `src/lib/ai/provider/dev-mock.ts`. The leading boundary alone
still prevents a false match inside an unrelated longer word (e.g. "tour"
inside "contour" still correctly does not match), while now correctly
matching plural/suffixed forms.

### Bug A — create_lead never triggered a follow-up task, despite the acceptance criteria

Phase 4's acceptance criteria (spec section 19, `DEVELOPMENT_PROGRESS.md`)
explicitly expects the Sales Agent to, "(where appropriate), create a
follow-up task" after creating/matching a lead. `create_task` was already
registered as an available tool for the Sales Agent persona, but no code
path in `dev-mock.ts` ever planned a call to it — confirmed via
`grep -n "create_task"` across the provider and its test file.

**Fixed**: added a new branch at the top of `planSalesAgentFollowUp` in
`src/lib/ai/provider/dev-mock.ts` — once `create_lead` has succeeded
(`created: true`) AND matched a specific open job (`applicationId` set),
and `create_task` hasn't already been called this turn, it plans a
`create_task` call built entirely from real data already in hand: the
real `leadId` for `relatedLeadId`, a title built from the real matched
`jobTitle` (plus the customer's profession, if extracted), and `priority`
set from the same `extractUrgency()` already used elsewhere — never
invented specifics. This respects `core.ts`'s `MAX_TOOL_ROUNDTRIPS = 4`:
it's gated behind the same `forceFinalize = roundsSoFar >= 3` guard every
other follow-up round already uses, so it only fires when there's genuine
round budget left (realistically: an existing-customer, single-match
conversation, which reaches `create_lead` by round 2, leaving round 3 free
for the task). A brand-new-customer conversation that already spends 3
rounds reaching `create_lead` won't get an automatic task in the same
turn — an honest, acceptable reading of the spec's own "(where
appropriate)" qualifier, not a workaround.

### Added
- 9 new tests in `dev-mock.test.ts`:
  - 2 tests proving `planSalesAgentFollowUp` now plans `create_task` with
    real details (`relatedLeadId`, a title built from the real job title,
    `priority` from real urgency) once `create_lead` succeeds with an
    `applicationId`, and that the loop still terminates cleanly on the
    following round; plus a test proving no `create_task` is planned when
    `create_lead` genuinely failed.
  - 6 tests proving the specific previously-broken phrases (including both
    of the app's own example prompts) now correctly resolve their intended
    intent, plus one proving the leading-boundary fix doesn't introduce a
    new false positive ("contour" still doesn't match the "tour" stem).
  - 1 existing regression: full pre-existing 19-test file re-run clean
    alongside the new tests.

### Verified
- `npx vitest run` — 193/193 passing (21 test files).
- `npx eslint .` — clean.
- `npx tsc --noEmit` — clean.
- `npm run build` — succeeds.

### Confirmed unchanged / not done
- No database migration, no change to RLS or business_id scoping.
- `create_task`'s own tool handler/schema (`src/lib/ai/tools/write.ts`) is
  untouched — only the mock provider's planning logic now calls it.
- The real `OpenAiProvider` and `AI_PROVIDER=mock` switch are both intact.
- Self-initiated from "let's keep testing on Phase 4," not yet confirmed
  by the user against a live conversation.

## [0.5.3] — Phase 4 diagnostic: "Invalid UUID" on create_lead

Live-testing follow-up to 0.5.2: with `AI_PROVIDER=mock`, the Sales Agent
correctly found the real open "[DEMO] Registered Nurse — Luxembourg" job
and called `update_conversation_state` → `get_open_jobs` →
`find_customer_by_contact` → `create_lead`, but `create_lead` failed with
`"The create_lead tool call had invalid arguments: Invalid UUID"`. The
mock provider honestly reported the failure rather than claiming success
(the 0.5.2 fix working as intended) — but the underlying failure itself
needed diagnosing.

### Root cause
Not a bug in the mock provider's tool-call construction — traced the exact
sequence (`planSalesAgentFollowUp` in `dev-mock.ts`) and confirmed it
correctly carries forward the REAL `id` returned by `find_customer_by_contact`
/`create_customer` and `get_open_jobs` into `create_lead`'s `customerId`/
`opportunityId`; it never invents or substitutes a name/phone/title for an
id. The actual defect is in the AI tool layer's input validation: every
`customerId`/`leadId`/`opportunityId`/`applicationId`/`jobId` field across
`src/lib/ai/tools/write.ts`, `read-only.ts`, and `src/lib/ai/validation.ts`
used `z.string().uuid()`, which — beyond checking the standard
8-4-4-4-12 hex shape Postgres's `uuid` column type itself accepts — also
requires a valid RFC4122 version nibble (`[1-8]`) and variant nibble
(`[89ab]`). Phase 0's `seed.sql` demo rows (the `[DEMO]` jobs, customers,
leads, tasks) use hand-typed, human-readable placeholder ids for
readability, e.g. the Luxembourg job's real id is
`00000000-0000-0000-0000-000000000101` and the demo customers are
`...-000201`/`...-000202`/`...-000203`. These are entirely valid Postgres
`uuid` values — Postgres does not check version/variant bits — but they
fail Zod's stricter `.uuid()` check, all-zero version nibble included. So
whenever the Sales Agent (mock OR, equally, the real OpenAI provider —
this was never mock-specific) tried to reference any of these real,
correctly-identified seeded rows, the AI tool layer rejected its own
correct tool call with "Invalid UUID."

### Fixed
- **`src/lib/ai/validation.ts`** — added `dbId()`, a shared schema helper
  (`z.string().guid()`) that validates a value is UUID-*shaped* without
  also enforcing a specific RFC4122 sub-version. `.guid()` is Zod v4's
  deliberately format-only sibling of `.uuid()` for exactly this case —
  it still rejects anything that isn't UUID-shaped at all (a customer
  name, a phone number, a job title — never accepted as a substitute for
  a real id), it just doesn't additionally reject a real Postgres `uuid`
  value for having an unusual version nibble. Applied to
  `aiChatRequestSchema.conversationId` and
  `salesAgentChatRequestSchema.conversationId`/`customerId`.
- **`src/lib/ai/tools/write.ts`** — replaced every `z.string().uuid()`
  with `dbId()`: `create_lead`'s `customerId`/`opportunityId`,
  `update_lead`'s `leadId`, `create_task`'s
  `relatedCustomerId`/`relatedLeadId`/`relatedOpportunityId`, and
  `update_conversation_state`'s `matchedOpportunityId`.
- **`src/lib/ai/tools/read-only.ts`** — same replacement for
  `get_customer`'s `customerId`, `get_lead`'s `leadId`, `get_job`'s and
  `get_job_applicants`'s `jobId`, `get_application`'s `applicationId`, and
  `get_missing_documents`'s optional `jobId`.
- The security boundary for every one of these fields is unchanged: RLS
  plus the `ctx.businessId`/`business_id` filter every business-logic
  query already applies — never the id string's format. This fix only
  relaxes a pre-database format check to match what Postgres's `uuid`
  column type itself already accepts; it doesn't touch RLS policies,
  business scoping, or any other Phase 4 security behavior.
- The real `OpenAiProvider` was equally affected by this bug (it's a tool
  *input schema* defect, not something specific to the mock provider) and
  is equally fixed by it — nothing provider-specific was changed.

### Added
- 3 new tests in `dev-mock.test.ts` proving the mock provider carries
  forward the exact tool-result id into `create_lead` — for a hand-seeded,
  non-RFC4122 placeholder-style customer/job id AND for an ordinary
  freshly-generated one — and never substitutes a name/phone/title; plus
  a regression test confirming genuine tool failures are still reported
  honestly (the 0.5.2 fix, unaffected by this change).
- 3 new tests in `write.test.ts`: `create_lead` now accepts a hand-seeded,
  non-RFC4122 placeholder-style `customerId`/`opportunityId` (the exact
  live failure), while still rejecting a customer name, phone number,
  email, or job title supplied in place of an id (both as `customerId`
  and as `opportunityId`).
- 1 new test in `create-lead-persistence.test.ts` proving the FULL
  pipeline end to end for this exact class of id — real Zod validation,
  real business logic, real persistence, real retrieval via `listLeads`/
  `listApplications` — using generic synthetic data in the same id style,
  not the literal Luxembourg job or any specific test persona.

### Verified
- `npm run test` — 184/184 passing (21 test files).
- `npm run lint` — clean.
- `npx tsc --noEmit` — clean.
- `npm run build` — succeeds.

### Confirmed unchanged / not done
- No database migration — no schema change of any kind; the `uuid` column
  type and every seeded row's actual id value are untouched.
- No hard-coded reference to the Luxembourg job or any specific test
  customer anywhere in the fix or new tests.
- RLS and business_id scoping are untouched everywhere.
- The real `OpenAiProvider` and `AI_PROVIDER=mock` switch are both intact.
- No Phase 5 work started.

## [0.5.2] — Phase 4 diagnostic: mock-mode reply honesty, state-aware follow-ups, real persistence proof

Diagnostic task: with `AI_PROVIDER=mock`, the Sales Agent's tool trace
showed `create_lead`, the AI replied "I've updated your existing enquiry",
and yet `/leads` never showed a new lead. Root-caused and fixed below —
see the full write-up for the exact chain of reasoning; summary only here.

### Root cause
`createLead()`/`create_lead` themselves have no persistence bug — the
insert, `business_id` scoping, and customer linkage were already correct
(confirmed by a new end-to-end test against the REAL, unmocked
business-logic layer — see "Added" below). The actual defect was in
`DevRuleBasedProvider.summarize()` (`src/lib/ai/provider/dev-mock.ts`): it
cast a `create_lead`/`create_customer` tool result straight to
`{created?: boolean}` without first checking whether that result was
actually the `{error: "..."}` shape `core.ts`'s tool loop produces for a
FAILED call. Since a failed call's `.created` is `undefined` — falsy,
exactly like a legitimate "reused the existing lead" result — any real
failure (a bad id, a job that's no longer open, a validation error) was
silently reported as "I've updated your existing enquiry with these
details," a false claim of success. This matches the forensic principle
that a tool name appearing in the UI trace does not prove it succeeded:
`core.ts` records failed calls into the trace too.

### Fixed
- **`src/lib/ai/provider/dev-mock.ts`** — `summarize()` now checks each
  `create_customer`/`create_lead` tool result for the `{error}` shape
  (`isToolError()`) before treating it as any kind of success, and gives
  an honest "I wasn't able to save those details just now ... I'll flag
  this for a team member" message instead when it failed.
- **`src/lib/ai/provider/dev-mock.ts`** — short, low-signal follow-up
  replies ("Yes please", "Tell me more", "What is my status?") now use the
  conversation's already-known structured state (parsed from
  `buildSalesAgentPrompt`'s "CONVERSATION STATE SO FAR" block — the only
  place that state is visible to a stateless per-request provider) instead
  of re-asking from scratch or silently discarding a previously-detected
  intent by overwriting it with a bare `GENERAL_ENQUIRY` guess:
  - `"What is my status?"` (widened `APPLICATION_STATUS` keyword match to
    include "my status") with a known lead now calls the real `get_lead`
    tool and answers from the actual stage/temperature — never invented.
  - `"Tell me more"` with a known matched opportunity now calls `get_job`
    for that same job and summarizes its real detail.
  - A bare affirmative/acknowledgement with *any* known state (lead,
    matched opportunity, or captured qualification) gets an honest
    acknowledgement instead of a generic "tell me more" that ignores what
    is already on file.
  - With genuinely no prior state at all, behavior is unchanged from
    before this fix.
  - Also hardened: `get_open_jobs` is now only ever called with a real
    profession/destination filter, even along this new state-aware path —
    never with empty filters (which would dump every open job).
- **`src/test/fake-supabase.ts`** — `.insert()` was a complete no-op (no
  generated id, no mutation of the underlying table, invisible to any
  later `.from(table)` call or `.select()`), so no test using this fake
  could ever prove genuine "insert, then retrieve" persistence. It now
  generates an id (`randomUUID()`) for any row that doesn't have one and
  pushes onto the SAME array backing that table, so later, independent
  `.from(table)` calls (e.g. `leads.ts`'s `notifyHotLead`, which re-selects
  the row it just inserted) see it too, and a chained
  `.select(...).single()` returns exactly what was inserted. Table arrays
  are also now reused across repeated `.from(table)` calls on the same
  fake client (previously a table with no pre-seeded rows got a fresh,
  disconnected `[]` on every call). No consumer of this fake relied on
  `.insert()` being a no-op — all 8 existing test files using it, and all
  166 previously-passing tests, still pass unchanged.

### Added
- **`src/lib/ai/tools/create-lead-persistence.test.ts`** (5 tests) — the
  item-5 regression test the diagnostic task asked for: proves
  `create_lead` genuinely persists through the REAL, unmocked
  `@/lib/business/{customers,leads,applications,jobs}` layer (unlike
  `write.test.ts`, which mocks all of them and can only prove the AI tool
  layer *calls* them correctly). Confirms: a real lead row is written; it
  belongs to the calling business (and is invisible to a different
  `business_id`'s `/leads` query); it's linked to the customer
  `create_customer` actually persisted (not a coincidence); linking to a
  currently-open job creates a real, retrievable `applications` row per
  Phase 2 rules; linking to a job that is no longer open creates no
  application row at all; and every assertion is made through the real
  `listLeads()`/`listApplications()` read path — the same one `/leads` and
  `/applications` use — never by inspecting the fake table directly. Uses
  no demo-specific data (no hard-coded job or customer name) — every id is
  a freshly generated UUID.
- 6 new tests in `dev-mock.test.ts` covering the two fixes above: the
  honest-failure-message case, and four state-aware follow-up scenarios
  (`get_lead` status lookup, real-data status answer, bare-affirmative
  acknowledgement, `get_job` "tell me more" lookup, and the unchanged
  no-prior-state fallback).

### Verified
- `npm run test` — 177/177 passing (21 test files).
- `npm run lint` — clean.
- `npx tsc --noEmit` — clean.
- `npm run build` — succeeds.

### Confirmed unchanged / not done
- No database migration — the defects were entirely in application-layer
  mock-provider logic and test infrastructure, not schema.
- The real `OpenAiProvider` and `AI_PROVIDER=mock` switch are untouched.
- No Phase 5 work started.
- Nothing in this fix hard-codes any specific job or customer name — every
  new test uses freshly generated, synthetic data.

## [0.5.1] — Phase 4 follow-up: local dev/test AI provider switch

### Added
- **`AI_PROVIDER=mock`**: a new, explicit environment-variable switch (see
  `aiProviderConfig` in `src/lib/config.ts`) that lets the AI Sales Agent
  tab — and the AI Assistant tab — be used locally without live OpenAI
  billing/credits, addressing the gap where Phase 4 could only be
  *automated-tested* without billing, not actually clicked around in the
  dashboard. `getAiProvider()` (`src/lib/ai/provider/index.ts`) now
  returns `DevRuleBasedProvider` when set, instead of `OpenAiProvider` —
  one change, in the one place both AI personas obtain their provider, so
  neither `/api/ai/chat` nor `/api/ai/sales-agent` needed a change beyond
  the config gate below.
- **`DevRuleBasedProvider`** (`src/lib/ai/provider/dev-mock.ts`): a
  deterministic, zero-cost, rule-based `AiProvider` implementation for
  local development/testing only. Unlike the existing `MockAiProvider`
  (unit tests only — requires a hand-scripted sequence of exact
  responses), this one has no script: it reacts to whatever conversation
  and tool list it's actually given, running the real bounded
  tool-calling loop and real Phase 4 business logic — intent detection,
  job matching against currently-open jobs, qualification capture via
  `update_conversation_state`, and (when a message plainly gives a name +
  contact) chaining `find_customer_by_contact` → `create_customer` →
  `create_lead` with deterministic scoring — for any test message, not
  one hard-coded scenario. It never invents business data: every factual
  claim comes from a real tool result, or it says so / asks a clarifying
  question.
- `env.hasAiProvider` (`src/lib/config.ts`): true when either a real
  `OPENAI_API_KEY` is set or `AI_PROVIDER=mock` is set. Both AI API
  routes and the `/ai` page now gate on this instead of `env.hasOpenAI`
  directly, so the whole feature works with `AI_PROVIDER=mock` even with
  no OpenAI key configured at all. `env.hasOpenAI` itself is unchanged —
  the Settings page, dashboard widget, and health check still report the
  real OpenAI integration's status specifically.
- 16 new tests: `dev-mock.test.ts` (the provider's own behavior across
  several distinct scenarios — vague enquiry, specific job enquiry for
  different professions/countries, empty search results, complaint/human
  handover, the full contact-info → customer → lead chain, round-trip
  termination safety, and the internal assistant persona), extended
  `provider/index.test.ts` (provider selection, including that an
  unrecognized `AI_PROVIDER` value safely falls back to the real
  provider rather than silently mocking a typo), and new gate tests in
  both route test files proving a route does NOT 503 when only
  `AI_PROVIDER=mock` is set, with no OpenAI key at all.
- `AI_PROVIDER=mock` documented in `.env.example` and a new SETUP.md
  section 3b subsection ("Trying it right now, without OpenAI billing").

### Changed
- `src/app/api/ai/chat/route.ts`, `src/app/api/ai/sales-agent/route.ts`,
  `src/app/(dashboard)/ai/page.tsx`: the "isn't configured yet" gate now
  checks `env.hasAiProvider` instead of `env.hasOpenAI`.

### Verified
- `npm run lint` — clean.
- `npx tsc --noEmit` — clean.
- `npm run test` — 166/166 passing (20 test files).
- `npm run build` — succeeds.

### Confirmed unchanged
- The real `OpenAiProvider` (`src/lib/ai/provider/openai.ts`) was not
  touched, weakened, or bypassed — it remains the provider used whenever
  `AI_PROVIDER` is unset/`openai` and `OPENAI_API_KEY` is present, exactly
  as before. `AI_PROVIDER=mock` is a single explicit switch, never an
  automatic fallback: a missing/broken key still throws `AiConfigError`.
- No database schema changes — no new migration.

## [0.5.0] — Phase 4: AI Sales Agent, Lead Qualification & Conversation Engine

### Added
- **AI Sales Agent tab** on `/ai` (next to the existing "AI Assistant"
  tab): a customer-facing chat surface — simulated from the dashboard for
  now, over `channel = 'website'` — plus a live side panel showing
  conversation mode, detected intent, the linked lead (temperature +
  score), matched OPEN opportunity, captured qualification details, and a
  recent conversation-events timeline. Includes Take over / Resume AI /
  Pause AI controls for human takeover.
- **`POST /api/ai/sales-agent`**: a second, channel-agnostic conversation
  engine endpoint sharing the AI Core's provider abstraction, tool
  registry, and bounded loop, but with its own persona, its own
  server-loaded (never client-trusted) conversation history, its own rate
  limit budget, and a hard code-level gate that skips calling the AI
  provider entirely while a conversation is in `human` or `paused` mode.
- **7 new AI tools** (`src/lib/ai/tools/write.ts`), the first write
  capability the AI has ever had, every one wrapping existing
  `src/lib/business/*` functions — never a direct database write, and
  never a generic SQL/`update_database` tool: `find_customer_by_contact`,
  `create_customer`, `create_lead` (dedups against an existing active lead
  for the same customer, re-verifies a target job is genuinely OPEN before
  linking it, computes score/temperature deterministically), `update_lead`
  (accepts qualification factors and pipeline/notes fields only — never a
  raw temperature or score), `create_task`, `add_conversation_event`,
  `update_conversation_state` (the human-takeover mechanism; explicitly
  refuses to let the AI resume itself). 24 tools total are now registered
  (17 read + 7 write), shared by both AI personas.
- **Deterministic lead-qualification & scoring model**
  (`src/lib/ai/qualification/scoring.ts`): six named, weighted, documented
  factors (intent clarity, fit, urgency, completeness, engagement,
  opportunity relevance; weights sum to 1.0) combine into a 0–100 score,
  which deterministically maps to the existing `hot`/`warm`/`nurture`
  temperature enum plus a display-only 4th "cold" tier — the model
  supplies qualification factors, never a score or temperature directly.
- **Structured sales intents** (`src/lib/ai/sales/intents.ts`): 14
  categories (`GENERAL_ENQUIRY` through `OTHER`), stored as free text on
  `conversations.intent` so future intents need no migration.
- **Human takeover state machine**: `conversations.mode` widened to
  `'ai' | 'human' | 'paused'`; three new Server Actions
  (`src/app/(dashboard)/ai/sales-agent-actions.ts`) let staff take over, 
  resume AI, or pause AI from the dashboard; every transition is logged
  as a `conversation_events` row.
- **`conversation_events`** (new table): a per-conversation activity
  timeline mirroring the existing `lead_events`/`application_events`
  tables exactly — `intent_detected`, `qualification_started`,
  `qualification_completed`, `lead_created`, `lead_updated`,
  `opportunity_matched`, `document_requirement_discussed`,
  `application_status_requested`, `human_handover`, `ai_resumed`,
  `follow_up_required`.
- **Owner notifications for AI-driven events**
  (`src/lib/ai/sales/notifications.ts`): diff-based, fires once per
  genuine transition (a lead newly becoming hot, a fresh human handover,
  a fresh pause, a fresh complaint) — never per message, never repeats
  while already in that state.
- New migration `supabase/migrations/0007_ai_sales_agent.sql`: widens
  `conversations.mode`; adds `lead_id`, `intent`,
  `matched_opportunity_id`, `qualification`, `handover_reason` columns to
  `conversations`; adds the `conversation_events` table + RLS policy + 
  indexes. No existing table, column, or policy is changed.
  **Action needed:** run this once in the Supabase SQL Editor, after
  `0006` — see SETUP.md section 3.
- SETUP.md section 3b: how to try the AI Sales Agent tab, including the
  spec's worked example ("I am a physiotherapist and I'm interested in
  Somalia") and a note on human-takeover behavior.
- 60 new unit/route tests (see "Verified" below), none of which call the
  real OpenAI API.

### Changed
- `src/lib/ai/core.ts`: `runAiChat()` now takes an explicit `systemPrompt`
  parameter instead of building the internal-assistant prompt itself — so
  the same bounded loop serves both the AI Assistant and AI Sales Agent
  personas. `/api/ai/chat` updated to pass its existing prompt explicitly;
  behavior for the AI Assistant tab is unchanged.
- `src/lib/ai/prompts/`: the ~17 core safety rules were extracted into
  `rules.ts` (`BASE_CORE_RULES`), shared by `system.ts` (AI Assistant) and
  the new `sales-agent.ts` (AI Sales Agent) rather than duplicated.
- `src/lib/ai/types.ts`: `AiToolContext` gained `conversationId: string |
  null` — like `businessId`, always resolved server-side, never accepted
  from the model; `null` for the internal AI Assistant, set for the AI
  Sales Agent.
- `src/lib/business/customers.ts` / `leads.ts`: added
  `findCustomerByContact()` and `findActiveLeadForCustomer()` — additive
  read helpers reused by the new `create_customer`/`create_lead` tools
  (and available to any future caller).
- `src/lib/config.ts`: `features.aiSalesAgent` flipped to `true`.

### Verified
- `npm run lint` — clean.
- `npx tsc --noEmit` — clean.
- `npm run test` — 150/150 passing (19 test files).
- `npm run build` — succeeds; `/api/ai/sales-agent` correctly forced
  dynamic, alongside every existing route.
- `0007_ai_sales_agent.sql` dry-run tested against a local PostgreSQL 16
  instance on top of `0001`, `0003`–`0006` + seed (`0002` skipped as
  storage-schema-only and unrelated to this migration's tables): applies
  cleanly, idempotent re-run confirmed, `ai`→`paused`→`human` mode
  transitions all succeed, an invalid mode value is still rejected by the
  check constraint, and a `conversation_events` insert succeeds and is
  queryable under RLS.

### Known limitations
- **Live OpenAI calls were not exercised in this environment.** OpenAI
  billing/credits are not active on the configured account, so every
  automated test — including the full `/api/ai/sales-agent` route — runs
  against the deterministic `MockAiProvider`. The real `OpenAiProvider`
  remains fully wired and is what the dashboard actually calls once
  billing is active; this has not changed since the Phase 3 entry below.
- `leads.temperature` intentionally stays a 3-value enum (`hot`/`warm`/
  `nurture`) rather than the spec's literal 4-value model — "cold" is a
  display-only label computed in application code. See ARCHITECTURE.md
  section 5 for the full rationale.
- The Sales Agent is simulated through the dashboard over
  `channel = 'website'`; no real customer-facing channel (WhatsApp, web
  chat widget, etc.) exists yet — that's Phase 5.
- The Sales Agent reuses the same simple in-process (not multi-instance-
  safe) rate limiter as the AI Assistant, just on a separate budget.
- Owner-notification rules are intentionally coarse (a small fixed set of
  transition types) rather than a configurable rules engine.
- No write tool can change application/job status, approve or reject an
  applicant, issue a refund, confirm a payment, or delete anything — by
  design, per spec section 15; these remain fully out of the AI's reach.

## [0.4.0] — Phase 3: AI Core

### Added
- **AI Command Centre** (`/ai`): a natural-language chat interface —
  message history, loading/error/empty states, example prompts, "new
  conversation" — that answers using real business data through 17
  read-only tools, never invented data. A small "Ask Grandvic AI" card
  with suggested prompts was also added to the dashboard (static links
  into `/ai?q=...`; it never calls OpenAI on dashboard load).
- **`src/lib/ai/`** — the AI Core, provider-agnostic by design (spec
  section 2): `types.ts`/`errors.ts` (shared contracts and safe,
  user-facing error classes), `context.ts` (resolves user + business scope
  for one request, reusing `requireCurrentUser`/`resolveBusinessId` —
  never a second auth path, never assumes an Owner's `business_id` is
  populated), `core.ts` (the bounded tool-calling loop — max 4 tool
  round-trips, capped history/output tokens), `prompts/system.ts` (a short,
  modular rule list — not one giant hard-coded prompt), `provider/openai.ts`
  (the only file that imports the OpenAI SDK) + `provider/mock.ts`
  (test-only, scripted responses, never used at runtime) behind a common
  `AiProvider` interface, `tools/registry.ts` + `tools/read-only.ts` (see
  below), `logging.ts` (`ai_runs` writes), `rate-limit.ts` (simple
  in-process per-user limiter), `validation.ts` (the chat request's Zod
  schema).
- **17 read-only AI tools**, each wrapping a real `src/lib/business/*`
  function against the SAME RLS-scoped Supabase client every page uses —
  never the service-role client, never raw SQL, and no tool accepts a
  `businessId` argument from the model (scope always comes from the
  authenticated session server-side): `get_dashboard_summary`,
  `get_business_summary`, `search_customers`, `get_customer`,
  `search_leads`, `get_lead`, `get_hot_leads`, `get_open_jobs`, `get_job`,
  `get_job_applicants`, `get_application`, `get_missing_documents`,
  `get_tasks`, `get_notifications`, `get_recent_activity`,
  `get_business_settings`, `search_knowledge_base`. **No write/delete/
  send/publish tool exists in this phase.**
- Three small additive readers for tables that existed since Phase 0 but
  had no reader yet: `listRecentActivity` in `audit.ts`, and new files
  `settings.ts` and `knowledge.ts` — no duplicated query logic, no new
  tables.
- **`src/lib/business/conversations.ts`**: persists AI Command Centre
  conversations into the existing `conversations`/`conversation_messages`
  tables under `channel = 'dashboard'`, `mode = 'ai'` — the same shape a
  future WhatsApp conversation will use, not a parallel AI-only table.
- **`POST /api/ai/chat`**: authenticates, resolves business context, rate
  limits, persists both sides of the conversation, runs the tool-calling
  loop, logs the run to `ai_runs`, and returns a small structured JSON
  response — never a stack trace, database error, or API key fragment.
- New migration `supabase/migrations/0006_ai_core.sql`: adds no new
  tables — only widens `conversations.channel` to also allow `'dashboard'`.
  **Action needed:** run this once in the Supabase SQL Editor, after
  `0005` — see SETUP.md section 3.
- `OPENAI_API_KEY` / `OPENAI_MODEL` / `AI_RATE_LIMIT_PER_MINUTE` added to
  `.env.example`, with SETUP.md section 3a walking through getting a key
  and trying the AI Command Centre.
- 37 new unit tests, none of which call the real OpenAI API: tool registry
  integrity (exact tool allow-list, every tool read-only, no `businessId`
  escape hatch, no SQL-execution capability), input validation, several
  real tool handlers (customer/lead/job/missing-documents lookups) against
  a small fake Supabase query builder (`src/test/fake-supabase.ts`), the
  tool-calling loop (including its round-trip ceiling and provider-error
  handling) via a scripted `MockAiProvider`, rate limiting, `ai_runs`
  logging, and the `/api/ai/chat` route's auth/config/rate-limit/error
  responses.

### Changed
- Sidebar nav: AI Command Centre no longer shows "Coming in Phase 3" —
  it's live (shows a clear "not configured" state instead if
  `OPENAI_API_KEY` is unset).
- `src/lib/config.ts`: `features.aiCore` flipped to `true`; `aiModelConfig.default`
  now prefers `OPENAI_MODEL` (falling back to the previous `AI_MODEL_DEFAULT`
  for compatibility).

### Verified
- `npm run lint` — clean.
- `npx tsc --noEmit` — clean.
- `npm run test` — 90/90 passing (14 test files).
- `npm run build` — succeeds; `/ai` and `/api/ai/chat` correctly forced
  dynamic, alongside every existing Phase 0/1/2 route.
- `0006_ai_core.sql` dry-run tested against a local PostgreSQL 16 instance
  on top of `0001`–`0005` + seed: a `channel = 'dashboard'` conversation
  insert succeeds, existing channel values are unaffected, an invalid
  channel is still rejected, and the migration is safely re-runnable.

### Known limitations
- See the Phase 3 entry in DEVELOPMENT_PROGRESS.md — in short: no write/
  action tools yet (by design — Phase 4+), no streaming responses, a
  simple in-process (not multi-instance-safe) rate limiter, cost estimates
  from a small hard-coded per-model rate table rather than a live pricing
  API, and no fine-grained per-role tool restrictions yet (any signed-in
  staff member can use any of the 17 read tools, scoped to their business
  by RLS but not further restricted by role).

## [0.3.2] — Fix: pre-existing Auth user had no profile row at all

### Fixed
- **Root cause**: `public.handle_new_user()` only runs as an `after insert
  on auth.users` trigger — it has no retroactive effect on a user who
  already existed before the trigger (and the `profiles` table itself)
  were created by `0001_init.sql`. Diagnosed by verifying, via read-only
  SQL Editor queries, a specific combination of facts that only this cause
  explains: `public.roles` and `public.businesses` were both correctly
  populated (so `0004_fix_owner_role_bootstrap.sql`'s fix had genuinely
  applied), the affected account could log in (a real `auth.users` row
  exists), yet `public.profiles` had **zero rows** — not one row with a
  missing role (that's the `0004` scenario), but no row whatsoever. That
  only happens when the Auth user's signup predates `0001_init.sql` ever
  running against the project.
- New migration `supabase/migrations/0005_repair_missing_owner_profile.sql`:
  finds Auth users with no matching `profiles` row; if there is exactly
  one, creates its profile using the *existing* `owner` role and confirms
  (without pinning to it — Owners are business-agnostic by design, see
  `0001_init.sql`) the *existing* Grandvic Tours & Travel business is
  present; sets `is_active = true`. If more than one Auth user has no
  profile, it deliberately refuses to guess which should be Owner and
  raises an explanatory error instead (rolling back with no partial
  changes) rather than picking one. Never creates a business or role row,
  never overwrites an existing profile, never touches RLS.
  `handle_new_user()` itself needed no further change — as redefined by
  `0004`, it's already correct for every signup from now on; this was
  purely a one-time gap for a user who signed up before it existed.
- Verified against a local PostgreSQL 16 instance across three scenarios:
  (1) the exact broken state (Auth user inserted before `0001_init.sql`
  ran, so no profile was ever created) → migration creates a correct
  Owner profile, and the exact `is_owner()` / `resolveBusinessId()` query
  path was confirmed to succeed afterward under RLS as that user; (2) an
  already-healthy database (every Auth user already has a profile) →
  confirmed strict no-op; (3) two Auth users both missing a profile →
  confirmed the migration raises an explanatory error and makes zero
  changes, rather than guessing.
- No application code changed — `resolveBusinessId()` and
  `handle_new_user()` were both working exactly as designed; the gap was
  a one-time database state issue for an Auth user created before the
  schema existed.

## [0.3.1] — Fix: Owner role bootstrap could silently fail

### Fixed
- **Root cause**: `handle_new_user()` (0001_init.sql) looks up the `owner`
  role in `public.roles`, which is only populated by `supabase/seed.sql` —
  if the first Supabase Auth user was created before `seed.sql` had run,
  the new profile silently got `role_id = NULL` instead of Owner. That
  broke `is_owner()` permanently for that account (a NULL `role_id` can
  never join to a role), which broke `current_business_id()`'s effective
  reach too, which meant Row Level Security correctly hid every
  business-scoped row — including the `businesses` table itself — from
  that account. Symptom: any page calling `resolveBusinessId()` (Jobs,
  Customers, Leads, Tasks, Applications, Documents — all of them) threw
  "No business exists yet. Create one first (see Settings)." even when the
  seeded business was present.
- New migration `supabase/migrations/0004_fix_owner_role_bootstrap.sql`:
  (1) guarantees the `owner`/`staff` roles the bootstrap trigger depends on
  always exist, (2) redefines `handle_new_user()` to create them inline if
  they're ever still missing, so this ordering trap can't recur, and (3)
  one-time repairs a database whose owner bootstrap already ran broken, by
  assigning the Owner role to the earliest-created profile — but only when
  no profile currently holds it, so a healthy database is left untouched.
  Does not modify any RLS policy, does not hard-code a business id, and
  does not insert or duplicate a business row.
- Verified against a local PostgreSQL 16 instance: reproduced the exact
  broken state (auth user created before roles existed → `role_id` NULL →
  `is_owner()` false → `businesses` table invisible via RLS), confirmed the
  fix migration repairs it, confirmed it's a no-op on an already-healthy
  database, confirmed it's safely re-runnable, and confirmed new signups
  after the fix still correctly default to `staff`.
- No application code changed — `src/lib/business/context.ts`'s
  `resolveBusinessId()` was working exactly as designed; the bug was
  entirely in the database trigger.

## [0.3.0] — Phase 2: Jobs Abroad Recruitment & Opportunity Management

### Added
- **Jobs** (`/jobs`): searchable/filterable list with a live summary panel,
  a structured create/edit form (Basic Information, Employment,
  Requirements, Benefits, Application, Description, Internal), a detail
  page (key facts, requirements, benefits, description, required
  documents, applicants with stage + missing-documents indicator), status
  actions (Draft → Pending Review/Open → Paused → Open → Closed, plus a
  system-driven → Expired), and a "Duplicate job" action —
  `src/app/(dashboard)/jobs/**`, `src/lib/business/jobs.ts`.
- **Job expiry protection**: every read computes a job's live effective
  status from `status` + `expiry_at` (`computeEffectiveJobStatus`,
  `isJobOpenForPromotion`, `isJobExpiringSoon` in `src/lib/business/jobs.ts`)
  rather than trusting a possibly-stale stored status; the stored status is
  opportunistically corrected to `expired` the first time it's observed
  stale, with an audit-log entry and one notification.
- **Recruitment pipeline**: `applications.status` expanded to 15 stages
  (new → screening → documents_pending/complete → shortlisted →
  submitted_to_recruiter → interview_scheduled/completed → selected →
  offer_received → visa_processing → deployment_pending → placed, or
  rejected/withdrawn with an optional reason); a new `/applications/[id]`
  detail page shows the stage, document checklist, and activity timeline.
- **`application_events`** table + `src/lib/business/application-events.ts`
  (mirrors Phase 1's `lead_events`) — per-application activity timeline.
- **`src/lib/business/job-documents.ts`**: flexible, job-specific document
  requirements (add/remove any document type, mandatory or optional) and a
  live Required/Submitted/Missing/Approved/Rejected checklist per
  application, built on Phase 0's existing `document_requirements` table
  and `documents.application_id` — no hard-coded document list.
- New notifications: new application, job expired, candidate moved to
  interview, candidate selected, candidate's documents all approved.
- New migration `supabase/migrations/0003_jobs_abroad.sql`: extends
  `opportunities` with the full Jobs Abroad field set and `applications`
  with the pipeline above, adds `application_events`, adds indexes/
  constraints. **Action needed:** run this once in the Supabase SQL
  Editor, after `0002_documents_storage.sql` and before `seed.sql` — see
  SETUP.md section 3.
- 24 new unit tests: job status-transition rules, expiry/effective-status
  computation, "expiring soon" detection, and the new/expanded Zod schemas.

### Changed
- Sidebar nav: Jobs no longer shows "Coming in Phase 2" — it's live.
- `applications.ts`: `createApplication`/`updateApplicationStatus` now log
  an `application_events` row and fire notifications on specific stage
  transitions, in addition to the existing `audit_logs` entry.
- `documents.ts`: `updateDocumentStatus` now checks, when a document tied
  to a job application is approved, whether that was the last mandatory
  document — and if so fires the "documents complete" notification.
- `supabase/seed.sql`: the demo opportunity now populates the full Phase 2
  field set (via `document_requirements` rows instead of the removed
  `documents_required` array) and a second demo job (paused) was added;
  **seed.sql must now be run after `0003_jobs_abroad.sql`**, not right
  after `0001_init.sql` — see SETUP.md.
- `src/lib/business/opportunities.ts` removed — superseded by the fuller
  `jobs.ts` (`listJobsForSelect` replaces `listOpportunitiesForSelect`).

### Verified
- `npm run lint` — clean.
- `npx tsc --noEmit` — clean.
- `npm run test` — 53/53 passing (7 test files).
- `npm run build` — succeeds; all Phase 2 routes (`/jobs`, `/jobs/[id]`,
  `/jobs/[id]/edit`, `/jobs/new`, `/applications/[id]`) correctly forced
  dynamic, alongside every existing Phase 0/1 route.
- `0003_jobs_abroad.sql` dry-run tested against a local PostgreSQL 16
  instance (with `auth`/`storage` schemas stubbed): applied cleanly on top
  of `0001_init.sql` + `0002_documents_storage.sql`, correctly migrated
  pre-existing `applications.status` values and `opportunities
  .documents_required` arrays forward instead of discarding them, and is
  safely re-runnable (verified by running it twice).

### Known limitations
- See the Phase 2 entry in DEVELOPMENT_PROGRESS.md — in short: no push
  notification for "job nearing expiry" yet (visible in the Jobs list
  instead; needs Phase 10's scheduler to do properly), no fine-grained role
  permissions, no pagination, one query per applicant for the
  missing-documents indicator.

## [0.2.0] — Phase 1: CRM + Database

### Added
- **Customers**: list (search), create, and detail page (editable profile
  + linked leads/tasks/applications/documents) — `src/app/(dashboard)/customers/**`.
- **Leads**: list with a drag-and-drop Kanban pipeline board and a
  filterable table view, create, and a detail page with inline
  stage/temperature/score/assignment editing, notes, and a full activity
  timeline — `src/app/(dashboard)/leads/**`.
- **Tasks**: list with status filter and inline status updates, create
  (optionally linked to a customer or lead) — `src/app/(dashboard)/tasks/**`.
- **Applications**: lightweight status tracking, optionally linked to a
  lead and/or opportunity — `src/app/(dashboard)/applications/**`.
- **Documents**: request, upload (private Supabase Storage bucket),
  status tracking, and short-lived signed-URL viewing —
  `src/app/(dashboard)/documents/**`.
- **Notifications**: Topbar bell (unread badge, dropdown, mark read/mark
  all read) and a `/notifications` page; automatic "🔥 Hot lead"
  notification on the nurture/warm → hot transition.
- Business-logic layer in `src/lib/business/`: `context.ts`
  (current-user + business-scope resolution), `validation.ts` (Zod
  schemas shared by server actions and tests), `customers.ts`,
  `leads.ts`, `lead-events.ts`, `pipeline-stages.ts`, `tasks.ts`,
  `applications.ts`, `documents.ts`, `notifications.ts`, `hot-lead.ts`
  (pure notification-transition rule), `opportunities.ts` (read-only —
  full opportunity management is Phase 2), `staff.ts`, `businesses.ts`,
  `audit.ts` (shared `logActivity()` helper, now called from every
  Phase 1 mutation including customers create/update).
- New migration `supabase/migrations/0002_documents_storage.sql`: private
  `documents` Storage bucket + business-scoped RLS policies (written to
  be safely re-runnable). **Action needed:** run this once in the
  Supabase SQL Editor — see SETUP.md section 3.
- 29 new unit tests: Zod validation schemas, the hot-lead notification
  transition rule, document file validation, pipeline-stage
  fallback/de-duplication logic, and the customer lead-count aggregate
  mapping.
- `zod` and `server-only` added as dependencies; `next.config.ts` now
  sets `serverActions.bodySizeLimit: "10mb"` for document uploads.

### Changed
- Sidebar nav: Leads, Customers, Tasks, Applications, and Documents no
  longer show "Coming in Phase N" — they're live.
- `customers.ts`'s `createCustomer`/`updateCustomer` now write to
  `audit_logs` via `logActivity()`, matching every other Phase 1 mutation
  (previously only tasks/leads/applications/documents did this).

### Verified
- `npm run lint` — clean.
- `npx tsc --noEmit` — clean.
- `npm run test` — 29/29 passing (6 test files).
- `npm run build` — succeeds; all Phase 1 routes correctly forced
  dynamic (customers, leads, tasks, applications, documents,
  notifications, and their `/new` and `/[id]` sub-routes).

### Known limitations
- Applications/documents are basic status trackers — full job matching,
  requirement checklists, and expiry enforcement are Phase 2.
- No fine-grained role permissions beyond Owner vs. scoped-staff yet
  (e.g. any staff member can set a document's status to `approved`).
- No pagination on list views yet.
- Customer detail page's lead list is fetched via a full business-wide
  query filtered client-side, not a dedicated filtered query.

## [0.1.0] — Phase 0: Project Foundation

### Added
- Next.js 16 + TypeScript + Tailwind CSS v4 application scaffold.
- Supabase integration: browser/server/service-role clients, session-refresh
  proxy, environment-aware "not configured" fallback UI.
- Full initial database schema (`supabase/migrations/0001_init.sql`):
  roles, businesses, business_modules, profiles, customers, pipeline_stages,
  leads, lead_events, opportunities, applications, document_requirements,
  documents, conversations, conversation_messages, tasks, content,
  content_variants, content_calendar, social_accounts, publishing_jobs,
  payments, notifications, automation_rules, knowledge_items, ai_runs,
  audit_logs, settings — with Row Level Security on every business-scoped
  table.
- Seed data (`supabase/seed.sql`): role catalog, Grandvic Tours & Travel as
  the first business with its three modules, fictional `[DEMO]` customers,
  leads, tasks, a job opportunity, a knowledge base item, and a content
  draft.
- Email/password authentication with automatic Owner bootstrap for the
  first signed-up user.
- Dashboard shell: sidebar navigation (all planned sections), topbar with
  sign-out, "Today's Overview" home page wired to live database counts,
  and "Coming in Phase N" placeholders for unbuilt sections.
- Settings page showing integration status (Supabase/OpenAI/WhatsApp env
  var presence) without overclaiming a tested connection.
- `/api/health` status endpoint.
- Documentation: README.md, SETUP.md, ARCHITECTURE.md,
  DEVELOPMENT_PROGRESS.md, this CHANGELOG.md, `.env.example`.
- Vitest test runner with unit tests for the dashboard overview's
  aggregation and graceful-degradation logic.

### Verified
- `npm run lint` — clean.
- `npx tsc --noEmit` — clean.
- `npm run test` — 2/2 passing.
- `npm run build` — succeeds (all dashboard routes correctly forced
  dynamic since they depend on the live session).
- Production server boots and correctly shows the "Setup required" screen
  when Supabase environment variables are absent.

### Known limitations
- No CRUD UI yet for leads/customers/jobs/etc. (Phase 1/2).
- `src/lib/supabase/types.ts` is a placeholder pending real Supabase CLI
  type generation once a project exists.
- `npm audit`: 2 moderate advisories in vitest's dev-only dependency chain;
  deferred fix to avoid a disruptive major-version bump mid-foundation.
