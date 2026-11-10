<script lang="ts">
  import { validateTicketToken } from '../../features/checker/checker';
  import type { LocalProfile } from '../../lib/db';
  export let profile: LocalProfile;
  let token = '';
  let result: { valid: boolean; reason: string; payload?: Record<string, unknown> } | null = null;
  let busy = false;
  async function validate() {
    busy = true;
    result = null;
    try { result = await validateTicketToken(token.trim(), profile.id); }
    catch (cause) { result = { valid: false, reason: cause instanceof Error ? cause.message : 'Validation failed.' }; }
    finally { busy = false; }
  }
</script>
<section class="rounded-2xl bg-white p-5 shadow-sm sm:p-7">
  <p class="text-sm font-black uppercase tracking-wider text-tapgreen">Checker mode</p>
  <h2 class="mt-1 text-2xl font-black">Validate signed ticket</h2>
  <p class="mt-2 text-slate-600">Paste the ticket QR data. The signature is checked against the trusted company device key cache, not a key supplied by the ticket.</p>
  <textarea bind:value={token} rows="5" class="mt-4 min-h-[120px] w-full rounded-xl border-2 border-slate-300 px-4 py-3 text-sm" placeholder="Paste signed QR payload" />
  <button class="mt-4 min-h-12 w-full rounded-xl bg-navy px-5 text-lg font-black text-white" disabled={!token.trim() || busy} onclick={validate}>{busy ? 'Checking…' : 'Validate and record scan'}</button>
  {#if result}<div role="status" class={`mt-4 rounded-xl border p-4 ${result.valid ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-red-300 bg-red-50 text-red-900'}`}><p class="font-black uppercase">{result.valid ? 'Valid signature' : 'Rejected'}</p><p class="mt-2 text-sm">{result.reason}</p>{#if result.payload}<pre class="mt-3 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(result.payload, null, 2)}</pre>{/if}</div>{/if}
</section>
