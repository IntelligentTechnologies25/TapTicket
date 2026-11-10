# TapTicket

Offline-first bus ticketing PWA for Zimbabwean bus operators. The active build branch is `copilot/build-tapticket`.

## Current build stage: conductor sales foundation

This branch now includes an installable Svelte PWA shell, Supabase Auth/profile lookup, local device PIN, Dexie persistence, and an initial conductor trip/sales flow. A conductor can start a trip, choose a From/To pair and Adult/Child/Luggage, take Cash or record an EcoCash reference, calculate change, persist ticket/trip and outbox records locally, display a QR identifier, print a receipt, and reprint locally saved tickets.

**Important: this is not production-ready.** Sync is not implemented, there are no Supabase schema/RLS migrations or server reference-data provisioning yet, and the QR code is an unsigned identifier. Sample route/fare values are for development UI testing only. Do not use for real sales, cash control, passenger boarding, or ticket fraud decisions until signing, server authorization, durable sync, and tests are completed.

## Requirements and local run

- Node.js 20+
- npm

```bash
npm install
npm run dev
```

Run checks/build:

```bash
npm run check
npm run build
npm run preview
```

For authenticated access, copy `.env.example` to `.env.local`, configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, and provision an Auth user with a matching active `public.profiles` record. Never expose a Supabase service-role key in the browser. The schema/provisioning migration is not yet included.

In development only, a clearly marked Masvingo–Mvuma–Gweru sample route is seeded locally for conductor UI testing. Production builds do not invent or default company routes/fare values; use is blocked until approved reference data is available. Replace sample fares with operator-approved values.

## Offline behavior in this stage

Trip and ticket records are written to Dexie and an outbox entry in the same local transaction. IndexedDB persists on this device when the browser is offline or refreshed. **Outbox rows remain queued** because server sync is not yet implemented. The QR contains only a ticket ID/number and is not signed or checker-verifiable. Browser print works without a network when the PWA is loaded.

## PWA install and offline shell

Serve the built app over HTTPS (or localhost during development). Visit it online first and let the service worker cache assets. Android Chrome: browser menu → **Install app** / **Add to Home screen**. iPhone Safari: Share → **Add to Home Screen**. Then use DevTools Network → Offline to test local trip/ticket persistence. This step's dev sample route requires running the development build; it is not seeded into a production build.

## Next

Implement reference-data management/download and Supabase migrations/RLS, then real ordered idempotent sync, Ed25519 device keys and signed ticket QR, checker scan/void/reuse controls, handover/expenses, admin reports, and tested printer support. Each phase needs validation before operational rollout.
