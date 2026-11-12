import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
const sourceHtml=await readFile(new URL('index.html',root),'utf8');
const sourceApp=await readFile(new URL('app.js',root),'utf8');
const sourceBase='https://mskbgkiksgpdosiarjvo.supabase.co/functions/v1/';
const targetBase='https://wepogbvijpvyvyfzxzeo.supabase.co/functions/v1/';
if(sourceApp.split(sourceBase).length!==2)throw new Error('Expected one canonical API base');
const app=sourceApp.replace(sourceBase,targetBase).replace('@dvfm_service_bot','@DVFMTESTCRM_bot');
const html=sourceHtml.replace('<title>СЕРВИС | ДВФМ</title>','<meta name="robots" content="noindex"><title>СЕРВИС | ДВФМ — тестовая среда</title>').replace('Внутренняя платформа отдела','Тестовая среда · DVFMTESTCRM_bot');
const hash=s=>createHash('sha256').update(s).digest('hex');
const files={
 'index.html':html,
 'app.js':app,
 'manifest.json':JSON.stringify({environment:'staging',api_base:targetBase,bot:'DVFMTESTCRM_bot',source:{index_sha256:hash(sourceHtml),app_sha256:hash(sourceApp)},output:{index_sha256:hash(html),app_sha256:hash(app)}},null,2)+'\n'
};
const outputFlag=process.argv.indexOf('--out');
const out=outputFlag>=0?resolve(process.argv[outputFlag+1]):new URL('preview/staging/',root);
await mkdir(out,{recursive:true});
for(const [name,value] of Object.entries(files)){
 const path=typeof out==='string'?resolve(out,name):new URL(name,out);
 if(process.argv.includes('--check')){if(await readFile(path,'utf8')!==value)throw new Error('Regenerate staging preview');}
 else await writeFile(path,value);
}
