import {serve,body,identity,json} from '../_shared/runtime.ts';
import {HttpError} from '../_shared/security.js';
// Compatible response contract with the original index.html identity gate.
serve(async req=>{
 const data=await body(req);if(typeof data.initData!=='string')throw new HttpError(400,'initData required');
 const employee=await identity(data.initData);
 // Preserve the legacy ID and position in the existing identity-gate contract.
 // CRM actor UUID is resolved separately on every CRM request.
 return json({ok:true,employee:{id:employee.legacy_id,full_name:employee.full_name,position:employee.position,role:employee.role}});
},true);
