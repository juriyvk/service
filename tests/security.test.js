import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {verifyInitData,parseTaskMessage,validateDocument,equal} from '../supabase/functions/_shared/security.js';
const token='synthetic-test-token';
function signed(extra={}){const p=new URLSearchParams({auth_date:'1900000000',user:JSON.stringify({id:900000001,first_name:'Fixture'}),...extra});const check=[...p].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');const secret=createHmac('sha256','WebAppData').update(token).digest();p.set('hash',createHmac('sha256',secret).update(check).digest('hex'));return p.toString();}
test('valid Telegram HMAC and exact synthetic identity',async()=>assert.equal(await verifyInitData(signed(),token,1900000001),900000001));
test('reject tamper, wrong token, duplicate keys, expiry, future and missing user',async()=>{
 for(const [data,key,now] of [[signed().replace('900000001','900000002'),token,1900000001],[signed(),'wrong',1900000001],[signed()+'&auth_date=1900000000',token,1900000001],[signed(),token,1900003601],[signed(),token,1899999900],[signed({user:'null'}),token,1900000001],[signed({user:'{"id":-1}'}),token,1900000001],['',token,1900000001]])await assert.rejects(verifyInitData(data,key,now),e=>e.status===401);
});
test('role fields never become trusted identity',async()=>assert.equal(await verifyInitData(signed({role:'manager'}),token,1900000001),900000001));
test('constant comparison rejects length mismatch',()=>{assert.ok(equal('abc','abc'));assert.ok(!equal('abc','ab'));});
test('bot explicit command and self assignment',()=>{assert.deepEqual(parseTaskMessage('/task self | Test task | 2030-01-01'),{title:'Test task',due_date:'2030-01-01'});assert.throws(()=>parseTaskMessage('/task promote manager'));});
test('document MIME and size allowlist',()=>{assert.equal(validateDocument({name:'fixture.pdf',mime:'application/pdf',size:123}).size,123);for(const d of [{name:'x',mime:'text/html',size:1},{name:'x',mime:'application/pdf',size:10485761},{name:'',mime:'application/pdf',size:1}])assert.throws(()=>validateDocument(d));});
