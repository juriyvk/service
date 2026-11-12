import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const server=createServer(async(req,res)=>{try{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(await readFile(new URL(req.url==='/app.js'?'../app.js':'../index.html',import.meta.url)));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://telegram.org/**',r=>r.fulfill({body:''}));await page.route('https://fonts.**/**',r=>r.abort());
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByRole('heading',{name:'Откройте через Telegram'}).waitFor();
 const employee={id:'00000000-0000-4000-8000-000000000003',role:'employee',full_name:'Fixture Employee'};
 const task={id:'00000000-0000-4000-8000-000000000010',title:'<img src=x onerror=alert(1)>',description:'Fixture description',assignee_id:employee.id,creator_id:employee.id,status:'pending',progress:0,version:1,due_date:'2030-01-01'};
 await page.addInitScript(()=>{window.Telegram={WebApp:{initData:'synthetic',initDataUnsafe:{},ready(){},expand(){}}};});
 const actions=[];
 await page.route('https://mskbgkiksgpdosiarjvo.supabase.co/functions/v1/**',async r=>{const input=r.request().postDataJSON();actions.push(input);let data;if(r.request().url().endsWith('telegram-auth'))data={ok:true,employee};else if(input.action==='snapshot')data={ok:true,data:{employee,employees:[employee],tasks:[task],projects:[],documents:[]}};else if(input.action==='task.detail')data={ok:true,data:{task,comments:[],checkpoints:[],history:[]}};else data={ok:true,data:{}};await r.fulfill({json:data});});
 await page.reload();await page.getByRole('heading',{name:'Мои задачи'}).waitFor();assert.equal(await page.locator('#content img').count(),0);assert.equal(await page.locator('.nav button').count(),5);
 await page.getByRole('button',{name:'+ Новая задача'}).click();assert.equal(await page.locator('#assignee option').count(),1);await page.locator('[name=title]').fill('Synthetic task');await page.getByRole('button',{name:'Создать',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('modalwrap').classList.contains('show'));assert.ok(actions.some(a=>a.action==='task.create'&&a.data.assignee_id===employee.id));
 await page.locator('[data-task]').click();await page.getByRole('button',{name:'Принять задачу',exact:true}).waitFor();await page.getByRole('button',{name:'Закрыть',exact:true}).click();
 for(const title of ['Проекты','Документы','Аналитика','Справка']){await page.locator(`[data-tab="${{Проекты:'projects',Документы:'documents',Аналитика:'analytics',Справка:'help'}[title]}"]`).click();await page.getByRole('heading',{name:title==='Документы'?'Приватная библиотека':title,exact:true}).waitFor();}
 await page.locator('#help-search').fill('Telegram');assert.equal(await page.locator('#help-items .card').count(),2);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));assert.deepEqual(errors,[]);
 await page.screenshot({path:'/tmp/dvfm-mini-app.png',fullPage:true});console.log('Browser: gate, authorized navigation, self task, acceptance UI, XSS escaping, search and mobile width passed');
}finally{await browser.close();await new Promise(r=>server.close(r));}
