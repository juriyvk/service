import { HttpError, verifyInitData, equal } from './security.js';
export const env = (name: string) => { const v=Deno.env.get(name); if(!v) throw new HttpError(503,'Server configuration missing'); return v; };
export function json(data: unknown,status=200,headers:Record<string,string>={}) { return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...headers}}); }
export async function rpc(name:string,args:unknown) {
 const r=await fetch(`${env('SUPABASE_URL')}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:env('SUPABASE_SERVICE_ROLE_KEY'),Authorization:`Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(15000)});
 const data=await r.json(); if(!r.ok) { const status=data.code==='42501'?403:data.code==='40001'?409:400; throw new HttpError(status,status===409?'Данные изменились. Обновите задачу.':status===403?'Доступ запрещён':'Некорректные данные или переход статуса'); } return data;
}
export async function identity(initData:string) {
 const id=await verifyInitData(initData,env('TELEGRAM_BOT_TOKEN'));
 const employee=await rpc('dvfm_identity',{p_telegram_id:id});
 if(!employee) throw new HttpError(403,'Сотрудник не зарегистрирован или отключён'); return employee;
}
export async function body(req:Request,limit=32768) {
 if(Number(req.headers.get('content-length'))>limit) throw new HttpError(413,'Request too large');
 const reader=req.body?.getReader(); if(!reader) throw new HttpError(400,'Body required');
 let size=0; const parts:Uint8Array[]=[];
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new HttpError(413,'Request too large');}parts.push(value);}
 const bytes=new Uint8Array(size);let pos=0;for(const part of parts){bytes.set(part,pos);pos+=part.length;}
 try{const data=JSON.parse(new TextDecoder().decode(bytes));if(!data||typeof data!=='object'||Array.isArray(data))throw new Error();return data;}catch{throw new HttpError(400,'Invalid JSON object');}
}
export function serve(handler:(req:Request)=>Promise<Response>,browser=false) {
 Deno.serve(async req=>{
 let headers:Record<string,string>={};
 try{
 if(browser){const origin=req.headers.get('origin');const allowed=(Deno.env.get('ALLOWED_ORIGINS') || 'https://juriyvk.github.io').split(',').map(s=>s.trim());if(origin&&!allowed.includes(origin))throw new HttpError(403,'Origin forbidden');if(origin)headers={'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Headers':'content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};}
 if(req.method==='OPTIONS'&&browser)return new Response(null,{status:204,headers});
 if(req.method!=='POST')throw new HttpError(405,'POST required');
 const response=await handler(req);for(const [k,v] of Object.entries(headers))response.headers.set(k,v);return response;
 }catch(e){return json({ok:false,error:e instanceof HttpError?e.message:'Internal server error'},e instanceof HttpError?e.status:500,headers);}
 });
}
export async function storage(path:string,method:string,body?:BodyInit,mime?:string) {
 const r=await fetch(`${env('SUPABASE_URL')}/storage/v1/${path}`,{method,headers:{Authorization:`Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`,...(mime?{'Content-Type':mime}:{}),...(method==='POST'&&path.startsWith('object/dvfm-private/')?{'x-upsert':'true'}:{})},body,signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw new HttpError(502,'Storage operation failed');return r;
}
export async function telegram(method:string,payload:unknown) {
 const r=await fetch(`https://api.telegram.org/bot${env('TELEGRAM_BOT_TOKEN')}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});
 const data=await r.json();if(!r.ok||!data.ok)throw new HttpError(502,'Telegram operation failed');return data.result;
}
export function taskLink(id:string) {
 const url=new URL(env('TELEGRAM_MINI_APP_URL'));if(url.protocol!=='https:'||url.hostname!=='t.me')throw new HttpError(503,'Invalid Mini App URL');url.searchParams.set('startapp',`task_${id}`);return url.href;
}
export async function drain() {
 const jobs=await rpc('dvfm_outbox',{});
 for(const job of jobs){let success=false;try{await telegram('sendMessage',{chat_id:job.telegram_id,text:job.text,...(job.task_id?{reply_markup:{inline_keyboard:[[{text:'Открыть задачу',url:taskLink(job.task_id)}]]}}:{})});success=true;}catch{/* Durable retry; never log token-bearing URLs. */}
 await rpc('dvfm_outbox',{p_id:job.id,p_token:job.lease_token,p_success:success});}
}
export function requireSecret(actual:string|null,name:string) {if(!actual||!equal(actual,env(name)))throw new HttpError(401,'Unauthorized');}
