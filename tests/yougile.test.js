import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createHmac} from 'node:crypto';
import ts from 'typescript';
import {inspectYougile} from '../supabase/functions/_shared/yougile.js';
const projectId='00000000-0000-4000-8000-000000000001',boardId='00000000-0000-4000-8000-000000000002',columnId='00000000-0000-4000-8000-000000000003';
const settings={apiKey:'synthetic-yg-key',projectId,boardId};
const response=data=>new Response(JSON.stringify(data));
function api(calls,override){return async(url,options)=>{
 calls.push({url:String(url),options});if(override){const result=override(String(url),options);if(result)return result;}
 if(String(url).includes('/projects/'))return response({id:projectId,title:'Fixture project',users:{'private-id':'private-role'}});
 if(String(url).includes('/boards/'))return response({id:boardId,projectId,title:'Fixture board'});
 return response({paging:{next:false},content:[{id:columnId,boardId,title:'Fixture column'}]});
};}
test('inspection uses only GET, server-side scope and filtered metadata',async()=>{
 const calls=[];const result=await inspectYougile(settings,api(calls));assert.equal(calls.length,3);assert.equal(result.read_only,true);assert.equal(result.sync_enabled,false);assert.equal(result.columns.length,1);
 for(const call of calls){assert.equal(call.options.method,'GET');assert.equal(call.options.redirect,'error');assert.equal(call.options.headers.Authorization,'Bearer '+settings.apiKey);assert.ok(call.url.startsWith('https://ru.yougile.com/api-v2/'));}
 assert.ok(!JSON.stringify(result).includes(settings.apiKey));assert.ok(!JSON.stringify(result).includes('private-id'));
});
test('invalid API origins and identifiers never receive a credential',async()=>{
 for(const change of [{baseUrl:'http://ru.yougile.com/api-v2'},{baseUrl:'https://attacker.invalid/api-v2'},{baseUrl:'https://ru.yougile.com/api-v2?token=x'},{baseUrl:'https://name:password@ru.yougile.com/api-v2'},{baseUrl:'https://ru.yougile.com:8443/api-v2'},{projectId:'../users'},{boardId:'bad'}]){let sent=false;await assert.rejects(inspectYougile({...settings,...change},async()=>{sent=true;}));assert.equal(sent,false);}
});
test('wrong board or foreign column cannot leak other project metadata',async()=>{
 for(const override of [url=>url.includes('/boards/')?response({id:boardId,projectId:columnId,title:'Foreign'}):null,url=>url.includes('/columns?')?response({paging:{next:false},content:[{id:columnId,boardId:projectId,title:'Foreign'}]}):null])await assert.rejects(inspectYougile(settings,api([],override)));
});
test('API error details, malformed JSON and oversized responses are not exposed',async()=>{
 for(const status of [401,403,404,429,500])await assert.rejects(inspectYougile(settings,async()=>new Response('private-key-upstream',{status})),e=>!e.message.includes('private-key')&&e.status===(status===429?429:status===500?502:503));
 await assert.rejects(inspectYougile(settings,async()=>new Response('invalid JSON')));
 await assert.rejects(inspectYougile(settings,async()=>new Response('x'.repeat(262145))),/Слишком большой/);
});
test('pagination is bounded and empty continuation is rejected',async()=>{
 await assert.rejects(inspectYougile(settings,api([],url=>url.includes('/columns?')?response({paging:{next:true},content:[]}):null)),/пустую страницу/);
});
const temp=await mkdtemp(`${tmpdir()}/dvfm-yougile-`);await writeFile(`${temp}/package.json`,'{"type":"module"}');
const source=await readFile(new URL('../deploy/dashboard/yougile.ts',import.meta.url),'utf8');await writeFile(`${temp}/yougile.js`,ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);
const values={SUPABASE_URL:'https://db.fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',TELEGRAM_BOT_TOKEN:'fixture-bot',ALLOWED_ORIGINS:'https://fixture.invalid',YOUGILE_API_KEY:settings.apiKey,YOUGILE_PROJECT_ID:projectId,YOUGILE_BOARD_ID:boardId};
let handler;globalThis.Deno={env:{get:name=>values[name]},serve:fn=>{handler=fn;}};await import(pathToFileURL(`${temp}/yougile.js`));
const oldFetch=globalThis.fetch;let role='employee',network=[];
globalThis.fetch=async(url,options)=>{if(String(url).endsWith('dvfm_identity'))return response({id:projectId,role});return api(network)(url,options);};
const signed=()=>{const p=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),user:'{"id":940000001}'});const check=[...p].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');const secret=createHmac('sha256','WebAppData').update(values.TELEGRAM_BOT_TOKEN).digest();p.set('hash',createHmac('sha256',secret).update(check).digest('hex'));return p.toString();};
const req=data=>new Request('https://edge.fixture.invalid/',{method:'POST',headers:{'Content-Type':'application/json',origin:'https://fixture.invalid'},body:JSON.stringify(data)});
after(async()=>{globalThis.fetch=oldFetch;delete globalThis.Deno;await rm(temp,{recursive:true,force:true});});
test('endpoint denies unsigned or forged browser roles before contacting YouGile',async()=>{
 network=[];assert.equal((await handler(req({action:'inspect',initData:'bad',role:'manager'}))).status,401);assert.equal((await handler(req({action:'inspect',initData:signed(),role:'manager'}))).status,403);assert.equal(network.length,0);
});
test('manager inspection ignores caller URL/IDs and disallows write actions',async()=>{
 role='manager';network=[];const r=await handler(req({action:'inspect',initData:signed(),projectId:columnId,baseUrl:'https://attacker.invalid'}));assert.equal(r.status,200);const data=await r.json();assert.equal(data.data.project.id,projectId);assert.equal(data.data.sync_enabled,false);assert.equal(network.length,3);
 network=[];assert.equal((await handler(req({action:'create_task',initData:signed()}))).status,400);assert.equal(network.length,0);
});
