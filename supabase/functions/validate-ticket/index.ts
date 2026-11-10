import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'authorization, apikey, content-type', 'Access-Control-Allow-Methods':'POST, OPTIONS' };
const json = (body:unknown,status=200) => new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
const canonical = (value:unknown):string => {
  const sort=(x:unknown):unknown=>Array.isArray(x)?x.map(sort):x&&typeof x==='object'?Object.fromEntries(Object.entries(x as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,sort(v)])):x;
  return JSON.stringify(sort(value));
};
const decode=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
Deno.serve(async req => {
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors});
  if(req.method!=='POST') return json({error:'POST required'},405);
  const url=Deno.env.get('SUPABASE_URL')!, anon=Deno.env.get('SUPABASE_ANON_KEY')!, service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const auth=req.headers.get('Authorization'); if(!auth) return json({error:'Authentication required'},401);
  const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}}});
  const {data:{user},error:userError}=await userClient.auth.getUser(); if(userError||!user) return json({error:'Invalid session'},401);
  const admin=createClient(url,service);
  const {data:profile}=await admin.from('profiles').select('id,company_id,role,active').eq('id',user.id).single();
  if(!profile?.active||profile.role!=='checker') return json({error:'Active checker required'},403);
  try {
    const body=await req.json(); const token=body.token;
    if(typeof token!=='string'||token.length>12000) return json({error:'Invalid ticket token'},400);
    const tokenData=JSON.parse(token); const payload=tokenData.payload; const signature=tokenData.signature;
    if(!payload||typeof signature!=='string') return json({error:'Malformed token'},400);
    const deviceId=String(payload.keyId??payload.deviceId??'');
    const ticketId=String(payload.id??payload.ticketId??'');
    const {data:device}=await admin.from('devices').select('id,company_id,signing_public_key,active').eq('id',deviceId).eq('company_id',profile.company_id).single();
    let verdict='unknown_key'; let reason='Signing key is unknown or revoked';
    if(device?.active) {
      const key=await crypto.subtle.importKey('spki',decode(device.signing_public_key),{name:'Ed25519'},false,['verify']);
      const valid=await crypto.subtle.verify({name:'Ed25519'},key,decode(signature),new TextEncoder().encode(canonical(payload)));
      verdict=valid?'valid':'fake'; reason=valid?'Signature valid':'Signature invalid';
    }
    if(verdict==='valid') {
      const {data:ticket}=await admin.from('tickets').select('id,company_id,trip_id,device_id,ticket_number,signed_payload,signature').eq('id',ticketId).eq('company_id',profile.company_id).maybeSingle();
      const tripId=String(body.tripId??payload.tripId??'');
      if(!ticket||ticket.device_id!==deviceId||ticket.trip_id!==tripId||ticket.ticket_number!==payload.ticketNumber||canonical(ticket.signed_payload)!==canonical(payload)||ticket.signature!==signature) { verdict='fake'; reason='Ticket does not match the synchronized company ledger or selected trip'; }
      else {
        const {data:trip}=await admin.from('trips').select('id,status,company_id').eq('id',tripId).eq('company_id',profile.company_id).maybeSingle();
        if(!trip) { verdict='wrong_route'; reason='Trip is not in this company'; }
        else {
          const {data:voids}=await admin.from('ticket_voids').select('id').eq('ticket_id',ticketId).limit(1);
          if(voids?.length) { verdict='voided'; reason='Ticket was voided'; }
          else {
            const {data:scanResult,error:scanError}=await admin.rpc('record_ticket_scan',{p_scan_id:body.scanId,p_ticket_id:ticketId,p_trip_id:tripId,p_result:'valid',p_client_scanned_at:body.clientScannedAt??new Date().toISOString()});
            if(scanError) return json({error:'Could not record validation',detail:scanError.message},409);
            verdict=scanResult.result; reason=scanResult.reason;
          }
        }
      }
    }
    if(verdict!=='valid') {
      await admin.from('scans').insert({id:body.scanId,company_id:profile.company_id,trip_id:body.tripId||payload.tripId,ticket_id:ticketId||null,checker_profile_id:profile.id,device_id:deviceId||null,result:verdict,ticket_number:String(payload.ticketNumber??''),client_scanned_at:body.clientScannedAt??new Date().toISOString()});
      await admin.from('audit_log').insert({id:crypto.randomUUID(),company_id:profile.company_id,actor_profile_id:profile.id,device_id:deviceId||null,action:'ticket_validation',entity_type:'ticket',entity_id:ticketId||null,details:{result:verdict,reason},client_created_at:body.clientScannedAt??new Date().toISOString()});
    }
    return json({result:verdict,reason,serverValidated:true});
  } catch(error) { return json({error:error instanceof Error?error.message:'Validation error'},400); }
});
