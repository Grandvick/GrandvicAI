import { describe, expect, it } from "vitest";
import { extractInboundTextMessages } from "./webhook-payload";

function envelope(...changes: unknown[]) {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "waba-1", changes }],
  };
}

function textChange(overrides: Record<string, unknown> = {}) {
  return {
    field: "messages",
    value: {
      messaging_product: "whatsapp",
      metadata: { phone_number_id: "phone-1", display_phone_number: "254700000000" },
      contacts: [{ profile: { name: "Jane Customer" }, wa_id: "254799999911" }],
      messages: [
        { from: "254799999911", id: "wamid.ABC123", timestamp: "1700000000", type: "text", text: { body: "Hi there" } },
      ],
      ...overrides,
    },
  };
}

describe("extractInboundTextMessages (Phase 5F — parsing Meta's webhook envelope)", () => {
  it("extracts a single text message with its phone_number_id/from/id/text", () => {
    const messages = extractInboundTextMessages(envelope(textChange()));
    expect(messages).toEqual([{ phoneNumberId: "phone-1", from: "254799999911", id: "wamid.ABC123", text: "Hi there" }]);
  });

  it("extracts multiple messages across multiple entries/changes/messages, not just the first", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        { id: "waba-1", changes: [textChange({ messages: [{ from: "111", id: "wamid.1", type: "text", text: { body: "one" } }] })] },
        { id: "waba-1", changes: [textChange({ messages: [{ from: "222", id: "wamid.2", type: "text", text: { body: "two" } }] })] },
      ],
    };
    const messages = extractInboundTextMessages(payload);
    expect(messages).toHaveLength(2);
    expect(messages.map((m) => m.id)).toEqual(["wamid.1", "wamid.2"]);
  });

  it("ignores a `statuses` (delivery/read receipt) update — no `messages` array at all", () => {
    const payload = envelope({
      field: "messages",
      value: {
        metadata: { phone_number_id: "phone-1" },
        statuses: [{ id: "wamid.ABC123", status: "delivered", timestamp: "1700000000" }],
      },
    });
    expect(extractInboundTextMessages(payload)).toEqual([]);
  });

  it("ignores a non-text message type (e.g. image) rather than throwing or mis-extracting it as text", () => {
    const payload = envelope(
      textChange({
        messages: [{ from: "254799999911", id: "wamid.IMG", type: "image", image: { id: "media-1", mime_type: "image/jpeg" } }],
      })
    );
    expect(extractInboundTextMessages(payload)).toEqual([]);
  });

  it("skips a text message missing its id, without throwing", () => {
    const payload = envelope(
      textChange({ messages: [{ from: "254799999911", type: "text", text: { body: "no id here" } }] })
    );
    expect(extractInboundTextMessages(payload)).toEqual([]);
  });

  it("skips a text message with an empty body", () => {
    const payload = envelope(textChange({ messages: [{ from: "254799999911", id: "wamid.EMPTY", type: "text", text: { body: "" } }] }));
    expect(extractInboundTextMessages(payload)).toEqual([]);
  });

  it("skips a change with no metadata.phone_number_id (can't be routed to a business)", () => {
    const payload = envelope({ field: "messages", value: { messages: [{ from: "254799999911", id: "wamid.X", type: "text", text: { body: "hi" } }] } });
    expect(extractInboundTextMessages(payload)).toEqual([]);
  });

  it("returns an empty array for null, non-object, or missing-entry payloads without throwing", () => {
    expect(extractInboundTextMessages(null)).toEqual([]);
    expect(extractInboundTextMessages(undefined)).toEqual([]);
    expect(extractInboundTextMessages("not an object")).toEqual([]);
    expect(extractInboundTextMessages({})).toEqual([]);
    expect(extractInboundTextMessages({ entry: "not an array" })).toEqual([]);
  });

  it("returns an empty array for a malformed entry/change shape without throwing", () => {
    expect(extractInboundTextMessages({ entry: [null, { changes: "not an array" }, { changes: [null] }] })).toEqual([]);
  });
});
