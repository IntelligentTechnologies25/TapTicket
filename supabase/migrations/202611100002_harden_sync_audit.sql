create table if not exists public.ticket_scan_claims (
  ticket_id uuid primary key references public.tickets(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  trip_id uuid not null references public.trips(id) on delete restrict,
  checker_profile_id uuid not null references public.profiles(id) on delete restrict,
  device_id uuid not null references public.devices(id) on delete restrict,
  scan_id uuid not null unique,
  scanned_at timestamptz not null default now()
);
create index if not exists scan_claims_company_time_idx on public.ticket_scan_claims(company_id, scanned_at desc);
alter table public.ticket_scan_claims enable row level security;
create policy scan_claims_company_read on public.ticket_scan_claims for select to authenticated using (company_id = public.current_company_id());
revoke all on public.ticket_scan_claims from anon, authenticated;
grant select on public.ticket_scan_claims to authenticated;

-- Client roles cannot forge audit rows or scan verdicts. Trusted Edge Functions invoke the atomic RPCs below using service credentials.
revoke insert, update, delete on public.scans, public.audit_log, public.ticket_scan_claims from authenticated, anon;
revoke insert, update, delete on public.ticket_voids from authenticated, anon;

create or replace function public.ingest_signed_ticket(p_row jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp
as $$
declare t public.trips; d public.devices; actor public.profiles; ticket_id uuid; trip_id uuid; company_id uuid; device_id uuid; payload jsonb;
begin
  actor := (select p from public.profiles p where p.id=auth.uid() and p.active and p.role='conductor');
  if actor.id is null then raise exception 'active conductor required'; end if;
  ticket_id := (p_row->>'id')::uuid; trip_id := (p_row->>'trip_id')::uuid; company_id := (p_row->>'company_id')::uuid; device_id := (p_row->>'device_id')::uuid;
  select * into t from public.trips where id=trip_id and company_id=actor.company_id and conductor_profile_id=actor.id and device_id=device_id;
  if t.id is null or t.status <> 'active' then raise exception 'trip missing, ended, or not owned by conductor'; end if;
  select * into d from public.devices where id=device_id and profile_id=actor.id and company_id=actor.company_id and active;
  if d.id is null then raise exception 'device not registered or revoked'; end if;
  if company_id <> actor.company_id or (p_row->'signed_payload'->>'id')::uuid <> ticket_id or (p_row->'signed_payload'->>'tripId')::uuid <> trip_id then raise exception 'signed payload identity mismatch'; end if;
  if p_row->>'signature' is null or jsonb_typeof(p_row->'signed_payload') <> 'object' then raise exception 'signature missing'; end if;
  if exists(select 1 from public.ticket_voids v where v.ticket_id=ticket_id) then raise exception 'ticket voided'; end if;
  insert into public.tickets(id,company_id,trip_id,device_id,sequence_number,ticket_number,from_stop_id,from_stop_name,to_stop_id,to_stop_name,fare_type,amount_cents,payment_method,cash_tendered_cents,change_cents,ecocash_reference,signed_payload,signature,client_created_at)
  values(ticket_id,company_id,trip_id,device_id,(p_row->>'sequence_number')::integer,p_row->>'ticket_number',(p_row->>'from_stop_id')::uuid,p_row->>'from_stop_name',(p_row->>'to_stop_id')::uuid,p_row->>'to_stop_name',p_row->>'fare_type',(p_row->>'amount_cents')::integer,p_row->>'payment_method',nullif(p_row->>'cash_tendered_cents','')::integer,(p_row->>'change_cents')::integer,nullif(p_row->>'ecocash_reference',''),p_row->'signed_payload',p_row->>'signature',(p_row->>'client_created_at')::timestamptz)
  on conflict(id) do nothing;
  if not exists(select 1 from public.tickets where id=ticket_id and company_id=company_id and signature=p_row->>'signature') then raise exception 'ticket id conflict'; end if;
  insert into public.audit_log(id,company_id,actor_profile_id,device_id,action,entity_type,entity_id,details,client_created_at)
  values(gen_random_uuid(),company_id,actor.id,device_id,'ticket_ingested','ticket',ticket_id,jsonb_build_object('ticket_number',p_row->>'ticket_number'),now());
end $$;
revoke all on function public.ingest_signed_ticket(jsonb) from public,anon;
grant execute on function public.ingest_signed_ticket(jsonb) to authenticated;

create or replace function public.record_ticket_scan(p_scan_id uuid,p_ticket_id uuid,p_trip_id uuid,p_result text,p_client_scanned_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare actor public.profiles; d public.devices; t public.tickets; trip public.trips; final_result text; reason text;
begin
  actor := (select p from public.profiles p where p.id=auth.uid() and p.active and p.role='checker');
  if actor.id is null then raise exception 'active checker required'; end if;
  select * into d from public.devices where profile_id=actor.id and company_id=actor.company_id and active order by registered_at desc limit 1;
  if d.id is null then raise exception 'checker device is not enrolled'; end if;
  select * into t from public.tickets where id=p_ticket_id and company_id=actor.company_id;
  final_result := p_result; reason := 'Recorded';
  if t.id is null then final_result := 'fake'; reason := 'Ticket does not exist in company ledger';
  elsif t.trip_id <> p_trip_id then final_result := 'wrong_route'; reason := 'Ticket does not belong to selected trip';
  elsif exists(select 1 from public.ticket_voids v where v.ticket_id=t.id) then final_result := 'voided'; reason := 'Ticket voided';
  elsif exists(select 1 from public.ticket_scan_claims c where c.ticket_id=t.id) then final_result := 'reused'; reason := 'Ticket already claimed by another scan';
  elsif not exists(select 1 from public.trips x where x.id=p_trip_id and x.company_id=actor.company_id) then final_result := 'wrong_route'; reason := 'Trip is not in this company';
  end if;
  if final_result='valid' then
    insert into public.ticket_scan_claims(ticket_id,company_id,trip_id,checker_profile_id,device_id,scan_id,scanned_at)
    values(t.id,actor.company_id,p_trip_id,actor.id,d.id,p_scan_id,p_client_scanned_at)
    on conflict(ticket_id) do nothing;
    if not found then final_result := 'reused'; reason := 'Ticket was concurrently scanned'; end if;
  end if;
  insert into public.scans(id,company_id,trip_id,ticket_id,checker_profile_id,device_id,result,ticket_number,client_scanned_at)
  values(p_scan_id,actor.company_id,p_trip_id,case when t.id is null then null else t.id end,actor.id,d.id,final_result,coalesce(t.ticket_number,''),p_client_scanned_at)
  on conflict(id) do nothing;
  insert into public.audit_log(id,company_id,actor_profile_id,device_id,action,entity_type,entity_id,details,client_created_at)
  values(gen_random_uuid(),actor.company_id,actor.id,d.id,'ticket_validation','ticket',p_ticket_id,jsonb_build_object('result',final_result,'reason',reason,'scan_id',p_scan_id),p_client_scanned_at);
  return jsonb_build_object('result',final_result,'reason',reason);
end $$;
revoke all on function public.record_ticket_scan(uuid,uuid,uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.record_ticket_scan(uuid,uuid,uuid,text,timestamptz) to service_role;
