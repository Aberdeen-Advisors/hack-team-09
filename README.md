# Signal-to-Outreach

Signal-to-Outreach is a mock-first hackathon MVP for Aberdeen Advisors. It turns a buying signal into a ranked pursuit, explainable ICP score, likely buyer map, TEAM/4E offering recommendation, editable outreach email, and Slack alert preview.

## Architecture

- Next.js 16 App Router, React, TypeScript, Tailwind CSS, Zod, Vitest, Playwright, and axe-core
- Typed seed data with an Upstash Redis production snapshot and a single shared administrator session
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

### ZoomInfo MCP

The default `ZOOMINFO_PROVIDER=mock` keeps the deterministic demo active. For a local live connection:

1. In ZoomInfo's API/MCP area, create an MCP App and register `http://localhost:3000/api/integrations/zoominfo/callback` as a redirect URI.
2. Set `ZOOMINFO_PROVIDER=mcp`, `ZOOMINFO_MCP_CLIENT_ID`, `ZOOMINFO_MCP_CLIENT_SECRET`, `ZOOMINFO_TOKEN_ENCRYPTION_KEY`, `ADMIN_PASSWORD`, and `ADMIN_SESSION_SECRET` in `.env.local`.
3. Start the development server, open the integration diagnostics drawer, sign in as the administrator, and click **Connect ZoomInfo**.
4. Complete ZoomInfo sign-in, then click **Refresh signals**.

The app connects directly to `https://mcp.zoominfo.com/mcp` with OAuth Authorization Code + PKCE. Access and refresh tokens are encrypted with AES-256-GCM before storage. Local development uses process memory when Redis is absent; production requires Upstash Redis so OAuth state, tokens, account results, and cache entries survive Vercel function cold starts.

Each uncached refresh resolves all canonical company identities with free search, then enriches Intent and Scoops for at most five accounts. This can consume up to ten company-enrichment credits. Results are cached for 24 hours, and a distributed lock prevents simultaneous refreshes from duplicating spend. Recommended contacts are resolved without paid contact enrichment, and email or phone data is never requested or stored.

### Vercel production setup

1. In the ZoomInfo MCP App, select **Authorization Code** and register `https://hack-team-09.vercel.app/api/integrations/zoominfo/callback`. Keep the localhost callback registered for development.
2. Add an Upstash Redis integration to the Vercel project. Vercel supplies `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
3. Add the Production environment variables below, then redeploy. Environment changes do not affect an existing deployment until it is redeployed.

```text
ZOOMINFO_PROVIDER=mcp
ZOOMINFO_MCP_URL=https://mcp.zoominfo.com/mcp
ZOOMINFO_MCP_CLIENT_ID=<ZoomInfo-issued client ID>
ZOOMINFO_MCP_CLIENT_SECRET=<ZoomInfo-issued client secret>
ZOOMINFO_MCP_REDIRECT_URI=https://hack-team-09.vercel.app/api/integrations/zoominfo/callback
ZOOMINFO_TOKEN_ENCRYPTION_KEY=<base64-encoded 32-byte key>
ADMIN_PASSWORD=<strong administrator password>
ADMIN_SESSION_SECRET=<at least 32 random characters>
SIGNAL_OUTREACH_REDIS_PREFIX=signal-outreach:production:v1
```

Generate the encryption key locally with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Generate the session secret independently. Never commit either value. After deployment, visitors can view the shared account snapshot, but only the signed-in administrator can connect or disconnect ZoomInfo or refresh signals.

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
- No CRM synchronization, historical analytics, multi-user role management, or long-term historical reporting.
- The production account snapshot is shared by all viewers; only one administrator identity controls the ZoomInfo connection.

## Manual ZoomInfo smoke test

With MCP mode and credentials configured, verify that the diagnostics drawer reaches `ready`, the required tools are reported available, and a refresh updates up to five accounts with `verified` ZoomInfo provenance. Repeat the refresh and confirm the toast reports cached accounts and zero estimated credits. Disconnect ZoomInfo and confirm another live refresh is blocked without replacing the last visible data with demo content.

## Phase two

Connect the licensed ZoomInfo mapper, approved Aberdeen credentials, Microsoft Graph warmth, a lightweight Dataverse/Fabric record, pursuit status tracking, and a production Slack notifier. Add authenticated roles and audit logs before using non-demo relationship data.
