import {serve,body,identity,json,rpc,storage} from '../_shared/runtime.ts';
import {HttpError,validateDocument} from '../_shared/security.js';
const actions=new Set(['snapshot','task.create','task.detail','task.accept','task.update','comment.create','checkpoint.create','checkpoint.toggle','project.create']);
serve(async req=>{
 const input=await body(req,14500000);const employee=await identity(input.initData);const data=input.data||{};
 if(input.action==='document.upload'){
 const meta=validateDocument(data);if(typeof data.base64!=='string'||data.base64.length>13981016)throw new HttpError(400,'Invalid file');
 let bytes:Uint8Array;try{bytes=Uint8Array.from(atob(data.base64),c=>c.charCodeAt(0));}catch{throw new HttpError(400,'Invalid file');}
 if(bytes.length!==meta.size)throw new HttpError(400,'Size mismatch');
 const doc=await rpc('dvfm_crm',{p_actor:employee.id,p_action:'document.reserve',p_data:meta});
 await storage(`object/dvfm-private/${doc.path}`,'POST',new Blob([bytes as Uint8Array<ArrayBuffer>]),meta.mime);
 await rpc('dvfm_crm',{p_actor:employee.id,p_action:'document.complete',p_data:{id:doc.id}});
 return json({ok:true,data:{id:doc.id}});
 }
 if(input.action==='document.download'){
 const doc=await rpc('dvfm_crm',{p_actor:employee.id,p_action:'document.get',p_data:{id:data.id}});if(!doc.ready)throw new HttpError(404,'File not ready');
 const r=await storage(`object/sign/dvfm-private/${doc.path}`,'POST',JSON.stringify({expiresIn:60}),'application/json');const signed=await r.json();
 return json({ok:true,data:{url: signed.signedURL.startsWith('http')?signed.signedURL:`${Deno.env.get('SUPABASE_URL')}/storage/v1${signed.signedURL}`}});
 }
 if(!actions.has(input.action))throw new HttpError(400,'Unknown action');
 return json({ok:true,data:await rpc('dvfm_crm',{p_actor:employee.id,p_action:input.action,p_data:data})});
},true);
