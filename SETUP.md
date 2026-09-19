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

In the Supabase dashboard, go to **SQL Editor → New query**, then:

1. Open `supabase/migrations/0001_init.sql` in VS Code, copy its entire
   contents, paste into the SQL Editor, and click **Run**. This creates
   every table, security rule, and helper function the app needs.
2. (Recommended for trying out the dashboard) Open `supabase/seed.sql`,
   copy its contents, paste into a new SQL Editor query, and click **Run**.
   This adds Grandvic Tours & Travel as a business plus clearly-labeled
   `[DEMO]` customers, leads, and content so the dashboard isn't empty on
   your first login. Every seeded record is fictional — safe to delete
   anytime from the Table Editor.
3. **(Phase 1)** Open `supabase/migrations/0002_documents_storage.sql`,
   copy its entire contents, paste into a new SQL Editor query, and click
   **Run**. This creates a private `documents` Storage bucket and the
   security rules that scope every file to the business that uploaded it —
   required before the Documents screen can accept an upload. If you
   already ran this once, running it again is safe (it's written to be
   idempotent).

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

You don't need any of these yet — they're listed here so you know what to
plan for. Full setup steps will be written when each phase is actually
built (per the phased build plan in DEVELOPMENT_PROGRESS.md), and each
integration will be verified against its official, current documentation
before being wired up — nothing here is assumed to still be accurate by
the time we reach it.

| Phase | What's needed | Where to get it |
| --- | --- | --- |
| 3 — AI Core | OpenAI API key | https://platform.openai.com/api-keys |
| 5 — WhatsApp | Meta Business account + WhatsApp Business Platform app | https://developers.facebook.com |
| 6 — Automation | n8n instance (self-hosted or n8n Cloud) | https://n8n.io |
| 8 — Social Publishing | Facebook/Instagram (Meta), TikTok, LinkedIn developer apps | Each platform's developer portal |
| 9+ — Payments | A payment provider (TBD together with you) | To be decided — see ARCHITECTURE.md "Payments" |

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
  step 3 in section 3 above) — it creates the private `documents` bucket
  the upload writes to.
- **Running `0002_documents_storage.sql` fails with `function
  public.is_owner() does not exist`**: `0001_init.sql` didn't fully commit
  against this database. The Supabase SQL Editor runs a pasted
  multi-statement script as one transaction — if anything later in that
  ~900-line file hit an error, the whole thing (including the `is_owner()`
  function near the top) rolls back together, even if earlier statements
  looked fine. Fix: re-run `0001_init.sql` in full, watch the SQL Editor
  output for any red error text and resolve it, confirm it completes
  clean, then run `0002_documents_storage.sql` again.
- **`npm install` fails**: confirm `node -v` shows v20 or newer.
- **Port 3000 already in use**: run `npm run dev -- -p 3001` and open that
  port instead.
