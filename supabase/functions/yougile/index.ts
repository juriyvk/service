import {serve,body,identity,json,env} from '../_shared/runtime.ts';
import {HttpError} from '../_shared/security.js';
import {inspectYougile} from '../_shared/yougile.js';
// Connection inspection only. No external task writes or employee imports.
serve(async req=>{
 const input=await body(req);const employee=await identity(input.initData);
 if(!['manager','deputy'].includes(employee.role))throw new HttpError(403,'Проверка интеграции доступна руководителю и заместителю');
 if(input.action!=='inspect')throw new HttpError(400,'Доступно только действие inspect');
 const result=await inspectYougile({apiKey:env('YOUGILE_API_KEY'),projectId:env('YOUGILE_PROJECT_ID'),boardId:env('YOUGILE_BOARD_ID'),baseUrl:Deno.env.get('YOUGILE_API_BASE')});
 return json({ok:true,data:result});
},true);
