# Standalone Edge Functions for the Supabase Dashboard

These generated files contain the same handlers and shared runtime as `supabase/functions/`, with all local imports resolved. No npm packages or secrets are embedded. Paste one file's entire contents into the Dashboard editor's `index.ts` for the corresponding function name, then deploy with **Verify JWT disabled**. Application-level authentication remains mandatory inside each handler.

- `telegram-auth.ts` → function `telegram-auth`
- `crm.ts` → function `crm`
- `telegram-webhook.ts` → function `telegram-webhook`

Target for the current staging phase: `wepogbvijpvyvyfzxzeo`. Do not deploy to the production project during this phase. Configure project Secrets in Supabase, never in these files or GitHub. A different staging bot token is required.

The files are emitted JavaScript stored as `.ts` for the editor's default filename. `@ts-nocheck` applies only to generated output; canonical sources receive TypeScript and Deno checks. The same Edge handler tests run against both canonical modules and the standalone artifacts. No secrets are needed to generate/test the files. `npm run check` verifies that the committed bundles match their sources.

Rebuild after changing any canonical function:

```sh
node scripts/build-dashboard.mjs
```

`staging-telegram-setup.ts` is a temporary staging-only administrative helper. It requires the stored worker Authorization value, refuses all projects except wepogbvijpvyvyfzxzeo, verifies the exact test bot username and never accepts a caller-supplied destination. In Dashboard Test, POST `{"action":"configure"}` with the Authorization header from the private secret store. This configures the fixed staging webhook using Secrets without exposing the bot token. Delete the deployed helper after setup if no longer needed. Do not deploy this helper to production.
