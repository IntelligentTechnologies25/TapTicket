# TapTicket

TapTicket is an offline-first ticketing PWA for Zimbabwean bus operators. The repository is being built in runnable, testable phases. The current branch contains **Step 1 only**: the installable app shell, local Dexie storage/outbox foundation, Supabase email/phone + account-password sign-in, company-profile lookup, and a PBKDF2-based local device PIN lock.

> **Not ready for real ticket sales.** Ticket sales, signed ticket QR, checker validation, real outbox synchronization, production account provisioning, and reporting are not implemented yet. Do not rely on this step for revenue, passenger boarding, or security decisions.

## Requirements

- Node.js 20 LTS or newer
- npm
- A Supabase project for authenticated sign-in; optional for building the shell

## Run locally

1. Clone the repository and check out the build branch:

   ```bash
   git clone https://github.com/IntelligentTechnologies25/TapTicket.git
   cd TapTicket
   git checkout copilot/build-tapticket
   ```

2. Install packages and launch the development server:

   ```bash
   npm install
   npm run dev -- --host 0.0.0.0
   ```

3. Open the Vite URL printed in your terminal, usually `http://localhost:5173`.

4. Check types and build:

   ```bash
   npm run check
   npm run build
   npm run preview
   ```

## Supabase configuration

Create a Supabase project. Copy `.env.example` to `.env.local` and set:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY
```

Restart Vite after changing environment variables. Do not put a service-role key in a `VITE_` variable or in client code. Sign-in requires an existing Supabase Auth user and a corresponding active row in `public.profiles`. Database migrations and safe company provisioning are part of the backend implementation phase and are not included yet.

Sign-in uses the Supabase account password. After successful sign-in, the user sets a separate 4–6 digit device PIN. The PIN hash is derived with PBKDF2-SHA-256 and a random salt in WebCrypto. This is a local lock only; a short PIN is not equivalent to strong account authentication or device encryption.

## Offline / PWA checks

The production build includes a service worker that precaches the generated app assets; it does not depend on external CDN libraries. For an actual PWA install, serve the built app over HTTPS (or localhost during development).

1. Build and preview with `npm run build && npm run preview`.
2. Open the preview in Chrome on Android, or Safari on iOS, while online.
3. Install from the browser menu (Chrome: **Install app** / **Add to Home screen**; Safari: **Share → Add to Home Screen**).
4. Reload once while online to let the service worker cache the shell. Then use DevTools Network → Offline to confirm the cached shell loads.
5. The current step does not support offline ticket sales or data sync. Offline PIN unlock only unlocks the shell and cached profile.

## Deployment

Cloudflare Pages can use the following build settings:

- Build command: `npm run build`
- Output directory: `dist`
- Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

Configure the variables in the Cloudflare Pages project and redeploy. A production rollout also needs the database migrations, provisioning flow, tested sync/RLS, and complete operational feature set before real use.

## Current implementation scope

- Vite + Svelte + Tailwind, responsive touch-first shell
- PWA manifest, generated icons, service-worker asset precaching
- Dexie stores for cached profiles, versioned references, settings, and an outbox queue
- Supabase Auth sign-in and active company-profile lookup (requires provisioned backend data)
- Local device PIN setup and verification using WebCrypto PBKDF2
- Online/offline status and locally queued item count

## Next implementation phases

Continue with conductor trip and ticket sales, then manifest/expenses/handover, Supabase migrations and idempotent sync, signed QR checker, backoffice, printer integration, and audit/anomaly reporting. Each phase must be built and checked before it is represented as production-ready.
