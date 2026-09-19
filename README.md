# Grandvic AI

Grandvic AI is an AI-powered business operating and sales platform. The first
business running on it is **Grandvic Tours & Travel** (Jobs Abroad / International
Recruitment, Visa Services, Tours & Safaris). The platform is built to later add
**Grandvic Motors** and other businesses without a rebuild — see
[ARCHITECTURE.md](./ARCHITECTURE.md).

> **Status: Phase 0 — Project Foundation.** This is the foundation: project
> structure, database schema, authentication, and a dashboard shell. Real
> business features (CRM, jobs, AI, WhatsApp, marketing, etc.) are built
> phase by phase — see [DEVELOPMENT_PROGRESS.md](./DEVELOPMENT_PROGRESS.md)
> for the full roadmap and what's done so far.

## Tech stack

- **Frontend/app**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4
- **Database/Auth/Storage**: Supabase (PostgreSQL + Row Level Security)
- **AI**: OpenAI API (added in Phase 3)
- **Automation**: n8n (added in Phase 6)
- **Hosting**: Vercel
- **Primary customer channel**: WhatsApp Business Platform / Cloud API (added in Phase 5)

## Quick start

Full instructions (including Windows PowerShell commands) are in
[SETUP.md](./SETUP.md). The short version:

```bash
npm install
cp .env.example .env.local   # then fill in your Supabase project's URL + anon key
npm run dev
```

Open http://localhost:3000. Until `.env.local` has real Supabase credentials,
the app shows a "Setup required" screen instead of crashing — that's expected.

## Useful commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the local dev server |
| `npm run build` | Production build (also used by Vercel) |
| `npm run start` | Run the production build locally |
| `npm run lint` | Lint the codebase |
| `npm run test` | Run unit tests once |
| `npm run test:watch` | Run unit tests in watch mode |

## Project documentation

- [SETUP.md](./SETUP.md) — step-by-step environment setup (Supabase, accounts, running locally, deploying)
- [ARCHITECTURE.md](./ARCHITECTURE.md) — how the system is designed and why
- [DEVELOPMENT_PROGRESS.md](./DEVELOPMENT_PROGRESS.md) — phase-by-phase roadmap and current status
- [CHANGELOG.md](./CHANGELOG.md) — what changed, when
- [.env.example](./.env.example) — every environment variable the app can use, and which phase needs it

## A note on how this project is built

This project is being built in phases, in the order described in
DEVELOPMENT_PROGRESS.md, on purpose. Each phase is implemented, tested, and
documented before the next one starts — WhatsApp, social publishing, and
advanced AI automation come later, once the foundation (this phase),
CRM, and jobs data are solid. If something looks "missing" right now, it's
almost certainly scheduled for a specific later phase rather than forgotten.
