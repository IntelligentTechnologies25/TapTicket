import { createClient } from 'npm:@supabase/supabase-js@2';
const cors={ 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS' };
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors}); if(req.method!=='POST')return response({error:'POST required'},405);
 const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 const auth=req.headers.get('Authorization');if(!auth)return response({error:'Authentication required'},401);
 const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}}});const {data:{user},error}=await userClient.auth.getUser();if(error||!user)return response({error:'Invalid session'},401);
 const admin=createClient(url,service);const {data:profile}=await admin.from('profiles').select('id,company_id,role,active').eq('id',user.id).single();
 if(!profile?.active||!['conductor','checker'].includes(profile.role))return response({error:'Active staff profile required'},403);
 try{
  const b=await req.json();if(typeof b.deviceId!=='string'||typeof b.publicKey!=='string'||typeof b.challenge!=='string'||typeof b.proof!=='string')return response({error:'Invalid registration request'},400);
  const key=await crypto.subtle.importKey('spki',Uint8Array.from(atob(b.publicKey),c=>c.charCodeAt(0)),{name:'Ed25519'},false,['verify']);
  const message=new TextEncoder().encode(JSON.stringify({challenge:b.challenge,deviceId:b.deviceId,profileId:profile.id}));
  if(!await crypto.subtle.verify({name:'Ed25519'},key,Uint8Array.from(atob(b.proof),c=>c.charCodeAt(0)),message))return response({error:'Device proof-of-possession failed'},401);
  const {data:device,error:registerError}=await admin.rpc('register_device',{p_device_id:b.deviceId,p_device_code:b.deviceCode,p_signing_public_key:b.publicKey});
  if(registerError)return response({error:registerError.message},403);
  return response({deviceId:device.id,registered:true});
 }catch(e){return response({error:e instanceof Error?e.message:'Registration failed'},400);}
});
