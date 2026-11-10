create extension if not exists pgcrypto;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  currency text not null default 'USD' check (currency = 'USD'),
  logo_path text,
  promotion_text text,
  promotion_image_path text,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete restrict,
  role text not null check (role in ('conductor','checker','admin','owner')),
  display_name text not null,
  phone text,
  email text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.routes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  version integer not null default 1,
  unique (company_id, name)
);
create table if not exists public.stops (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  unique (company_id, name)
);
create table if not exists public.route_stops (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  route_id uuid not null references public.routes(id) on delete cascade,
  stop_id uuid not null references public.stops(id) on delete restrict,
  sequence_no integer not null check (sequence_no > 0),
  unique(route_id, sequence_no), unique(route_id, stop_id)
);
create table if not exists public.fares (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  route_id uuid not null references public.routes(id) on delete cascade,
  from_stop_id uuid not null references public.stops(id),
  to_stop_id uuid not null references public.stops(id),
  fare_type text not null check (fare_type in ('adult','child')),
  amount_cents integer not null check (amount_cents > 0),
  version integer not null default 1,
  unique(route_id, from_stop_id, to_stop_id, fare_type, version),
  check (from_stop_id <> to_stop_id)
);
create table if not exists public.buses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  registration text not null,
  active boolean not null default true,
  unique(company_id, registration)
);

create table if not exists public.devices (
  id uuid primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  device_code text not null,
  signing_public_key text not null,
  active boolean not null default true,
  registered_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique(company_id, device_code)
);
create table if not exists public.trips (
  id uuid primary key,
  company_id uuid not null references public.companies(id) on delete restrict,
  route_id uuid not null references public.routes(id) on delete restrict,
  device_id uuid not null references public.devices(id) on delete restrict,
  conductor_profile_id uuid not null references public.profiles(id) on delete restrict,
  trip_number text not null,
  route_name text not null,
  bus_registration text not null,
  driver_name text not null,
  conductor_mobile text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  status text not null check (status in ('active','ended')),
  received_at timestamptz not null default now(),
  unique(company_id, trip_number)
);
create table if not exists public.tickets (
  id uuid primary key,
  company_id uuid not null references public.companies(id) on delete restrict,
  trip_id uuid not null references public.trips(id) on delete restrict,
  device_id uuid not null references public.devices(id) on delete restrict,
  sequence_number integer not null check (sequence_number > 0),
  ticket_number text not null,
  from_stop_id uuid not null references public.stops(id),
  from_stop_name text not null,
  to_stop_id uuid not null references public.stops(id),
  to_stop_name text not null,
  fare_type text not null check (fare_type in ('adult','child','luggage')),
  amount_cents integer not null check (amount_cents > 0),
  payment_method text not null check (payment_method in ('cash','ecocash')),
  cash_tendered_cents integer,
  change_cents integer not null default 0 check (change_cents >= 0),
  ecocash_reference text,
  signed_payload jsonb not null,
  signature text not null,
  client_created_at timestamptz not null,
  received_at timestamptz not null default now(),
  unique(company_id, ticket_number),
  unique(device_id, sequence_number),
  check ((payment_method = 'cash' and cash_tendered_cents >= amount_cents and ecocash_reference is null)
      or (payment_method = 'ecocash' and cash_tendered_cents is null and change_cents = 0 and length(trim(ecocash_reference)) > 0))
);
create table if not exists public.ticket_voids (
  id uuid primary key,
  company_id uuid not null references public.companies(id) on delete restrict,
  ticket_id uuid not null references public.tickets(id) on delete restrict,
  trip_id uuid not null references public.trips(id) on delete restrict,
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  reason text not null check (length(trim(reason)) > 0),
  client_created_at timestamptz not null,
  received_at timestamptz not null default now(),
  unique(ticket_id)
);
create table if not exists public.expenses (
  id uuid primary key,
  company_id uuid not null references public.companies(id) on delete restrict,
  trip_id uuid not null references public.trips(id) on delete restrict,
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  category text not null,
  amount_cents integer not null check (amount_cents > 0),
  note text,
  client_created_at timestamptz not null,
  received_at timestamptz not null default now()
);
create table if not exists public.handovers (
  id uuid primary key,
  company_id uuid not null references public.companies(id) on delete restrict,
  trip_id uuid not null references public.trips(id) on delete restrict,
  conductor_profile_id uuid not null references public.profiles(id) on delete restrict,
  declared jsonb not null,
  client_created_at timestamptz not null,
  received_at timestamptz not null default now(),
  unique(trip_id)
);
create table if not exists public.scans (
  id uuid primary key,
  company_id uuid not null references public.companies(id) on delete restrict,
  trip_id uuid not null references public.trips(id) on delete restrict,
  ticket_id uuid references public.tickets(id) on delete restrict,
  checker_profile_id uuid not null references public.profiles(id) on delete restrict,
  device_id uuid not null references public.devices(id) on delete restrict,
  result text not null check (result in ('valid','fake','reused','voided','wrong_bus','wrong_route','unknown_key')),
  ticket_number text,
  client_scanned_at timestamptz not null,
  received_at timestamptz not null default now()
);
create table if not exists public.audit_log (
  id uuid primary key,
  company_id uuid not null references public.companies(id) on delete restrict,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  device_id uuid references public.devices(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  client_created_at timestamptz not null,
  received_at timestamptz not null default now()
);

create index if not exists profiles_company_role_idx on public.profiles(company_id, role);
create index if not exists route_stops_route_seq_idx on public.route_stops(route_id, sequence_no);
create index if not exists fares_route_pair_idx on public.fares(route_id, from_stop_id, to_stop_id);
create index if not exists devices_company_profile_idx on public.devices(company_id, profile_id);
create index if not exists trips_company_started_idx on public.trips(company_id, started_at desc);
create index if not exists tickets_trip_created_idx on public.tickets(trip_id, client_created_at);
create index if not exists tickets_company_received_idx on public.tickets(company_id, received_at desc);
create index if not exists scans_trip_time_idx on public.scans(trip_id, client_scanned_at);
create index if not exists audit_company_time_idx on public.audit_log(company_id, received_at desc);

create or replace function public.current_company_id() returns uuid
language sql stable security definer set search_path = public, pg_temp
as $$ select company_id from public.profiles where id = (select auth.uid()) and active limit 1 $$;
create or replace function public.current_role() returns text
language sql stable security definer set search_path = public, pg_temp
as $$ select role from public.profiles where id = (select auth.uid()) and active limit 1 $$;
create or replace function public.is_company_admin(target_company uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$ select exists(select 1 from public.profiles p where p.id = (select auth.uid()) and p.active and p.company_id = target_company and p.role in ('admin','owner')) $$;

create or replace function public.register_device(p_device_id uuid, p_device_code text, p_signing_public_key text)
returns public.devices
language plpgsql security definer set search_path = public, pg_temp
as $$
declare p public.profiles; d public.devices;
begin
  select * into p from public.profiles where id = auth.uid() and active;
  if p.id is null or p.role not in ('conductor','checker') then raise exception 'active conductor/checker profile required'; end if;
  if length(p_device_code) not between 6 and 32 or length(p_signing_public_key) < 40 then raise exception 'invalid device registration'; end if;
  select * into d from public.devices where id = p_device_id;
  if found then
    if d.profile_id <> p.id or d.company_id <> p.company_id or d.signing_public_key <> p_signing_public_key or not d.active then
      raise exception 'device identity mismatch or revoked';
    end if;
    return d;
  end if;
  insert into public.devices(id, company_id, profile_id, device_code, signing_public_key)
  values (p_device_id, p.company_id, p.id, p_device_code, p_signing_public_key) returning * into d;
  return d;
end $$;
revoke all on function public.register_device(uuid,text,text) from public;
grant execute on function public.register_device(uuid,text,text) to authenticated;

alter table public.companies enable row level security;
alter table public.profiles enable row level security;
alter table public.routes enable row level security;
alter table public.stops enable row level security;
alter table public.route_stops enable row level security;
alter table public.fares enable row level security;
alter table public.buses enable row level security;
alter table public.devices enable row level security;
alter table public.trips enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_voids enable row level security;
alter table public.expenses enable row level security;
alter table public.handovers enable row level security;
alter table public.scans enable row level security;
alter table public.audit_log enable row level security;

create policy company_read on public.companies for select to authenticated using (id = public.current_company_id());
create policy profile_read_company on public.profiles for select to authenticated using (company_id = public.current_company_id());
create policy profile_admin_manage on public.profiles for all to authenticated using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));
create policy routes_read_company on public.routes for select to authenticated using (company_id = public.current_company_id());
create policy routes_admin_manage on public.routes for all to authenticated using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));
create policy stops_read_company on public.stops for select to authenticated using (company_id = public.current_company_id());
create policy stops_admin_manage on public.stops for all to authenticated using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));
create policy route_stops_read_company on public.route_stops for select to authenticated using (company_id = public.current_company_id());
create policy route_stops_admin_manage on public.route_stops for all to authenticated using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));
create policy fares_read_company on public.fares for select to authenticated using (company_id = public.current_company_id());
create policy fares_admin_manage on public.fares for all to authenticated using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));
create policy buses_read_company on public.buses for select to authenticated using (company_id = public.current_company_id());
create policy buses_admin_manage on public.buses for all to authenticated using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));
create policy devices_read_company on public.devices for select to authenticated using (company_id = public.current_company_id());
create policy devices_admin_manage on public.devices for all to authenticated using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));
create policy trips_read_company on public.trips for select to authenticated using (company_id = public.current_company_id());
create policy trips_insert_own_conductor on public.trips for insert to authenticated with check (company_id = public.current_company_id() and conductor_profile_id = auth.uid() and exists(select 1 from public.devices d where d.id = device_id and d.profile_id = auth.uid() and d.company_id = company_id and d.active));
create policy trips_update_conductor_admin on public.trips for update to authenticated using (company_id = public.current_company_id() and (conductor_profile_id = auth.uid() or public.is_company_admin(company_id))) with check (company_id = public.current_company_id() and (conductor_profile_id = auth.uid() or public.is_company_admin(company_id)));
create policy tickets_read_company on public.tickets for select to authenticated using (company_id = public.current_company_id());
create policy tickets_insert_own_trip on public.tickets for insert to authenticated with check (
  company_id = public.current_company_id() and
  exists(select 1 from public.trips t join public.devices d on d.id = t.device_id where t.id = trip_id and t.company_id = company_id and t.conductor_profile_id = auth.uid() and t.device_id = tickets.device_id and d.profile_id = auth.uid() and d.active)
);
create policy ticket_voids_read_company on public.ticket_voids for select to authenticated using (company_id = public.current_company_id());
create policy ticket_voids_conductor_insert on public.ticket_voids for insert to authenticated with check (company_id = public.current_company_id() and actor_profile_id = auth.uid() and exists(select 1 from public.trips t where t.id = trip_id and t.conductor_profile_id = auth.uid() and t.company_id = company_id));
create policy expenses_read_company on public.expenses for select to authenticated using (company_id = public.current_company_id());
create policy expenses_conductor_insert on public.expenses for insert to authenticated with check (company_id = public.current_company_id() and actor_profile_id = auth.uid() and exists(select 1 from public.trips t where t.id = trip_id and t.conductor_profile_id = auth.uid() and t.company_id = company_id));
create policy handovers_read_company on public.handovers for select to authenticated using (company_id = public.current_company_id());
create policy handovers_conductor_insert on public.handovers for insert to authenticated with check (company_id = public.current_company_id() and conductor_profile_id = auth.uid() and exists(select 1 from public.trips t where t.id = trip_id and t.conductor_profile_id = auth.uid() and t.company_id = company_id));
create policy scans_read_company on public.scans for select to authenticated using (company_id = public.current_company_id());
create policy scans_checker_insert on public.scans for insert to authenticated with check (company_id = public.current_company_id() and checker_profile_id = auth.uid() and exists(select 1 from public.devices d where d.id = device_id and d.profile_id = auth.uid() and d.active));
create policy audit_read_company on public.audit_log for select to authenticated using (company_id = public.current_company_id());
create policy audit_insert_own on public.audit_log for insert to authenticated with check (company_id = public.current_company_id() and (actor_profile_id is null or actor_profile_id = auth.uid()));

-- Do not grant anonymous access. Supabase authenticated grants are constrained by RLS.
grant select on public.companies, public.profiles, public.routes, public.stops, public.route_stops, public.fares, public.buses, public.devices, public.trips, public.tickets, public.ticket_voids, public.expenses, public.handovers, public.scans, public.audit_log to authenticated;
grant insert on public.trips, public.tickets, public.ticket_voids, public.expenses, public.handovers, public.scans, public.audit_log to authenticated;
grant update on public.trips to authenticated;
grant insert, update, delete on public.routes, public.stops, public.route_stops, public.fares, public.buses, public.devices, public.profiles to authenticated;
