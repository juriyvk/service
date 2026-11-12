import {serve,body,identity,json} from '../_shared/runtime.ts';
// Compatible response contract with the original index.html identity gate.
serve(async req=>{const data=await body(req);return json({ok:true,employee:await identity(data.initData)});},true);
