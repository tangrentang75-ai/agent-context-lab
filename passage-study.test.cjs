const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {checkPassageStudy,scheduleFor,grade,preflight,runPassageStudy}=require('./passage-study.cjs');
const fixtures=require('./passage-study-fixtures.json');
function temp(t){const folder=fs.mkdtempSync(path.join(os.tmpdir(),'passage-study-test-'));t.after(()=>{const resolved=path.resolve(folder);if(path.dirname(resolved)===path.resolve(os.tmpdir())&&path.basename(resolved).startsWith('passage-study-test-'))fs.rmSync(resolved,{recursive:true,force:true});});return folder;}
function gold(task){return Object.fromEntries(task.goals.map(g=>[g.id,g.expected===null?{value:null,sourceId:null,quote:null}:{value:g.expected,sourceId:g.sourceId,quote:g.sentence}]));}
test('方法和试点双重哈希校验；协议先于调用固定，时间晚于方法冻结',t=>{
  const p=checkPassageStudy();assert.ok(Date.parse(p.lock.preparedAt)>Date.parse(p.method.frozenAt));assert.equal(preflight().modelCalls,0);assert.equal(preflight().plannedRows,16);
  const folder=temp(t);for(const f of ['review-passages-protocol.json','passage-study-lock.json'])fs.copyFileSync(path.join(__dirname,f),path.join(folder,f));fs.writeFileSync(path.join(folder,'review-planner.js'),'changed');assert.throws(()=>checkPassageStudy(folder),/冻结方法已变化/);
});
test('任务或试点源码变化同样阻止运行，普通 CLI 只检查并不创建模型运行',t=>{
  const p=checkPassageStudy(),folder=temp(t),files=new Set([...Object.keys(p.method.sourceHashes),...Object.keys(p.lock.sourceHashes),'passage-study-lock.json']);
  for(const file of files)fs.copyFileSync(path.join(__dirname,file),path.join(folder,file));fs.appendFileSync(path.join(folder,'passage-study-fixtures.json'),' ');assert.throws(()=>checkPassageStudy(folder),/试点协议\/源码已变化/);
  const result=require('node:child_process').spawnSync(process.execPath,['passage-study.cjs'],{cwd:__dirname,encoding:'utf8'});assert.equal(result.status,0);const preview=JSON.parse(result.stdout);assert.equal(preview.status,'prepared_not_run');assert.equal(preview.modelCalls,0);
});
test('16格有唯一编号；每任务每配置两次，四个循环位置平衡，预留题不进入日程',()=>{
  const {design}=checkPassageStudy(),schedule=scheduleFor(design);assert.equal(new Set(schedule.map(e=>e.id)).size,16);
  for(const taskId of design.pilotTaskIds)for(const s of design.strategies)assert.equal(schedule.filter(e=>e.taskId===taskId&&e.strategy===s.id).length,2);
  for(const s of design.strategies)assert.deepEqual(schedule.map((e,i)=>e.strategy===s.id?i%4:null).filter(v=>v!==null).sort(),[0,1,2,3]);
  assert.ok(schedule.every(e=>design.pilotTaskIds.includes(e.taskId)));
});
test('候选金标准与可见原文同时评分，省略的正确引文和拼接引文不能通过',()=>{
  const spec=fixtures.tasks[0],answer=gold(spec);assert.equal(grade(spec,answer,spec.documents,'ready_for_verification',false).verifiedCompletion,true);
  const incomplete=grade(spec,answer,[spec.documents[0]],'needs_review',false);assert.equal(incomplete.candidatePassed,false);assert.equal(incomplete.verifiedCompletion,false);
  const g=spec.goals[0],doc=spec.documents.find(d=>d.id===g.sourceId),quote=g.sentence+'[省略结尾正文]';
  const forged=grade(spec,{...answer,[g.id]:{value:g.expected,sourceId:g.sourceId,quote}},spec.documents.map(d=>d.id===doc.id?{...d,text:quote}:d),'ready_for_verification',false);assert.equal(forged.checks[g.id].judgment,'fabricated_quote');assert.equal(forged.unsafeRelease,true);
  const skipped=grade(spec,null,[],'needs_review',false);assert.equal(skipped.candidatePassed,null);assert.equal(skipped.released,false);
});
test('冻结后新题有六类，金标准原句存在且全读可验收；不使用旧任务编号',()=>{
  const {method}=checkPassageStudy();assert.equal(fixtures.tasks.length,6);
  for(const spec of fixtures.tasks){assert.ok(!method.observedDevelopmentTaskIds.includes(spec.id));for(const g of spec.goals)if(g.expected!==null)assert.ok(spec.documents.find(d=>d.id===g.sourceId).text.includes(g.sentence));assert.equal(grade(spec,gold(spec),spec.documents,'ready_for_verification',false).candidatePassed,true);}
});
test('替身调度保存源码、日程、真实输入和规划；零调用行与未评分分开，重复分别统计',async t=>{
  const outputDir=temp(t);let count=0;
  const data=await runPassageStudy({outputDir,cliVersion:'mock',onProgress:()=>{},execute:async(task,prompt)=>{
    count++;assert.ok(task.goals.every(g=>Object.keys(g).sort().join(',')==='id,label'));assert.ok(!('kind' in task));assert.ok(task.documents.every(d=>Object.keys(d).sort().join(',')==='id,text'));
    const folder=fs.readdirSync(outputDir).find(f=>f.startsWith('passage-')&&f!=='passage-latest.json'),files=fs.readdirSync(path.join(outputDir,folder));assert.ok(files.includes('protocol.json'));assert.ok(files.includes('passage-study-lock.json'));assert.ok(files.some(f=>f.endsWith('-plan.json')));
    assert.ok(files.filter(f=>f.endsWith('-input.json')).some(f=>JSON.parse(fs.readFileSync(path.join(outputDir,folder,f))).prompt===prompt));
    const spec=fixtures.tasks.find(t=>t.id===task.id);return {answer:gold(spec),usage:{input_tokens:100,output_tokens:10},toolEvents:0};
  }});
  assert.equal(data.demo,true);assert.equal(data.status,'complete');assert.equal(data.rows.length,16);assert.equal(count,12);assert.equal(data.cost.modelCalls,12);assert.equal(data.cost.knownTokens,1320);assert.equal(data.unrunEntryIds.length,0);
  const skip=data.summary.find(s=>s.id==='v2-stop');assert.equal(skip.skippedBeforeCall,4);assert.equal(skip.assessed,0);assert.equal(skip.cost.tokens,0);assert.equal(skip.verifiedCompletions,0);
  assert.ok(data.summary.every(s=>s.byRepeat.length===2&&s.byRepeat.every(r=>r.attempted===2)));assert.equal(data.summary.find(s=>s.id==='all').verifiedCompletions,4);assert.ok(!fs.existsSync(path.join(outputDir,'review-latest.json')));assert.equal(data.humanReviewMeasurement,'not_measured');
});
test('未知用量触发后续停止，已评分响应与未知费用同时保留，未运行不计零成本',async t=>{
  const data=await runPassageStudy({outputDir:temp(t),cliVersion:'mock',onProgress:()=>{},execute:async task=>({answer:gold(fixtures.tasks.find(s=>s.id===task.id)),usage:null,toolEvents:0})});
  assert.equal(data.status,'stopped');assert.equal(data.cost.modelCalls,1);assert.equal(data.cost.unknownCalls,1);assert.equal(data.rows.length,1);assert.equal(data.unrunEntryIds.length,15);assert.equal(data.rows[0].cost.tokens,null);assert.equal(data.summary.find(s=>s.id==='v2-stop').cost.tokens,null);assert.equal(data.stopReason,'出现未知用量');
});
test('连续两次失败保留费用后停止，不重试；重复日程中的未运行格子单独保留',async t=>{
  let count=0;const data=await runPassageStudy({outputDir:temp(t),cliVersion:'mock',onProgress:()=>{},execute:async()=>{count++;const e=Error('synthetic');e.usage={input_tokens:12,output_tokens:1};throw e;}});
  assert.equal(count,2);assert.equal(data.status,'stopped');assert.equal(data.cost.knownTokens,26);assert.equal(data.rows.length,2);assert.equal(data.stopReason,'连续执行失败');assert.ok(data.rows.every(r=>r.candidatePassed===null&&!r.verifiedCompletion));
});
test('单次用量越过阈值不抹掉账单，后续可调用格子保持未运行',async t=>{
  const data=await runPassageStudy({outputDir:temp(t),cliVersion:'mock',onProgress:()=>{},execute:async task=>({answer:gold(fixtures.tasks.find(s=>s.id===task.id)),usage:{input_tokens:190001,output_tokens:1},toolEvents:0})});
  assert.equal(data.status,'stopped');assert.equal(data.rows.length,1);assert.equal(data.cost.knownTokens,190002);assert.equal(data.unrunEntryIds.length,15);assert.equal(data.stopReason,'达到已知用量调用间阈值');
});
test('网页新接口只读：检查协议与读取替身结果不调用执行器，没有实验启动路由',async t=>{
  const {createServer}=require('./server.cjs'),server=createServer({runExperiment:()=>assert.fail('不应调用')},{passageReader:()=>({type:'passage-study',demo:true,rows:[]})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const base='http://127.0.0.1:'+server.address().port;
  const plan=await (await fetch(base+'/api/passage-plan')).json();assert.equal(plan.modelCalls,0);assert.equal(plan.plannedRows,16);
  const result=await (await fetch(base+'/api/passage-study')).json();assert.equal(result.demo,true);assert.equal((await fetch(base+'/api/passage-study',{method:'POST'})).status,404);
});
