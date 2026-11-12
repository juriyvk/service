import {serve,body,json,env,requireSecret,telegram} from '../_shared/runtime.ts';
import {HttpError} from '../_shared/security.js';
// Temporary administrative helper for this staging project and bot only.
const project='https://wepogbvijpvyvyfzxzeo.supabase.co';
const botUsername='DVFMTESTCRM_bot';
serve(async req=>{
 requireSecret(req.headers.get('authorization'),'OUTBOX_WORKER_AUTH');
 if(env('SUPABASE_URL').replace(/\/$/,'')!==project)throw new HttpError(403,'Staging project required');
 const input=await body(req);
 if(!['inspect','configure'].includes(input.action))throw new HttpError(400,'Use inspect or configure');
 const me=await telegram('getMe',{});
 if(!me.is_bot||me.username?.toLowerCase()!==botUsername.toLowerCase())throw new HttpError(409,'Staging bot token does not match expected username');
 const url=project+'/functions/v1/telegram-webhook';
 let info=await telegram('getWebhookInfo',{});
 if(input.action==='configure'){
  if(info.url&&info.url!==url)throw new HttpError(409,'Bot already has a different webhook; inspect before changing it');
  const secret=env('TELEGRAM_WEBHOOK_SECRET');
  if(!/^[A-Za-z0-9_-]{32,256}$/.test(secret))throw new HttpError(503,'Invalid webhook secret format');
  await telegram('setWebhook',{url,secret_token:secret,allowed_updates:['message'],max_connections:10,drop_pending_updates:false});
  info=await telegram('getWebhookInfo',{});
 }
 return json({ok:true,bot:me.username,configured:info.url===url,webhook_url:info.url||null,pending_updates:info.pending_update_count||0});
});
