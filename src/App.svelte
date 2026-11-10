<script lang="ts">
  import { onMount } from 'svelte';
  import { db, type LocalProfile } from './lib/db';
  import { configureDevicePin, getCachedProfile, signIn, signOut, verifyDevicePin } from './lib/auth';
  import { supabase, supabaseEnabled } from './lib/supabase';
  import ConductorSales from './features/conductor/ConductorSales.svelte';
  import CheckerPanel from './features/checker/CheckerPanel.svelte';
  import AdminPanel from './features/admin/AdminPanel.svelte';

  type Screen = 'checking' | 'login' | 'set-pin' | 'unlock' | 'app';
  let screen: Screen = 'checking';
  let profile: LocalProfile | undefined;
  let identifier = '';
  let password = '';
  let pin = '';
  let pinConfirm = '';
  let error = '';
  let online = typeof navigator === 'undefined' ? false : navigator.onLine;
  let queued = 0;
  let busy = false;
  let installPrompt: { prompt: () => Promise<void> } | null = null;

  $: roleLabel = profile?.role ? profile.role[0].toUpperCase() + profile.role.slice(1) : '';

  async function refreshQueue() {
    queued = await db.outbox.where('state').equals('queued').count();
  }

  async function submitLogin() {
    error = '';
    busy = true;
    try {
      profile = await signIn(identifier, password);
      screen = 'set-pin';
      password = '';
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Unable to sign in.';
    } finally {
      busy = false;
    }
  }

  async function savePin() {
    error = '';
    if (!/^\d{4,6}$/.test(pin)) {
      error = 'Choose a 4–6 digit PIN.';
      return;
    }
    if (pin !== pinConfirm) {
      error = 'PINs do not match.';
      return;
    }
    await configureDevicePin(pin);
    pin = '';
    pinConfirm = '';
    screen = 'app';
  }

  async function unlock() {
    error = '';
    busy = true;
    try {
      if (!(await verifyDevicePin(pin))) throw new Error('Incorrect PIN.');
      profile = await getCachedProfile();
      if (!profile?.active) throw new Error('No active cached profile is available on this device. Sign in while online.');
      pin = '';
      screen = 'app';
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not unlock this device.';
    } finally {
      busy = false;
    }
  }

  async function lock() {
    pin = '';
    error = '';
    profile = await getCachedProfile();
    screen = profile ? 'unlock' : 'login';
  }

  async function changeAccount() {
    await signOut();
    await db.profiles.clear();
    profile = undefined;
    pin = '';
    screen = 'login';
  }

  onMount(async () => {
    const updateOnline = () => {
      online = navigator.onLine;
    };
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    const installHandler = (event: Event) => {
      event.preventDefault();
      installPrompt = event as unknown as { prompt: () => Promise<void> };
    };
    window.addEventListener('beforeinstallprompt', installHandler);
    const { registerSW } = await import('virtual:pwa-register');
    registerSW({ immediate: true });
    profile = await getCachedProfile();
    const hasPin = Boolean(await db.settings.get('local-pin'));
    if (profile && hasPin) {
      screen = 'unlock';
    } else if (supabaseEnabled && supabase) {
      const { data } = await supabase.auth.getSession();
      screen = data.session && profile ? (hasPin ? 'unlock' : 'set-pin') : 'login';
    } else {
      screen = 'login';
    }
    await refreshQueue();
    const timer = window.setInterval(() => void refreshQueue(), 5000);
    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
      window.removeEventListener('beforeinstallprompt', installHandler);
      window.clearInterval(timer);
    };
  });
</script>

<svelte:head>
  <title>TapTicket · Bus ticketing</title>
  <meta name="theme-color" content="#102a43" />
</svelte:head>

<main class="min-h-screen bg-paper text-navy">
  <header class="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
    <div class="mx-auto flex max-w-3xl items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <img src="/icons/tapticket-192.svg" alt="" class="h-11 w-11 rounded-xl" />
        <div>
          <p class="text-xs font-black uppercase tracking-[.18em] text-slate-500">TapTicket</p>
          <h1 class="text-xl font-black">Bus ticketing</h1>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <span class={`rounded-full px-3 py-2 text-xs font-black ${online ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-950'}`}>
          {online ? 'ONLINE' : 'OFFLINE'}
        </span>
        {#if screen === 'app'}
          <button class="min-h-11 rounded-xl border border-slate-300 px-3 text-sm font-bold" onclick={lock}>Lock</button>
        {/if}
      </div>
    </div>
  </header>

  <div class="safe-bottom mx-auto max-w-3xl space-y-4 p-4">
    {#if screen === 'checking'}
      <section class="rounded-2xl bg-white p-6 shadow-sm"><p class="font-bold">Loading TapTicket…</p></section>
    {:else if screen === 'login'}
      <section class="rounded-2xl bg-white p-5 shadow-sm sm:p-7">
        <p class="text-sm font-black uppercase tracking-wider text-tapgreen">Secure sign in</p>
        <h2 class="mt-1 text-2xl font-black">Welcome to TapTicket</h2>
        <p class="mt-2 text-slate-600">Sign in online with the account password issued by your company. After sign-in, set a device PIN for quick offline unlocking.</p>
        {#if !supabaseEnabled}
          <div class="mt-4 rounded-xl border-2 border-amber-300 bg-amber-50 p-4 text-sm font-semibold text-amber-950">
            Backend not configured. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in <code>.env.local</code>.
          </div>
        {/if}
        <form class="mt-5 space-y-4" onsubmit={(event) => { event.preventDefault(); void submitLogin(); }}>
          <label class="block text-sm font-bold">Phone or email
            <input bind:value={identifier} autocomplete="username" class="mt-1 min-h-14 w-full rounded-xl border-2 border-slate-300 px-4 text-lg" placeholder="name@example.com or +263…" required />
          </label>
          <label class="block text-sm font-bold">Account password
            <input bind:value={password} type="password" autocomplete="current-password" class="mt-1 min-h-14 w-full rounded-xl border-2 border-slate-300 px-4 text-lg" required />
          </label>
          {#if error}
            <p role="alert" class="rounded-xl bg-red-50 p-3 font-semibold text-red-800">{error}</p>
          {/if}
          <button disabled={!supabaseEnabled || busy} class="min-h-14 w-full rounded-xl bg-tapgreen px-5 text-lg font-black text-white disabled:opacity-50">
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>
    {:else if screen === 'set-pin'}
      <section class="rounded-2xl bg-white p-5 shadow-sm sm:p-7">
        <p class="text-sm font-black uppercase tracking-wider text-tapgreen">Device setup</p>
        <h2 class="mt-1 text-2xl font-black">Set your offline PIN</h2>
        <p class="mt-2 text-slate-600">This PIN locks this device. It is not your Supabase account password.</p>
        <form class="mt-5 space-y-4" onsubmit={(event) => { event.preventDefault(); void savePin(); }}>
          <label class="block text-sm font-bold">New 4–6 digit PIN
            <input bind:value={pin} type="password" inputmode="numeric" autocomplete="new-password" minlength="4" maxlength="6" class="mt-1 min-h-14 w-full rounded-xl border-2 border-slate-300 px-4 text-2xl tracking-[.4em]" required />
          </label>
          <label class="block text-sm font-bold">Confirm PIN
            <input bind:value={pinConfirm} type="password" inputmode="numeric" autocomplete="new-password" minlength="4" maxlength="6" class="mt-1 min-h-14 w-full rounded-xl border-2 border-slate-300 px-4 text-2xl tracking-[.4em]" required />
          </label>
          {#if error}
            <p role="alert" class="rounded-xl bg-red-50 p-3 font-semibold text-red-800">{error}</p>
          {/if}
          <button class="min-h-14 w-full rounded-xl bg-tapgreen px-5 text-lg font-black text-white">Save PIN and continue</button>
        </form>
      </section>
    {:else if screen === 'unlock'}
      <section class="rounded-2xl bg-white p-5 shadow-sm sm:p-7">
        <p class="text-sm font-black uppercase tracking-wider text-tapgreen">Offline device access</p>
        <h2 class="mt-1 text-2xl font-black">Unlock{profile ? `, ${profile.displayName}` : ''}</h2>
        <p class="mt-2 text-slate-600">Previously cached profile and local data remain available offline.</p>
        <form class="mt-5 space-y-4" onsubmit={(event) => { event.preventDefault(); void unlock(); }}>
          <input bind:value={pin} aria-label="Device PIN" type="password" inputmode="numeric" autocomplete="current-password" minlength="4" maxlength="6" class="min-h-16 w-full rounded-xl border-2 border-slate-300 px-4 text-center text-3xl tracking-[.5em]" required />
          {#if error}
            <p role="alert" class="rounded-xl bg-red-50 p-3 font-semibold text-red-800">{error}</p>
          {/if}
          <button disabled={busy} class="min-h-14 w-full rounded-xl bg-tapgreen px-5 text-lg font-black text-white">{busy ? 'Checking…' : 'Unlock device'}</button>
          <button type="button" class="min-h-12 w-full rounded-xl border border-slate-300 font-bold" onclick={changeAccount}>Sign out / change account</button>
        </form>
      </section>
    {:else}
      {#if profile?.role === 'conductor'}
        <ConductorSales {profile} />
      {:else if profile?.role === 'checker'}
        <CheckerPanel {profile} />
      {:else if profile?.role === 'admin' || profile?.role === 'owner'}
        <AdminPanel {profile} />
      {:else}
        <section class="rounded-2xl bg-white p-5 shadow-sm">
          <p class="text-xs font-black uppercase tracking-wider text-tapgreen">Signed in · {roleLabel}</p>
          <h2 class="mt-1 text-2xl font-black">Welcome, {profile?.displayName}</h2>
          <p class="mt-2 text-slate-600">This account is not mapped to a conductor or checker role yet.</p>
          <div class="mt-4 rounded-xl bg-slate-100 p-4 text-sm">Queued locally: <b>{queued}</b></div>
        </section>
      {/if}
    {/if}
    <footer class="px-1 text-center text-xs text-slate-500">TapTicket · USD · Built for low-connectivity operations</footer>
  </div>
</main>
