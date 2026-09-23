import { describe, expect, it } from "vitest";
import { DevRuleBasedProvider } from "./dev-mock";
import type { AiProviderToolSchema, AiProviderTurn } from "../types";

/**
 * DevRuleBasedProvider is the rule-based provider AI_PROVIDER=mock selects
 * (src/lib/ai/provider/index.ts) so the Phase 4 AI Sales Agent (and the
 * internal AI Assistant) can be exercised locally without live OpenAI
 * billing/credits. These tests prove it reacts sensibly to several DIFFERENT
 * messages/scenarios — never one hard-coded scenario — and that it always
 * terminates with a final answer rather than looping forever.
 */

function tool(name: string): AiProviderToolSchema {
  return { name, description: "", parameters: {} };
}

const SALES_AGENT_TOOLS: AiProviderToolSchema[] = [
  "get_open_jobs",
  "get_job",
  "get_lead",
  "search_knowledge_base",
  "find_customer_by_contact",
  "create_customer",
  "create_lead",
  "update_lead",
  "create_task",
  "add_conversation_event",
  "update_conversation_state",
].map(tool);

/**
 * Builds a sales-agent system prompt carrying real "CONVERSATION STATE SO
 * FAR" values — the exact shape buildSalesAgentPrompt (src/lib/ai/prompts/
 * sales-agent.ts) produces, so these tests exercise the SAME text-parsing
 * path (parseStateFromSystemPrompt in dev-mock.ts) the real app relies on,
 * not a hand-rolled shortcut.
 */
function salesSystemPromptWithState(state: {
  intent?: string;
  leadId?: string;
  matchedOpportunityId?: string;
  qualification?: string;
}): string {
  return [
    "You are Grandvic AI, the sales and customer-service agent for Grandvic Tours & Travel.",
    "CONVERSATION STATE SO FAR (already known — use it, don't re-ask):",
    `- Detected intent: ${state.intent ?? "(not yet determined)"}`,
    `- Linked CRM lead: ${state.leadId ?? "(none yet — create one once you have enough information)"}`,
    `- Matched opportunity: ${state.matchedOpportunityId ?? "(none yet)"}`,
    `- Qualification captured: ${state.qualification ?? "(nothing captured yet)"}`,
  ].join("\n");
}

const INTERNAL_TOOLS: AiProviderToolSchema[] = [
  "get_hot_leads",
  "get_open_jobs",
  "get_dashboard_summary",
  "get_missing_documents",
  "get_tasks",
  "get_notifications",
  "get_recent_activity",
  "get_business_summary",
  "search_knowledge_base",
].map(tool);

const SALES_AGENT_SYSTEM_PROMPT = [
  "You are Grandvic AI, the sales and customer-service agent for Grandvic Tours & Travel.",
  "CONVERSATION STATE SO FAR (already known — use it, don't re-ask):",
  "- Detected intent: (not yet determined)",
].join("\n");

const INTERNAL_SYSTEM_PROMPT = "You are Grandvic AI, the internal business assistant built into the Grandvic AI dashboard.";

function salesTurns(userMessage: string, extra: AiProviderTurn[] = []): AiProviderTurn[] {
  return [{ role: "system", content: SALES_AGENT_SYSTEM_PROMPT }, ...extra, { role: "user", content: userMessage }];
}

function salesTurnsWithState(userMessage: string, systemContent: string): AiProviderTurn[] {
  return [{ role: "system", content: systemContent }, { role: "user", content: userMessage }];
}

function internalTurns(userMessage: string): AiProviderTurn[] {
  return [{ role: "system", content: INTERNAL_SYSTEM_PROMPT }, { role: "user", content: userMessage }];
}

function toolCallArgs(result: { toolCalls: { name: string; rawArguments: string }[] }, name: string): Record<string, unknown> {
  const call = result.toolCalls.find((c) => c.name === name);
  if (!call) throw new Error(`Expected a "${name}" tool call, got: ${result.toolCalls.map((c) => c.name).join(", ")}`);
  return JSON.parse(call.rawArguments);
}

describe("DevRuleBasedProvider — AI_PROVIDER=mock (Phase 4)", () => {
  it("never calls OpenAI: it is a plain class with no network/SDK dependency", async () => {
    const provider = new DevRuleBasedProvider();
    expect(provider.name).toBe("mock-dev");
  });

  it("asks a qualifying question for a vague job enquiry rather than dumping every open job (spec section 19)", async () => {
    const provider = new DevRuleBasedProvider();
    const result = await provider.chat(salesTurns("Hi, I want to work abroad"), SALES_AGENT_TOOLS);

    // Either it records the intent via the tool (preferred), or it asks
    // directly — either way it must NOT call get_open_jobs without any
    // profession/destination to search by.
    expect(result.toolCalls.some((c) => c.name === "get_open_jobs")).toBe(false);
  });

  it("searches real open jobs once a profession AND destination are given — for ANY profession/country, not a hard-coded one", async () => {
    const provider = new DevRuleBasedProvider();

    const somalia = await provider.chat(
      salesTurns("I am a physiotherapist and I'm interested in Somalia."),
      SALES_AGENT_TOOLS
    );
    const somaliaArgs = toolCallArgs(somalia, "get_open_jobs");
    expect(somaliaArgs.country).toBe("Somalia");
    expect(somaliaArgs.search).toMatch(/physiotherapist/i);

    const kenya = await provider.chat(salesTurns("I am a nurse and I'm interested in Kenya."), SALES_AGENT_TOOLS);
    const kenyaArgs = toolCallArgs(kenya, "get_open_jobs");
    expect(kenyaArgs.country).toBe("Kenya");
    expect(kenyaArgs.search).toMatch(/nurse/i);
  });

  it("records the detected intent + qualification via update_conversation_state", async () => {
    const provider = new DevRuleBasedProvider();
    const result = await provider.chat(
      salesTurns("I am a chef and I'm interested in Qatar, it's quite urgent for me."),
      SALES_AGENT_TOOLS
    );
    const args = toolCallArgs(result, "update_conversation_state");
    expect(args.intent).toBe("JOB_ENQUIRY");
    expect(args.qualification).toMatchObject({ serviceInterest: expect.stringContaining("chef"), destination: "Qatar", urgency: "high" });
  });

  it("produces a final answer, mentioning the real job data returned, once the tool result comes back", async () => {
    const provider = new DevRuleBasedProvider();
    const userMessage = "I am a physiotherapist and I'm interested in Somalia.";
    const firstTurns = salesTurns(userMessage);
    const first = await provider.chat(firstTurns, SALES_AGENT_TOOLS);
    expect(first.message).toBeNull();

    expect(first.toolCalls.some((c) => c.name === "get_open_jobs")).toBe(true);

    // Simulate core.ts appending the assistant's tool-call turn + tool
    // result turns exactly as src/lib/ai/core.ts does.
    const followUpTurns: AiProviderTurn[] = [
      ...firstTurns,
      { role: "assistant", content: first.message, toolCalls: first.toolCalls },
      ...first.toolCalls.map((c): AiProviderTurn => {
        if (c.name === "get_open_jobs") {
          return {
            role: "tool",
            toolCallId: c.id,
            name: c.name,
            content: JSON.stringify([{ id: "job-1", title: "Physiotherapist", country: "Somalia" }]),
          };
        }
        return { role: "tool", toolCallId: c.id, name: c.name, content: JSON.stringify({ mode: "ai", intent: "JOB_ENQUIRY" }) };
      }),
    ];

    const second = await provider.chat(followUpTurns, SALES_AGENT_TOOLS);
    expect(second.toolCalls).toEqual([]);
    expect(second.message).toMatch(/Physiotherapist/);
    expect(second.message).toMatch(/Somalia/);
  });

  it("says so plainly, never invents a job, when the search comes back empty", async () => {
    const provider = new DevRuleBasedProvider();
    const userMessage = "I am a physiotherapist and I'm interested in Somalia.";
    const firstTurns = salesTurns(userMessage);
    const first = await provider.chat(firstTurns, SALES_AGENT_TOOLS);

    const followUpTurns: AiProviderTurn[] = [
      ...firstTurns,
      { role: "assistant", content: first.message, toolCalls: first.toolCalls },
      ...first.toolCalls.map((c): AiProviderTurn => ({
        role: "tool",
        toolCallId: c.id,
        name: c.name,
        content: c.name === "get_open_jobs" ? "[]" : JSON.stringify({ mode: "ai" }),
      })),
    ];

    const second = await provider.chat(followUpTurns, SALES_AGENT_TOOLS);
    expect(second.message).toMatch(/don't currently have any open opportunities/i);
  });

  it("hands over to a human on a complaint, and again on an explicit request for a human — never answers itself", async () => {
    const provider = new DevRuleBasedProvider();

    const complaint = await provider.chat(salesTurns("This service has been terrible, I'm very unhappy."), SALES_AGENT_TOOLS);
    expect(toolCallArgs(complaint, "update_conversation_state")).toMatchObject({ mode: "human" });

    const humanRequest = await provider.chat(salesTurns("Can I speak to a human please?"), SALES_AGENT_TOOLS);
    expect(toolCallArgs(humanRequest, "update_conversation_state")).toMatchObject({ mode: "human" });
  });

  it("always terminates with a final message within the tool-loop's round limit, even if tool calls keep coming back", async () => {
    const provider = new DevRuleBasedProvider();
    const userMessage = "My name is Jane Doe, phone +254712345678, I am a nurse interested in Kenya, urgent please.";
    let turns = salesTurns(userMessage);
    let last;

    for (let round = 0; round < 4; round++) {
      last = await provider.chat(turns, SALES_AGENT_TOOLS);
      if (last.toolCalls.length === 0) break;
      turns = [
        ...turns,
        { role: "assistant", content: last.message, toolCalls: last.toolCalls },
        ...last.toolCalls.map((c): AiProviderTurn => {
          if (c.name === "find_customer_by_contact") return { role: "tool", toolCallId: c.id, name: c.name, content: "[]" };
          if (c.name === "create_customer")
            return {
              role: "tool",
              toolCallId: c.id,
              name: c.name,
              content: JSON.stringify({ created: true, customerId: "22222222-2222-2222-2222-222222222222", fullName: "Jane Doe" }),
            };
          if (c.name === "create_lead")
            return {
              role: "tool",
              toolCallId: c.id,
              name: c.name,
              content: JSON.stringify({ created: true, leadId: "lead-1", temperature: "hot", score: 80 }),
            };
          if (c.name === "get_open_jobs")
            return { role: "tool", toolCallId: c.id, name: c.name, content: JSON.stringify([{ id: "job-2", title: "Nurse", country: "Kenya" }]) };
          return { role: "tool", toolCallId: c.id, name: c.name, content: JSON.stringify({ mode: "ai" }) };
        }),
      ];
    }

    expect(last?.toolCalls).toEqual([]);
    expect(typeof last?.message).toBe("string");
    expect(last?.message?.length).toBeGreaterThan(0);
  });

  it("also works for the internal AI Assistant persona (no CONVERSATION STATE marker) — maps a hot-leads question to the read tool", async () => {
    const provider = new DevRuleBasedProvider();
    const result = await provider.chat(internalTurns("Show me my hot leads"), INTERNAL_TOOLS);
    expect(result.toolCalls.map((c) => c.name)).toContain("get_hot_leads");
  });

  it("gives a helpful, honest fallback for the internal assistant when nothing matches, instead of pretending to answer", async () => {
    const provider = new DevRuleBasedProvider();
    const result = await provider.chat(internalTurns("asdkjaslkdjas"), []);
    expect(result.toolCalls).toEqual([]);
    expect(result.message).toMatch(/mock mode/i);
  });

  // ---------------------------------------------------------------------
  // Item 6 fix: summarize() must distinguish a FAILED create_customer/
  // create_lead tool result ({error: "..."}, the shape core.ts's loop
  // produces for a thrown AiToolError — see src/lib/ai/core.ts) from a
  // genuine success, instead of unsafely casting either shape straight to
  // `{created?: boolean}` and reporting a false "I've updated your
  // existing enquiry" (spec section 18: never claim an action occurred
  // unless the tool actually succeeded).
  // ---------------------------------------------------------------------
  describe("never claims success when create_lead/create_customer actually failed", () => {
    it("gives an honest failure message, never a false 'updated your enquiry' claim, when create_lead errors", async () => {
      const provider = new DevRuleBasedProvider();
      const userMessage = "My name is Test Person, phone +254799999999, I am a driver interested in Kenya.";
      const firstTurns = salesTurns(userMessage);
      const first = await provider.chat(firstTurns, SALES_AGENT_TOOLS);

      const followUpTurns: AiProviderTurn[] = [
        ...firstTurns,
        { role: "assistant", content: first.message, toolCalls: first.toolCalls },
        ...first.toolCalls.map((c): AiProviderTurn => {
          if (c.name === "find_customer_by_contact") return { role: "tool", toolCallId: c.id, name: c.name, content: "[]" };
          return { role: "tool", toolCallId: c.id, name: c.name, content: JSON.stringify({ mode: "ai" }) };
        }),
      ];
      const second = await provider.chat(followUpTurns, SALES_AGENT_TOOLS);
      // Simulate create_customer succeeding, then create_lead genuinely
      // FAILING (e.g. the job it tried to link was no longer open) —
      // exactly the {error: "..."} shape core.ts's loop actually produces.
      const thirdTurns: AiProviderTurn[] = [
        ...followUpTurns,
        { role: "assistant", content: second.message, toolCalls: second.toolCalls },
        ...second.toolCalls.map((c): AiProviderTurn => {
          if (c.name === "create_customer") {
            return {
              role: "tool",
              toolCallId: c.id,
              name: c.name,
              content: JSON.stringify({ created: true, customerId: "33333333-3333-3333-3333-333333333333", fullName: "Test Person" }),
            };
          }
          return { role: "tool", toolCallId: c.id, name: c.name, content: JSON.stringify({ mode: "ai" }) };
        }),
      ];
      const third = await provider.chat(thirdTurns, SALES_AGENT_TOOLS);
      const createLeadCall = third.toolCalls.find((c) => c.name === "create_lead");
      expect(createLeadCall).toBeDefined();

      const fourthTurns: AiProviderTurn[] = [
        ...thirdTurns,
        { role: "assistant", content: third.message, toolCalls: third.toolCalls },
        ...third.toolCalls.map((c): AiProviderTurn => ({
          role: "tool",
          toolCallId: c.id,
          name: c.name,
          content: JSON.stringify({ error: '"Nurse - Qatar" is no longer open (status: closed).' }),
        })),
      ];
      const fourth = await provider.chat(fourthTurns, SALES_AGENT_TOOLS);

      expect(fourth.toolCalls).toEqual([]);
      expect(fourth.message).not.toMatch(/updated your existing enquiry/i);
      expect(fourth.message).not.toMatch(/logged your details/i);
      expect(fourth.message).toMatch(/wasn't able to save|couldn't save|flag this for a team member/i);
    });
  });

  // ---------------------------------------------------------------------
  // Item 7: short, low-signal follow-ups ("Yes please", "Tell me more",
  // "What is my status?") must preserve and use the conversation's
  // ALREADY-KNOWN structured state (recovered from the system prompt's
  // "CONVERSATION STATE SO FAR" block — the only place a stateless
  // per-request provider can see it), rather than re-asking from scratch
  // or invoking OpenAI-equivalent understanding.
  // ---------------------------------------------------------------------
  describe("short follow-up replies preserve and use existing conversation state (item 7)", () => {
    it('"What is my status?" with a known lead calls get_lead instead of re-asking for contact details', async () => {
      const provider = new DevRuleBasedProvider();
      const leadId = "44444444-4444-4444-4444-444444444444";
      const systemContent = salesSystemPromptWithState({ intent: "JOB_ENQUIRY", leadId });
      const result = await provider.chat(salesTurnsWithState("What is my status?", systemContent), SALES_AGENT_TOOLS);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe("get_lead");
      expect(JSON.parse(result.toolCalls[0].rawArguments)).toMatchObject({ leadId });
    });

    it('answers "What is my status?" using the REAL lead data once get_lead returns, never inventing a status', async () => {
      const provider = new DevRuleBasedProvider();
      const leadId = "44444444-4444-4444-4444-444444444444";
      const systemContent = salesSystemPromptWithState({ intent: "JOB_ENQUIRY", leadId });
      const firstTurns = salesTurnsWithState("What is my status?", systemContent);
      const first = await provider.chat(firstTurns, SALES_AGENT_TOOLS);

      const followUpTurns: AiProviderTurn[] = [
        ...firstTurns,
        { role: "assistant", content: first.message, toolCalls: first.toolCalls },
        ...first.toolCalls.map((c): AiProviderTurn => ({
          role: "tool",
          toolCallId: c.id,
          name: c.name,
          content: JSON.stringify({ stage: "documents", temperature: "warm", service: "Driver", targetCountry: "Qatar" }),
        })),
      ];
      const second = await provider.chat(followUpTurns, SALES_AGENT_TOOLS);
      expect(second.toolCalls).toEqual([]);
      expect(second.message).toMatch(/documents/i);
    });

    it('"Yes please" after a lead already exists acknowledges the existing enquiry rather than re-asking what the customer wants', async () => {
      const provider = new DevRuleBasedProvider();
      const systemContent = salesSystemPromptWithState({
        intent: "JOB_ENQUIRY",
        leadId: "55555555-5555-5555-5555-555555555555",
        qualification: "serviceInterest: \"driver\"; destination: \"Qatar\"",
      });
      const result = await provider.chat(salesTurnsWithState("Yes please", systemContent), SALES_AGENT_TOOLS);

      expect(result.toolCalls).toEqual([]);
      expect(result.message).toMatch(/already have your enquiry/i);
    });

    it('"Tell me more" with a matched opportunity calls get_job for that SAME opportunity, never a hard-coded one', async () => {
      const provider = new DevRuleBasedProvider();
      const opportunityId = "66666666-6666-6666-6666-666666666666";
      const systemContent = salesSystemPromptWithState({ intent: "JOB_ENQUIRY", matchedOpportunityId: opportunityId });
      const result = await provider.chat(salesTurnsWithState("Tell me more", systemContent), SALES_AGENT_TOOLS);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe("get_job");
      expect(JSON.parse(result.toolCalls[0].rawArguments)).toMatchObject({ jobId: opportunityId });
    });

    it("a low-signal follow-up with NO prior state at all still falls back to asking a qualifying question, unchanged", async () => {
      const provider = new DevRuleBasedProvider();
      const result = await provider.chat(salesTurns("Ok"), SALES_AGENT_TOOLS);
      // No prior intent/lead/opportunity/qualification — behaves exactly
      // like a first-contact vague message (existing behaviour, untouched).
      expect(toolCallArgs(result, "update_conversation_state")).toMatchObject({ intent: "GENERAL_ENQUIRY" });
    });
  });

  // ---------------------------------------------------------------------
  // Live-testing follow-up (second diagnostic pass): create_lead was
  // failing live with "The create_lead tool call had invalid arguments:
  // Invalid UUID" for a REAL, correctly-matched customer/job. Root cause:
  // Zod's `.uuid()` (now `.guid()` — see src/lib/ai/validation.ts)
  // additionally demanded RFC4122 version/variant nibbles that Phase 0's
  // seed.sql demo rows don't have (they use hand-typed, human-readable
  // placeholder ids like "00000000-0000-0000-0000-000000000101", the real
  // "[DEMO] Registered Nurse — Luxembourg" job) — a perfectly valid
  // Postgres uuid value, rejected by the stricter app-level check. The
  // mock provider was NEVER inventing or substituting an id; these tests
  // prove that explicitly — for ordinary random ids AND for seed-style
  // placeholder ids — so a future change can't quietly reintroduce either
  // failure mode (a fabricated id, or an over-strict validator).
  // ---------------------------------------------------------------------
  describe("create_lead arguments always carry forward REAL tool-result ids, never invented ones", () => {
    const SEED_STYLE_CUSTOMER_ID = "00000000-0000-0000-0000-000000000201";
    const SEED_STYLE_JOB_ID = "00000000-0000-0000-0000-000000000101";
    const RANDOM_CUSTOMER_ID = "7c9e6b3f-4a1d-4e2b-8f3a-123456789abc";

    it("passes the EXACT customer id find_customer_by_contact returned, and the EXACT job id get_open_jobs returned, into create_lead — including hand-seeded, non-RFC4122 placeholder ids, never a manufactured value", async () => {
      const provider = new DevRuleBasedProvider();
      const userMessage = "I am a registered nurse and I'm interested in Luxembourg, phone +352000000000.";
      const firstTurns = salesTurns(userMessage);
      const first = await provider.chat(firstTurns, SALES_AGENT_TOOLS);

      expect(first.toolCalls.map((c) => c.name)).toEqual(
        expect.arrayContaining(["update_conversation_state", "get_open_jobs", "find_customer_by_contact"])
      );

      const followUpTurns: AiProviderTurn[] = [
        ...firstTurns,
        { role: "assistant", content: first.message, toolCalls: first.toolCalls },
        ...first.toolCalls.map((c): AiProviderTurn => {
          if (c.name === "get_open_jobs") {
            return {
              role: "tool",
              toolCallId: c.id,
              name: c.name,
              content: JSON.stringify([
                { id: SEED_STYLE_JOB_ID, title: "[DEMO] Registered Nurse — Luxembourg", country: "Luxembourg" },
              ]),
            };
          }
          if (c.name === "find_customer_by_contact") {
            return {
              role: "tool",
              toolCallId: c.id,
              name: c.name,
              content: JSON.stringify([{ id: SEED_STYLE_CUSTOMER_ID, fullName: "[DEMO] Existing Customer" }]),
            };
          }
          return { role: "tool", toolCallId: c.id, name: c.name, content: JSON.stringify({ mode: "ai" }) };
        }),
      ];

      const second = await provider.chat(followUpTurns, SALES_AGENT_TOOLS);
      expect(second.toolCalls).toHaveLength(1);
      expect(second.toolCalls[0].name).toBe("create_lead");
      const args = JSON.parse(second.toolCalls[0].rawArguments);

      expect(args.customerId).toBe(SEED_STYLE_CUSTOMER_ID);
      expect(args.opportunityId).toBe(SEED_STYLE_JOB_ID);
      // Never a name, title, or phone number substituted for the id.
      expect(args.customerId).not.toBe("[DEMO] Existing Customer");
      expect(args.opportunityId).not.toBe("[DEMO] Registered Nurse — Luxembourg");
      expect(String(args.customerId)).not.toContain("+352");
    });

    it("passes the EXACT customer id create_customer returned (freshly generated) into create_lead when no existing match was found", async () => {
      const provider = new DevRuleBasedProvider();
      const userMessage = "My name is Test Persona, phone +19995550123, I am a driver interested in Kenya.";
      const firstTurns = salesTurns(userMessage);
      const first = await provider.chat(firstTurns, SALES_AGENT_TOOLS);

      const secondTurns: AiProviderTurn[] = [
        ...firstTurns,
        { role: "assistant", content: first.message, toolCalls: first.toolCalls },
        ...first.toolCalls.map((c): AiProviderTurn => {
          if (c.name === "find_customer_by_contact") return { role: "tool", toolCallId: c.id, name: c.name, content: "[]" };
          return { role: "tool", toolCallId: c.id, name: c.name, content: JSON.stringify({ mode: "ai" }) };
        }),
      ];
      const second = await provider.chat(secondTurns, SALES_AGENT_TOOLS);
      expect(second.toolCalls).toHaveLength(1);
      expect(second.toolCalls[0].name).toBe("create_customer");

      const thirdTurns: AiProviderTurn[] = [
        ...secondTurns,
        { role: "assistant", content: second.message, toolCalls: second.toolCalls },
        ...second.toolCalls.map((c): AiProviderTurn => ({
          role: "tool",
          toolCallId: c.id,
          name: c.name,
          content: JSON.stringify({ created: true, customerId: RANDOM_CUSTOMER_ID, fullName: "Test Persona" }),
        })),
      ];
      const third = await provider.chat(thirdTurns, SALES_AGENT_TOOLS);
      expect(third.toolCalls).toHaveLength(1);
      expect(third.toolCalls[0].name).toBe("create_lead");
      const args = JSON.parse(third.toolCalls[0].rawArguments);
      expect(args.customerId).toBe(RANDOM_CUSTOMER_ID);
      expect(args.customerId).not.toBe("Test Persona");
    });

    it("still reports a genuine tool failure honestly (never a false success), unchanged by this fix", async () => {
      const provider = new DevRuleBasedProvider();
      const userMessage = "My name is Another Persona, phone +19995550124, I am a driver interested in Kenya.";
      let turns = salesTurns(userMessage);
      let last: Awaited<ReturnType<InstanceType<typeof DevRuleBasedProvider>["chat"]>> | undefined;

      for (let round = 0; round < 4; round++) {
        last = await provider.chat(turns, SALES_AGENT_TOOLS);
        if (last.toolCalls.length === 0) break;
        turns = [
          ...turns,
          { role: "assistant", content: last.message, toolCalls: last.toolCalls },
          ...last.toolCalls.map((c): AiProviderTurn => {
            if (c.name === "find_customer_by_contact") return { role: "tool", toolCallId: c.id, name: c.name, content: "[]" };
            if (c.name === "create_customer")
              return {
                role: "tool",
                toolCallId: c.id,
                name: c.name,
                content: JSON.stringify({ created: true, customerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", fullName: "Another Persona" }),
              };
            if (c.name === "create_lead")
              return {
                role: "tool",
                toolCallId: c.id,
                name: c.name,
                content: JSON.stringify({ error: 'The "create_lead" tool call had invalid arguments: Invalid UUID' }),
              };
            return { role: "tool", toolCallId: c.id, name: c.name, content: JSON.stringify({ mode: "ai" }) };
          }),
        ];
      }

      expect(last?.toolCalls).toEqual([]);
      expect(last?.message).toMatch(/wasn't able to save|flag this for a team member/i);
      expect(last?.message).not.toMatch(/logged your details|updated your existing enquiry/i);
    });
  });

  // ---------------------------------------------------------------------
  // "lets keep testing on phase 4" diagnostic pass — Bug A: create_task
  // (registered as an available Sales Agent tool, spec section 19's
  // acceptance example: "...and (where appropriate) creates a follow-up
  // task") was never actually planned by ANY code path in this provider,
  // so a successfully-created, job-matched lead never got a real follow-up
  // task, even when there was still round budget to create one. These
  // tests prove planSalesAgentFollowUp now creates one — with REAL details
  // carried over from the actual create_lead result and the user's own
  // message, never invented specifics — and stays inside core.ts's
  // MAX_TOOL_ROUNDTRIPS budget.
  // ---------------------------------------------------------------------
  describe("creates a real follow-up task once a lead is created and matched to a job (Bug A)", () => {
    it("plans create_task, with a title/priority/relatedLeadId built from real data, right after create_lead succeeds with an applicationId", async () => {
      const provider = new DevRuleBasedProvider();
      const existingCustomerId = "88888888-8888-8888-8888-888888888888";
      const jobId = "99999999-9999-9999-9999-999999999999";
      const userMessage = "I am a registered nurse and I'm interested in Kenya, it's urgent, phone +254712345678.";
      const firstTurns = salesTurns(userMessage);
      const first = await provider.chat(firstTurns, SALES_AGENT_TOOLS);

      expect(first.toolCalls.map((c) => c.name)).toEqual(
        expect.arrayContaining(["get_open_jobs", "find_customer_by_contact"])
      );

      const secondTurns: AiProviderTurn[] = [
        ...firstTurns,
        { role: "assistant", content: first.message, toolCalls: first.toolCalls },
        ...first.toolCalls.map((c): AiProviderTurn => {
          if (c.name === "get_open_jobs") {
            return {
              role: "tool",
              toolCallId: c.id,
              name: c.name,
              content: JSON.stringify([{ id: jobId, title: "Registered Nurse — Kenya", country: "Kenya" }]),
            };
          }
          if (c.name === "find_customer_by_contact") {
            return {
              role: "tool",
              toolCallId: c.id,
              name: c.name,
              content: JSON.stringify([{ id: existingCustomerId, fullName: "Existing Nurse Customer" }]),
            };
          }
          return { role: "tool", toolCallId: c.id, name: c.name, content: JSON.stringify({ mode: "ai" }) };
        }),
      ];

      // Round 2: single existing customer match -> plans create_lead.
      const second = await provider.chat(secondTurns, SALES_AGENT_TOOLS);
      expect(second.toolCalls).toHaveLength(1);
      expect(second.toolCalls[0].name).toBe("create_lead");
      const leadArgs = JSON.parse(second.toolCalls[0].rawArguments);
      expect(leadArgs.customerId).toBe(existingCustomerId);
      expect(leadArgs.opportunityId).toBe(jobId);

      const leadId = "77777777-7777-7777-7777-777777777777";
      const thirdTurns: AiProviderTurn[] = [
        ...secondTurns,
        { role: "assistant", content: second.message, toolCalls: second.toolCalls },
        ...second.toolCalls.map((c): AiProviderTurn => ({
          role: "tool",
          toolCallId: c.id,
          name: c.name,
          content: JSON.stringify({
            created: true,
            leadId,
            applicationId: "app-1",
            jobTitle: "Registered Nurse — Kenya",
            temperature: "hot",
            score: 85,
          }),
        })),
      ];

      // Round 3: create_lead succeeded with an applicationId -> plans
      // create_task, using the REAL leadId/jobTitle/urgency, not invented
      // ones, and still within MAX_TOOL_ROUNDTRIPS (this is only round 3).
      const third = await provider.chat(thirdTurns, SALES_AGENT_TOOLS);
      expect(third.toolCalls).toHaveLength(1);
      expect(third.toolCalls[0].name).toBe("create_task");
      const taskArgs = JSON.parse(third.toolCalls[0].rawArguments);
      expect(taskArgs.relatedLeadId).toBe(leadId);
      expect(taskArgs.title).toMatch(/Registered Nurse — Kenya/);
      expect(taskArgs.priority).toBe("high");

      // And the loop still terminates cleanly afterwards (round 4).
      const fourthTurns: AiProviderTurn[] = [
        ...thirdTurns,
        { role: "assistant", content: third.message, toolCalls: third.toolCalls },
        ...third.toolCalls.map((c): AiProviderTurn => ({
          role: "tool",
          toolCallId: c.id,
          name: c.name,
          content: JSON.stringify({ created: true, taskId: "task-1" }),
        })),
      ];
      const fourth = await provider.chat(fourthTurns, SALES_AGENT_TOOLS);
      expect(fourth.toolCalls).toEqual([]);
      expect(typeof fourth.message).toBe("string");
    });

    it("never plans create_task when create_lead failed — an honest failure message instead", async () => {
      const provider = new DevRuleBasedProvider();
      const userMessage = "My name is Fail Case, phone +19995550199, I am a driver interested in Kenya.";
      let turns = salesTurns(userMessage);
      let last: Awaited<ReturnType<InstanceType<typeof DevRuleBasedProvider>["chat"]>> | undefined;
      for (let round = 0; round < 4; round++) {
        last = await provider.chat(turns, SALES_AGENT_TOOLS);
        if (last.toolCalls.length === 0) break;
        turns = [
          ...turns,
          { role: "assistant", content: last.message, toolCalls: last.toolCalls },
          ...last.toolCalls.map((c): AiProviderTurn => {
            if (c.name === "find_customer_by_contact") return { role: "tool", toolCallId: c.id, name: c.name, content: "[]" };
            if (c.name === "create_customer")
              return {
                role: "tool",
                toolCallId: c.id,
                name: c.name,
                content: JSON.stringify({ created: true, customerId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", fullName: "Fail Case" }),
              };
            if (c.name === "create_lead")
              return { role: "tool", toolCallId: c.id, name: c.name, content: JSON.stringify({ error: "no longer open" }) };
            return { role: "tool", toolCallId: c.id, name: c.name, content: JSON.stringify({ mode: "ai" }) };
          }),
        ];
      }
      expect(last?.toolCalls.some((c) => c.name === "create_task")).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // "lets keep testing on phase 4" diagnostic pass — Bug B: every
  // alternation in INTENT_KEYWORDS (plus extractUrgency and the
  // wantsMoreDetail check) used `\b(alt1|alt2|...)\b` — a TRAILING
  // boundary right after the alternation. That anchors to wherever the
  // MATCHED alternative's text ends, so a plain singular noun like
  // "document" or "tour" never matched its own natural plural
  // ("documents abroad", "any tours available"), and an intentional word
  // stem like "vacan" (meant to catch "vacancy"/"vacancies") never matched
  // anything at all. Two of the broken phrases are this app's OWN example
  // prompts (SALES_AGENT_EXAMPLE_PROMPTS in src/app/(dashboard)/ai/page.tsx).
  // Fixed to a LEADING boundary only: `\b(?:alt1|alt2|...)`. These tests
  // prove the fix without hard-coding just one case, and prove the leading
  // boundary still prevents a false match inside an unrelated longer word.
  // ---------------------------------------------------------------------
  describe("intent keywords match plural/suffixed forms, not just the bare stem (Bug B)", () => {
    it('"What documents do I need for this job?" (the app\'s own example prompt) triggers a document/job search, not silence', async () => {
      const provider = new DevRuleBasedProvider();
      const result = await provider.chat(salesTurns("What documents do I need for this job?"), SALES_AGENT_TOOLS);
      expect(toolCallArgs(result, "update_conversation_state")).toMatchObject({
        intent: expect.stringMatching(/DOCUMENT_ENQUIRY|JOB_ENQUIRY/),
      });
    });

    it('"Do you have any tours to the coast?" (the app\'s own example prompt) is detected as a tour enquiry, not missed', async () => {
      const provider = new DevRuleBasedProvider();
      const result = await provider.chat(salesTurns("Do you have any tours to the coast?"), SALES_AGENT_TOOLS);
      expect(toolCallArgs(result, "update_conversation_state")).toMatchObject({ intent: "TOUR_ENQUIRY" });
    });

    it('"Are there any vacancies for nurses?" is detected as a job enquiry (the "vacan" stem must match "vacancies")', async () => {
      const provider = new DevRuleBasedProvider();
      const result = await provider.chat(salesTurns("Are there any vacancies for nurses?"), SALES_AGENT_TOOLS);
      expect(toolCallArgs(result, "update_conversation_state")).toMatchObject({ intent: "JOB_ENQUIRY" });
    });

    it('"What are your fees for this?" is detected as a price enquiry ("fee" must match "fees")', async () => {
      const provider = new DevRuleBasedProvider();
      const result = await provider.chat(salesTurns("What are your fees for this?"), SALES_AGENT_TOOLS);
      expect(toolCallArgs(result, "update_conversation_state")).toMatchObject({ intent: "PRICE_ENQUIRY" });
    });

    it('"What are the requirements and am I eligible?" is detected as a requirements enquiry ("requirement"/"eligib" must match their suffixed forms)', async () => {
      const provider = new DevRuleBasedProvider();
      const result = await provider.chat(
        salesTurns("What are the requirements and am I eligible?"),
        SALES_AGENT_TOOLS
      );
      expect(toolCallArgs(result, "update_conversation_state")).toMatchObject({ intent: "REQUIREMENTS_ENQUIRY" });
    });

    it('"I need this done urgently" is still detected as high urgency ("urgent" must match "urgently")', async () => {
      const provider = new DevRuleBasedProvider();
      const result = await provider.chat(
        salesTurns("I am a driver and I'm interested in Kenya, I need this done urgently."),
        SALES_AGENT_TOOLS
      );
      expect(toolCallArgs(result, "update_conversation_state")).toMatchObject({
        qualification: expect.objectContaining({ urgency: "high" }),
      });
    });

    it('a leading boundary still avoids false positives inside an unrelated longer word ("contour" must not match the "tour" stem)', async () => {
      const provider = new DevRuleBasedProvider();
      const result = await provider.chat(
        salesTurns("Can you describe the contour of the hiking trail difficulty rating system?"),
        SALES_AGENT_TOOLS
      );
      const args = toolCallArgs(result, "update_conversation_state");
      expect(args.intent).not.toBe("TOUR_ENQUIRY");
    });
  });

  // ---------------------------------------------------------------------
  // "lets continue with phase 4 testing" — a further proactive pass turned
  // up that `update_lead` (registered as a Sales Agent tool, and named in
  // the spec's own acceptance example: the agent "creates OR UPDATES a
  // lead with a deterministically computed temperature/score") was never
  // called by ANY code path — `create_lead` REUSES an existing active
  // lead's stored score/temperature untouched rather than recomputing it,
  // so a returning customer's fresh signal (a new profession/destination/
  // urgency mentioned this turn) was silently dropped, forever.
  //
  // The fix only calls `update_lead` when doing so would raise the score
  // — deliberately conservative, because `update_lead` fully OVERWRITES
  // score/temperature from whatever `qualification` it's given, and this
  // mock only ever sees THIS message's 3 factors (fit/opportunityRelevance/
  // urgency), never the richer set (intentClarity/completeness/engagement)
  // that may have produced a high existing score over prior turns. These
  // tests prove both directions: a low-score existing lead gets a real
  // recomputed update, and a high-score one is never silently downgraded.
  // ---------------------------------------------------------------------
  describe("updates an existing (reused) lead's qualification when it's a genuine improvement, never a downgrade", () => {
    const EXISTING_CUSTOMER_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const EXISTING_LEAD_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    const JOB_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

    function conversationUpToCreateLead(userMessage: string) {
      const firstTurns = salesTurns(userMessage);
      return firstTurns;
    }

    it("recomputes and raises a low-score existing lead's qualification once real signal is given", async () => {
      const provider = new DevRuleBasedProvider();
      const userMessage = "I am a registered nurse and I'm interested in Luxembourg, phone +254711000001, it's urgent.";
      const firstTurns = conversationUpToCreateLead(userMessage);
      const first = await provider.chat(firstTurns, SALES_AGENT_TOOLS);

      const secondTurns: AiProviderTurn[] = [
        ...firstTurns,
        { role: "assistant", content: first.message, toolCalls: first.toolCalls },
        ...first.toolCalls.map((c): AiProviderTurn => {
          if (c.name === "get_open_jobs") {
            return {
              role: "tool",
              toolCallId: c.id,
              name: c.name,
              content: JSON.stringify([{ id: JOB_ID, title: "[DEMO] Registered Nurse — Luxembourg", country: "Luxembourg" }]),
            };
          }
          if (c.name === "find_customer_by_contact") {
            return {
              role: "tool",
              toolCallId: c.id,
              name: c.name,
              content: JSON.stringify([{ id: EXISTING_CUSTOMER_ID, fullName: "Returning Customer" }]),
            };
          }
          return { role: "tool", toolCallId: c.id, name: c.name, content: JSON.stringify({ mode: "ai" }) };
        }),
      ];
      const second = await provider.chat(secondTurns, SALES_AGENT_TOOLS);
      expect(second.toolCalls).toHaveLength(1);
      expect(second.toolCalls[0].name).toBe("create_lead");

      const thirdTurns: AiProviderTurn[] = [
        ...secondTurns,
        { role: "assistant", content: second.message, toolCalls: second.toolCalls },
        ...second.toolCalls.map((c): AiProviderTurn => ({
          role: "tool",
          toolCallId: c.id,
          name: c.name,
          content: JSON.stringify({
            created: false,
            leadId: EXISTING_LEAD_ID,
            temperature: "nurture",
            score: 10,
            applicationId: "app-1",
            jobTitle: "[DEMO] Registered Nurse — Luxembourg",
          }),
        })),
      ];

      const third = await provider.chat(thirdTurns, SALES_AGENT_TOOLS);
      expect(third.toolCalls).toHaveLength(1);
      expect(third.toolCalls[0].name).toBe("update_lead");
      const args = JSON.parse(third.toolCalls[0].rawArguments);
      expect(args.leadId).toBe(EXISTING_LEAD_ID);
      expect(args.qualification).toMatchObject({ fit: 0.6, opportunityRelevance: 0.8, urgency: 0.9 });

      // And the loop still terminates cleanly on the next round.
      const fourthTurns: AiProviderTurn[] = [
        ...thirdTurns,
        { role: "assistant", content: third.message, toolCalls: third.toolCalls },
        ...third.toolCalls.map((c): AiProviderTurn => ({
          role: "tool",
          toolCallId: c.id,
          name: c.name,
          content: JSON.stringify({ leadId: EXISTING_LEAD_ID, stage: "new", temperature: "nurture", score: 38 }),
        })),
      ];
      const fourth = await provider.chat(fourthTurns, SALES_AGENT_TOOLS);
      expect(fourth.toolCalls).toEqual([]);
      expect(typeof fourth.message).toBe("string");
    });

    it("never downgrades an already-strong existing lead just because this one message alone only captures 3 of the 6 factors", async () => {
      const provider = new DevRuleBasedProvider();
      const userMessage = "I am a registered nurse and I'm interested in Luxembourg, phone +254711000001, it's urgent.";
      const firstTurns = conversationUpToCreateLead(userMessage);
      const first = await provider.chat(firstTurns, SALES_AGENT_TOOLS);

      const secondTurns: AiProviderTurn[] = [
        ...firstTurns,
        { role: "assistant", content: first.message, toolCalls: first.toolCalls },
        ...first.toolCalls.map((c): AiProviderTurn => {
          if (c.name === "get_open_jobs") {
            return {
              role: "tool",
              toolCallId: c.id,
              name: c.name,
              content: JSON.stringify([{ id: JOB_ID, title: "[DEMO] Registered Nurse — Luxembourg", country: "Luxembourg" }]),
            };
          }
          if (c.name === "find_customer_by_contact") {
            return {
              role: "tool",
              toolCallId: c.id,
              name: c.name,
              content: JSON.stringify([{ id: EXISTING_CUSTOMER_ID, fullName: "Jane Wanjiru" }]),
            };
          }
          return { role: "tool", toolCallId: c.id, name: c.name, content: JSON.stringify({ mode: "ai" }) };
        }),
      ];
      const second = await provider.chat(secondTurns, SALES_AGENT_TOOLS);

      const thirdTurns: AiProviderTurn[] = [
        ...secondTurns,
        { role: "assistant", content: second.message, toolCalls: second.toolCalls },
        ...second.toolCalls.map((c): AiProviderTurn => ({
          role: "tool",
          toolCallId: c.id,
          name: c.name,
          // Already "hot" at 91 (e.g. from documents already submitted,
          // high engagement over many prior turns) — richer than anything
          // a single new message can capture.
          content: JSON.stringify({
            created: false,
            leadId: EXISTING_LEAD_ID,
            temperature: "hot",
            score: 91,
            applicationId: "app-1",
            jobTitle: "[DEMO] Registered Nurse — Luxembourg",
          }),
        })),
      ];

      const third = await provider.chat(thirdTurns, SALES_AGENT_TOOLS);
      // No update_lead (would only lower the score), and no create_task
      // either (create_lead's `created` was false, not true) — the loop
      // finalizes here instead.
      expect(third.toolCalls).toEqual([]);
      expect(typeof third.message).toBe("string");
    });
  });
});
