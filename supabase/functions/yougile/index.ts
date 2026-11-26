import {serve,body,identity,json,env,rpc,requireSecret} from '../_shared/runtime.ts';
import {HttpError} from '../_shared/security.js';
import {inspectYougile} from '../_shared/yougile.js';
import {syncYougile} from '../_shared/yougile-sync.js';
const syncEnabled=()=>Deno.env.get('YOUGILE_SYNC_ENABLED')==='true';
const settings=()=>({apiKey:env('YOUGILE_API_KEY'),projectId:env('YOUGILE_PROJECT_ID'),boardId:env('YOUGILE_BOARD_ID'),baseUrl:Deno.env.get('YOUGILE_API_BASE')});
serve(async req=>{
 if(new URL(req.url).searchParams.get('worker')==='1'){
  requireSecret(req.headers.get('authorization'),'OUTBOX_WORKER_AUTH');
  if(!syncEnabled())return json({ok:true,data:{enabled:false}});
  return json({ok:true,data:await syncYougile(settings(),rpc)});
 }
 const input=await body(req);const employee=await identity(input.initData);
 if(!['manager','deputy'].includes(employee.role))throw new HttpError(403,'Интеграция доступна руководителю и заместителю');
 const data=input.data||{};
 const local=async(action:string,value:unknown={})=>{try{return await rpc('dvfm_yg',{p_actor:employee.id,p_action:action,p_data:value});}catch(error){if(error instanceof HttpError&&error.code==='PGRST202')throw new HttpError(503,'Нужно применить миграцию синхронизации YouGile');throw error;}};
 if(input.action==='inspect')return json({ok:true,data:await inspectYougile(settings())});
 if(input.action==='status')return json({ok:true,data:{...await local('status'),server_enabled:syncEnabled()}});
 if(input.action==='configure'||input.action==='bind'){
  const configured=settings(),scope=await inspectYougile(configured);
  if(input.action==='configure'){
   const columns=data.columns;if(!columns||typeof columns!=='object'||Array.isArray(columns)||Object.values(columns).some(id=>!scope.columns.some(c=>c.id===id)))throw new HttpError(400,'Все колонки должны принадлежать выбранной доске');
   return json({ok:true,data:await local('configure',{...data,remote_project:configured.projectId,board_id:configured.boardId})});
  }
  if(!scope.memberIds.includes(data.remote_user))throw new HttpError(400,'Нужен ID активного прямого участника выбранного проекта YouGile');
  return json({ok:true,data:await local('bind',{employee_id:data.employee_id,remote_user:data.remote_user})});
 }
 if(input.action==='resolve'||input.action==='retry.reset')return json({ok:true,data:await local(input.action,data)});
 if(input.action==='run'){
  if(!syncEnabled())throw new HttpError(409,'Синхронизация выключена. Сначала проверьте настройки и YOUGILE_SYNC_ENABLED');
  return json({ok:true,data:await syncYougile(settings(),rpc)});
 }
 throw new HttpError(400,'Неизвестное действие интеграции');
},true);
