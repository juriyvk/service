import {readFile,writeFile,mkdir} from 'node:fs/promises';
import ts from 'typescript';
const root=new URL('../',import.meta.url);
const names=['telegram-auth','crm','telegram-webhook'];
function removeImports(source,path){
 const ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true);
 const imports=ast.statements.filter(ts.isImportDeclaration);
 for(const node of imports){
  const specifier=node.moduleSpecifier.text;
  if(!['./security.js','../_shared/runtime.ts','../_shared/security.js'].includes(specifier))throw new Error(`Unexpected bundle dependency in ${path}`);
 }
 for(const node of imports.reverse())source=source.slice(0,node.getFullStart())+source.slice(node.getEnd());
 return source;
}
const common=await Promise.all(['_shared/security.js','_shared/runtime.ts'].map(async path=>removeImports(await readFile(new URL(`supabase/functions/${path}`,root),'utf8'),path)));
await mkdir(new URL('deploy/dashboard/',root),{recursive:true});
for(const name of names){
 const path=`supabase/functions/${name}/index.ts`;
 const entry=removeImports(await readFile(new URL(path,root),'utf8'),path);
 const source=common.join('\n')+'\n'+entry;
 const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext},reportDiagnostics:true});
 if(output.diagnostics?.length)throw new Error(`Bundle syntax error: ${name}`);
 const code='// @ts-nocheck\n// GENERATED JavaScript for pasting into Dashboard index.ts. Do not edit.\n// Canonical typed sources: supabase/functions/. Rebuild: node scripts/build-dashboard.mjs\n'+output.outputText;
 const target=new URL(`deploy/dashboard/${name}.ts`,root);
 if(process.argv.includes('--check')){if(await readFile(target,'utf8')!==code)throw new Error(`Regenerate Dashboard bundle: ${name}`);}
 else await writeFile(target,code);
}
