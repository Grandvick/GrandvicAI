/**
 * Structured sales intent categories (Phase 4 spec section 9). Kept as a
 * plain string array + type, stored as free text on `conversations.intent`
 * (not a Postgres enum — see 0007_ai_sales_agent.sql) so a new intent can be
 * added here without a migration. Deliberately generic/channel-agnostic —
 * nothing here hard-codes "Jobs Abroad" as special; JOB_ENQUIRY is just one
 * of several service-shaped intents a business's modules might use.
 */
export const SALES_INTENTS = [
  "GENERAL_ENQUIRY",
  "JOB_ENQUIRY",
  "VISA_ENQUIRY",
  "TOUR_ENQUIRY",
  "SAFARI_ENQUIRY",
  "VEHICLE_ENQUIRY",
  "PRICE_ENQUIRY",
  "REQUIREMENTS_ENQUIRY",
  "APPLICATION_STATUS",
  "DOCUMENT_ENQUIRY",
  "FOLLOW_UP",
  "COMPLAINT",
  "HUMAN_SUPPORT",
  "OTHER",
] as const;

export type SalesIntent = (typeof SALES_INTENTS)[number];

export function isSalesIntent(value: string): value is SalesIntent {
  return (SALES_INTENTS as readonly string[]).includes(value);
}
