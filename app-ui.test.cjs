'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const E=require('./evaluation.js');require('./sample-data.js');
const fresh=title=>{const data=structuredClone(globalThis.AGENT_SAMPLE);data.tasks[0].title=title;return data;};
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
// Minimal DOM event doubles run the real app handlers; no browser or model calls.
function harness(){
  const nodes=new Map(),requests=[],intervals=[],downloads=[],windowListeners={};
  const decode=value=>value.replace(/&(?:amp|lt|gt|quot|#39);/g,entity=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[entity]));
  class Element{
    constructor(){this.listeners={};this.value='';this.dataset={};this.style={};this.parentElement={after(){}};this.open=false;this._html='';this.textContent='';this.children=[];}
    addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}async emit(type,event={target:this}){event.currentTarget=this;for(const fn of this.listeners[type]||[])await fn(event);}
    click(){return this.emit('click');}showModal(){this.open=true;}close(){if(!this.open)return;this.open=false;for(const fn of this.listeners.close||[])fn({target:this,currentTarget:this});}scrollIntoView(){}append(...nodes){this.children.push(...nodes);}remove(){}
    set innerHTML(v){
      this._html=v;this.controls=new Map();for(const m of v.matchAll(/\bid="([^"]+)"/g))nodes.set(m[1],new Element());
      for(const form of v.matchAll(/<form\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/form>/g)){
        const fields=nodes.get(form[1]).fields={};
        for(const select of form[2].matchAll(/<select\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)){
          const options=[...select[2].matchAll(/<option\b[^>]*value="([^"]+)"([^>]*)>/g)];
          const chosen=options.find(option=>/\bselected\b/.test(option[2]))||options[0];fields[select[1]]=decode(chosen[1]);
        }
        for(const textarea of form[2].matchAll(/<textarea\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g))fields[textarea[1]]=decode(textarea[2]);
      }
    }
    get innerHTML(){return this._html;}
    insertAdjacentHTML(position,value){this._html=position==='afterbegin'?value+this._html:this._html+value;}
    querySelectorAll(selector){
      if(!this.controls)this.controls=new Map();if(this.controls.has(selector))return this.controls.get(selector);
      const match=selector.match(/^\[data-([a-z]+)\]$/);if(!match)return [];
      const result=[...this._html.matchAll(new RegExp('data-'+match[1]+'="([^"]+)"','g'))].map(m=>{const el=new Element();el.dataset[match[1]]=m[1];return el;});
      this.controls.set(selector,result);return result;
    }
  }
  const get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
  get('scenario-filter').value='all';get('run-live').disabled=true;get('load-live').disabled=true;
  const context={AgentEvaluation:E,AGENT_SAMPLE:globalThis.AGENT_SAMPLE,structuredClone,Blob,URL:{createObjectURL:blob=>{downloads.push(blob);return 'blob:test';},revokeObjectURL(){}},console,
    document:{getElementById:get,createElement:()=>new Element(),querySelectorAll:()=>[],body:{dataset:{},append(){}}},
    window:{addEventListener(type,fn){(windowListeners[type]??=[]).push(fn);},scrollTo(){}},location:{hash:''},confirm:()=>true,
    FormData:class{constructor(target){this.fields=target.fields;}get(key){return this.fields[key];}},
    setTimeout:()=>0,clearTimeout(){},setInterval:fn=>{intervals.push(fn);return intervals.length;},clearInterval(){},
    fetch:(url,options)=>{const d=deferred();requests.push({url,options,...d});return d.promise;}};
  vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('./app.js'),'utf8'),context);
  const read=expr=>vm.runInContext(expr,context);
  return {get,requests,intervals,downloads,read,
    beforeUnload(){const event={prevented:false,returnValue:undefined,preventDefault(){this.prevented=true;}};for(const fn of windowListeners.beforeunload||[])fn(event);return event;},
    import(file){get('file-input').files=[file];get('file-input').value='selected';return get('file-input').emit('change');},
    respond(index,data,ok=true){requests[index].resolve({ok,json:async()=>data});},
    control(name){return get('compare-content').querySelectorAll(`[data-${name}]`)[0];}};
}
const file=data=>({size:100,text:async()=>JSON.stringify(data)});
const slowFile=d=>({size:100,text:()=>d.promise});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const assertUnload=(h,expected)=>{const event=h.beforeUnload();assert.equal(event.prevented,expected);assert.equal(event.returnValue,expected?'':undefined);};

test('条件组切换保留原始空白与符号，页面和报告只包含所选组',async()=>{
  const h=harness(),data=fresh('虚构分组回归');
  const groups=['条件 A','条件  A',' 条件 A ','条件\r\nB\t<对照> & "引用"','条件\nB','条件\rB','条件\0B'];
  const task=data.tasks[0],base=task.runs[0];
  task.runs=groups.map((group,i)=>({...structuredClone(base),id:`group-${i}`,strategy:`分组记录${i}`,comparisonGroup:group}));
  await h.import(file(data));
  for(const i of [1,3,0,6,2,5,4,1]){
    const select=h.get('group-select');
    assert.deepEqual(select.children.map(o=>o.value),groups);
    select.value=select.children[i].value;await select.emit('change');
    assert.equal(h.read('selectedGroup'),groups[i]);assert.equal(h.get('group-select').value,groups[i]);
    const buttons=h.get('compare-content').querySelectorAll('[data-run]');
    assert.deepEqual(buttons.map(b=>b.dataset.run),[`group-${i}`]);
    await h.get('export-report').click();
    const report=JSON.parse(await h.downloads.at(-1).text());
    assert.equal(report.comparisonGroup,groups[i]);assert.deepEqual(report.results.map(r=>r.runId),[`group-${i}`]);
    await h.get('close-report').click();
    const weight=h.control('weight');weight.value='2';await weight.emit('change');
    assert.equal(h.get('group-select').value,groups[i]);
  }
  await h.get('save-dataset').click();
  assert.deepEqual(JSON.parse(await h.downloads.at(-1).text()).tasks[0].runs.map(r=>r.comparisonGroup),groups);
});

test('首页后选文件优先，迟到的成功、解析失败和读取失败不覆盖新结果',async()=>{
  for(const outcome of ['success','parse','read']){
    const h=harness(),slow=deferred(),pending=h.import(slowFile(slow));await h.import(file(fresh('最新文件')));
    const message=h.get('toast').textContent;
    if(outcome==='read')slow.reject(Error('旧文件错误'));else slow.resolve(outcome==='parse'?'broken':JSON.stringify(fresh('迟到文件')));
    await pending;assert.equal(h.read('dataset.tasks[0].title'),'最新文件');assert.equal(h.get('toast').textContent,message);
  }
});
test('新导入失败仍阻止旧请求回写，保留原页面；过大文件不读取',async()=>{
  const h=harness(),before=h.read('dataset.tasks[0].title'),slow=deferred(),pending=h.import(slowFile(slow));
  await h.import({size:10,text:async()=>'{'});const message=h.get('toast').textContent;
  slow.resolve(JSON.stringify(fresh('迟到文件')));await pending;assert.equal(h.read('dataset.tasks[0].title'),before);assert.equal(h.get('toast').textContent,message);
  let read=false;await h.import({size:2*1024*1024+1,text:()=>{read=true;}});assert.equal(read,false);
});
test('恢复示例与目标条件修改保护当前会话，不被在途导入覆盖',async()=>{
  for(const action of ['reset','weight','required','budget','budget-draft','group','select','search','filter']){
    const h=harness(),slow=deferred(),pending=h.import(slowFile(slow));
    if(action==='reset')await h.get('reset-button').click();
    if(action==='weight'){const el=h.control('weight');el.value='1';await el.emit('change');}
    if(action==='required'){const el=h.control('required');el.checked=false;await el.emit('change');}
    if(action==='budget'){h.get('budget-input').value='123';await h.get('budget-input').emit('keydown',{key:'Enter'});}
    if(action==='budget-draft'){h.get('budget-input').value='123';await h.get('budget-input').emit('input');}
    if(action==='group'){h.get('group-select').value='new-group';await h.get('group-select').emit('change');}
    if(action==='select'){h.get('compare-task').value=h.read('dataset.tasks[1].id');await h.get('compare-task').emit('change');}
    if(action==='search'){h.get('search').value='新筛选';await h.get('search').emit('input');}
    if(action==='filter'){h.get('scenario-filter').value='coding';await h.get('scenario-filter').emit('change');}
    const expected=h.read('JSON.stringify({dataset,selectedTaskId,budget,selectedGroup})');slow.resolve(JSON.stringify(fresh('迟到文件')));await pending;
    assert.equal(h.read('JSON.stringify({dataset,selectedTaskId,budget,selectedGroup})'),expected,action);
    if(action==='budget-draft')assert.equal(h.get('budget-input').value,'123');
  }
});
test('所有只读加载入口与文件导入共享次序，旧错误不覆盖新提示',async()=>{
  for(const button of ['load-study','load-retrieval','load-evidence','load-validation','load-quality','load-scaling','load-live']){
    const h=harness(),pending=h.get(button).click();await h.import(file(fresh('导入胜出')));
    const message=h.get('toast').textContent;h.respond(1,{error:'旧请求失败'},false);await pending;
    assert.equal(h.read('dataset.tasks[0].title'),'导入胜出');assert.equal(h.get('toast').textContent,message,button);
  }
  const h=harness(),slow=deferred(),pending=h.import(slowFile(slow)),a=h.get('load-live').click(),b=h.get('load-live').click();
  h.respond(2,fresh('最新请求'));await b;h.respond(1,fresh('旧请求'));await a;slow.resolve(JSON.stringify(fresh('旧导入')));await pending;
  assert.equal(h.read('dataset.tasks[0].title'),'最新请求');assert.equal(h.read('localDataset'),true);
});
test('复核编辑挡住迟到加载；主动换数据关闭旧弹窗并阻止旧表单写入',async()=>{
  const h=harness(),a=h.get('load-live').click();await h.control('run').click();h.respond(1,fresh('旧请求'));await a;
  assert.notEqual(h.read('dataset.tasks[0].title'),'旧请求');assert.equal(h.get('detail-dialog').open,true);
  const b=h.get('load-live').click();await h.get('review-form').emit('input');h.respond(2,fresh('编辑时旧请求'));await b;assert.notEqual(h.read('dataset.tasks[0].title'),'编辑时旧请求');
  const oldForm=h.get('review-form'),fields={};h.read('currentTask().goals').forEach((g,i)=>{fields[`status-${i}`]='pass';fields[`evidence-${i}`]='虚构复核依据';});oldForm.fields=fields;
  const c=h.get('load-live').click();await oldForm.emit('submit',{target:oldForm,preventDefault(){}});h.respond(3,fresh('保存时旧请求'));await c;
  assert.equal(h.read('currentTask().runs[0].checks[currentTask().goals[0].id].evidence'),'虚构复核依据');
  await h.control('run').click();const stale=h.get('review-form');stale.fields=fields;
  await h.import(file(fresh('主动换数据')));assert.equal(h.get('detail-dialog').open,false);
  const before=h.read('JSON.stringify(dataset)');await stale.emit('submit',{target:stale,preventDefault(){}});assert.equal(h.read('JSON.stringify(dataset)'),before);assert.match(h.get('toast').textContent,/记录已切换/);
});
test('迟到连接状态不覆盖新加载的记录说明',async()=>{
  const h=harness(),a=h.get('load-live').click();h.respond(1,fresh('已载入'));await a;const message=h.get('connection-status').textContent;
  h.respond(0,{message:'旧连接消息',available:true,running:false,hasLatest:true});await tick();assert.equal(h.get('connection-status').textContent,message);assert.equal(h.get('run-live').disabled,false);assert.equal(h.get('load-live').disabled,false);
});
test('运行接口仅用模拟响应：切换记录后进度、成功和错误都不夺回页面',async()=>{
  for(const failed of [false,true]){
    const h=harness(),pending=h.get('run-live').click();assert.equal(h.requests[1].url,'/api/run');
    h.respond(0,{message:'旧连接消息',available:true,running:false,hasLatest:true});await tick();assert.equal(h.get('run-live').disabled,true);assert.equal(h.get('load-live').disabled,true);
    await h.import(file(fresh('保留手动选择')));const notice=h.get('connection-status').textContent,message=h.get('toast').textContent;
    h.intervals[0]();assert.equal(h.get('connection-status').textContent,notice);
    if(failed)h.requests[1].reject(Error('迟到失败'));else h.respond(1,fresh('迟到运行'));
    await pending;assert.equal(h.read('dataset.tasks[0].title'),'保留手动选择');assert.equal(h.get('toast').textContent,message);assert.equal(h.get('run-live').disabled,false);
  }
  const h=harness(),pending=h.get('run-live').click();h.respond(1,fresh('当前模拟运行'));await pending;assert.equal(h.read('dataset.tasks[0].title'),'当前模拟运行');
});
test('保存当前数据可完整重新导入，保留多任务修改、未知费用、演示标记及原始附加字段',async()=>{
  const data=fresh('虚构整份备份');data.tasks[1].runs[0].tokens=null;data.source='declared-source';data.originalSummary={note:'原始汇总不随人工修改重算'};
  const h=harness();await h.import(file(data));const weight=h.control('weight');weight.value='2';await weight.emit('change');
  await h.control('run').click();const form=h.get('review-form'),fields={};h.read('currentTask().goals').forEach((g,i)=>{fields[`status-${i}`]='unknown';fields[`evidence-${i}`]='虚构保存测试';});form.fields=fields;await form.emit('submit',{target:form,preventDefault(){}});
  const snapshot=h.read('JSON.stringify(dataset)');await h.get('save-dataset').click();assert.equal(h.downloads.length,1);
  const saved=await h.downloads[0].text();assert.equal(saved,snapshot);E.validateDataset(JSON.parse(saved));
  const restored=harness();await restored.import({size:h.downloads[0].size,text:async()=>saved});assert.equal(restored.read('JSON.stringify(dataset)'),snapshot);
  assert.equal(restored.read('localDataset'),false);assert.equal(restored.read('dataset.demo'),true);assert.equal(restored.read('dataset.tasks[1].runs[0].tokens'),null);
  assert.match(h.get('toast').textContent,/确认文件/);
});
test('整份保存按UTF-8字节限制2MiB，边界文件可回读，超限不截断、不修改当前数据',async()=>{
  const h=harness(),data=fresh('边界测试');data.padding='中'.repeat(100);let text=JSON.stringify(data);data.padding+='x'.repeat(2*1024*1024-Buffer.byteLength(text));text=JSON.stringify(data);
  assert.equal(Buffer.byteLength(text),2*1024*1024);await h.import({size:Buffer.byteLength(text),text:async()=>text});await h.get('save-dataset').click();assert.equal(h.downloads.length,1);assert.equal(h.downloads[0].size,2*1024*1024);
  const restored=harness();await restored.import({size:h.downloads[0].size,text:()=>h.downloads[0].text()});assert.equal(restored.read('dataset.tasks[0].title'),'边界测试');
  const newData=structuredClone(data);newData.padding+='中';const load=h.get('load-live').click();h.respond(1,newData);await load;const before=h.read('JSON.stringify(dataset)');
  await h.get('save-dataset').click();assert.equal(h.downloads.length,1);assert.match(h.get('toast').textContent,/超过 2 MB/);assert.equal(h.read('JSON.stringify(dataset)'),before);
});
test('保存快照阻止在途读取切走已保存页面；保存失败不会提示下载成功',async()=>{
  const h=harness(),slow=deferred(),pending=h.import(slowFile(slow));const original=h.read('JSON.stringify(dataset)');await h.get('save-dataset').click();slow.resolve(JSON.stringify(fresh('旧文件')));await pending;assert.equal(h.read('JSON.stringify(dataset)'),original);
  const g=harness();g.read("URL.createObjectURL=()=>{throw Error('下载资源不可用')}");await g.get('save-dataset').click();assert.match(g.get('toast').textContent,/未能保存.*下载资源不可用/);assert.equal(g.downloads.length,0);
});
test('本机汇总或用量字段损坏时回退完整会话，随后仍能保存和读取有效记录',async()=>{
  for(const source of ['local-codex-study','local-retrieval-study','local-evidence-study','local-validation-study','local-scaling-study','local-quality-study','bad-usage']){
    const h=harness();await h.import(file(fresh('原记录')));
    h.get('compare-task').value=h.read('dataset.tasks[1].id');await h.get('compare-task').emit('change');
    h.get('search').value='原筛选';await h.get('search').emit('input');h.get('scenario-filter').value='research';await h.get('scenario-filter').emit('change');
    h.get('budget-input').value='1234';await h.get('budget-input').emit('input');h.read("location.hash='overview'");
    const previous=h.read('JSON.stringify({dataset,localDataset,selectedTaskId,selectedGroup,budget})'),oldGrid=h.get('task-grid').innerHTML;
    const bad=fresh('不可显示的新记录');bad.source=source;if(source==='bad-usage')bad.tasks[0].runs[0].usage={};
    const pending=h.get('load-live').click();h.respond(1,bad);await pending;
    assert.equal(h.read('JSON.stringify({dataset,localDataset,selectedTaskId,selectedGroup,budget})'),previous,source);
    assert.equal(h.get('task-grid').innerHTML,oldGrid);assert.equal(h.get('search').value,'原筛选');assert.equal(h.get('scenario-filter').value,'research');assert.equal(h.get('budget-input').value,'1234');assert.equal(h.read('location.hash'),'overview');assert.match(h.get('toast').textContent,/保留原有/);
    await h.get('save-dataset').click();assert.equal(JSON.parse(await h.downloads[0].text()).tasks[0].title,'原记录');
    const next=h.get('load-live').click();h.respond(2,fresh('有效新记录'));await next;assert.equal(h.read('dataset.tasks[0].title'),'有效新记录');
  }
});
test('切换显示失败时不关闭旧详情或改动旧任务，原表单仍可提交',async()=>{
  const h=harness();await h.control('run').click();const form=h.get('review-form');form.fields={};h.read('currentTask().goals').forEach((g,i)=>{form.fields[`status-${i}`]='unknown';form.fields[`evidence-${i}`]='保留的虚构草稿';});
  const bad=fresh('损坏汇总');bad.source='local-codex-study';const pending=h.get('load-study').click();h.respond(1,bad);await pending;
  assert.equal(h.get('detail-dialog').open,true);assert.equal(h.get('review-form'),form);await form.emit('submit',{target:form,preventDefault(){}});assert.equal(h.read('currentTask().runs[0].checks[currentTask().goals[0].id].evidence'),'保留的虚构草稿');
});

test('离页保护：浏览示例、打开详情、筛选与下载都不会误标为修改',async()=>{
  const h=harness();assertUnload(h,false);
  h.get('search').value='资料';await h.get('search').emit('input');
  h.get('scenario-filter').value='research';await h.get('scenario-filter').emit('change');
  h.get('compare-task').value=h.read('dataset.tasks[1].id');await h.get('compare-task').emit('change');
  await h.get('group-select').emit('change');assertUnload(h,false);
  await h.control('run').click();assertUnload(h,false);
  await h.get('review-form').emit('input');assertUnload(h,false);
  await h.get('close-dialog').click();assertUnload(h,false);
  await h.get('template-button').click();await h.get('save-dataset').click();
  await h.get('export-report').click();assertUnload(h,false);
  await h.get('report-download').click();await h.get('close-report').click();assertUnload(h,false);
  // beforeunload must use the browser's native mechanism, never a second confirm.
  h.read("confirm=()=>{throw Error('unexpected confirm')}");assertUnload(h,false);
});

test('离页保护：仅实际目标或预算变更触发，未应用预算也被保护',async()=>{
  for(const kind of ['weight','required','budget']){
    const h=harness();
    if(kind==='weight'){
      const value=h.read('currentTask().goals[0].weight'),same=h.control('weight');same.value=String(value);await same.emit('change');assertUnload(h,false);
      const changed=h.control('weight');changed.value=String(value===1?2:1);await changed.emit('change');
    }else if(kind==='required'){
      const value=h.read('currentTask().goals[0].required'),same=h.control('required');same.checked=value;await same.emit('change');assertUnload(h,false);
      const changed=h.control('required');changed.checked=!value;await changed.emit('change');
    }else{
      const value=h.read('budget');h.get('budget-input').value=String(value);await h.get('budget-input').emit('input');assertUnload(h,false);
      await h.get('budget-input').emit('keydown',{key:'Enter'});assertUnload(h,false);
      h.get('budget-input').value='';await h.get('budget-input').emit('input');assertUnload(h,true);
      await h.get('budget-input').emit('keydown',{key:'Enter'});assertUnload(h,false);
      h.get('budget-input').value=String(value-1);await h.get('budget-input').emit('input');assertUnload(h,true);
      await h.get('budget-input').emit('keydown',{key:'Enter'});
    }
    assertUnload(h,true);await h.get('save-dataset').click();assertUnload(h,true);
  }
});

test('离页保护：导入即保护，下载成功或失败不解除，仅确认恢复示例后清除',async()=>{
  const h=harness();await h.import(file(fresh('需要保留的记录')));assertUnload(h,true);
  h.read("confirm=()=>{throw Error('unexpected confirm')}");assertUnload(h,true);
  await h.get('save-dataset').click();assertUnload(h,true);
  await h.get('export-report').click();await h.get('report-download').click();await h.get('close-report').click();assertUnload(h,true);
  h.read("URL.createObjectURL=()=>{throw Error('模拟下载失败')}");await h.get('save-dataset').click();assertUnload(h,true);assert.match(h.get('toast').textContent,/模拟下载失败/);
  h.read('confirm=()=>false');await h.get('reset-button').click();assertUnload(h,true);assert.equal(h.read('dataset.tasks[0].title'),'需要保留的记录');
  h.read('confirm=()=>true');await h.get('reset-button').click();assertUnload(h,false);assert.equal(h.read('dataset.tasks[0].title'),globalThis.AGENT_SAMPLE.tasks[0].title);
});

test('离页保护：复核草稿可恢复原值或明确关闭，验证失败不会丢失保护',async()=>{
  const h=harness();await h.control('run').click();const form=h.get('review-form'),original={...form.fields};
  form.fields['evidence-0']+=' 未提交补充';await form.emit('input');assertUnload(h,true);
  form.fields={...original};await form.emit('input');assertUnload(h,false);
  form.fields['status-0']=original['status-0']==='unknown'?'pass':'unknown';await form.emit('change');assertUnload(h,true);
  form.fields={...original};await form.emit('change');assertUnload(h,false);
  form.fields['status-0']='pass';form.fields['evidence-0']='';await form.emit('input');
  await form.emit('submit',{target:form,preventDefault(){}});assertUnload(h,true);assert.equal(h.get('detail-dialog').open,true);assert.match(h.get('toast').textContent,/补充验收证据/);
  await h.get('close-dialog').click();assertUnload(h,false);
  await h.control('run').click();const reopened=h.get('review-form');assert.deepEqual(reopened.fields,original);assertUnload(h,false);
  await reopened.emit('submit',{target:reopened,preventDefault(){}});assertUnload(h,false);
});

test('离页保护：保存实际复核后关闭详情与下载仍保持保护',async()=>{
  const h=harness();await h.control('run').click();const form=h.get('review-form');
  form.fields['evidence-0']='人工补充的可追溯证据';await form.emit('input');assertUnload(h,true);
  await form.emit('submit',{target:form,preventDefault(){}});assert.equal(h.get('detail-dialog').open,false);assertUnload(h,true);
  await h.get('save-dataset').click();assertUnload(h,true);
  assert.equal(JSON.parse(await h.downloads.at(-1).text()).tasks[0].runs[0].checks[h.read('currentTask().goals[0].id')].evidence,'人工补充的可追溯证据');
});

test('离页保护：失败导入不改变干净、已修改或未提交草稿的保护状态',async()=>{
  for(const state of ['clean','imported','review','budget']){
    const h=harness();let form;
    if(state==='imported')await h.import(file(fresh('保留原记录')));
    if(state==='review'){await h.control('run').click();form=h.get('review-form');form.fields['evidence-0']='需保留的草稿';await form.emit('input');}
    if(state==='budget'){h.get('budget-input').value='456';await h.get('budget-input').emit('input');}
    const expected=h.read('JSON.stringify(dataset)');
    const renderFailure=fresh('无效汇总');renderFailure.source='local-codex-study';
    for(const bad of [{size:10,text:async()=>'{'},file({tasks:[]}),{size:2*1024*1024+1,text:()=>{throw Error('oversized file read');}}]){
      await h.import(bad);assertUnload(h,state!=='clean');assert.equal(h.read('JSON.stringify(dataset)'),expected);
    }
    const pending=h.get('load-study').click();h.respond(1,renderFailure);await pending;
    assertUnload(h,state!=='clean');assert.equal(h.read('JSON.stringify(dataset)'),expected);
    if(state==='review'){assert.equal(h.get('review-form'),form);assert.equal(form.fields['evidence-0'],'需保留的草稿');await h.get('close-dialog').click();assertUnload(h,false);}
    if(state==='budget'){assert.equal(h.get('budget-input').value,'456');h.get('budget-input').value=String(h.read('budget'));await h.get('budget-input').emit('input');assertUnload(h,false);}
  }
});

test('离页保护：成功本机载入与文件一致，失败或失效载入不标记示例',async()=>{
  const h=harness(),failed=h.get('load-live').click();h.respond(1,{error:'模拟读取失败'},false);await failed;assertUnload(h,false);
  const pending=h.get('load-live').click();await h.control('run').click();h.respond(2,fresh('迟到记录'));await pending;assertUnload(h,false);
  await h.get('close-dialog').click();const loaded=h.get('load-live').click();h.respond(3,fresh('当前本机记录'));await loaded;assertUnload(h,true);
});
