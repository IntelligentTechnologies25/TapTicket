<script lang="ts">
  import { validateTicketToken } from '../../features/checker/checker';

  let token = '';
  let result: { valid: boolean; reason: string; payload?: Record<string, unknown> } | null = null;
  let busy = false;

  async function validate() {
    busy = true;
    result = null;
    try {
      result = await validateTicketToken(token.trim());
    } finally {
      busy = false;
    }
  }
</script>

<section class="rounded-2xl bg-white p-5 shadow-sm sm:p-7">
  <p class="text-sm font-black uppercase tracking-wider text-tapgreen">Checker mode</p>
  <h2 class="mt-1 text-2xl font-black">Validate ticket</h2>
  <p class="mt-2 text-slate-600">Scan or paste the secure token displayed on the ticket. The checker verifies the ticket locally on this device.</p>
  <textarea bind:value={token} rows="5" class="mt-4 min-h-[120px] w-full rounded-xl border-2 border-slate-300 px-4 py-3 text-sm" placeholder="Paste generated ticket token here" />
  <button class="mt-4 min-h-12 w-full rounded-xl bg-navy px-5 text-lg font-black text-white" disabled={!token.trim() || busy} onclick={validate}>{busy ? 'Checking…' : 'Validate ticket'}</button>

  {#if result}
    <div class={`mt-4 rounded-xl border p-4 ${result.valid ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-red-300 bg-red-50 text-red-900'}`}>
      <p class="font-black uppercase">{result.valid ? 'Valid ticket' : 'Rejected'}</p>
      <p class="mt-2 text-sm">{result.reason}</p>
      {#if result.payload}
        <dl class="mt-3 text-sm leading-6">
          <div><dt class="font-black inline">Ticket:</dt> <dd class="inline">{result.payload.ticketNumber}</dd></div>
          <div><dt class="font-black inline">Trip:</dt> <dd class="inline">{result.payload.tripNumber}</dd></div>
          <div><dt class="font-black inline">From:</dt> <dd class="inline">{result.payload.from}</dd></div>
          <div><dt class="font-black inline">To:</dt> <dd class="inline">{result.payload.to}</dd></div>
          <div><dt class="font-black inline">Conductor:</dt> <dd class="inline">{result.payload.conductor}</dd></div>
        </dl>
      {/if}
    </div>
  {/if}
</section>
