<script lang="ts">
  import { onMount } from 'svelte';
  import QRCode from 'qrcode';
  import { db, type FareRoute, type FareType, type LocalProfile, type PaymentMethod, type TicketRecord, type TripRecord } from '../../lib/db';
  import { calculateFare, endLocalTrip, getActiveTrip, listTripTickets, loadConductorRoute, queuedCount, issueLocalTicket, startLocalTrip } from './sales';

  export let profile: LocalProfile;
  let route: FareRoute | undefined;
  let trip: TripRecord | undefined;
  let tickets: TicketRecord[] = [];
  let selectedFrom = '';
  let selectedTo = '';
  let fareType: FareType = 'adult';
  let payment: PaymentMethod = 'cash';
  let luggageValue = '';
  let tenderedValue = '';
  let ecoReference = '';
  let registration = '';
  let driver = '';
  let mobile = profile.phone ?? '';
  let error = '';
  let notice = '';
  let queue = 0;
  let busy = false;
  let receipt: TicketRecord | undefined;
  let qrData = '';
  let activeTab: 'sell' | 'tickets' = 'sell';

  const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  function toCents(value: string): number {
    const text = value.trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return Number.NaN;
    const [whole, fraction = ''] = text.split('.');
    return Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
  }

  $: from = route?.stops.find((stop) => stop.id === selectedFrom);
  $: to = route?.stops.find((stop) => stop.id === selectedTo);
  $: luggageCents = luggageValue ? toCents(luggageValue) : 0;
  $: amountCents = route && from && to
    ? calculateFare(route, from.id, to.id, fareType, Number.isFinite(luggageCents) ? luggageCents : 0)
    : 0;
  $: tenderedCents = tenderedValue ? toCents(tenderedValue) : 0;
  $: changeCents = payment === 'cash' && Number.isFinite(tenderedCents) ? Math.max(0, tenderedCents - amountCents) : 0;
  $: canIssue = Boolean(trip && from && to && from.id !== to.id && amountCents > 0 && !busy && (
    payment === 'cash' ? Number.isSafeInteger(tenderedCents) && tenderedCents >= amountCents : ecoReference.trim().length > 0
  ));

  async function refresh() {
    queue = await queuedCount();
    if (trip) tickets = await listTripTickets(trip.id);
  }

  onMount(async () => {
    try {
      route = await loadConductorRoute(profile.companyId);
      trip = await getActiveTrip(profile.companyId);
      await refresh();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Unable to load local trip data.';
    }
  });

  function selectStop(side: 'from' | 'to', id: string) {
    if (side === 'from') selectedFrom = id;
    else selectedTo = id;
    if (selectedFrom && selectedFrom === selectedTo) {
      if (side === 'from') selectedTo = '';
      else selectedFrom = '';
    }
  }

  async function startTrip() {
    if (!route) return;
    error = '';
    busy = true;
    try {
      trip = await startLocalTrip({
        companyId: profile.companyId,
        route,
        conductorId: profile.id,
        conductorName: profile.displayName,
        conductorMobile: mobile,
        busRegistration: registration,
        driverName: driver
      });
      notice = `${trip.tripNumber} started and saved on this device.`;
      await refresh();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not start trip.';
    } finally { busy = false; }
  }

  async function issueTicket() {
    if (!trip || !from || !to || !canIssue) return;
    error = '';
    notice = '';
    busy = true;
    try {
      const created = await issueLocalTicket({
        trip, from, to, fareType, amountCents, paymentMethod: payment,
        cashTenderedCents: payment === 'cash' ? tenderedCents : 0,
        ecocashReference: ecoReference
      });
      receipt = created;
      // QR is a receipt identifier only in this phase. Do not treat it as a verified ticket until signing/checker support is implemented.
      qrData = await QRCode.toDataURL(JSON.stringify({ ticketId: created.id, ticketNumber: created.ticketNumber }), { width: 220, margin: 1, errorCorrectionLevel: 'M' });
      notice = `Ticket ${created.ticketNumber} saved locally. It is not yet synced or cryptographically signed.`;
      selectedFrom = '';
      selectedTo = '';
      fareType = 'adult';
      payment = 'cash';
      luggageValue = '';
      tenderedValue = '';
      ecoReference = '';
      await refresh();
      setTimeout(() => window.print(), 200);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Ticket could not be issued.';
    } finally { busy = false; }
  }

  async function endTrip() {
    if (!trip || !confirm('End this trip? You will need to start a new trip to continue issuing tickets.')) return;
    await endLocalTrip(trip);
    trip = undefined;
    tickets = [];
    notice = 'Trip ended on this device.';
    await refresh();
  }

  async function reprint(ticket: TicketRecord) {
    receipt = ticket;
    qrData = await QRCode.toDataURL(JSON.stringify({ ticketId: ticket.id, ticketNumber: ticket.ticketNumber }), { width: 220, margin: 1 });
    setTimeout(() => window.print(), 150);
  }

  function setTendered(cents: number) { tenderedValue = (cents / 100).toFixed(2); }
</script>

<section class="space-y-4">
  {#if !route}
    <div class="rounded-2xl border-2 border-amber-400 bg-amber-50 p-5 text-amber-950">
      <h2 class="text-xl font-black">No route and fare data on this device</h2>
      <p class="mt-2 text-sm leading-6">Sign in online after company reference-data download is implemented. No default fare is assumed in production builds.</p>
      {#if import.meta.env.DEV}<p class="mt-2 text-xs font-bold">In development, a clearly labeled sample route may be seeded for UI testing.</p>{/if}
    </div>
  {:else if route.sampleOnly}
    <div class="rounded-xl border-2 border-amber-400 bg-amber-50 p-3 text-sm font-bold text-amber-950">Sample development route/fare data. Do not use for real sales.</div>
  {/if}

  {#if route && !trip}
    <div class="rounded-2xl bg-white p-5 shadow-sm">
      <p class="text-xs font-black uppercase tracking-wider text-tapgreen">Start a trip</p>
      <h2 class="mt-1 text-2xl font-black">{route.name}</h2>
      <div class="mt-4 grid gap-3 sm:grid-cols-2">
        <label class="text-sm font-bold">Bus registration<input bind:value={registration} class="sales-field" placeholder="e.g. AAE 1234" autocomplete="off" /></label>
        <label class="text-sm font-bold">Driver name<input bind:value={driver} class="sales-field" placeholder="Driver" autocomplete="name" /></label>
        <label class="text-sm font-bold">Conductor mobile<input bind:value={mobile} class="sales-field" inputmode="tel" placeholder="+263…" /></label>
      </div>
      <p class="mt-3 text-sm text-slate-600">Conductor: <b>{profile.displayName}</b></p>
      <button class="touch-action mt-4 w-full bg-navy text-white" disabled={busy} onclick={startTrip}>Start trip</button>
    </div>
  {:else if route && trip}
    <div class="rounded-2xl bg-white p-4 shadow-sm">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div><p class="text-xs font-black uppercase tracking-wider text-slate-500">Active trip</p><h2 class="text-xl font-black">{trip.tripNumber}</h2><p class="text-sm text-slate-600">{trip.busRegistration} · {trip.routeName}</p></div>
        <button class="min-h-11 rounded-xl border-2 border-slate-300 px-3 text-sm font-bold" onclick={endTrip}>End trip</button>
      </div>
      <div class="mt-4 grid grid-cols-2 gap-2">
        <button class={`min-h-12 rounded-xl font-black ${activeTab === 'sell' ? 'bg-navy text-white' : 'bg-slate-100'}`} onclick={() => activeTab = 'sell'}>Sell ticket</button>
        <button class={`min-h-12 rounded-xl font-black ${activeTab === 'tickets' ? 'bg-navy text-white' : 'bg-slate-100'}`} onclick={() => activeTab = 'tickets'}>Tickets ({tickets.length})</button>
      </div>
    </div>

    {#if activeTab === 'sell'}
      <div class="rounded-2xl bg-white p-5 shadow-sm">
        <h3 class="text-xl font-black">Passenger journey</h3>
        <fieldset class="mt-4"><legend class="mb-2 text-sm font-black">From</legend><div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {#each route.stops as stop}<button class={`min-h-14 rounded-xl border-2 px-2 font-bold ${selectedFrom === stop.id ? 'border-blue-800 bg-blue-800 text-white' : 'border-slate-300 bg-white'}`} onclick={() => selectStop('from', stop.id)}>{stop.name}</button>{/each}
        </div></fieldset>
        <fieldset class="mt-4"><legend class="mb-2 text-sm font-black">To</legend><div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {#each route.stops as stop}<button class={`min-h-14 rounded-xl border-2 px-2 font-bold ${selectedTo === stop.id ? 'border-blue-800 bg-blue-800 text-white' : 'border-slate-300 bg-white'}`} onclick={() => selectStop('to', stop.id)}>{stop.name}</button>{/each}
        </div></fieldset>
        <fieldset class="mt-4"><legend class="mb-2 text-sm font-black">Fare type</legend><div class="grid grid-cols-3 gap-2">
          {#each ['adult', 'child', 'luggage'] as item}<button class={`min-h-12 rounded-xl border-2 font-bold capitalize ${fareType === item ? 'border-navy bg-navy text-white' : 'border-slate-300 bg-white'}`} onclick={() => fareType = item as FareType}>{item}</button>{/each}
        </div></fieldset>
        {#if fareType === 'luggage'}<label class="mt-4 block text-sm font-bold">Luggage fee (USD)<input bind:value={luggageValue} class="sales-field" inputmode="decimal" placeholder="0.00" /></label>{/if}
        <div class="mt-4 rounded-2xl bg-slate-100 p-4"><p class="text-xs font-black uppercase text-slate-500">Fare due · USD</p><p class="text-4xl font-black">{money(amountCents)}</p></div>
        <fieldset class="mt-4"><legend class="mb-2 text-sm font-black">Payment</legend><div class="grid grid-cols-2 gap-2">
          <button class={`min-h-14 rounded-xl border-2 text-lg font-black ${payment === 'cash' ? 'border-emerald-800 bg-emerald-800 text-white' : 'border-slate-300'}`} onclick={() => payment = 'cash'}>Cash</button>
          <button class={`min-h-14 rounded-xl border-2 text-lg font-black ${payment === 'ecocash' ? 'border-emerald-800 bg-emerald-800 text-white' : 'border-slate-300'}`} onclick={() => payment = 'ecocash'}>EcoCash</button>
        </div></fieldset>
        {#if payment === 'cash'}
          <label class="mt-4 block text-sm font-bold">Cash tendered (USD)<input bind:value={tenderedValue} class="sales-field" inputmode="decimal" placeholder="0.00" /></label>
          <div class="mt-2 grid grid-cols-3 gap-2">{#each [100, 500, 1000, 2000, 5000] as cents}<button class="min-h-12 rounded-xl border border-slate-300 bg-white font-black" onclick={() => setTendered(cents)}>${cents / 100}</button>{/each}<button class="min-h-12 rounded-xl border border-slate-300 bg-white font-black" onclick={() => setTendered(amountCents)}>Exact</button></div>
          <p class="mt-3 text-xl font-black">CHANGE: {money(changeCents)}</p>
        {:else}
          <label class="mt-4 block text-sm font-bold">EcoCash reference<input bind:value={ecoReference} class="sales-field" autocomplete="off" placeholder="Type transaction reference" /></label>
        {/if}
        <button class="touch-action mt-5 w-full bg-tapgreen text-white disabled:opacity-40" disabled={!canIssue} onclick={issueTicket}>{busy ? 'Saving…' : 'Issue ticket & print'}</button>
      </div>
    {:else}
      <div class="rounded-2xl bg-white p-5 shadow-sm"><h3 class="text-xl font-black">Tickets on this device</h3>
        {#if tickets.length}<div class="mt-3 space-y-2">{#each [...tickets].reverse() as ticket}<div class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3"><div><p class="font-black">{ticket.ticketNumber}</p><p class="text-sm">{ticket.fromStopName} → {ticket.toStopName} · {money(ticket.amountCents)} · {ticket.paymentMethod.toUpperCase()}</p></div><button class="min-h-11 rounded-lg border px-3 font-bold" onclick={() => reprint(ticket)}>Reprint</button></div>{/each}</div>{:else}<p class="mt-3 text-slate-600">No tickets issued on this trip yet.</p>{/if}
      </div>
    {/if}
  {/if}

  {#if error}<p role="alert" class="rounded-xl border border-red-300 bg-red-50 p-3 font-bold text-red-900">{error}</p>{/if}
  {#if notice}<p role="status" class="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm font-bold text-emerald-900">{notice}</p>{/if}
  <div class="rounded-xl bg-white px-4 py-3 text-sm font-bold text-slate-700">{queue} item(s) waiting locally. This step does not upload to Supabase.</div>

  {#if receipt}
    <article class="print-receipt">
      <header class="text-center"><h1>{profile.displayName}</h1><p class="font-bold">BUS TICKET</p></header><hr />
      <p><b>Ticket:</b> {receipt.ticketNumber}</p><p><b>Device:</b> {receipt.deviceId}</p><p><b>Date:</b> {new Date(receipt.createdAt).toLocaleString()}</p>
      <p><b>Trip:</b> {receipt.tripNumber}</p><p><b>Bus:</b> {receipt.busRegistration}</p><p><b>From:</b> {receipt.fromStopName}</p><p><b>To:</b> {receipt.toStopName}</p>
      <p><b>Fare:</b> {receipt.fareType.toUpperCase()}</p><p><b>Amount:</b> {money(receipt.amountCents)}</p><p><b>Payment:</b> {receipt.paymentMethod.toUpperCase()}</p>
      {#if receipt.paymentMethod === 'cash'}<p><b>Tendered:</b> {money(receipt.cashTenderedCents ?? 0)}</p><p><b>Change:</b> {money(receipt.changeCents)}</p>{:else}<p><b>EcoCash ref:</b> {receipt.ecocashReference}</p>{/if}
      <p><b>Driver:</b> {receipt.driverName}</p><p><b>Conductor:</b> {receipt.conductorName}</p><p><b>Mobile:</b> {receipt.conductorMobile}</p>
      {#if qrData}<img class="qr" src={qrData} alt="Ticket identifier QR; not yet signed" />{/if}
      <p class="text-center font-bold">Thank you. Travel safely!</p><p class="mt-2 text-center text-xs">NOT YET SIGNED · NOT FOR CHECKER VALIDATION</p>
    </article>
  {/if}
</section>

<style>
  :global(.sales-field) { display:block; width:100%; min-height:3.5rem; margin-top:.4rem; border:2px solid #cbd5e1; border-radius:.75rem; background:#fff; padding:.75rem 1rem; font-size:1.125rem; color:#102a43; }
  :global(.touch-action) { min-height:3.75rem; border-radius:.85rem; padding:.75rem 1rem; font-size:1.125rem; font-weight:900; }
  .print-receipt { position:fixed; left:-10000px; top:0; width:58mm; padding:2mm; background:#fff; color:#000; font:10pt Arial,sans-serif; }
  .print-receipt hr { border:0; border-top:1px dashed #000; margin:.5rem 0; }
  .qr { display:block; width:36mm; height:36mm; margin:.6rem auto; }
  @media print {
    :global(body *) { visibility:hidden !important; }
    .print-receipt, .print-receipt * { visibility:visible !important; }
    .print-receipt { position:absolute; left:0; top:0; width:58mm; padding:2mm; }
    @page { size:58mm auto; margin:0; }
  }
</style>
