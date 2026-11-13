import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
const temp=await mkdtemp(`${tmpdir()}/dvfm-setup-`);await writeFile(`${temp}/package.json`,'{"type":"module"}');
const values={SUPABASE_URL:'https://wepogbvijpvyvyfzxzeo.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-key',TELEGRAM_BOT_TOKEN:'synthetic-token',OUTBOX_WORKER_AUTH:'Bearer synthetic-admin',TELEGRAM_WEBHOOK_SECRET:'synthetic_webhook_secret_for_tests_1234567890'};
let handler;globalThis.Deno={env:{get:name=>values[name]},serve:fn=>{handler=fn;}};
const source=await readFile(new URL('../deploy/dashboard/staging-telegram-setup.ts',import.meta.url),'utf8');
await writeFile(`${temp}/setup.js`,ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);await import(pathToFileURL(`${temp}/setup.js`));
const originalFetch=globalThis.fetch;let calls=[],wrongBot=false,currentUrl='',mainEnabled=true;
globalThis.fetch=async(url,options)=>{
 const method=String(url).split('/').at(-1),data=JSON.parse(options.body);calls.push({method,data});
 if(method==='dvfm_staging_configure_worker')return new Response(JSON.stringify({configured:true,job_name:'dvfm-staging-notifications',schedule:'* * * * *'}));
 let result;if(method==='getMe')result={is_bot:true,has_main_web_app:mainEnabled,username:wrongBot?'other_fixture_bot':'DVFMTESTCRM_bot'};
 else if(method==='getWebhookInfo')result={url:currentUrl,pending_update_count:0};
 else if(method==='setWebhook'){currentUrl=data.url;result=true;}else throw new Error('Unexpected method');
 return new Response(JSON.stringify({ok:true,result}));
};
const request=(action='inspect',auth=values.OUTBOX_WORKER_AUTH)=>new Request('https://fixture.invalid/',{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:auth}:{})},body:JSON.stringify({action,url:'https://attacker.invalid'})});
after(async()=>{globalThis.fetch=originalFetch;delete globalThis.Deno;await rm(temp,{recursive:true,force:true});});
test('setup helper requires independent authorization before network',async()=>{calls=[];for(const auth of ['', 'Bearer invalid'])assert.equal((await handler(request('configure',auth))).status,401);assert.equal(calls.length,0);});
test('setup helper cannot configure production or a different bot',async()=>{
 calls=[];values.SUPABASE_URL='https://production.fixture.invalid';assert.equal((await handler(request('configure'))).status,403);assert.equal(calls.length,0);values.SUPABASE_URL='https://wepogbvijpvyvyfzxzeo.supabase.co';
 wrongBot=true;assert.equal((await handler(request('configure'))).status,409);wrongBot=false;assert.ok(!calls.some(c=>c.method==='setWebhook'));
});
test('inspection makes no change; configure uses only fixed target and stored secret',async()=>{
 calls=[];const first=await handler(request());assert.equal(first.status,200);assert.equal((await first.json()).configured,false);assert.ok(!calls.some(c=>c.method==='setWebhook'));
 const response=await handler(request('configure'));assert.equal(response.status,200);const result=await response.json();assert.equal(result.configured,true);assert.equal(result.webhook_url,'https://wepogbvijpvyvyfzxzeo.supabase.co/functions/v1/telegram-webhook');
 const sent=calls.find(c=>c.method==='setWebhook');assert.equal(sent.data.secret_token,values.TELEGRAM_WEBHOOK_SECRET);assert.equal(sent.data.drop_pending_updates,false);assert.deepEqual(sent.data.allowed_updates,['message']);assert.ok(!JSON.stringify(result).includes(values.TELEGRAM_WEBHOOK_SECRET));
});
test('setup refuses to overwrite another existing webhook',async()=>{calls=[];currentUrl='https://other.fixture.invalid/hook';assert.equal((await handler(request('configure'))).status,409);assert.ok(!calls.some(c=>c.method==='setWebhook'));});

test('worker setup requires the staging Mini App link and sends auth only to fixed project RPC',async()=>{
 calls=[];assert.equal((await handler(request('configure_worker'))).status,503);assert.ok(!calls.some(c=>c.method==='dvfm_staging_configure_worker'));
 values.TELEGRAM_MINI_APP_URL='https://t.me/other_fixture_bot';calls=[];assert.equal((await handler(request('configure_worker'))).status,503);assert.ok(!calls.some(c=>c.method==='dvfm_staging_configure_worker'));
 values.TELEGRAM_MINI_APP_URL='https://t.me/DVFMTESTCRM_bot';mainEnabled=false;calls=[];assert.equal((await handler(request('configure_worker'))).status,409);assert.ok(!calls.some(c=>c.method==='dvfm_staging_configure_worker'));mainEnabled=true;calls=[];const response=await handler(request('configure_worker'));assert.equal(response.status,200);const result=await response.json();assert.equal(result.worker.configured,true);assert.ok(!JSON.stringify(result).includes(values.OUTBOX_WORKER_AUTH));
 assert.equal(calls.find(c=>c.method==='dvfm_staging_configure_worker').data.p_worker_auth,values.OUTBOX_WORKER_AUTH);assert.ok(!calls.some(c=>c.method==='setWebhook'));
});
