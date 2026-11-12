import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
const temp=await mkdtemp(`${tmpdir()}/dvfm-edge-`);
await writeFile(`${temp}/package.json`,'{"type":"module"}');
for(const file of ['_shared/runtime.ts','_shared/security.js','crm/index.ts','telegram-auth/index.ts','telegram-webhook/index.ts']){
 const source=await readFile(new URL(`../supabase/functions/${file}`,import.meta.url),'utf8');
 const output=file.replace(/\.ts$/,'.js');await mkdir(`${temp}/${output.split('/')[0]}`,{recursive:true});
 await writeFile(`${temp}/${output}`,ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,allowJs:true}}).outputText.replaceAll("runtime.ts'","runtime.js'"));
}
const values={TELEGRAM_BOT_TOKEN:'synthetic-token',ALLOWED_ORIGINS:'https://fixture.invalid',SUPABASE_URL:'https://db.fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-key',TELEGRAM_WEBHOOK_SECRET:'synthetic-webhook',OUTBOX_WORKER_AUTH:'Bearer synthetic-worker'};
let handler;globalThis.Deno={env:{get:name=>values[name]},serve:fn=>{handler=fn;}};
const routes={};for(const name of ['crm','telegram-auth','telegram-webhook']){await import(pathToFileURL(`${temp}/${name}/index.js`));routes[name]=handler;}
const originalFetch=globalThis.fetch;let calls=[];let registered=true;
globalThis.fetch=async(url,options)=>{calls.push({url:String(url),body:JSON.parse(options.body)});const data=String(url).endsWith('dvfm_identity')?(registered?{id:'server-actor',role:'employee',full_name:'Fixture'}:null):{confirmed:true};return new Response(JSON.stringify(data),{status:200});};
function signed(){const p=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),user:'{"id":900000001}'});const check=[...p].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');const secret=createHmac('sha256','WebAppData').update(values.TELEGRAM_BOT_TOKEN).digest();p.set('hash',createHmac('sha256',secret).update(check).digest('hex'));return p.toString();}
const req=(data,headers={})=>new Request('https://edge.fixture.invalid/',{method:'POST',headers:{'Content-Type':'application/json',origin:'https://fixture.invalid',...headers},body:JSON.stringify(data)});
after(async()=>{globalThis.fetch=originalFetch;delete globalThis.Deno;await rm(temp,{recursive:true,force:true});});
test('auth retains original ok/employee contract',async()=>{const r=await routes['telegram-auth'](req({initData:signed()}));assert.equal(r.status,200);assert.equal((await r.json()).employee.role,'employee');});
test('each CRM operation authenticates and uses only DB actor',async()=>{calls=[];const r=await routes.crm(req({initData:signed(),action:'task.create',data:{title:'Fixture',p_actor:'forged',role:'manager'},p_actor:'forged',role:'manager'}));assert.equal(r.status,200);assert.equal(calls.length,2);assert.equal(calls[1].body.p_actor,'server-actor');assert.equal(calls[1].body.p_action,'task.create');});
test('unsigned requests cannot reach DB; revoked identity denied',async()=>{calls=[];assert.equal((await routes.crm(req({initData:'bad',action:'snapshot'}))).status,401);assert.equal(calls.length,0);registered=false;assert.equal((await routes.crm(req({initData:signed(),action:'snapshot'}))).status,403);registered=true;});
test('CORS exact origin and POST restriction',async()=>{assert.equal((await routes.crm(req({}, {origin:'https://attacker.invalid'}))).status,403);assert.equal((await routes.crm(new Request('https://edge.fixture.invalid/'))).status,405);const r=await routes.crm(new Request('https://edge.fixture.invalid/',{method:'OPTIONS',headers:{origin:'https://fixture.invalid'}}));assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-origin'),'https://fixture.invalid');});
test('webhook requires independent secret; workers require separate authorization',async()=>{calls=[];assert.equal((await routes['telegram-webhook'](req({update_id:1}))).status,401);assert.equal((await routes['telegram-webhook'](new Request('https://edge.fixture.invalid/?worker=1',{method:'POST'}))).status,401);assert.equal(calls.length,0);assert.equal((await routes['telegram-webhook'](req({update_id:1},{'x-telegram-bot-api-secret-token':values.TELEGRAM_WEBHOOK_SECRET}))).status,200);});
test('groups are ignored even with valid webhook secret',async()=>{calls=[];const r=await routes['telegram-webhook'](req({update_id:2,message:{chat:{id:-1,type:'group'},from:{id:900000001},text:'Fixture'}},{'x-telegram-bot-api-secret-token':values.TELEGRAM_WEBHOOK_SECRET}));assert.equal(r.status,200);assert.equal(calls.length,0);});
