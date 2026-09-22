'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID, createHash} = require('node:crypto');
const {fixtures, selectDocuments, buildPrompt, verify, infer} = require('./retrieval-study.cjs');
const {capture} = require('./codex-bridge.cjs');
const {validateDataset} = require('./evaluation.js');
const policies = [{id:'all', label:'一次读取全部资料'}, {id:'evidence', label:'检查引文，不足时补读'}];
const hash = text => createHash('sha256').update(text).digest('hex');
const write = (file, data) => {fs.writeFileSync(file+'.tmp', JSON.stringify(data,null,2)); fs.renameSync(file+'.tmp',file);};

// The controller receives no expected value, gold source ID or gold sentence.
function publicTask(task) {
  return {id:task.id, title:task.title, goals:task.goals.map(({id,label})=>({id,label})), documents:task.documents};
}
function inspectEvidence(goals, answer, documents) {
  return goals.map(goal => {
    const field = answer?.[goal.id];
    if (!field || typeof field.value !== 'string' || !field.value.trim()) return {goalId:goal.id, supported:false, reason:'缺少配置值'};
    const doc = documents.find(d=>d.id===field.sourceId);
    if (!doc || typeof field.quote !== 'string' || !field.quote.trim() || field.quote.length>3000 || !doc.text.includes(field.quote)) {
      return {goalId:goal.id, supported:false, reason:'缺少所读正文中的原句'};
    }
    // Numeric boundaries avoid accepting "7" just because the quote contains "17".
    const quotedNumbers = field.quote.match(/-?\d+(?:\.\d+)?/g) || [];
    if (!quotedNumbers.includes(field.value.trim())) return {goalId:goal.id, supported:false, reason:'所引原句没有对应数值'};
    return {goalId:goal.id, supported:true, reason:'值与原句可追溯；尚未证明语义正确'};
  });
}
function tokenCount(usage) {
  return usage && Number.isFinite(usage.input_tokens) && Number.isFinite(usage.output_tokens)
    ? usage.input_tokens+usage.output_tokens : null;
}
function callCosts(calls) {
  const costs = calls.map(c=>tokenCount(c.usage));
  return {tokens:costs.length && costs.every(Number.isFinite)?costs.reduce((a,b)=>a+b,0):null,
    knownTokens:costs.reduce((a,b)=>a+(b??0),0), unknownCalls:costs.filter(c=>c===null).length};
}

async function runPolicy(task, policy, {execute=infer, beforeCall=()=>{}, onCall=()=>{}, onInput=()=>{}, strictSources=false}={}) {
  const started = Date.now(), elapsed=()=>Math.round((Date.now()-started)/100)/10;
  const events=[], calls=[];
  const event=(type,label,detail)=>events.push({type,atSec:elapsed(),label,detail});
  let docs=[], answer=null, inspection=[], error, outcome, stopReason;
  const add = chosen => {for (const doc of chosen) {docs.push(doc);event('explore','读取资料 '+doc.id,`平台提交正文 ${doc.text.length} 字符。`);}};
  if (!policies.some(p=>p.id===policy)) throw new Error('未知策略');
  add(selectDocuments(task.documents,task.goals,policy==='all'?'all':'coverage'));
  for (let round=1;round<=2;round++) {
    try {beforeCall();} catch(e) {error=e.message;outcome='budget_stopped';stopReason='调用间停止阈值已达到';break;}
    const prompt=buildPrompt(task,docs)+(strictSources?'\nsourceId 只允许使用本轮资料的裸编号：'+docs.map(d=>d.id).join('、')+'；无依据时为 null。不要添加“资料”等前缀。':'');
    const call={round, selectedIds:docs.map(d=>d.id), promptSha256:hash(prompt), usage:null, answer:null, toolEvents:0};
    onInput({round,prompt,selectedIds:call.selectedIds});
    calls.push(call);
    event('act',`第 ${round} 次模型调用`,round===1?'按当前资料恢复配置。':'提交全部资料重新恢复配置；额外调用计入总成本。');
    try {
      const result=await execute(task,prompt,type=>{call.toolEvents++;event('act','额外模型工具事件',type);},strictSources?{allowedSourceIds:docs.map(d=>d.id)}:{});
      call.answer=result.answer;call.usage=result.usage;call.toolEvents=Math.max(call.toolEvents,result.toolEvents||0);
      answer=result.answer;
      inspection=inspectEvidence(task.goals,answer,docs);call.inspection=inspection;
      call.status='complete';
    } catch(e) {
      call.status='failed';call.error=e.message;call.usage=e.usage||null;error=e.message;outcome='execution_failed';
    }
    onCall(call);
    if (outcome==='execution_failed') {stopReason='执行失败，不自动重试';break;}
    const missing=inspection.filter(c=>!c.supported);
    event('verify','引文完整性检查',missing.length?missing.map(c=>c.goalId+'：'+c.reason).join('；'):'各字段均有可追溯数值和原句；独立答案验收尚未执行。');
    if (policy==='all') {stopReason='一次性全部读取策略完成';break;}
    if (!missing.length) {stopReason='引文完整性检查通过';break;}
    const unread=task.documents.filter(d=>!docs.some(s=>s.id===d.id));
    if (!unread.length || round===2) {stopReason='资料已耗尽，仍可能缺少证据';break;}
    event('explore','证据不足，补读剩余资料',`待补充字段：${missing.map(c=>c.goalId).join('、')}。不向控制器提供标准答案。`);
    add(unread);
  }
  return {answer,calls,events,inspection,error,outcome,durationSec:elapsed(),tokens:callCosts(calls).tokens,
    cost:callCosts(calls),protocolDeviation:calls.some(c=>c.toolEvents>0),
    retrieval:{selectedIds:docs.map(d=>d.id),stopReason,modelCalls:calls.length,fallbacks:Math.max(0,calls.length-1)}, documents:docs};
}
const mean=values=>{const known=values.filter(Number.isFinite);return known.length?known.reduce((a,b)=>a+b,0)/known.length:null;};
function summarize(data) {
  return policies.map(p=>{
    const runs=data.tasks.flatMap(t=>t.runs).filter(r=>r.policy===p.id);
    return {...p,attempts:runs.length,successes:runs.filter(r=>r.outcome==='passed').length,
      meanTokens:mean(runs.map(r=>r.tokens)),meanSeconds:mean(runs.map(r=>r.durationSec)),meanFiles:mean(runs.map(r=>r.retrieval.selectedIds.length)),
      modelCalls:runs.reduce((n,r)=>n+r.calls.length,0),fallbacks:runs.reduce((n,r)=>n+r.retrieval.fallbacks,0),
      prematureStops:runs.filter(r=>r.policy==='evidence'&&r.retrieval.stopReason==='引文完整性检查通过'&&r.outcome!=='passed').length,
      unknownCosts:runs.filter(r=>r.tokens===null).length,executionFailures:runs.filter(r=>r.outcome==='execution_failed').length,
      protocolDeviations:runs.filter(r=>r.protocolDeviation).length};
  });
}
async function runStudy({execute=infer,outputDir=path.join(__dirname,'runs'),onProgress=console.log,cliVersion,maxCalls=9,maxTokens=180000,fixtureFile='retrieval-fixtures.json',strictSources=false,studyName='evidence'}={}) {
  if(!['evidence','validation'].includes(studyName))throw new Error('未知实验名称');
  const taskSet=JSON.parse(fs.readFileSync(path.join(__dirname,fixtureFile),'utf8'));
  const id=studyName+'-'+randomUUID(),folder=path.join(outputDir,id);
  fs.mkdirSync(folder,{recursive:true});
  const schedule=taskSet.tasks.flatMap((t,i)=>[0,1].map(j=>({taskId:t.id,policy:policies[(i+j)%2].id})));
  const protocol={id,version:1,createdAt:new Date().toISOString(),model:'gpt-6-astra',effort:'high',
    cliVersion:cliVersion||(await capture(['--version'])).output.trim(),schedule,maxCalls,maxTokens,strictSources,
    sourceHashes:Object.fromEntries(['evidence-study.cjs','retrieval-study.cjs',fixtureFile,'codex-bridge.cjs','evaluation.js',...(studyName==='validation'?['validation-study.cjs']:[])].map(name=>[name,hash(fs.readFileSync(path.join(__dirname,name)))])),
    design:taskSet.design||'同一开发任务集：3 任务 × 2 策略，每格 1 次；每次策略最多 2 次模型调用。非独立验证集。',
    stoppingRule:'每次模型调用前检查总调用数、已知累计 token、连续失败数（2 次即停）；失败不重试；调用间阈值非硬计费上限。',
    limitations:[taskSet.limitations||'沿用已观察过失败的开发任务，不能作为独立泛化证据','引文检查仅验证原句存在和数值对应，不能证明语义相关或发现全部冲突','资料由平台选择，非模型自主检索','少量人工任务，每格一次；模型服务名非不可变快照','额外模型调用成本全计入；有未知用量时总量保留未知，另列已知部分']};
  for (const name of Object.keys(protocol.sourceHashes)) fs.copyFileSync(path.join(__dirname,name),path.join(folder,name));
  write(path.join(folder,'protocol.json'),protocol);
  const data={version:1,demo:false,source:studyName==='validation'?'local-validation-study':'local-evidence-study',retrievalStudy:{protocol,status:'running',summary:[]},tasks:[]};
  let callCount=0,knownTokens=0,consecutiveFailures=0,unknownCalls=0;
  const beforeCall=()=>{if(callCount>=maxCalls||knownTokens>=maxTokens||consecutiveFailures>=2)throw new Error('实验达到调用间停止阈值');};
  const persist=()=>{data.generatedAt=new Date().toISOString();data.retrievalStudy.summary=summarize(data);data.retrievalStudy.cost={modelCalls:callCount,knownTokens,unknownCalls};validateDataset(data);write(path.join(folder,'results.json'),data);write(path.join(outputDir,studyName+'-latest.json'),data);};
  for (const entry of schedule) {
    try {beforeCall();}catch(e){data.retrievalStudy.status='stopped';data.retrievalStudy.stopReason=e.message;break;}
    const spec=taskSet.tasks.find(t=>t.id===entry.taskId),runId=randomUUID();
    onProgress(`开始：${spec.title} / ${entry.policy}`);
    const result=await runPolicy(publicTask(spec),entry.policy,{execute,beforeCall,strictSources,
      onInput:input=>write(path.join(folder,runId+'-'+input.round+'-input.json'),input),
      onCall:call=>{callCount++;const tokens=tokenCount(call.usage);knownTokens+=tokens??0;if(tokens===null)unknownCalls++;consecutiveFailures=call.status==='failed'?consecutiveFailures+1:0;write(path.join(folder,runId+'-'+call.round+'-call.json'),call);}});
    const {documents,...record}=result;
    // Gold answers are used only here, after the controller has already stopped.
    const checks=result.outcome?Object.fromEntries(spec.goals.map(g=>[g.id,{status:'unknown',evidence:result.error||'执行未完成'}])):verify(spec,result.answer,documents);
    const outcome=result.outcome||(Object.values(checks).every(c=>c.status==='pass')?'passed':Object.values(checks).some(c=>c.status==='fail')?'verification_failed':'insufficient_evidence');
    record.events.push({type:'verify',atSec:record.durationSec,label:'控制器停止后，独立核对标准答案',detail:`${Object.values(checks).filter(c=>c.status==='pass').length}/${spec.goals.length} 项通过；标准答案不参与停止决策。`});
    const run={...record,id:runId,strategy:policies.find(p=>p.id===entry.policy).label,policy:entry.policy,model:'gpt-6-astra / high（请求配置）',comparisonGroup:id+'-'+spec.id+(result.protocolDeviation?'-tool-deviation':''),checks,outcome};
    let task=data.tasks.find(t=>t.id===spec.id);
    if(!task){task={id:spec.id,title:spec.title,description:spec.description,scenario:'coding',goals:spec.goals.map(({id,label})=>({id,label,weight:5,required:true})),runs:[]};data.tasks.push(task);}
    task.runs.push(run);persist();onProgress(`完成：${outcome}，${run.tokens??'未知'} tokens，${run.calls.length} 次调用`);
    if(outcome==='budget_stopped'){data.retrievalStudy.status='stopped';data.retrievalStudy.stopReason=result.error;break;}
  }
  if(data.retrievalStudy.status==='running')data.retrievalStudy.status='complete';
  if(data.tasks.length)persist();return data;
}
function latestEvidence(){try{return validateDataset(JSON.parse(fs.readFileSync(path.join(__dirname,'runs','evidence-latest.json'),'utf8')));}catch{return null;}}
module.exports={publicTask,inspectEvidence,tokenCount,callCosts,runPolicy,runStudy,summarize,latestEvidence};
if(require.main===module)runStudy().then(d=>console.log(JSON.stringify(d.retrievalStudy,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
