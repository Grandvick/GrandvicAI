import "server-only";
import { randomUUID } from "node:crypto";
import type {
  AiProvider,
  AiProviderChatResult,
  AiProviderToolCall,
  AiProviderToolSchema,
  AiProviderTurn,
} from "../types";
import { type SalesIntent } from "../sales/intents";
import { computeLeadScore } from "../qualification/scoring";

/**
 * A deterministic, zero-cost, RULE-BASED provider used for local
 * development/testing when `AI_PROVIDER=mock` (see
 * src/lib/ai/provider/index.ts) — this is NOT the same thing as
 * `MockAiProvider` in `./mock.ts`, which requires a hand-scripted sequence
 * of exact responses and exists only to drive unit tests deterministically.
 * This provider has no script at all: it reacts to whatever conversation
 * and tool list it's actually handed, so the same code exercises the real
 * Phase 4 tool-calling loop (intent detection, job matching, qualification
 * capture, customer/lead creation, conversation events, human handover, and
 * plain business lookups for the internal AI Assistant) for ANY test
 * message — not one hard-coded scenario.
 *
 * It is intentionally simple keyword/regex heuristics, not a real language
 * model. It never invents business data: every factual claim it makes comes
 * from an actual tool result (real jobs, real knowledge-base entries, real
 * customer/lead records) — if it has nothing to go on, it says so or asks a
 * clarifying question, exactly like the real persona prompts instruct.
 *
 * The real `OpenAiProvider` (./openai.ts) is completely untouched by this
 * file and remains the provider used whenever `AI_PROVIDER` is unset/"openai"
 * and `OPENAI_API_KEY` is configured — see src/lib/ai/provider/index.ts.
 */
export class DevRuleBasedProvider implements AiProvider {
  readonly name = "mock-dev";

  async chat(turns: AiProviderTurn[], tools: AiProviderToolSchema[]): Promise<AiProviderChatResult> {
    const toolNames = new Set(tools.map((t) => t.name));
    const systemContent = turns.find((t) => t.role === "system")?.content ?? "";
    const isSalesAgent = systemContent.includes(SALES_AGENT_MARKER);
    // Recovered from buildSalesAgentPrompt's "CONVERSATION STATE SO FAR"
    // block (src/lib/ai/prompts/sales-agent.ts) — the only place this
    // provider can see what's already known about THIS conversation from a
    // PRIOR request (intent/leadId/matchedOpportunityId/qualification are
    // never re-derivable from the latest message alone). Used to answer
    // short, low-signal follow-ups sensibly instead of re-asking from
    // scratch — see item 7 / planSalesAgentFirstPass below.
    const priorState = isSalesAgent ? parseStateFromSystemPrompt(systemContent) : EMPTY_PRIOR_STATE;

    const lastUserIdx = lastIndexWhere(turns, (t) => t.role === "user");
    const userMessage = turns[lastUserIdx]?.content ?? "";
    const sinceUser = turns.slice(lastUserIdx + 1);
    const toolResultsSinceUser = sinceUser.filter(isToolTurn);
    // core.ts pushes exactly one "assistant" turn per round-trip, right
    // before that round's "tool" result turns — counting them tells us how
    // many rounds have already happened for THIS user message.
    const roundsSoFar = sinceUser.filter((t) => t.role === "assistant").length;

    const usage = { inputTokens: Math.max(20, userMessage.length), outputTokens: 40 };

    if (toolResultsSinceUser.length === 0) {
      const plan = isSalesAgent
        ? planSalesAgentFirstPass(userMessage, toolNames, priorState)
        : planInternalAssistantFirstPass(userMessage, toolNames);
      if (plan.finalMessage !== null) {
        return { message: plan.finalMessage, toolCalls: [], usage, model: this.name };
      }
      return { message: null, toolCalls: plan.calls.map(toAiProviderToolCall), usage, model: this.name };
    }

    const resultsByName = new Map<string, unknown>();
    for (const t of toolResultsSinceUser) {
      resultsByName.set(t.name, tryParseJson(t.content));
    }

    // Stay safely inside core.ts's MAX_TOOL_ROUNDTRIPS (4) — never plan
    // another round of tool calls on what would be the last allowed call,
    // so we always finish with a real answer rather than the generic
    // "ran out of round-trips" fallback.
    const forceFinalize = roundsSoFar >= 3;

    if (!forceFinalize && isSalesAgent) {
      const nextCalls = planSalesAgentFollowUp(userMessage, toolNames, resultsByName);
      if (nextCalls.length > 0) {
        return { message: null, toolCalls: nextCalls.map(toAiProviderToolCall), usage, model: this.name };
      }
    }

    return { message: summarize(userMessage, resultsByName, isSalesAgent), toolCalls: [], usage, model: this.name };
  }
}

// -----------------------------------------------------------------------------
// Shared plumbing
// -----------------------------------------------------------------------------

/** Unique to prompts/sales-agent.ts — lets this provider tell the two personas apart without any extra plumbing. */
const SALES_AGENT_MARKER = "CONVERSATION STATE SO FAR";

type ToolCallPlan = { name: string; args: Record<string, unknown> };
type FirstPassPlan = { calls: ToolCallPlan[]; finalMessage: string | null };
type ToolTurn = Extract<AiProviderTurn, { role: "tool" }>;

function isToolTurn(t: AiProviderTurn): t is ToolTurn {
  return t.role === "tool";
}

function lastIndexWhere<T>(arr: T[], pred: (t: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i])) return i;
  }
  return -1;
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function toAiProviderToolCall(plan: ToolCallPlan): AiProviderToolCall {
  return { id: `mock-${randomUUID()}`, name: plan.name, rawArguments: JSON.stringify(plan.args) };
}

/**
 * What this provider can recover about a conversation's ALREADY-KNOWN state
 * from a PRIOR request, without any extra tool call — read straight out of
 * buildSalesAgentPrompt's "CONVERSATION STATE SO FAR" block (the only place
 * this information is visible to a stateless per-request provider; see
 * chat()'s call site). Used only to avoid re-asking/re-guessing on a short
 * follow-up message that carries no new extractable detail of its own
 * (item 7) — never used to invent facts not actually in that block.
 */
type ParsedSalesState = {
  intent: string | null;
  leadId: string | null;
  matchedOpportunityId: string | null;
  hasQualification: boolean;
};

const EMPTY_PRIOR_STATE: ParsedSalesState = {
  intent: null,
  leadId: null,
  matchedOpportunityId: null,
  hasQualification: false,
};

/** A placeholder value from buildSalesAgentPrompt, e.g. "(not yet determined)" / "(none yet)" / "(nothing captured yet)". */
function isPlaceholder(value: string | undefined): boolean {
  return !value || value.trim().startsWith("(");
}

function parseStateFromSystemPrompt(systemContent: string): ParsedSalesState {
  const intent = systemContent.match(/^- Detected intent:\s*(.+)$/m)?.[1]?.trim();
  const leadId = systemContent.match(/^- Linked CRM lead:\s*(\S+)/m)?.[1]?.trim();
  const matchedOpportunityId = systemContent.match(/^- Matched opportunity:\s*(\S+)/m)?.[1]?.trim();
  const qualification = systemContent.match(/^- Qualification captured:\s*(.+)$/m)?.[1]?.trim();

  return {
    intent: isPlaceholder(intent) ? null : (intent as string),
    leadId: isPlaceholder(leadId) ? null : (leadId as string),
    matchedOpportunityId: isPlaceholder(matchedOpportunityId) ? null : (matchedOpportunityId as string),
    hasQualification: !isPlaceholder(qualification),
  };
}

function humanize(toolName: string): string {
  return toolName.replace(/_/g, " ");
}

// -----------------------------------------------------------------------------
// Very lightweight, best-effort text understanding (dev/test aid only — NOT
// real NLU; it exists to make the mock react sensibly to varied input, never
// to replace the real model in production).
// -----------------------------------------------------------------------------

// NOTE ON WORD BOUNDARIES: every alternation below is intentionally
// `\b(?:...)` — a LEADING boundary only, never a trailing one. A trailing
// `\b` right after the alternation (the original shape here, e.g.
// `\b(document|...)\b`) anchors to wherever THAT alternative's match ends,
// so a stem like "vacan" (meant to catch "vacancy"/"vacancies") never
// matches anything at all, and a plain singular noun like "document" or
// "tour" fails against its own natural plural — "documents abroad" or "any
// tours available" would not match, even though "What documents do I need
// for this job?" and "Do you have any tours to the coast?" are this app's
// OWN example prompts (see SALES_AGENT_EXAMPLE_PROMPTS in
// src/app/(dashboard)/ai/page.tsx). Dropping the trailing `\b` fixes every
// case like this (job/jobs, document/documents, tour/tours,
// requirement/requirements, fee/fees, vacan→vacancy/vacancies,
// qualif→qualify/qualification, eligib→eligible/eligibility,
// recruit→recruiting/recruitment) while the LEADING `\b` still prevents a
// false match inside an unrelated longer word (e.g. "tour" inside
// "contour").
const INTENT_KEYWORDS: [SalesIntent, RegExp][] = [
  ["COMPLAINT", /\b(?:complain|unhappy|disappointed|terrible|awful|worst|refund|angry|frustrat|poor service)/i],
  ["HUMAN_SUPPORT", /\b(?:human|real person|speak to (?:a|someone)|talk to (?:a|someone)|agent please|representative)/i],
  [
    "APPLICATION_STATUS",
    /\b(?:application status|status of my (?:application|enquiry|request)|where is my application|my application|my status|check (?:on )?my status)/i,
  ],
  ["DOCUMENT_ENQUIRY", /\b(?:document|certificate|passport copy|upload|\bcv\b|resume)/i],
  ["REQUIREMENTS_ENQUIRY", /\b(?:requirement|qualif|eligib)/i],
  ["PRICE_ENQUIRY", /\b(?:price|cost|fee|how much|rate|charge)/i],
  ["VISA_ENQUIRY", /\b(?:visa|immigration|work permit)/i],
  ["SAFARI_ENQUIRY", /\b(?:safari|wildlife|national park|game drive)/i],
  ["TOUR_ENQUIRY", /\b(?:tour|itinerary|travel package|trip to)/i],
  ["VEHICLE_ENQUIRY", /\b(?:car hire|vehicle|rental car|4x4|land cruiser)/i],
  ["JOB_ENQUIRY", /\b(?:job|work abroad|employment|vacan|recruit|career|position|hire me)/i],
  ["FOLLOW_UP", /\b(?:follow up|checking in|any update|still waiting)/i],
];

function extractDestination(text: string): string | undefined {
  const m = text.match(/\b(?:in|to|for)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\b/);
  return m?.[1];
}

function extractProfession(text: string): string | undefined {
  const m = text.match(/\bi(?:'m| am)\s+a[n]?\s+([a-zA-Z][a-zA-Z\- ]{2,40}?)(?:[.,!]|\s+and\b|\s+in\b|\s+interested\b|$)/i);
  return m?.[1]?.trim();
}

function extractUrgency(text: string): "low" | "medium" | "high" | undefined {
  // Leading boundary only (see INTENT_KEYWORDS's note above) — "urgent"
  // must also match "urgently".
  if (/\b(?:urgent|asap|immediately|right away|as soon as possible)/i.test(text)) return "high";
  if (/\b(?:no rush|whenever|just looking|just browsing|just curious)/i.test(text)) return "low";
  return undefined;
}

function extractEmail(text: string): string | undefined {
  return text.match(/[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}/)?.[0];
}

function extractPhone(text: string): string | undefined {
  return text.match(/\+?\d[\d ()-]{6,}\d/)?.[0]?.trim();
}

function extractName(text: string): string | undefined {
  const m =
    text.match(/\bmy name is\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/i) ??
    text.match(/\bthis is\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\s+(?:here|speaking)\b/i);
  return m?.[1];
}

function detectIntent(text: string, hints: { profession?: string; destination?: string }): SalesIntent {
  for (const [intent, re] of INTENT_KEYWORDS) {
    if (re.test(text)) return intent;
  }
  // A profession + destination together, with no stronger signal above,
  // reads as a job enquiry in this business's context — a general rule,
  // not a hard-coded scenario (it fires for any profession/country pair).
  if (hints.profession || hints.destination) return "JOB_ENQUIRY";
  if (/\b(hi|hello|hey|good morning|good afternoon|good evening)\b/i.test(text.trim())) return "GENERAL_ENQUIRY";
  return text.trim().length > 0 ? "GENERAL_ENQUIRY" : "OTHER";
}

const KNOWLEDGE_BASE_INTENTS = new Set<SalesIntent>([
  "VISA_ENQUIRY",
  "SAFARI_ENQUIRY",
  "TOUR_ENQUIRY",
  "VEHICLE_ENQUIRY",
  "PRICE_ENQUIRY",
  "REQUIREMENTS_ENQUIRY",
  "DOCUMENT_ENQUIRY",
]);

// -----------------------------------------------------------------------------
// AI Sales Agent persona planning (prompts/sales-agent.ts)
// -----------------------------------------------------------------------------

function planSalesAgentFirstPass(
  userMessage: string,
  toolNames: Set<string>,
  priorState: ParsedSalesState = EMPTY_PRIOR_STATE
): FirstPassPlan {
  const profession = extractProfession(userMessage);
  const destination = extractDestination(userMessage);
  const urgency = extractUrgency(userMessage);
  const email = extractEmail(userMessage);
  const phone = extractPhone(userMessage);
  const intent = detectIntent(userMessage, { profession, destination });

  const calls: ToolCallPlan[] = [];

  // Human handover takes priority over everything else (spec section 16).
  if (intent === "COMPLAINT" || intent === "HUMAN_SUPPORT") {
    if (toolNames.has("update_conversation_state")) {
      calls.push({
        name: "update_conversation_state",
        args: {
          mode: "human",
          handoverReason: intent === "COMPLAINT" ? "Customer expressed a complaint." : "Customer asked for a human.",
          intent,
        },
      });
    }
    if (toolNames.has("add_conversation_event")) {
      calls.push({ name: "add_conversation_event", args: { eventType: "human_handover", payload: { intent } } });
    }
    return calls.length > 0
      ? { calls, finalMessage: null }
      : { calls: [], finalMessage: "I'll get a member of the team to help you with this directly." };
  }

  // "What's my status?" with an already-known lead (from a PRIOR request —
  // spec section 17: preserve structured state, don't re-ask what's already
  // known) — answer from the real lead record instead of asking the
  // customer to re-identify themselves from scratch every time.
  if (intent === "APPLICATION_STATUS" && priorState.leadId && toolNames.has("get_lead")) {
    return { calls: [{ name: "get_lead", args: { leadId: priorState.leadId } }], finalMessage: null };
  }

  // A short, low-signal follow-up ("Yes please", "Tell me more", "Ok") that
  // adds no new extractable detail of its own. Never treat this as a fresh
  // GENERAL_ENQUIRY that discards what the conversation already knows (item
  // 7) — but also never guess what the bare reply refers to; only react
  // using state that was genuinely captured earlier, via a real tool call
  // where one applies.
  const hasNewSignal = Boolean(profession || destination || email || phone);
  const isLowSignalFollowUp = (intent === "GENERAL_ENQUIRY" || intent === "OTHER") && !hasNewSignal;

  if (isLowSignalFollowUp) {
    // Leading boundary only — "more detail" must also match "more details".
    const wantsMoreDetail = /\b(?:tell me more|more info|more detail|know more|more about (?:it|this|that))/i.test(
      userMessage
    );
    if (wantsMoreDetail && priorState.matchedOpportunityId && toolNames.has("get_job")) {
      return { calls: [{ name: "get_job", args: { jobId: priorState.matchedOpportunityId } }], finalMessage: null };
    }

    if (priorState.leadId || priorState.matchedOpportunityId || priorState.hasQualification || priorState.intent) {
      return {
        calls: [],
        finalMessage: priorState.leadId
          ? "Thanks — I already have your enquiry logged, and a member of our team will follow up with you. Is there anything specific you'd like me to check or add in the meantime?"
          : "Good to know! Could you share your name and a phone number or email so I can log your interest and have someone follow up?",
      };
    }
    // No prior state either — genuinely nothing to go on yet, falls through
    // to the "ask a qualifying question" handling below exactly as before.
  }

  // A vague job enquiry, or a bare greeting — ask a qualifying question
  // rather than dumping every open job (spec section 19's own example).
  const isVagueJobEnquiry = intent === "JOB_ENQUIRY" && !profession && !destination;
  if (isVagueJobEnquiry || intent === "GENERAL_ENQUIRY" || intent === "OTHER") {
    if (toolNames.has("update_conversation_state")) {
      calls.push({ name: "update_conversation_state", args: { intent } });
      return { calls, finalMessage: null };
    }
    return {
      calls: [],
      finalMessage:
        "Thanks for reaching out! Could you tell me a bit more about what you're looking for — for example, the type of work, destination, or service you're interested in?",
    };
  }

  // Record the detected intent + whatever qualification we can read off
  // the message (spec section 3/7 — captured naturally, not interrogated).
  if (toolNames.has("update_conversation_state")) {
    const qualification: Record<string, unknown> = {};
    if (profession) qualification.serviceInterest = profession;
    if (destination) qualification.destination = destination;
    if (urgency) qualification.urgency = urgency;
    calls.push({
      name: "update_conversation_state",
      args: { intent, ...(Object.keys(qualification).length > 0 ? { qualification } : {}) },
    });
  }

  // Look up REAL data for the detected intent instead of guessing (spec
  // section 10/11 — never invent jobs, prices, requirements, or policies).
  // Requires an actual profession/destination to search by — never call
  // this with empty filters, which would dump every open job (same rule
  // isVagueJobEnquiry enforces above; guarded again here defensively since
  // this branch can also be reached with a carried-over JOB_ENQUIRY intent).
  if (intent === "JOB_ENQUIRY" && (profession || destination) && toolNames.has("get_open_jobs")) {
    const args: Record<string, unknown> = {};
    if (destination) args.country = destination;
    if (profession) args.search = profession;
    calls.push({ name: "get_open_jobs", args });
  } else if (KNOWLEDGE_BASE_INTENTS.has(intent) && toolNames.has("search_knowledge_base")) {
    calls.push({ name: "search_knowledge_base", args: { search: userMessage.slice(0, 180) } });
  }

  // If the customer plainly gave contact details, try to identify them too
  // — never guessed, only ever an exact phone/email match (spec section 4).
  if ((email || phone) && toolNames.has("find_customer_by_contact")) {
    const args: Record<string, unknown> = {};
    if (phone) args.phone = phone;
    if (email) args.email = email;
    calls.push({ name: "find_customer_by_contact", args });
  }

  if (calls.length === 0) {
    return {
      calls: [],
      finalMessage:
        "I don't have verified information on that yet — could you tell me a little more, or would you like me to have a member of the team follow up with you?",
    };
  }
  return { calls, finalMessage: null };
}

/**
 * Chains a SECOND (and occasionally third) round of tool calls once we've
 * seen the first round's results — e.g. "no existing customer found, but we
 * now have a name + contact" -> create one, then create/link their lead.
 * Every id used here (customerId, opportunityId) comes from a REAL tool
 * result, never invented — matching spec section 4's "never guess an
 * identity" and section 11's "only ever link a currently open job".
 */
function planSalesAgentFollowUp(
  userMessage: string,
  toolNames: Set<string>,
  resultsByName: Map<string, unknown>
): ToolCallPlan[] {
  // Once a NEW lead has been created and matched to a specific open job,
  // create a real follow-up task for staff (spec section 19's acceptance
  // example: "...and (where appropriate) creates a follow-up task") — never
  // just SAY a team member will follow up without actually creating
  // something for them to follow up on, when there's still round budget and
  // enough real detail to make the task concrete. Checked first, since once
  // create_lead has already run, none of the branches below should fire
  // again anyway.
  const leadResult = resultsByName.get("create_lead") as
    | { created?: boolean; leadId?: string; applicationId?: string | null; jobTitle?: string | null; score?: number }
    | undefined;
  if (
    leadResult &&
    !isToolError(leadResult) &&
    leadResult.created &&
    leadResult.applicationId &&
    !resultsByName.has("create_task") &&
    toolNames.has("create_task")
  ) {
    const profession = extractProfession(userMessage);
    const title = leadResult.jobTitle
      ? `Follow up: ${profession ? `${profession} enquiry — ` : ""}${leadResult.jobTitle}`
      : "Follow up on new enquiry";
    return [
      {
        name: "create_task",
        args: {
          title,
          priority: extractUrgency(userMessage) === "high" ? "high" : "medium",
          relatedLeadId: leadResult.leadId,
        },
      },
    ];
  }

  // create_lead REUSES an existing active lead rather than creating a new
  // one (spec: never duplicate a customer's lead) — but its handler
  // deliberately does NOT recompute that existing lead's score/temperature
  // from this turn's qualification info; it just returns whatever was
  // already on file. That's the right default (a single message shouldn't
  // blindly overwrite a richer picture built up over prior turns — see
  // below), but it does mean genuinely new signal from a returning
  // customer (e.g. "it's urgent now") would otherwise be silently
  // dropped, even though the spec's own acceptance example says the agent
  // "creates OR UPDATES a lead with a deterministically computed
  // temperature/score."
  //
  // `update_lead` is the tool for this, but it fully OVERWRITES the
  // score/temperature from whatever `qualification` it's given — it does
  // NOT merge with whatever factors originally produced the existing
  // score (this mock never sees those original factors again; only the
  // resulting score/temperature persists). So this only ever fires when
  // recomputing from THIS message's factors alone would produce a HIGHER
  // score than what's already on file — e.g. a "nurture" lead from a bare
  // walk-in record, now showing real profession/destination/urgency
  // signal for the first time. It never fires in the other direction:
  // a lead that's already "hot" from a richer history (documents
  // submitted, high engagement, etc.) is never downgraded just because a
  // single new message alone can only capture 3 of the 6 factors.
  if (
    leadResult &&
    !isToolError(leadResult) &&
    leadResult.created === false &&
    leadResult.leadId &&
    !resultsByName.has("update_lead") &&
    toolNames.has("update_lead")
  ) {
    const profession = extractProfession(userMessage);
    const destination = extractDestination(userMessage);
    const urgency = extractUrgency(userMessage);
    const qualification: Record<string, number> = {};
    if (profession) qualification.fit = 0.6;
    if (destination) qualification.opportunityRelevance = leadResult.applicationId ? 0.8 : 0.4;
    if (urgency === "high") qualification.urgency = 0.9;

    if (Object.keys(qualification).length > 0) {
      const recomputedScore = computeLeadScore(qualification);
      if (recomputedScore > (leadResult.score ?? 0)) {
        return [{ name: "update_lead", args: { leadId: leadResult.leadId, qualification } }];
      }
    }
  }

  const foundCustomers = resultsByName.get("find_customer_by_contact");
  const foundCustomersArray = Array.isArray(foundCustomers) ? (foundCustomers as { id?: string }[]) : undefined;

  if (foundCustomersArray && foundCustomersArray.length === 0 && !resultsByName.has("create_customer")) {
    const name = extractName(userMessage);
    const email = extractEmail(userMessage);
    const phone = extractPhone(userMessage);
    if (name && (email || phone) && toolNames.has("create_customer")) {
      const args: Record<string, unknown> = { fullName: name };
      if (email) args.email = email;
      if (phone) args.phone = phone;
      const profession = extractProfession(userMessage);
      if (profession) args.profession = profession;
      const destination = extractDestination(userMessage);
      if (destination) args.country = destination;
      return [{ name: "create_customer", args }];
    }
  }

  const createdCustomer = resultsByName.get("create_customer") as { customerId?: string } | undefined;
  const singleExistingMatch =
    foundCustomersArray && foundCustomersArray.length === 1 ? foundCustomersArray[0].id : undefined;
  const customerId = createdCustomer?.customerId ?? singleExistingMatch;

  if (customerId && !resultsByName.has("create_lead") && toolNames.has("create_lead")) {
    const profession = extractProfession(userMessage);
    const destination = extractDestination(userMessage);
    const urgency = extractUrgency(userMessage);
    const jobs = resultsByName.get("get_open_jobs");
    const jobsArray = Array.isArray(jobs) ? (jobs as { id?: string; country?: string | null }[]) : [];
    const matchedJob =
      jobsArray.find((j) => destination && j.country && j.country.toLowerCase() === destination.toLowerCase()) ??
      jobsArray[0];

    const args: Record<string, unknown> = { customerId };
    if (profession) args.service = profession;
    if (destination) args.targetCountry = destination;
    if (matchedJob?.id) args.opportunityId = matchedJob.id;

    const qualification: Record<string, number> = {};
    if (profession) qualification.fit = 0.6;
    if (destination) qualification.opportunityRelevance = matchedJob ? 0.8 : 0.4;
    if (urgency === "high") qualification.urgency = 0.9;
    if (Object.keys(qualification).length > 0) args.qualification = qualification;

    return [{ name: "create_lead", args }];
  }

  return [];
}

// -----------------------------------------------------------------------------
// Internal AI Assistant persona planning (prompts/system.ts) — a much
// smaller set of keyword -> read-tool mappings, since staff queries are
// simple factual lookups rather than an open-ended sales conversation.
// -----------------------------------------------------------------------------

function planInternalAssistantFirstPass(userMessage: string, toolNames: Set<string>): FirstPassPlan {
  const text = userMessage.toLowerCase();
  const calls: ToolCallPlan[] = [];

  if (/hot lead/.test(text) && toolNames.has("get_hot_leads")) {
    calls.push({ name: "get_hot_leads", args: {} });
  } else if (/(open job|job.*(open|opening)|how many jobs)/.test(text) && toolNames.has("get_open_jobs")) {
    calls.push({ name: "get_open_jobs", args: {} });
  } else if (/(dashboard|today|attention today)/.test(text) && toolNames.has("get_dashboard_summary")) {
    calls.push({ name: "get_dashboard_summary", args: {} });
  } else if (/missing document/.test(text) && toolNames.has("get_missing_documents")) {
    calls.push({ name: "get_missing_documents", args: {} });
  } else if (/(task|to-do|to do)/.test(text) && toolNames.has("get_tasks")) {
    calls.push({ name: "get_tasks", args: {} });
  } else if (/notification/.test(text) && toolNames.has("get_notifications")) {
    calls.push({ name: "get_notifications", args: {} });
  } else if (/(recent activity|what.?s happened|what happened)/.test(text) && toolNames.has("get_recent_activity")) {
    calls.push({ name: "get_recent_activity", args: {} });
  } else if (/(business summary|how is the business|overview)/.test(text) && toolNames.has("get_business_summary")) {
    calls.push({ name: "get_business_summary", args: {} });
  } else if (toolNames.has("search_knowledge_base")) {
    calls.push({ name: "search_knowledge_base", args: { search: userMessage.slice(0, 180) } });
  }

  if (calls.length === 0) {
    return {
      calls: [],
      finalMessage:
        "I'm running in local mock mode (AI_PROVIDER=mock) and don't have a specific tool for that yet — try asking about hot leads, open jobs, today's dashboard, tasks, notifications, or recent activity.",
    };
  }
  return { calls, finalMessage: null };
}

// -----------------------------------------------------------------------------
// Final answer synthesis — always built from real tool results, never
// invented (spec section 10/18).
// -----------------------------------------------------------------------------

/**
 * True only when `value` is the `{error: "..."}` shape core.ts's tool loop
 * pushes for a FAILED tool call (see src/lib/ai/core.ts — a thrown
 * AiToolError/AiValidationError is caught and turned into exactly this
 * shape, never a thrown exception the provider would see). A tool name
 * appearing in the trace does NOT mean it succeeded — this is the check
 * that tells the two apart before summarize() below claims anything
 * happened.
 */
function isToolError(value: unknown): value is { error: string } {
  return typeof value === "object" && value !== null && !Array.isArray(value) && typeof (value as { error?: unknown }).error === "string";
}

function summarize(userMessage: string, resultsByName: Map<string, unknown>, isSalesAgent: boolean): string {
  const parts: string[] = [];
  const handled = new Set<string>();

  const job = resultsByName.get("get_job");
  if (job && typeof job === "object" && !Array.isArray(job) && !isToolError(job)) {
    handled.add("get_job");
    const j = job as {
      title?: string;
      country?: string | null;
      effectiveStatus?: string;
      salaryAmount?: number | null;
      salaryCurrency?: string | null;
      contractDuration?: string | null;
      requirements?: string[];
    };
    if (j.effectiveStatus && j.effectiveStatus !== "open") {
      parts.push(`"${j.title ?? "That role"}" isn't currently open anymore — would you like me to check other options?`);
    } else {
      const bits: string[] = [];
      if (j.salaryAmount && j.salaryCurrency) bits.push(`${j.salaryCurrency} ${j.salaryAmount}`);
      if (j.contractDuration) bits.push(j.contractDuration);
      if (j.requirements && j.requirements.length > 0) bits.push(`requirements: ${j.requirements.slice(0, 3).join(", ")}`);
      parts.push(
        `Here's more on ${j.title ?? "that role"}${j.country ? ` in ${j.country}` : ""}${bits.length > 0 ? ` — ${bits.join("; ")}` : ""}.`
      );
    }
  }

  const leadDetail = resultsByName.get("get_lead");
  if (leadDetail && typeof leadDetail === "object" && !Array.isArray(leadDetail) && !isToolError(leadDetail)) {
    handled.add("get_lead");
    const l = leadDetail as { stage?: string; temperature?: string; service?: string | null; targetCountry?: string | null };
    parts.push(
      `Here's your current status: your enquiry${l.service ? ` for ${l.service}` : ""}${l.targetCountry ? ` in ${l.targetCountry}` : ""} is at the "${l.stage ?? "new"}" stage. Someone from our team will be in touch with the next steps.`
    );
  }

  const jobs = resultsByName.get("get_open_jobs");
  if (Array.isArray(jobs)) {
    handled.add("get_open_jobs");
    const jobsArray = jobs as { title?: string; country?: string | null }[];
    if (jobsArray.length === 0) {
      parts.push(
        "I don't currently have any open opportunities matching that — I can note your interest and follow up as soon as one opens."
      );
    } else {
      const list = jobsArray
        .slice(0, 3)
        .map((j) => `${j.title ?? "a role"}${j.country ? ` in ${j.country}` : ""}`)
        .join("; ");
      parts.push(
        `I found ${jobsArray.length} currently open opportunit${jobsArray.length === 1 ? "y" : "ies"}: ${list}. Would you like more detail on one of these?`
      );
    }
  }

  const kb = resultsByName.get("search_knowledge_base");
  if (Array.isArray(kb)) {
    handled.add("search_knowledge_base");
    const kbArray = kb as { content?: string }[];
    parts.push(
      kbArray.length === 0
        ? "I don't have verified information on that in our knowledge base yet — I'll flag this for a team member to confirm rather than guess."
        : String(kbArray[0]?.content ?? "Here's what I found on that.").slice(0, 400)
    );
  }

  // Only ever treat these as a genuine success once we've confirmed the
  // result is NOT the {error: "..."} shape a FAILED create_customer/
  // create_lead call produces (see isToolError above) — this is the fix for
  // the confirmed bug where a failed tool call's error object was cast
  // straight to `{created?: boolean}`, read `.created` as `undefined`
  // (falsy either way), and fell into the "else" branch, producing a false
  // "I've updated your existing enquiry" message even though NOTHING was
  // persisted (spec section 18: never claim an action occurred unless the
  // tool actually succeeded).
  const rawCreatedCustomer = resultsByName.get("create_customer");
  const rawLead = resultsByName.get("create_lead");
  const customerFailed = isToolError(rawCreatedCustomer);
  const leadFailed = isToolError(rawLead);
  const createdCustomer = !customerFailed ? (rawCreatedCustomer as { created?: boolean } | undefined) : undefined;
  const lead = !leadFailed ? (rawLead as { created?: boolean } | undefined) : undefined;

  if (leadFailed || customerFailed) {
    handled.add("create_customer");
    handled.add("create_lead");
    handled.add("find_customer_by_contact");
    const reason = (leadFailed ? (rawLead as { error: string }).error : (rawCreatedCustomer as { error: string }).error);
    parts.push(`I wasn't able to save those details just now (${reason}). I'll flag this for a team member to follow up directly.`);
  } else if (lead) {
    handled.add("create_customer");
    handled.add("create_lead");
    handled.add("find_customer_by_contact");
    parts.push(
      lead.created
        ? "Thanks — I've logged your details and someone from our team will follow up with you shortly."
        : "Thanks — I've updated your existing enquiry with these details."
    );
  } else if (createdCustomer?.created) {
    handled.add("create_customer");
    handled.add("find_customer_by_contact");
    parts.push("Got it, thanks for those details.");
  }

  if (isSalesAgent && parts.length > 0 && !lead && !createdCustomer && !leadFailed && !customerFailed) {
    parts.push("If you'd like me to note your interest, could you share your name and a phone number or email?");
  }

  if (!isSalesAgent) {
    // The internal assistant is a plain business-data lookup — surface any
    // remaining tool result generically rather than describing every tool
    // by name (a customer-facing reply never does this — see above).
    for (const [name, value] of resultsByName) {
      if (handled.has(name)) continue;
      if (Array.isArray(value)) {
        parts.push(`${humanize(name)}: found ${value.length} result${value.length === 1 ? "" : "s"}.`);
      } else if (value && typeof value === "object") {
        parts.push(`${humanize(name)}: ${JSON.stringify(value).slice(0, 300)}`);
      }
    }
  }

  if (parts.length === 0) {
    const profession = extractProfession(userMessage);
    const destination = extractDestination(userMessage);
    const intent = detectIntent(userMessage, { profession, destination });
    switch (intent) {
      case "APPLICATION_STATUS":
        parts.push(
          "To check your application status, could you share your name or the email/phone you applied with?"
        );
        break;
      case "DOCUMENT_ENQUIRY":
      case "REQUIREMENTS_ENQUIRY":
        parts.push("Could you let me know which job or service this is for, so I can check the exact requirements?");
        break;
      default:
        parts.push("Thanks for your message — could you tell me a bit more so I can help?");
    }
  }

  return parts.join(" ");
}
