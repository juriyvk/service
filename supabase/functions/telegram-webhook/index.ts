import {serve,body,json,rpc,requireSecret,drain,telegram,storage,env} from '../_shared/runtime.ts';
import {HttpError,parseTaskMessage,validateDocument} from '../_shared/security.js';
serve(async req=>{
 // Cron worker endpoint uses a separate secret; never accepts employee/browser roles.
 if(new URL(req.url).searchParams.get('worker')==='1'){requireSecret(req.headers.get('authorization'),'OUTBOX_WORKER_AUTH');await drain();return json({ok:true});}
 requireSecret(req.headers.get('x-telegram-bot-api-secret-token'),'TELEGRAM_WEBHOOK_SECRET');
 const update=await body(req);const m=update.message;
 if(!Number.isSafeInteger(update.update_id))throw new HttpError(400,'Invalid update');
 if(!m||m.chat?.type!=='private'||m.chat.id!==m.from?.id||m.from?.is_bot||!Number.isSafeInteger(m.from?.id)||m.from.id<=0)return json({ok:true});
 // Explicit identity help in a verified private chat grants no employee access.
 if(/^\/id(?:@\w+)?$/i.test(m.text||'')){
  await telegram('sendMessage',{chat_id:m.chat.id,text:'Ваш Telegram ID: '+m.from.id+'\nПередайте его администратору лично. Эта команда не предоставляет доступ к CRM.'});
  return json({ok:true});
 }
 const actor=await rpc('dvfm_identity',{p_telegram_id:m.from.id});if(!actor)return json({ok:true});
 try{
 if(m.document){
 const d=m.document;const meta=validateDocument({name:d.file_name,mime:d.mime_type,size:d.file_size});
 const doc=await rpc('dvfm_bot',{p_update_id:update.update_id,p_telegram_id:m.from.id,p_action:'document.reserve',p_data:meta});
 if(doc.duplicate)return json({ok:true});
 const file=await telegram('getFile',{file_id:d.file_id});
 if(!/^[a-zA-Z0-9_./-]+$/.test(file.file_path)||file.file_path.includes('..'))throw new HttpError(400,'Invalid Telegram file path');
 const r=await fetch(`https://api.telegram.org/file/bot${env('TELEGRAM_BOT_TOKEN')}/${file.file_path}`,{signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw new HttpError(502,'Download failed');
 // Reuse bounded streaming decoder-independent size check.
 const reader=r.body!.getReader();let size=0;const parts:Uint8Array[]=[];
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>meta.size){await reader.cancel();throw new HttpError(400,'File too large');}parts.push(value);}
 if(size!==meta.size)throw new HttpError(400,'Size mismatch');const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
 await storage(`object/dvfm-private/${doc.path}`,'POST',bytes,meta.mime);
 await rpc('dvfm_crm',{p_actor:actor.id,p_action:'document.complete',p_data:{id:doc.id}});
 await telegram('sendMessage',{chat_id:m.chat.id,text:'Документ сохранён в вашей приватной библиотеке.'});
 }else if(m.text?.startsWith('/task')){
 await rpc('dvfm_bot',{p_update_id:update.update_id,p_telegram_id:m.from.id,p_action:'task.create',p_data:parseTaskMessage(m.text)});
 }else if(m.text&&!m.text.startsWith('/')){
 await rpc('dvfm_bot',{p_update_id:update.update_id,p_telegram_id:m.from.id,p_action:'task.create',p_data:{title:m.text.slice(0,240),description:m.text}});
 }else{await telegram('sendMessage',{chat_id:m.chat.id,text:'Отправьте текст для задачи самому себе; /task self | Название | ГГГГ-ММ-ДД. Руководитель и заместитель могут указать UUID сотрудника вместо self. Отправьте документ для приватной библиотеки.'});}
 }catch(e){if(e instanceof HttpError&&e.status<500){await telegram('sendMessage',{chat_id:m.chat.id,text:e.message});return json({ok:true});}throw e;}
 await drain();return json({ok:true});
});
