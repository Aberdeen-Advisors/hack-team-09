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

Open `http://localhost:3000`. The default configuration shows the target-account queue with unverified seed data. Seed evidence earns zero points and does not support outreach; connect ZoomInfo and refresh accounts to use the complete workflow.

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

Set `OPENAI_USE_MOCK=false`, `OPENAI_API_KEY`, and optionally `OPENAI_MODEL` (default `gpt-5.4-mini`). Outreach uses the Responses API with strict structured output and validates every response with Zod. Failed or invalid responses fall back to an evidence-based template with a visible warning. With `OPENAI_USE_MOCK=true`, those same templates use ZoomInfo evidence without calling OpenAI. Offering recommendations use consistent evidence-based rules in Pursuit, Outreach, and Slack.

### ZoomInfo MCP

The default `ZOOMINFO_PROVIDER=mock` keeps the deterministic demo active. For a local live connection:

1. In ZoomInfo's API/MCP area, create an MCP App and register `http://localhost:3000/api/integrations/zoominfo/callback` as a redirect URI. Note which **client authentication** method the app is registered with.
2. Set `ZOOMINFO_PROVIDER=mcp`, `ZOOMINFO_MCP_CLIENT_ID`, `ZOOMINFO_MCP_CLIENT_SECRET`, and `ZOOMINFO_TOKEN_ENCRYPTION_KEY` in `.env.local`.
3. Start the development server, open the integration diagnostics drawer, and click **Connect ZoomInfo**.
4. Complete ZoomInfo sign-in, then click **Refresh signals**.

Dynamic client registration is not an option here: `https://mcp.zoominfo.com/oauth/register` rejects unknown callers with `Vendor with name … was not found in approved vendors`, so the client ID and secret must come from a ZoomInfo-issued MCP App.

#### Client authentication method

ZoomInfo authorizes through `https://mcp.zoominfo.com/oauth/authorize` but exchanges the code directly against Okta at `https://okta-login.zoominfo.com/oauth2/default/v1/token`. Okta accepts `client_secret_basic`, `client_secret_post`, and public PKCE clients, and rejects a mismatch against the app's registration with a single opaque message:

> The client secret supplied for a confidential client is invalid.

Because the authorize step is a permissive proxy that never validates the client ID, reaching the ZoomInfo sign-in screen does **not** confirm the credentials are correct — only the token exchange does. Set `ZOOMINFO_MCP_AUTH_METHOD` to match the registration:

| Value | Sends |
| --- | --- |
| `post` (default) | `client_id` and `client_secret` in the request body |
| `basic` | `client_id`/`client_secret` as an HTTP Basic header |
| `none` | `client_id` and PKCE only, no secret (public client) |

If connection fails, the integration drawer reports the selected method, the client ID length and prefix, the secret length, and whether stray whitespace was trimmed — enough to tell a wrong secret apart from a wrong method without exposing the secret itself.

The app connects directly to `https://mcp.zoominfo.com/mcp` with OAuth Authorization Code + PKCE. Access and refresh tokens are encrypted with AES-256-GCM before storage. Local development uses process memory when Redis is absent; production requires Upstash Redis so OAuth state, tokens, account results, and cache entries survive Vercel function cold starts.

Each batch selects up to `ZOOMINFO_REFRESH_ACCOUNT_LIMIT` canonical accounts (default five), prioritizing never-attempted accounts and then the oldest attempts. Failed attempts also rotate through the queue so they cannot block coverage. Selected companies are resolved by exact domain match before signals and contacts are retrieved. Discovery prefers `enrich_company_signals`, which replaces `enrich_intent` and `enrich_scoops`; the legacy pair remains supported. Discovery follows all MCP tool-list pages. Legacy signal calls are estimated at two company enrichments per uncached account. For the unified endpoint, consult ZoomInfo usage for actual charges; the application does not assume the old credit estimate applies. Results are cached for 24 hours, and a distributed lock prevents simultaneous refreshes from duplicating spend. **Refresh this account** targets one canonical company and bypasses its cache; it may consume enrichment credits. Partial-source failures, limited signal snapshots, and last failed refreshes are shown on the account. Unified results are matched to the requested company ID and filtered locally by resolved intent topics, score, lookback window, and relevant scoop types. Recommended contacts are resolved without paid contact enrichment, and email or phone data is never requested or stored.

### Vercel production setup

1. In the ZoomInfo MCP App, select **Authorization Code** and register `https://hack-team-09.vercel.app/api/integrations/zoominfo/callback`. Keep the localhost callback registered for development.
2. Add an Upstash Redis integration to the Vercel project. Vercel supplies `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
3. Add the Production environment variables below, then redeploy. Environment changes do not affect an existing deployment until it is redeployed.

```text
ZOOMINFO_PROVIDER=mcp
ZOOMINFO_MCP_URL=https://mcp.zoominfo.com/mcp
ZOOMINFO_MCP_CLIENT_ID=<ZoomInfo-issued client ID>
ZOOMINFO_MCP_CLIENT_SECRET=<ZoomInfo-issued client secret>
ZOOMINFO_MCP_AUTH_METHOD=post
ZOOMINFO_MCP_REDIRECT_URI=https://hack-team-09.vercel.app/api/integrations/zoominfo/callback
ZOOMINFO_TOKEN_ENCRYPTION_KEY=<base64-encoded 32-byte key>
ADMIN_PASSWORD=<strong administrator password>
ADMIN_SESSION_SECRET=<at least 32 random characters>
SIGNAL_OUTREACH_REDIS_PREFIX=signal-outreach:production:v1
```

Paste the client secret carefully: a trailing newline picked up from the Vercel dashboard is indistinguishable from a wrong secret in Okta's response. The app trims both credentials before use and reports when it had to.

Generate the encryption key locally with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Generate the session secret independently. Never commit either value. After deployment, visitors can view the shared account snapshot, but only the signed-in administrator can connect or disconnect ZoomInfo or refresh signals.

## Integrated workflow

1. Connect ZoomInfo, then refresh successive batches to research the account queue. Use **Refresh this account** for a targeted update.
2. In Prioritize, review observed signals, firmographics, and the evidence behind each score. Unresearched accounts show a research-pending state in live mode.
3. In Pursuit, review verified contacts, inferred decision roles, and the offering selected by evidence-based rules. Relationship warmth requires independently verified internal evidence; ZoomInfo contact identity alone earns no relationship points.
4. Open Outreach to generate a draft automatically. Select a verified recipient and tone, then regenerate as needed. Both AI and template drafts use observed evidence, and account-level intent is treated as a topic to validate rather than proof of a funded initiative.
5. Edit and copy the draft after review. A refresh preserves edits in the open workspace; changed evidence or recipient selection marks the draft outdated and disables copying until regeneration. Draft edits are not persisted across page reloads.
6. Review the Slack preview. No email or Slack message is sent.

Accounts with no qualifying observed trigger stay in research and cannot generate outreach. Synthetic credentials are excluded; approved Aberdeen proof points must come from the internal offering catalog.

## Data replacement

- Replace target accounts and relationships in `lib/data.ts`. Never label a relationship verified unless its source supports it.
- Replace the offering catalog in `lib/data.ts` with approved Service Offerings content. Preserve the `Offering` schema or migrate it explicitly.
- Every fact supports `verified`, `inferred`, `demo`, or `unknown` provenance. Unknown scoring inputs receive zero points.
- Synthetic credentials are never inserted into outreach and are visibly marked for replacement.

## Known limitations

- Public company identities are seeded, but company facts, signals, relationships, and proof points are demo research or synthetic unless explicitly labeled verified.
- Buyer cards use observed ZoomInfo contacts after refresh. Decision roles remain inferred; internal relationship evidence must be verified separately.
- The app previews but does not send email or Slack messages.
- No CRM synchronization, historical analytics, multi-user role management, or long-term historical reporting.
- The production account snapshot is shared by all viewers; only one administrator identity controls the ZoomInfo connection.

## Manual ZoomInfo smoke test

With MCP mode and credentials configured, verify that the diagnostics drawer reaches `ready`, the required tools are reported available, and a refresh updates up to five accounts with `verified` ZoomInfo provenance. Repeat batches until all canonical accounts have been attempted, then confirm cached results are reused. Targeted account refreshes deliberately bypass cache. Disconnect ZoomInfo and confirm another live refresh is blocked without replacing the last visible data with demo content.

## Phase two

Add approved Aberdeen credentials, Microsoft Graph warmth, a lightweight Dataverse/Fabric record, pursuit status tracking, and a production Slack notifier. Add authenticated roles and audit logs before using non-demo relationship data.

### ZoomInfo tool migration

ZoomInfo documents `enrich_company_signals` as the replacement for its old Intent and Scoops enrichments: https://gtm.ai/docs/mcp/tools/enrich-company-signals. If reconnect reports missing `enrich_intent` / `enrich_scoops`, deploy this compatibility update, then reconnect. No client-secret change is needed solely for this tool-name migration.
