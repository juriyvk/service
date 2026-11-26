import {HttpError} from './security.js';
const CLOUD_HOSTS=new Set(['ru.yougile.com','rf.yougile.com','yougile.com']);
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
export function settingsFor(input){
 let base;try{base=new URL(input.baseUrl||'https://ru.yougile.com/api-v2');}catch{throw new HttpError(503,'Некорректный адрес YouGile');}
 if(base.protocol!=='https:'||!CLOUD_HOSTS.has(base.hostname)||base.port||base.username||base.password||base.search||base.hash||!/^\/api-v2\/?$/.test(base.pathname))throw new HttpError(503,'Разрешён только облачный HTTPS API YouGile');
 if(!uuid(input.projectId)||!uuid(input.boardId))throw new HttpError(503,'Настройте YOUGILE_PROJECT_ID и YOUGILE_BOARD_ID в Secrets');
 if(typeof input.apiKey!=='string'||!input.apiKey||input.apiKey.length>4096||/\s/.test(input.apiKey))throw new HttpError(503,'Настройте YOUGILE_API_KEY в Secrets');
 return {...input,projectId:input.projectId.toLowerCase(),boardId:input.boardId.toLowerCase(),baseUrl:base.origin+'/api-v2'};
}
async function boundedJson(response){
 const reader=response.body?.getReader();if(!reader)throw new HttpError(502,'Пустой ответ YouGile');
 let size=0;const parts=[];
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>262144){await reader.cancel();throw new HttpError(502,'Слишком большой ответ YouGile');}parts.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
 try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new HttpError(502,'Некорректный JSON от YouGile');}
}
export function createYougileClient(input,fetchImpl=fetch,beforeRequest=async()=>{}){
 const settings=settingsFor(input);
 async function request(method,path,body){
  await beforeRequest();
  let response;
  try{response=await fetchImpl(settings.baseUrl+path,{method,headers:{Authorization:'Bearer '+settings.apiKey,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(10000)});}catch{throw new HttpError(502,'Не удалось связаться с YouGile');}
  if(!response.ok){await response.body?.cancel();const status=response.status;
   if(status===401||status===403)throw new HttpError(503,'Ключ YouGile недействителен или не имеет доступа к выбранному проекту');
   if(status===404)throw new HttpError(503,'Выбранный объект YouGile не найден','YG404');
   if(status===429)throw new HttpError(429,'YouGile ограничил частоту запросов. Повторите позже');
   throw new HttpError(502,'Сбой API YouGile (HTTP '+status+')');
  }
  return boundedJson(response);
 }
 const get=path=>request('GET',path);
 return {settings,get,
  task:async id=>{if(!uuid(id))throw new HttpError(400,'Некорректный ID задачи');return get('/tasks/'+id);},
  createTask:payload=>request('POST','/tasks',payload),
  updateTask:async(id,payload)=>{if(!uuid(id)||Object.keys(payload).some(k=>!['title','description','columnId','assigned','deadline','completed'].includes(k)))throw new HttpError(400,'Недопустимое изменение YouGile');return request('PUT','/tasks/'+id,payload);}
 };
}
export async function inspectYougile(input,fetchImpl=fetch){return readYougileScope(createYougileClient(input,fetchImpl));}
export async function readYougileScope(client){
 const {settings,get}=client;
 const project=await get('/projects/'+settings.projectId);
 if(project?.id!==settings.projectId||typeof project.title!=='string')throw new HttpError(502,'Неожиданный ответ проекта YouGile');
 if(project.deleted||project.archived)throw new HttpError(409,'Проект YouGile удалён или архивирован');
 const board=await get('/boards/'+settings.boardId);
 if(board?.id!==settings.boardId||board.projectId!==settings.projectId||typeof board.title!=='string')throw new HttpError(409,'Доска YouGile не принадлежит настроенному проекту');
 if(board.deleted)throw new HttpError(409,'Доска YouGile удалена');
 const columns=[];const seen=new Set();let offset=0;
 for(let page=0;page<5;page++){
  const data=await get('/columns?'+new URLSearchParams({boardId:settings.boardId,limit:'100',offset:String(offset)}));
  if(!Array.isArray(data?.content)||!data.paging||typeof data.paging.next!=='boolean'||data.content.length>100)throw new HttpError(502,'Неожиданный список колонок YouGile');
  for(const column of data.content){
   if(!uuid(column.id)||column.boardId!==settings.boardId||typeof column.title!=='string'||seen.has(column.id))throw new HttpError(502,'Некорректная принадлежность или повтор колонки YouGile');
   seen.add(column.id);if(!column.deleted)columns.push({id:column.id,title:column.title});
  }
  if(!data.paging.next)return {memberIds:Object.keys(project.users||{}).filter(id=>uuid(id)&&project.users[id]!=='-'&&project.users[id]!=='observer'),read_only:true,writes_performed:false,project:{id:project.id,title:project.title},board:{id:board.id,title:board.title},columns};
  if(data.content.length===0)throw new HttpError(502,'YouGile вернул пустую страницу с продолжением');
  offset+=data.content.length;
 }
 throw new HttpError(502,'Слишком много колонок для проверки подключения');
}
