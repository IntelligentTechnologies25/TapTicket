# Applying the production-backend phase

Apply `supabase/migrations/202611100001_core_ticketing.sql` to a new Supabase project using the Supabase CLI (`supabase link`, then `supabase db push`) or the SQL editor. Never expose a service-role key in the browser. The migration enables RLS on every company table, installs company/role helpers and the authenticated `register_device` RPC, and includes indexes and ticket/scan/audit records.

## Important constraints

- This commit is a backend foundation, not a certification of production readiness. Review and test SQL/RLS on a staging project before live data.
- The current client signing key is a non-exportable WebCrypto Ed25519 private `CryptoKey` persisted in IndexedDB; it is device-local and not hardware-backed. Clearing browser storage loses it. Device revocation is online-only; offline checkers cannot know about a recent revocation.
- Signatures are Ed25519 over canonical JSON and tickets include a key ID. The checker only trusts cached public keys from the `devices` table; never trust a public key embedded in a QR by itself.
- Offline sync outbox currently accepts trips/tickets and trip-end events; unsupported records stay queued and are not silently discarded. Device enrollment must succeed before upload. Company route/stop/profile IDs must be valid server UUIDs and provisioned in the same company. Development sample IDs deliberately fail backend sync.
- Duplicate scans across disconnected checker devices cannot be prevented in real time. The server audit trail records scans on reconnect; offline duplicate protection is local to each checker device.
- Never use the development sample route/fare for sales. Validate fare/reference data, RLS, device enrollment, clock drift, printer behavior, and recovery procedures before real operations.

## Sync

The app syncs queued writes when online and every 15 seconds. Each trip/ticket has a stable client UUID; uploads use conflict-ignore semantics so retries don't mutate immutable ticket rows. Failed events remain in the queue with exponential backoff. RLS applies to the signed-in user for every request.

## Company provisioning

Create company, route/stops/fare, bus, Auth user, and corresponding `profiles` records through a trusted administrator/provisioning workflow. Do not enable client self-enrollment or let the public anon key create company/admin records. The backoffice provisioning workflow is not part of this phase.
