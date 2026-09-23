# SETUP.md — Grandvic AI

This guide gets Grandvic AI running on your computer. It assumes **Windows**
(PowerShell) since that's the primary development machine, with notes for
macOS/Linux where the commands differ. No prior developer experience is
assumed — every command is copy/paste-able.

---

## 1. Install required software (one-time)

| Tool | Why | Windows install |
| --- | --- | --- |
| **Node.js 20 or newer** | Runs the app | Download the LTS installer from https://nodejs.org and run it, or `winget install OpenJS.NodeJS.LTS` in PowerShell |
| **Git** | Source control | https://git-scm.com/download/win, or `winget install Git.Git` |
| **VS Code** | Code editor | https://code.visualstudio.com, or `winget install Microsoft.VisualStudioCode` |

Verify everything installed correctly (PowerShell):

```powershell
node -v
npm -v
git --version
```

You should see version numbers, not "command not found."

---

## 2. Get the project running locally

Open the `grandvic-ai` folder in VS Code (File → Open Folder), then open a
terminal inside VS Code (`` Ctrl+` ``) and run:

```powershell
npm install
```

This downloads all the packages the app needs (~1-2 minutes).

---

## 3. Create your Supabase project (Phase 0 — required)

Supabase is the database, authentication, and file storage for Grandvic AI.
It has a free tier that's enough for development.

1. Go to https://supabase.com and sign up / sign in.
2. Click **New project**. Choose an organization, name it (e.g.
   `grandvic-ai`), set a database password (save it somewhere safe — you
   won't need it day-to-day, but you will if you ever connect a database
   tool directly), and pick a region close to Kenya (e.g. `eu-west` or
   similar — pick whichever is offered and closest).
3. Wait ~2 minutes for the project to finish provisioning.
4. In the left sidebar, go to **Project Settings → API**. You'll need two
   values from this page in the next step:
   - **Project URL**
   - **anon public** key (NOT the `service_role` key for this one)

### Copy the environment file and fill it in

In the project folder:

```powershell
Copy-Item .env.example .env.local
```

(macOS/Linux: `cp .env.example .env.local`)

Open `.env.local` in VS Code and paste in:

```
NEXT_PUBLIC_SUPABASE_URL=<your Project URL>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your anon public key>
SUPABASE_SERVICE_ROLE_KEY=<your service_role key — from the same API settings page>
```

`.env.local` is already in `.gitignore` — it will never be committed to git.
**Never share your `service_role` key or paste it into the browser** — it
bypasses all database security rules.

### Run the database schema

In the Supabase dashboard, go to **SQL Editor → New query**, then run each
of these **in order** (each as its own query — paste the whole file, click
**Run**, confirm no red error text, then move to the next one):

1. `supabase/migrations/0001_init.sql` — creates every table, security
   rule, and helper function the app needs.
2. `supabase/migrations/0002_documents_storage.sql` **(Phase 1)** — creates
   a private `documents` Storage bucket and the security rules that scope
   every file to the business that uploaded it — required before the
   Documents screen can accept an upload. Safe to re-run (it's written to
   be idempotent).
3. `supabase/migrations/0003_jobs_abroad.sql` **(Phase 2)** — extends
   `opportunities` with the full Jobs Abroad field set (employer/recruiter,
   salary, benefits, structured requirements, expiry) and `applications`
   with the full recruitment pipeline (screening → documents →
   shortlisted → submitted → interview → selected → placed, etc.), and adds
   one new table, `application_events`. Safe to re-run — see the comment
   block at the top of the file for exactly what is and isn't idempotent
   about it. **If you already have real job/application data, read that
   comment block before running it** — it migrates old data (e.g.
   `documents_required` values, old application statuses) forward rather
   than discarding it, but it's still a real schema change, not a pure
   no-op.
4. `supabase/migrations/0004_fix_owner_role_bootstrap.sql` — fixes a Phase 0
   bug where, if your very first Supabase Auth user was created before
   `seed.sql` had been run, that user's profile silently ended up with no
   role at all instead of Owner (see the comment block at the top of the
   file, and the Troubleshooting entry below). Safe to run even if you
   never hit this — it's a no-op on a database whose Owner already works.
5. (Recommended for trying out the dashboard) `supabase/seed.sql` — adds
   Grandvic Tours & Travel as a business plus clearly-labeled `[DEMO]`
   customers, leads, jobs, and content so the dashboard isn't empty on your
   first login. **Run this after all four migrations above** — the seed
   data uses Phase 2 columns that only exist once `0003_jobs_abroad.sql`
   has run. Every seeded record is fictional — safe to delete anytime from
   the Table Editor.
6. `supabase/migrations/0005_repair_missing_owner_profile.sql` — fixes a
   related but different Phase 0 bug: if your very first Supabase Auth user
   was created *before you ever ran `0001_init.sql`*, there was no
   `profiles` row for them at all (not even one with a missing role) — the
   bootstrap trigger didn't exist yet to react to that signup. **Run this
   last, after `seed.sql`** — it looks up the already-seeded Grandvic Tours
   & Travel business by name to confirm it exists (it never creates one).
   See the comment block at the top of the file, and the Troubleshooting
   entry below. Safe to run even if you never hit this — it's a no-op once
   every Auth user has a profile.
7. `supabase/migrations/0006_ai_core.sql` **(Phase 3)** — adds no new
   tables (`ai_runs`, `audit_logs`, `settings`, `knowledge_items`,
   `conversations`/`conversation_messages` and their RLS already existed
   since Phase 0); it only widens `conversations.channel` to also allow
   `'dashboard'`, so an AI Command Centre conversation can be saved
   alongside future WhatsApp/website/social ones. Safe to re-run.
8. `supabase/migrations/0007_ai_sales_agent.sql` **(Phase 4)** — widens
   `conversations.mode` to add `'paused'` (alongside the existing `'ai'`
   and `'human'`, for the human-takeover state machine), adds structured
   state columns to `conversations` (`lead_id`, `intent`,
   `matched_opportunity_id`, `qualification`, `handover_reason`), and adds
   one new table, `conversation_events` — a per-conversation timeline that
   mirrors the existing `lead_events`/`application_events` tables exactly.
   No existing table, column, or RLS policy is changed. Safe to re-run.

### Create your owner login

1. In Supabase, go to **Authentication → Users → Add user → Create new user**.
2. Enter your email and a password. Leave "Auto Confirm User" checked so you
   don't need to click an email confirmation link.
3. Click **Create user**.

Because this is the very first user, the database automatically makes you
the **Owner** (full access to everything) — see the `handle_new_user`
function in `supabase/migrations/0001_init.sql` if you want to see exactly
how that works.

---

## 3a. Enable the AI Command Centre (Phase 3, optional but recommended)

The AI Command Centre (`/ai` in the sidebar) is a natural-language assistant
that answers questions about your real business data — leads, jobs,
applicants, documents, tasks — using a fixed set of read-only tools, never
by inventing an answer or querying the database directly itself. It needs
one more environment variable beyond what Phase 0 required:

1. Go to https://platform.openai.com/api-keys, sign in (or create an
   account), and create a new API key.
2. Add it to `.env.local`:
   ```
   OPENAI_API_KEY=<your key>
   OPENAI_MODEL=gpt-4o-mini
   ```
   `OPENAI_MODEL` is optional — it defaults to `gpt-4o-mini` (cheap, fast,
   good enough for the tool-calling lookups the AI Command Centre does)
   if you leave it blank.
3. Restart `npm run dev` (environment variables are only read when the
   server starts).
4. Open `/ai` from the sidebar and try one of the example prompts, e.g.
   "Show me my hot leads." or "What jobs are currently open?"

Until `OPENAI_API_KEY` is set, `/ai` shows a clear "isn't configured yet"
message instead of a broken chat window — the same pattern as the rest of
the app (see `env.hasOpenAI` in `src/lib/config.ts`). The AI Command Centre
never has write access to your data in this phase — see ARCHITECTURE.md
section 7 and CHANGELOG.md's `[0.4.0]` entry for exactly what it can and
can't do.

**Cost note:** every request is capped (max 4 tool round-trips, ~800
output tokens, a 10-requests-per-minute-per-user rate limit by default —
see `AI_RATE_LIMIT_PER_MINUTE` in `.env.example`) and logged to the
`ai_runs` table with a token/cost estimate, so usage stays predictable and
inspectable from the Table Editor.

---

## 3b. Try the AI Sales Agent (Phase 4, optional but recommended)

The AI Sales Agent is a second, separate persona living on the same `/ai`
page, behind an **"AI Sales Agent"** tab next to the existing "AI
Assistant" tab. Where the AI Command Centre (3a, above) is an internal
tool for *your staff* to ask questions about the business, the Sales Agent
plays the *customer-facing* role — it's the engine a future WhatsApp/web
chat widget will plug into, simulated for now from inside the dashboard so
you (or a teammate) can play the customer and see exactly how it behaves.

It shares the exact same `OPENAI_API_KEY` / `OPENAI_MODEL` setup as
section 3a — there is nothing extra to configure. If you've already done
3a, you're ready to try it.

1. Open `/ai` from the sidebar and click the **"AI Sales Agent"** tab.
2. Type a message as if you were a prospective customer, for example:
   ```
   Hi, I am a physiotherapist and I'm interested in working in Somalia.
   ```
3. Watch what happens on the right-hand side panel as the conversation
   proceeds: **Mode** (AI active / human takeover / paused), **Intent**
   (e.g. `JOB_ENQUIRY`), a linked **Lead** once one is created (with its
   temperature and score), a **Matched job** once the agent finds a
   relevant open opportunity, the **Qualification** details it has
   captured so far (destination, profession, urgency, etc.), and a log of
   **Conversation events** (`intent_detected`, `lead_created`,
   `opportunity_matched`, and so on).
4. Try the takeover controls in that same panel: **Take over** switches
   the conversation to `human` mode — send another message as the
   "customer" and you'll see the AI does *not* reply (by design — a human
   is now handling it). **Resume AI** hands it back. **Pause AI** stops
   AI replies without marking it as a human takeover.
5. Check the CRM: a lead created this way shows up on `/leads` like any
   other, with the same temperature/score/pipeline stage, because the
   Sales Agent creates it through the exact same business-logic functions
   the rest of the app uses — never a direct database write.

**What it will and won't do, by design (Phase 4 scope):** it only
recommends opportunities that are currently OPEN (never paused/closed/
expired/draft), it never invents prices, visa/job requirements, or
policies it doesn't have verified data for, and it can create/update
leads, customers, tasks and conversation state — but it cannot delete
anything, approve or reject an applicant, change a job's or application's
status, confirm a payment, or send a message on your behalf outside this
dashboard. Real customer channels (WhatsApp, web chat, etc.) connecting to
this same engine are Phase 5 — see DEVELOPMENT_PROGRESS.md.

**A note on testing:** OpenAI billing/credits were not active while this
phase was built, so live OpenAI calls have not been exercised end-to-end
in this environment — only the deterministic mock provider was used for
the automated test suite (`npm run test`). The Sales Agent tab described
above talks to the *real* provider once you've added a working
`OPENAI_API_KEY` with active billing; try it yourself once billing is
enabled on your OpenAI account, and report back anything that looks off.

### Trying it right now, without OpenAI billing (`AI_PROVIDER=mock`)

You don't have to wait for OpenAI billing to click around the AI Sales
Agent tab. Add one line to `.env.local`:

```
AI_PROVIDER=mock
```

and restart `npm run dev`. This switches **both** `/ai` tabs (AI Assistant
and AI Sales Agent) over to `DevRuleBasedProvider`
(`src/lib/ai/provider/dev-mock.ts`) — a deterministic, zero-cost,
rule-based stand-in for the real model. It is not a fake frontend response:
the request still goes through `POST /api/ai/sales-agent`, the real bounded
tool-calling loop (`src/lib/ai/core.ts`), and the real Phase 4 business
logic — intent detection, job matching against currently-open jobs,
qualification capture, deterministic lead scoring, customer/lead creation,
conversation events, and human takeover all still run for real, against
your real Supabase data. It just never calls OpenAI, so it costs nothing
and needs no billing — and it works with whatever you type, not one
scripted example: try different professions, destinations, a price/visa
question, or "I'd like to speak to a human" and see how it reacts.

Leave `AI_PROVIDER` blank (or set to `openai`, the default) to go back to
the real provider once you're ready to test with live billing. **Never set
`AI_PROVIDER=mock` in production** — it never gives a real answer, by
design (see the comment in `src/lib/config.ts`).

---

## 4. Run the app

```powershell
npm run dev
```

Open http://localhost:3000 in your browser. You should be redirected to a
login page. Sign in with the email/password you just created in Supabase —
you'll land on the dashboard.

If you see a "Setup required" screen instead, double-check `.env.local` has
the right values and restart `npm run dev` (environment variables are only
read when the server starts).

---

## 5. Running tests and checks

```powershell
npm run lint     # code style / correctness checks
npm run test     # unit tests
npm run build    # full production build (also confirms everything compiles)
```

All three should complete with no errors before you consider a change "done."

---

## 6. Deploying to production (Vercel)

1. Push this project to a GitHub repository (create one at
   https://github.com/new, then follow GitHub's "push an existing
   repository" instructions, or ask your developer/Claude Code session to do
   it once you've connected GitHub).
2. Go to https://vercel.com, sign in with GitHub, and click **Add New →
   Project**, then select your `grandvic-ai` repository.
3. In the "Environment Variables" step, add the same variables from your
   `.env.local` (at minimum `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).
4. Click **Deploy**. Vercel will build and give you a live URL
   (`https://your-project.vercel.app`).
5. **Production Supabase**: for real customer data, create a *separate*
   Supabase project for production (don't mix demo/dev data with real
   customers), run the same migration + owner-user steps against it, and use
   its URL/keys in Vercel's environment variables instead of your dev
   project's.
6. **Custom domain**: In Vercel, go to your project → Settings → Domains to
   attach your own domain once you have one.
7. **Rollback**: Vercel keeps every deployment. If a deploy causes a
   problem, go to the Deployments tab and click "Promote to Production" on
   the last good one.

---

## 7. What you'll need for later phases

You don't need most of these yet — they're listed here so you know what to
plan for. Full setup steps are written just before each phase actually
needs them (per the phased build plan in DEVELOPMENT_PROGRESS.md), and each
integration is verified against its official, current documentation before
being wired up — nothing here is assumed to still be accurate by the time
we reach it. **Phase 5 (WhatsApp) is active now**, so its full walkthrough
is in section 7a below. Everything else is still just a placeholder.

| Phase | What's needed | Where to get it |
| --- | --- | --- |
| 5 — WhatsApp | Meta Business account + WhatsApp Business Platform app | See section 7a below |
| 6 — Automation | n8n instance (self-hosted or n8n Cloud) | https://n8n.io |
| 8 — Social Publishing | Facebook/Instagram (Meta), TikTok, LinkedIn developer apps | Each platform's developer portal |
| 9+ — Payments | A payment provider (TBD together with you) | To be decided — see ARCHITECTURE.md "Payments" |

---

## 7a. WhatsApp Cloud API setup (Phase 5H — development stage)

This is something only you can do — it needs your own Meta account and a
few clicks in Meta's dashboard, so it can't be done from inside this
coding session. Everything below is for **development/testing only**
(a personal WhatsApp number talking to a test business number). Going live
with real customers (a verified business number, a permanent access
token, template approval) is a separate, later stage — Phase 5L — because
Meta's own business-verification process is on Meta's timeline, not
engineering's.

Meta's developer dashboard changes its exact wording and layout from time
to time, so treat the menu names below as "roughly where to look," and use
whatever the current equivalent screen calls it if something's moved. The
underlying mechanics (a Callback URL + Verify Token, and a temporary
access token tied to a test phone number) have been stable for years and
are what this app's code already expects — see
`src/app/api/webhooks/whatsapp/route.ts` and
`src/lib/channels/whatsapp/webhook-signature.ts`.

### Step 1 — Create a Meta developer account and app

1. Go to https://developers.facebook.com/apps and log in with (or create)
   a Facebook account, then complete the one-time developer registration
   if prompted.
2. Click **Create App**. Choose the "Business" app type when asked what
   the app is for.
3. Once the app is created, find **WhatsApp** in the list of products you
   can add, and click **Set up**. Meta will ask you to attach or create a
   **Meta Business Account** (formerly "Business Manager") — create one if
   you don't already have one for Grandvic.
4. Adding the WhatsApp product automatically provisions, at no cost: a
   test WhatsApp Business Account, a test business phone number, and a
   temporary access token (valid ~24 hours, regenerate it from this same
   screen whenever it expires during development).

### Step 2 — Collect your test credentials

On the app's **WhatsApp → API Setup** page you'll find:

- **Phone number ID** → `WHATSAPP_PHONE_NUMBER_ID`
- **WhatsApp Business Account ID** → `WHATSAPP_BUSINESS_ACCOUNT_ID`
- **Temporary access token** → `WHATSAPP_ACCESS_TOKEN` (regenerate and
  update this when it expires — a 24-hour temporary token is normal at
  this stage; a permanent one is a Phase 5L concern)
- The example `curl` command on that page shows the Graph API version
  currently in its URL (e.g. `v21.0`) → `WHATSAPP_API_VERSION`. Use
  whatever version that page actually shows you, not a version copied
  from this document, since Meta deprecates versions on a schedule.

Put all four into your `.env.local`, and leave `WHATSAPP_PROVIDER` blank
(unset) so the app uses the real Meta provider instead of the mock one.

### Step 3 — Add your own phone as a test recipient

Still on the API Setup page, under "Send and receive messages," add your
own WhatsApp number to the allowed recipient list (test apps can only
message a short allowlist until business verification/Phase 5L). Meta
will text you a confirmation code to verify it.

Send yourself the sample template message from that same page to confirm
the access token and phone number ID actually work before moving on.

### Step 4 — Expose your local server to the internet

Meta's webhook can't reach `localhost`, so your local dev server needs a
public HTTPS URL pointing at it while you're developing:

1. Install [ngrok](https://ngrok.com/download) (or any similar tunnel
   tool) and create a free account.
2. With `npm run dev` running (section 4 above, serving on port 3000), run:
   ```powershell
   ngrok http 3000
   ```
3. Copy the `https://....ngrok-free.app` forwarding URL it prints — your
   webhook callback URL will be that plus `/api/webhooks/whatsapp`.

(Once the app is deployed to Vercel — section 6 — you can point the
webhook at your real `https://your-project.vercel.app/api/webhooks/whatsapp`
instead, and skip the tunnel entirely.)

### Step 5 — Set your own webhook secrets

In `.env.local`, set:

- `WHATSAPP_WEBHOOK_VERIFY_TOKEN` — make this up yourself (any random
  string, e.g. generate one with `openssl rand -hex 20`). You'll enter the
  exact same value into Meta's dashboard in the next step — it's how the
  one-time verification handshake confirms you own this endpoint.
- `WHATSAPP_APP_SECRET` — from your app's **App Settings → Basic** page
  ("App Secret," click "Show"). This is what Meta signs every webhook
  delivery with, and what this app's webhook route verifies every inbound
  request against before touching the database.

Restart `npm run dev` after saving so it picks up the new values.

### Step 6 — Register the webhook in Meta's dashboard

1. Go to your app's **WhatsApp → Configuration** page.
2. Under **Webhook**, click **Edit**, and enter:
   - **Callback URL**: your tunnel (or Vercel) URL + `/api/webhooks/whatsapp`
   - **Verify Token**: the exact same value you put in
     `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
3. Click **Verify and Save**. Meta immediately sends a GET request to your
   URL to confirm it — if this app's `.env.local` value doesn't match
   exactly what you typed, or the tunnel/dev server isn't running, this
   step fails. If it succeeds, your webhook route just proved itself live.
4. Still on that page, find the **Manage** (webhook fields) button and
   subscribe to the **messages** field — that's the only one this app's
   webhook route currently handles. Delivery/read-receipt updates (Meta's
   `statuses` field) are deliberately not subscribed to yet — the route
   already ignores them safely if they arrive, but nothing acts on them
   (see the comments in `src/app/api/webhooks/whatsapp/route.ts` and
   `src/lib/channels/whatsapp/webhook-payload.ts`).

### Step 7 — Send yourself a real test message

From the personal phone number you verified in Step 3, send a WhatsApp
message to the test business number shown on the API Setup page. If
everything above is wired correctly, it should arrive at your
`/api/webhooks/whatsapp` route, get processed by the same AI engine the
dashboard simulator (`/ai`, WhatsApp tab) already exercises, and a reply
should come back to your phone. This end-to-end check is Phase 5I, not
5H — it needs the code from 5F/5G *and* this setup together, so treat a
failure here as something to report back rather than something to debug
alone, since it's the first time these pieces have run against real Meta
traffic.

**A note on the temporary token:** because it expires roughly every 24
hours during this development stage, real sending (`WHATSAPP_PROVIDER`
unset) will start failing with a clear `WhatsAppConfigError`-style/Graph
API auth error once it does — just regenerate it from the API Setup page
and update `.env.local`. This is expected and normal before Phase 5L
(permanent token) is built; it is not a bug.

---

## Troubleshooting

- **"Supabase is not configured" error / Setup required screen won't go
  away**: check `.env.local` exists (not just `.env.example`), has no extra
  quotes around values, and restart `npm run dev`.
- **Login succeeds but the dashboard shows zeros everywhere**: that's
  correct if you haven't run `supabase/seed.sql` — the numbers are real
  counts from your database, not fake demo numbers.
- **Uploading a document fails with a storage/policy error**: you likely
  haven't run `supabase/migrations/0002_documents_storage.sql` yet (see
  step 2 in section 3 above) — it creates the private `documents` bucket
  the upload writes to.
- **Running `0002_documents_storage.sql` or `0003_jobs_abroad.sql` fails
  with `function public.is_owner() does not exist` (or a similar "has not
  fully run" error from `0003`'s own preflight check)**: `0001_init.sql`
  didn't fully commit against this database. The Supabase SQL Editor runs a
  pasted multi-statement script as one transaction — if anything later in
  that file hit an error, the whole thing (including the `is_owner()`
  function near the top) rolls back together, even if earlier statements
  looked fine. Fix: re-run `0001_init.sql` in full, watch the SQL Editor
  output for any red error text and resolve it, confirm it completes
  clean, then re-run `0002_documents_storage.sql` and `0003_jobs_abroad.sql`
  in order.
- **Running `supabase/seed.sql` fails with a missing column error** (e.g.
  `column "city" of relation "opportunities" does not exist`): you ran the
  seed data before `0003_jobs_abroad.sql` — run the migrations in order
  first (see section 3), then run the seed.
- **Every page — Jobs, Customers, Leads, anything — throws "No business
  exists yet. Create one first (see Settings)." even though you know
  Grandvic Tours & Travel was seeded**: this has two possible causes,
  depending on what's actually in `public.profiles` (check via **Table
  Editor → profiles**, or `select count(*) from public.profiles;` in the
  SQL Editor, which bypasses RLS and shows the true state):
  - **A profile row exists but has no role** (there's at least one row in
    `public.profiles`, just with `role_id` empty): your first Supabase Auth
    user was created *before* `seed.sql` had ever been run — the bootstrap
    trigger looks up the `owner` role in `public.roles`, which only
    `seed.sql` populates, and silently left `role_id` empty when that table
    was still empty. Fix: run
    `supabase/migrations/0004_fix_owner_role_bootstrap.sql` (see step 4
    above) — it repairs the broken profile and makes the trigger
    self-healing.
  - **`public.profiles` has zero rows at all**: your first Supabase Auth
    user was created *before you ever ran `0001_init.sql`* — the
    `profiles` table and its bootstrap trigger didn't exist yet at signup
    time, so no profile was ever inserted for that user (this is a
    different bug from the one above; `0004` only repairs a profile that
    already exists, it can't create one that was never inserted). Fix: run
    `supabase/migrations/0005_repair_missing_owner_profile.sql` (see step 6
    above) — it creates the missing profile for that user with the Owner
    role, using the roles/business rows that already exist. It refuses to
    guess and stops with an explanation instead if more than one Auth user
    has no profile.
  Either way, without a role `is_owner()` can never return true, so Row
  Level Security correctly hides every business-scoped row — including the
  business itself — from your account, regardless of whether it exists.
  Reload the app after running whichever migration applies.
- **`npm install` fails**: confirm `node -v` shows v20 or newer.
- **Port 3000 already in use**: run `npm run dev -- -p 3001` and open that
  port instead.
- **The "AI Sales Agent" tab on `/ai` shows the same "isn't configured
  yet" message as the AI Assistant tab**: both tabs share one gate —
  `OPENAI_API_KEY` — so follow section 3a first; there's no separate key
  for the Sales Agent.
- **Sending a message on the AI Sales Agent tab does nothing / says the
  conversation is in human or paused mode**: this is expected once you've
  clicked "Take over" or "Pause AI" in the side panel — by design, the AI
  does not auto-respond in those states (see section 3b). Click "Resume
  AI" to hand it back.
- **A lead created from the AI Sales Agent tab doesn't show a job
  attached**: the agent only links a job when one is currently OPEN and
  genuinely matches what the "customer" described — if your seeded data
  has no open opportunity matching the test message (e.g. no Somalia job
  currently open), that's correct behavior, not a bug; try a message that
  matches an opportunity you know is open on `/jobs`.
- **`/ai` (AI Command Centre) shows "isn't configured yet"**: `OPENAI_API_KEY`
  is missing from `.env.local` — see section 3a above. Restart `npm run dev`
  after adding it (env vars are only read at server start).
- **The AI Command Centre replies "You're sending requests too quickly"**:
  the built-in rate limit (`AI_RATE_LIMIT_PER_MINUTE`, default 10/minute per
  signed-in user — see `.env.example`) tripped. Wait a minute, or raise the
  limit in `.env.local` if you're deliberately testing it hard.
  Restart the dev server after changing it.
- **The AI Command Centre says "No business exists yet" / "isn't assigned to
  a business yet"**: this is the exact same Owner/business resolution used
  by every other page (Jobs, Customers, etc.) — see the "No business exists
  yet" entry above. Fixing that also fixes `/ai`.
- **A tool call in the AI Command Centre shows a red 🔧 chip**: that
  specific tool call failed (e.g. a record the model asked about doesn't
  exist) — the assistant still answers using whatever else it was able to
  retrieve. This is expected error handling, not a bug; check the server
  logs (or the `ai_runs` table's `output` column) if a tool is failing
  unexpectedly often.
