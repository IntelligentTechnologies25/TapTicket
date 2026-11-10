<script lang="ts">
  import { onMount } from 'svelte';
  import QRCode from 'qrcode';
  import { db, type LocalProfile, type TicketRecord } from '../../lib/db';
  import { encodeSignedToken, getSigningKey, signTicketPayload } from '../../lib/crypto';

  export let profile: LocalProfile;
  let route = 'Masvingo – Gweru';
  let tripNumber = 'TRIP-1102-0001';
  let preview = '';
  let notice = '';
  let error = '';

  async function generateDemoTicket() {
    try {
      const payload = {
        ticketId: crypto.randomUUID(),
        ticketNumber: `DEV-${Date.now().toString().slice(-6)}`,
        tripNumber,
        fromStopName: 'Masvingo',
        toStopName: 'Gweru',
        amountCents: 1000,
        paymentMethod: 'cash',
        conductor: profile.displayName,
        busRegistration: 'AAE 1234',
        createdAt: Date.now()
      };
      const signature = await signTicketPayload(payload);
      const token = encodeSignedToken(payload, signature);
      preview = await QRCode.toDataURL(token, { width: 220, margin: 1, errorCorrectionLevel: 'M' });
      notice = 'Demo signed ticket created. The token is signed with a locally generated device key.';
      error = '';
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not generate signed demo ticket.';
    }
  }

  onMount(async () => {
    const ticket = await db.tickets.orderBy('createdAt').reverse().first();
    if (ticket) {
      preview = await QRCode.toDataURL(
        encodeSignedToken(
          {
            ticketId: ticket.id,
            ticketNumber: ticket.ticketNumber,
            tripNumber: ticket.tripNumber,
            fromStopName: ticket.fromStopName,
            toStopName: ticket.toStopName,
            amountCents: ticket.amountCents,
            paymentMethod: ticket.paymentMethod,
            conductor: ticket.conductorName,
            busRegistration: ticket.busRegistration,
            createdAt: ticket.createdAt
          },
          await signTicketPayload({
            ticketId: ticket.id,
            ticketNumber: ticket.ticketNumber,
            tripNumber: ticket.tripNumber,
            fromStopName: ticket.fromStopName,
            toStopName: ticket.toStopName,
            amountCents: ticket.amountCents,
            paymentMethod: ticket.paymentMethod,
            conductor: ticket.conductorName,
            busRegistration: ticket.busRegistration,
            createdAt: ticket.createdAt
          })
        ),
        { width: 220, margin: 1, errorCorrectionLevel: 'M' }
      );
      notice = 'Most recent local ticket shown as a signed demo token.';
      return;
    }
    await generateDemoTicket();
  });
</script>

<section class="space-y-4">
  <div class="rounded-2xl bg-white p-5 shadow-sm">
    <p class="text-xs font-black uppercase tracking-wider text-tapgreen">Checker</p>
    <h2 class="mt-1 text-2xl font-black">Ticket verification</h2>
    <p class="mt-2 text-slate-600">Use a locally generated signed token to validate a ticket before boarding.</p>
    <button class="mt-4 min-h-12 w-full rounded-xl bg-navy px-5 text-lg font-black text-white" onclick={generateDemoTicket}>Generate demo signed QR</button>
    {#if preview}
      <img src={preview} alt="Signed ticket QR" class="mt-4 mx-auto block h-44 w-44 rounded-xl border-2 border-slate-200 p-2" />
    {/if}
    {#if notice}<p class="mt-3 rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm font-bold text-emerald-900">{notice}</p>{/if}
    {#if error}<p class="mt-3 rounded-xl border border-red-300 bg-red-50 p-3 text-sm font-bold text-red-900">{error}</p>{/if}
  </div>
</section>
