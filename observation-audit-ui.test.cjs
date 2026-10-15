'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const A=require('./observation-audit.js'),P=require('./observation-plan.js'),KEY='acl-observation-plans-v1';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function plan(id='synthetic-plan'){return {schema:'observation-plan-v1',id,title:'虚构软件测试计划',createdAt:'2026-10-10T00:00:00Z',context:{softwareVersion:'test-1',targetAppVersion:'test-2',deviceAlias:'virtual',network:'test-network',taskId:'test-task'},task:'仅软件验证，无真实设备或参与者结果',primaryMeasure:'开屏广告次数',durationSeconds:30,rounds:[...'ABBABAAB'].map((condition,i)=>({number:i+1,condition}))};}
// Event/state unit tests using minimal DOM doubles, not browser automation.
function harness({storage=new Map(),planApi=P}={}){
  const nodes=new Map(),downloads=[];
  class Element{
    constructor(tag='div'){this.tagName=tag;this.children=[];this.listeners={};this.value='';this.disabled=false;this._text='';}
    set textContent(v){this._text=String(v);this.children=[];}get textContent(){return this._text+this.children.map(c=>c.textContent||'').join('');}
    append(...children){this.children.push(...children);}add(child){this.append(child);}replaceChildren(...children){this._text='';this.children=[];this.append(...children);}
    addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}async emit(type,event={target:this}){for(const fn of this.listeners[type]||[])await fn(event);}click(){return this.emit('click');}
  }
  class Option extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}}
  for(const m of fs.readFileSync(path.join(__dirname,'project-review.html'),'utf8').matchAll(/<(\w+)[^>]*\bid="([^"]+)"/g))nodes.set(m[2],new Element(m[1]));
  const get=id=>{if(!nodes.has(id))throw Error('Missing DOM id '+id);return nodes.get(id);};
  get('observation-export').disabled=true;
  const context={window:{ObservationAudit:A,ObservationPlan:planApi},document:{getElementById:get,createElement:tag=>new Element(tag)},Option,localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},crypto:{randomUUID:()=> 'synthetic-id'},Date,Blob,URL:{createObjectURL:blob=>{downloads.push(blob);return 'blob:test';},revokeObjectURL(){}},setTimeout};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'observation-audit-ui.js'),'utf8'),context,{filename:'observation-audit-ui.js'});
  const change=(id,file)=>get(id).emit('change',{target:{files:[file],value:'file'}});
  return {get,storage,downloads,csv:file=>change('observation-file',file),importPlan:file=>change('plan-file',file)};
}
const csvFile=(text=A.template(),name='synthetic.csv')=>({name,size:Buffer.byteLength(text),text:async()=>text});
const planFile=e=>csvFile(JSON.stringify(e),'synthetic-plan.json');

test('开始读取新CSV立即撤下旧结果并禁用导出，迟到旧文件不覆盖最新结果',async()=>{
  const h=harness();await tick();await h.csv(csvFile());assert.equal(h.get('observation-export').disabled,false);
  const slow=deferred(),pending=h.csv({name:'slow.csv',size:100,text:()=>slow.promise});
  assert.equal(h.get('observation-export').disabled,true);assert.equal(h.get('observation-results').textContent,'');assert.match(h.get('observation-notice').textContent,/正在读取 slow.csv/);
  await h.get('observation-export').click();assert.equal(h.downloads.length,0);
  await h.csv(csvFile(A.template(),'newest.csv'));slow.resolve('invalid stale csv');await pending;
  assert.equal(h.get('observation-export').disabled,false);assert.match(h.get('observation-notice').textContent,/newest.csv/);
  await h.get('observation-export').click();const report=await h.downloads[0].text();assert.match(report,/未记录/);assert.match(report,/未知/);
});

test('新CSV读取失败不留旧报告，迟到失败也不能覆盖较新成功；过大文件不读取',async()=>{
  const h=harness();await tick();await h.csv(csvFile());await h.csv({name:'broken.csv',size:10,text:async()=>{throw Error('read failed');}});assert.equal(h.get('observation-export').disabled,true);assert.equal(h.get('observation-results').textContent,'');assert.match(h.get('observation-notice').textContent,/read failed/);
  const slow=deferred(),pending=h.csv({name:'late.csv',size:10,text:()=>slow.promise});await h.csv(csvFile(A.template(),'latest.csv'));slow.reject(Error('late failure'));await pending;assert.match(h.get('observation-notice').textContent,/latest.csv/);
  let read=false;await h.csv({name:'large.csv',size:2000001,text:()=>{read=true;}});assert.equal(read,false);assert.equal(h.get('observation-export').disabled,true);
});

test('计划保存区损坏提示不会被CSV成功覆盖，原保存内容保持不变',async()=>{
  const storage=new Map([[KEY,'broken']]),h=harness({storage});await tick();const warning=h.get('plan-notice').textContent;assert.match(warning,/已有计划未能载入/);
  await h.csv(csvFile());assert.equal(h.get('plan-notice').textContent,warning);assert.match(h.get('observation-notice').textContent,/已在浏览器本地读取/);
  await h.importPlan(planFile(await P.seal(plan())));assert.match(h.get('plan-notice').textContent,/计划未导入/);assert.equal(storage.get(KEY),'broken');assert.equal(h.get('observation-export').disabled,false);
});

test('计划成功导入不掩盖CSV解析错误，随后有效空表仍显示未记录而不是实际零广告',async()=>{
  const h=harness();await tick();await h.csv(csvFile('invalid csv'));const error=h.get('observation-notice').textContent;assert.match(error,/未完成检查/);
  const p=plan();await h.importPlan(planFile(await P.seal(p)));assert.match(h.get('plan-notice').textContent,/已导入/);assert.equal(h.get('observation-notice').textContent,error);assert.equal(h.get('observation-export').disabled,true);
  await h.csv(csvFile(A.templateForPlan(p)));assert.match(h.get('observation-results').textContent,/未记录 8 轮/);assert.match(h.get('observation-results').textContent,/原定 8 轮 · 缺失 0/);assert.match(h.get('observation-results').textContent,/未知/);
});

test('导入计划期间选择另一项，迟到校验不保存也不改变选择',async()=>{
  const slow=deferred(),h=harness({planApi:{...P,verify:()=>slow.promise}});await tick();const pending=h.importPlan(planFile(await P.seal(plan())));await tick();h.get('observation-plan-select').value='';await h.get('observation-plan-select').emit('change');slow.resolve(await P.seal(plan()));await pending;
  assert.equal(h.storage.get(KEY),undefined);assert.equal(h.get('observation-plan-select').value,'');assert.equal(h.get('plan-export').disabled,true);
});

test('计划编号冲突、另一页变更、写入失败都保留原计划及CSV结果',async()=>{
  const p=plan(),original=await P.seal(p),storage=new Map([[KEY,JSON.stringify([original])]]),h=harness({storage});await tick();await h.csv(csvFile());const csvStatus=h.get('observation-notice').textContent;
  const changed=await P.seal({...p,title:'changed'});await h.importPlan(planFile(changed));assert.match(h.get('plan-notice').textContent,/不同内容/);assert.deepEqual(JSON.parse(storage.get(KEY)),[original]);assert.equal(h.get('observation-notice').textContent,csvStatus);
  const incoming=await P.seal(plan('new-plan'));storage.set(KEY,'external change');await h.importPlan(planFile(incoming));assert.equal(storage.get(KEY),'external change');assert.match(h.get('plan-notice').textContent,/另一页面/);
  const other=new Map(),g=harness({storage:other});await tick();other.set=()=>{throw Error('write denied');};await g.importPlan(planFile(incoming));assert.equal(other.get(KEY),undefined);assert.match(g.get('plan-notice').textContent,/write denied/);assert.equal(g.get('plan-export').disabled,true);
});
