(()=>{
 const yg=async(action,data={})=>(await request('yougile',{action,data})).data;
 const reason={both_sides_changed:'Одно поле изменено с двух сторон',acceptance_required:'Исполнитель должен принять задачу в CRM',crm_transition_rejected:'Переход статуса или контрольные точки не позволяют обновление',remote_outside_scope:'Задача перемещена за пределы связи',remote_removed:'Задача удалена или архивирована в YouGile',unbound_assignee:'Не сопоставлен ответственный',single_assignee_required:'В YouGile нужен один ответственный',local_changed:'Задача изменилась во время синхронизации',resolution_stale:'После выбора появились новые изменения',timed_deadline_requires_review:'Срок со временем требует ручного решения'};
 window.showYougileIntegration=async()=>{
  const data=await yg('status'),cfg=data.config;
  modal('Синхронизация YouGile','<p class="hint">Секрет API хранится только на сервере. Документы и роли сотрудников не синхронизируются.</p>'+
   '<div class="card"><b>'+(cfg?.enabled&&data.server_enabled?'Включена':'Выключена')+'</b><p>В очереди: '+Number(data.pending)+'</p>'+
   (!data.server_enabled?'<p class="small">Для запуска администратор должен включить YOUGILE_SYNC_ENABLED в Secrets.</p>':'')+
   '<button class="ghost" id="yg-configure">Настройки связи</button> '+(cfg?.enabled&&data.server_enabled?'<button class="btn" id="yg-run">Синхронизировать</button>':'')+'</div>'+
   (cfg?.scan_error?'<div class="card"><b>Импорт требует внимания</b><p>'+esc(reason[cfg.scan_error.reason]||cfg.scan_error.reason)+'</p></div>':'')+
   (data.issues||[]).map(x=>'<div class="card"><b>'+esc(x.title)+'</b><p>'+esc(reason[x.conflict?.reason]||x.conflict?.reason||'Повторная попытка доставки')+'</p>'+
    (x.conflict?.remote?'<p class="small">Название в YouGile: '+esc(x.conflict.remote.title)+'</p><button class="ghost" data-yg-resolve="local" data-task="'+x.task_id+'">Оставить CRM</button> <button class="ghost" data-yg-resolve="remote" data-task="'+x.task_id+'">Принять YouGile</button>':'<button class="ghost" data-yg-retry="'+x.task_id+'">Повторить после исправления</button>')+'</div>').join('')+
   '<p class="small">Принятие исполнителем и закрытие контрольных точек обязательны и при выборе версии YouGile.</p>');
  $('yg-configure').onclick=()=>run(()=>configure(data));
  if($('yg-run'))$('yg-run').onclick=()=>run(async()=>{await yg('run');await refresh();await window.showYougileIntegration();});
  document.querySelectorAll('[data-yg-resolve]').forEach(b=>b.onclick=()=>run(async()=>{
   const issue=data.issues.find(x=>x.task_id===b.dataset.task);
   await yg('resolve',{task_id:issue.task_id,conflict_id:issue.conflict.id,version:issue.local_version,choice:b.dataset.ygResolve});
   await window.showYougileIntegration();
  }));
  document.querySelectorAll('[data-yg-retry]').forEach(b=>b.onclick=()=>run(async()=>{await yg('retry.reset',{task_id:b.dataset.ygRetry});await window.showYougileIntegration();}));
 };
 async function configure(status){
  const scope=await yg('inspect'),cfg=status.config;
  const defaults={pending:'Новые',in_progress:'В работе',review:'На проверке',done:'Готово',cancelled:'Отменено'};
  modal('Настройки YouGile','<p><b>'+esc(scope.project.title)+'</b> · '+esc(scope.board.title)+'</p><form id="yg-form">'+
   '<label class="formlabel">Проект CRM</label><select class="field" name="project_id">'+state.projects.map(p=>'<option value="'+p.id+'" '+(p.id===cfg?.project_id?'selected':'')+'>'+esc(p.title)+'</option>').join('')+'</select>'+
   Object.entries(defaults).map(([key,label])=>'<label class="formlabel">'+label+(key==='cancelled'?' (необязательно)':'')+'</label><select class="field" name="column_'+key+'">'+(key==='cancelled'?'<option value="">Не синхронизировать отмену</option>':'')+
    scope.columns.map(c=>'<option value="'+c.id+'" '+((cfg?.columns?.[key]===c.id||!cfg&&c.title===label)?'selected':'')+'>'+esc(c.title)+'</option>').join('')+'</select>').join('')+
   '<p><label><input type="checkbox" name="enabled" '+(cfg?.enabled?'checked':'')+'> Включить связь</label></p><p><label><input type="checkbox" name="import_new" '+(cfg?.import_new?'checked':'')+'> Импортировать новые задачи из YouGile</label></p>'+
   '<button class="btn" '+(!state.projects.length?'disabled':'')+'>Сохранить связь</button></form><h2 class="section">Ответственные</h2><p class="small">Сверьте ID пользователя в YouGile. Сопоставление не создаёт сотрудника и не изменяет его роль.</p>'+
   '<form id="yg-bind"><label class="formlabel">Сотрудник CRM</label><select name="employee_id" class="field">'+people(state.employee.id)+'</select><label class="formlabel">ID участника YouGile</label><select name="remote_user" class="field">'+scope.memberIds.map(id=>'<option value="'+esc(id)+'">'+esc(id)+'</option>').join('')+'</select><button class="ghost">Сопоставить</button></form>'+
   '<div class="small section">'+(status.users||[]).map(u=>esc(name(u.employee_id))+' → '+esc(u.remote_user)).join('<br>')+'</div>');
  $('yg-form').onsubmit=e=>{e.preventDefault();run(async()=>{const form=new FormData(e.target),columns={};for(const key of Object.keys(defaults)){const value=form.get('column_'+key);if(value)columns[key]=value;}await yg('configure',{project_id:form.get('project_id'),columns,enabled:form.has('enabled'),import_new:form.has('import_new')});await window.showYougileIntegration();});};
  $('yg-bind').onsubmit=e=>{e.preventDefault();run(async()=>{await yg('bind',Object.fromEntries(new FormData(e.target)));await configure(await yg('status'));});};
 }
})();
