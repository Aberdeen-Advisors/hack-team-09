# Signal-to-Outreach

Signal-to-Outreach is a mock-first hackathon MVP for Aberdeen Advisors. It turns a buying signal into a ranked pursuit, explainable ICP score, likely buyer map, TEAM/4E offering recommendation, editable outreach email, and Slack alert preview.

## Architecture

- Next.js 16 App Router, React, TypeScript, Tailwind CSS, Zod, Vitest, Playwright, and axe-core
- Local typed seed data; no database or authentication
- Dedicated rules configuration in `lib/scoring-config.ts`
- Interchangeable signal, offering, outreach, relationship, and Slack boundaries
- Server-only OpenAI and ZoomInfo clients with timeouts and deterministic fallback
- Three-stage guided workspace: Prioritize → Pursuit → Outreach

## Local setup

Install Node.js 24 LTS and npm, then run:

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. The default configuration is fully functional in demo mode.

Validation commands:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

The end-to-end suite uses installed Microsoft Edge, starts a local server on port 4317 when needed, checks the complete guided journey, runs axe-core, and captures laptop and narrow-layout screenshots.

## Environment variables

See `.env.example`. All secrets remain server-side.

### OpenAI

Set `OPENAI_USE_MOCK=false`, `OPENAI_API_KEY`, and optionally `OPENAI_MODEL` (default `gpt-5.4-mini`). The app uses the Responses API with strict structured output and validates every response with Zod. Failed or invalid responses fall back to the deterministic mock provider.

### ZoomInfo

Set `ZOOMINFO_USE_MOCK=false` and provide the OAuth and API variables. Because licensed endpoint paths and payloads vary, `ZOOMINFO_SIGNALS_PATH` is required and `normalizeZoomInfoSignal` is the isolated mapper. Update that mapper to match the licensed response; the app never invents an undocumented endpoint.

## Demo script

1. Open the dashboard and point out Demo Mode plus the ranked account queue.
2. Click **Refresh signals**. The app refreshes 19 canonical companies from 20 rows and reports the duplicate suppression.
3. Open the top-ranked account and review Why Now plus the explainable score.
4. Click **Map buyer and offering** to show relationship warmth, assumptions, TEAM stage, and 4E fit.
5. Click **Draft outreach**, select a tone, regenerate, edit, and copy the draft.
6. Show the Slack preview and integration diagnostics drawer.
7. Select “Marriott Vacations Worldwide Corporation” to demonstrate duplicate detection and canonical grouping.

## Data replacement

- Replace target accounts and relationships in `lib/data.ts`. Never label a relationship verified unless its source supports it.
- Replace the offering catalog in `lib/data.ts` with approved Service Offerings content. Preserve the `Offering` schema or migrate it explicitly.
- Every fact supports `verified`, `inferred`, `demo`, or `unknown` provenance. Unknown scoring inputs receive zero points.
- Synthetic credentials are never inserted into outreach and are visibly marked for replacement.

## Known limitations

- Public company identities are seeded, but company facts, signals, relationships, and proof points are demo research or synthetic unless explicitly labeled verified.
- Buyer cards represent role hypotheses, not verified named contacts.
- The app previews but does not send email or Slack messages.
- No CRM synchronization, historical analytics, role management, or persistent system of record.

## Phase two

Connect the licensed ZoomInfo mapper, approved Aberdeen credentials, Microsoft Graph warmth, a lightweight Dataverse/Fabric record, pursuit status tracking, and a production Slack notifier. Add authenticated roles and audit logs before using non-demo relationship data.
