<script lang="ts">
  import { onMount } from 'svelte';
  import { db, type LocalProfile } from '../../lib/db';

  export let profile: LocalProfile;
  let queued = 0;
  let tickets = 0;
  let trips = 0;

  async function refresh() {
    queued = await db.outbox.where('state').equals('queued').count();
    tickets = await db.tickets.count();
    trips = await db.trips.count();
  }

  onMount(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  });
</script>

<section class="rounded-2xl bg-white p-5 shadow-sm sm:p-7">
  <p class="text-sm font-black uppercase tracking-wider text-tapgreen">Admin</p>
  <h2 class="mt-1 text-2xl font-black">Operations overview</h2>
  <div class="mt-4 grid gap-3 sm:grid-cols-3">
    <div class="rounded-xl bg-slate-100 p-4">
      <p class="text-xs font-black uppercase tracking-wider text-slate-500">Trips</p>
      <p class="mt-2 text-3xl font-black">{trips}</p>
    </div>
    <div class="rounded-xl bg-slate-100 p-4">
      <p class="text-xs font-black uppercase tracking-wider text-slate-500">Tickets</p>
      <p class="mt-2 text-3xl font-black">{tickets}</p>
    </div>
    <div class="rounded-xl bg-slate-100 p-4">
      <p class="text-xs font-black uppercase tracking-wider text-slate-500">Queued</p>
      <p class="mt-2 text-3xl font-black">{queued}</p>
    </div>
  </div>
  <p class="mt-4 text-sm leading-6 text-slate-600">
    Signed-in as <b>{profile.displayName}</b>. This admin view is a local operations dashboard; production reporting and reconciliation still require cloud-backed reconciliation and role-specific authorisation.
  </p>
</section>
