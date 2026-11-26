import {chromium} from '@playwright/test';import {createServer} from 'node:http';import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';
const server=createServer(async(req,res)=>{const name=req.url==='/'?'index.html':req.url?.slice(1);if(!['index.html','app.js','yougile-ui.js'].includes(name)){res.writeHead(404).end();return;}res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':'text/html');res.end(await readFile(new URL('../'+name,import.meta.url)));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],actions=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://telegram.org/**',r=>r.fulfill({body:''}));await page.route('https://fonts.**/**',r=>r.abort());
 await page.addInitScript(()=>{window.Telegram={WebApp:{initData:'synthetic',initDataUnsafe:{},ready(){},expand(){}}};});
 const id=n=>'50000000-0000-4000-8000-'+String(n).padStart(12,'0');
 const employee={id:id(1),full_name:'Synthetic manager',role:'manager'},project={id:id(2),title:'Fixture CRM project',owner_id:id(1)};
 const columns=['Новые','В работе','На проверке','Готово'].map((title,n)=>({id:id(n+10),title}));
 let issues=[{task_id:id(3),title:'<img src=x onerror=alert(1)>',remote_id:id(4),local_version:7,conflict:{id:id(5),reason:'both_sides_changed',remote:{title:'Remote fixture'}}}],bindings=[],cfg={enabled:false,project_id:project.id,columns:{pending:columns[0].id,in_progress:columns[1].id,review:columns[2].id,done:columns[3].id}};
 await page.route('https://mskbgkiksgpdosiarjvo.supabase.co/functions/v1/**',async route=>{
  const body=route.request().postDataJSON(),endpoint=route.request().url().split('/').at(-1);actions.push({endpoint,...body});
  if(endpoint==='telegram-auth'){await route.fulfill({json:{ok:true,employee}});return;}
  if(endpoint==='crm'){await route.fulfill({json:{ok:true,data:{employee,employees:[employee],projects:[project],tasks:[],documents:[]}}});return;}
  let data={};
  if(body.action==='status')data={config:cfg,users:bindings,pending:1,issues,server_enabled:false};
  if(body.action==='inspect')data={project:{title:'<img src=x>'},board:{title:'Fixture board'},columns,memberIds:[id(6)]};
  if(body.action==='resolve')issues=[];
  if(body.action==='configure')cfg={...cfg,...body.data};
  if(body.action==='bind')bindings=[body.data];
  await route.fulfill({json:{ok:true,data}});
 });
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.locator('[data-tab="help"]').click();await page.getByRole('button',{name:'Синхронизация YouGile',exact:true}).click();
 await page.getByText('Одно поле изменено с двух сторон').waitFor();assert.equal(await page.locator('#modalbody img').count(),0);
 await page.getByRole('button',{name:'Оставить CRM',exact:true}).click();await page.getByRole('button',{name:'Настройки связи',exact:true}).waitFor();
 assert.ok(actions.some(a=>a.action==='resolve'&&a.data.version===7&&a.data.conflict_id===id(5)));
 await page.getByRole('button',{name:'Настройки связи',exact:true}).click();await page.locator('#yg-form').waitFor();assert.equal(await page.locator('#modalbody img').count(),0);
 await page.getByRole('button',{name:'Сопоставить',exact:true}).click();await page.locator('#yg-bind').waitFor();assert.ok(actions.some(a=>a.action==='bind'&&a.data.employee_id===employee.id&&a.data.remote_user===id(6)));
 await page.getByRole('button',{name:'Сохранить связь',exact:true}).click();await page.getByRole('button',{name:'Настройки связи',exact:true}).waitFor();assert.ok(actions.some(a=>a.action==='configure'&&a.data.project_id===project.id&&a.data.columns.done===columns[3].id));
 assert.equal(await page.getByRole('button',{name:'Синхронизировать',exact:true}).count(),0);assert.deepEqual(errors,[]);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
 console.log('YouGile UI: admin settings, safe conflict display, versioned resolution and employee ID binding passed');
}finally{await browser.close();await new Promise(r=>server.close(r));}
