import {test} from 'node:test';import assert from 'node:assert/strict';
import {mergeTask,remotePatch,remoteSnapshot,localSnapshot,assertIncomingStatus} from '../supabase/functions/_shared/yougile-merge.js';
const base={title:'Fixture',description:'Plain',assignee_id:'local',status:'in_progress',due_date:null};
const task={...base,version:3},link={base_local:{...base},base_remote:{...base}};
test('three-way merge combines disjoint edits and flags divergent edits',()=>{
 const result=mergeTask({...task,title:'Local'},{...base,description:'Remote'},link);
 assert.deepEqual(result.push,['title']);assert.deepEqual(result.pull,['description']);assert.equal(result.desired.title,'Local');assert.equal(result.desired.description,'Remote');
 assert.throws(()=>mergeTask({...task,title:'L'},{...base,title:'R'},link),e=>e.reason==='both_sides_changed'&&e.fields.includes('title'));
});
test('own acknowledged updates and accepted/New projection do not echo',()=>{
 const accepted={...task,status:'accepted'},l={base_local:localSnapshot(accepted),base_remote:{...base,status:'pending'}};
 assert.deepEqual(mergeTask(accepted,{...base,status:'pending'},l).push,[]);
 assert.deepEqual(mergeTask(task,{...base},link),{desired:base,push:[],pull:[]});
});
test('resolution must match both current local version and observed remote snapshot',()=>{
 const reordered=JSON.parse(JSON.stringify(base,Object.keys(base).sort()));const l={...link,resolution:{choice:'local',version:3,remote:reordered}};assert.deepEqual(mergeTask({...task,title:'Local'},base,l).push,['title']);
 assert.throws(()=>mergeTask({...task,version:4},base,l),/resolution_stale/);assert.throws(()=>mergeTask(task,{...base,title:'new edit'},l),/resolution_stale/);
});
test('payload is a field subset, escapes HTML and never archives or deletes a task',()=>{
 const patch=remotePatch({...base,description:'<img src=x>&'},['description'],{},[],{});assert.deepEqual(patch,{description:'&lt;img src=x&gt;&amp;'});
 assert.throws(()=>remotePatch({...base,status:'cancelled'},['status'],{},[],{}),/status_unmapped/);
 assert.throws(()=>remotePatch({...base,due_date:'2030-01-02'},['due_date'],{},[],{deadline:{withTime:true}}),/timed_deadline/);
});
test('remote scope and single known assignee are required',()=>{
 const remote={id:'remote',columnId:'work',title:'Fixture',description:'&lt;x&gt;',assigned:['remote-user'],completed:false};
 const snapshot=remoteSnapshot(remote,{in_progress:'work'},[{employee_id:'local',remote_user:'remote-user'}]);assert.equal(snapshot.description,'<x>');
 assert.equal(remoteSnapshot({...remote,completed:true},{in_progress:'work'},[{employee_id:'local',remote_user:'remote-user'}]).status,'done');
 for(const change of [{columnId:'outside'},{assigned:[]},{assigned:['unknown']},{deleted:true}])assert.throws(()=>remoteSnapshot({...remote,...change},{in_progress:'work'},[{employee_id:'local',remote_user:'remote-user'}]));
});
test('incoming status cannot invent acceptance or reopen terminal tasks',()=>{
 assert.throws(()=>assertIncomingStatus({...task,status:'pending'},{...base,status:'done'}),/acceptance_required/);
 assert.throws(()=>assertIncomingStatus({...task,status:'done'},{...base,status:'in_progress'}),/invalid_transition/);
 assert.doesNotThrow(()=>assertIncomingStatus(task,{...base,status:'review'}));
});
