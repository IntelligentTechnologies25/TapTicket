# TapTicket backend + sync phase

This branch now contains an initial Supabase migration, authenticated device enrollment endpoint, non-exportable Ed25519 device keys, server-side ticket-ingest/scan validation foundations, and retryable local outbox processing.

## Setup
1. Review and apply migrations to a fresh staging Supabase project using the Supabase CLI.
2. Deploy Edge Functions `register-device`, `ingest-ticket`, and `validate-ticket` (the ticket ingest endpoint is still required before enabling live sales; see status below).
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; never put service-role credentials in client env or source.
4. Provision company, users/profiles, routes/stops/fares, and buses using trusted administrative tooling.

## Security status / limitations

This is not yet a production deployment. Edge function and migration code must be reviewed and tested in a staging project. Browser Ed25519 CryptoKey storage is non-exportable but not hardware-backed; browser storage can be cleared or compromised. Online validation checks the server ledger and atomically claims a ticket. Offline validation can only verify a recently cached trusted key and cannot establish current revocation, server void state, or cross-device replay status; show offline results as provisional and reconcile them later. The server currently checks synced ledger membership on scan, so tickets created while offline are not accepted online until their earlier trip/ticket outbox entries sync successfully.

The outbox retains failed/unsupported events with retry metadata; it never silently deletes a failed event. Review queued failures and DLQ/recovery policy before live operation.
