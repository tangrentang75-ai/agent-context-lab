'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const {runReview}=require('./review-strategy.cjs'),{runPassageReview}=require('./review-passages-strategy.cjs');
const {infer}=require('./retrieval-study.cjs'),{callCosts}=require('./evidence-study.cjs'),{score}=require('./review-study.cjs');
const {capture}=require('./codex-bridge.cjs');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=(root,file)=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const write=(file,data)=>{fs.writeFileSync(file+'.tmp',JSON.stringify(data,null,2));fs.renameSync(file+'.tmp',file);};
function verifyHashes(root,protocol,label){for(const [file,expected] of Object.entries(protocol.sourceHashes)){if(hash(fs.readFileSync(path.join(root,file)))!==expected)throw Error(label+'已变化：'+file+'；请另立版本与协议');}}
function checkPassageStudy(root=__dirname){
  const method=read(root,'review-passages-protocol.json'),lock=read(root,'passage-study-lock.json');
  verifyHashes(root,method,'冻结方法');verifyHashes(root,lock,'试点协议/源码');
  const design=read(root,'passage-study-design.json'),fixtures=read(root,'passage-study-fixtures.json');
  if(!(Date.parse(lock.preparedAt)>Date.parse(method.frozenAt)))throw Error('试点准备时间必须晚于方法冻结');
  if(design.repeats!==2||design.strategies.length!==4||design.pilotTaskIds.length!==2)throw Error('试点设计与预定范围不符');
  const ids=new Set(fixtures.tasks.map(t=>t.id));if(ids.size!==fixtures.tasks.length||design.pilotTaskIds.some(id=>!ids.has(id))||fixtures.tasks.some(t=>method.observedDevelopmentTaskIds.includes(t.id)))throw Error('任务重复、缺失或复用了已见开发任务编号');
  return {method,lock,design,fixtures};
}
function scheduleFor(design){return Array.from({length:design.repeats},(_,repeat)=>design.pilotTaskIds.flatMap((taskId,index)=>design.strategies.map((_,j)=>{const strategy=design.strategies[(repeat*design.pilotTaskIds.length+index+j)%design.strategies.length].id;return {id:`${repeat+1}:${taskId}:${strategy}`,repeat:repeat+1,taskId,strategy};}))).flat();}
function costs(calls,attempted=true){return calls.length?callCosts(calls):{tokens:attempted?0:null,knownTokens:0,unknownCalls:0};}
function grade(spec,answer,submitted,status,deviation){
  const grading=score(spec,answer,submitted,status,deviation);
  // A quote must exist in both the model-visible text and the actual original source.
  for(const goal of spec.goals){const a=answer?.[goal.id];if(grading.checks[goal.id].status==='pass'&&a?.value!==null&&!spec.documents.find(d=>d.id===a.sourceId)?.text.includes(a.quote)){grading.checks[goal.id]={status:'fail',judgment:'fabricated_quote',evidence:'引文不在原文中；不能引用拼接标记或跨省略处拼出的句子。'};}}
  if(grading.candidatePassed!==null)grading.candidatePassed=Object.values(grading.checks).every(c=>c.status==='pass');
  grading.verifiedCompletion=grading.released&&grading.candidatePassed===true;grading.unsafeRelease=grading.released&&grading.candidatePassed===false;
  return grading;
}
function summarize(design,rows){return design.strategies.map(s=>{
  const r=rows.filter(row=>row.strategy===s.id),assessed=r.filter(row=>row.candidatePassed!==null);
  return {id:s.id,label:s.label,planned:design.pilotTaskIds.length*design.repeats,attempted:r.length,assessed:assessed.length,candidatePasses:assessed.filter(row=>row.candidatePassed).length,released:r.filter(row=>row.released).length,verifiedCompletions:r.filter(row=>row.verifiedCompletion).length,unsafeReleases:r.filter(row=>row.unsafeRelease).length,needsReview:r.filter(row=>row.status==='needs_review').length,skippedBeforeCall:r.filter(row=>row.skippedBeforeCall).length,executionFailures:r.filter(row=>row.status==='execution_failed').length,modelCalls:r.reduce((n,row)=>n+row.calls.length,0),cost:costs(r.flatMap(row=>row.calls),r.length>0),byRepeat:Array.from({length:design.repeats},(_,i)=>{const runs=r.filter(row=>row.repeat===i+1);return {repeat:i+1,attempted:runs.length,assessed:runs.filter(row=>row.candidatePassed!==null).length,verifiedCompletions:runs.filter(row=>row.verifiedCompletion).length,cost:costs(runs.flatMap(row=>row.calls),runs.length>0)};})};
});}
function preflight(root=__dirname){const {method,lock,design,fixtures}=checkPassageStudy(root);return {type:'passage-study-preflight',status:'prepared_not_run',method:method.method,methodFrozenAt:method.frozenAt,preparedAt:lock.preparedAt,modelRequest:design.modelRequest,reasoningEffort:design.reasoningEffort,plannedRows:scheduleFor(design).length,pilotTasks:design.pilotTaskIds,repeats:design.repeats,reservedTaskIds:fixtures.tasks.filter(t=>!design.pilotTaskIds.includes(t.id)).map(t=>t.id),maxCalls:design.maxCalls,maxKnownTokens:design.maxKnownTokens,stopOnUnknownUsage:design.stopOnUnknownUsage,provenance:fixtures.provenance,limitations:design.scopeLimit,modelCalls:0};}
async function runPassageStudy({execute=infer,outputDir=path.join(__dirname,'runs'),cliVersion,onProgress=console.log}={}){
  const {method,lock,design,fixtures}=checkPassageStudy(),schedule=scheduleFor(design),id='passage-'+randomUUID(),folder=path.join(outputDir,id);fs.mkdirSync(folder,{recursive:true});
  const protocol={id,createdAt:new Date().toISOString(),method,lock,design,schedule,provenance:fixtures.provenance,cliVersion:cliVersion||(await capture(['--version'])).output.trim(),unrunTaskIds:fixtures.tasks.filter(t=>!design.pilotTaskIds.includes(t.id)).map(t=>t.id),sourceHashes:{}};
  for(const file of new Set([...Object.keys(method.sourceHashes),...Object.keys(lock.sourceHashes),'passage-study-lock.json'])){const bytes=fs.readFileSync(path.join(__dirname,file));protocol.sourceHashes[file]=hash(bytes);fs.writeFileSync(path.join(folder,file),bytes);}
  write(path.join(folder,'protocol.json'),protocol);
  const data={version:1,type:'passage-study',demo:execute!==infer,protocol,status:'running',stopReason:null,rows:[],summary:[],cost:{modelCalls:0,knownTokens:0,unknownCalls:0},humanReviewMeasurement:'not_measured'};
  let consecutiveFailures=0;
  const persist=()=>{data.summary=summarize(design,data.rows);data.unrunEntryIds=schedule.filter(e=>!data.rows.some(r=>r.entryId===e.id)).map(e=>e.id);write(path.join(folder,'results.json'),data);write(path.join(outputDir,'passage-latest.json'),data);};
  const beforeCall=()=>{const reason=data.cost.modelCalls>=design.maxCalls?'达到调用次数上限':data.cost.knownTokens>=design.maxKnownTokens?'达到已知用量调用间阈值':consecutiveFailures>=design.maxConsecutiveFailures?'连续执行失败':design.stopOnUnknownUsage&&data.cost.unknownCalls?'出现未知用量':null;if(reason){data.stopReason=reason;throw Error(reason);}};
  persist();
  for(const entry of schedule){
    // Unknown usage or repeated failures stop the protocol. A call quota still permits
    // later controller-only skips; blocked call entries remain unrun, not zero-cost attempts.
    if(consecutiveFailures>=design.maxConsecutiveFailures||(design.stopOnUnknownUsage&&data.cost.unknownCalls)){try{beforeCall();}catch{data.status='stopped';break;}}
    const spec=fixtures.tasks.find(t=>t.id===entry.taskId),strategy=design.strategies.find(s=>s.id===entry.strategy),started=Date.now(),total=spec.documents.reduce((n,d)=>n+d.text.length,0),contextCharBudget=strategy.budget==='half'?Math.floor(total/2):total;
    // Strict public projection: gold, task kind, description and annotations never enter controllers.
    const task={id:spec.id,title:spec.title,goals:spec.goals.map(({id,label})=>({id,label})),documents:spec.documents.map(({id,text})=>({id,text}))};
    const rowId=randomUUID(),calls=[];let submitted=[];
    const recordedExecute=async(modelTask,prompt,onTool,options)=>{
      beforeCall();submitted=modelTask.documents.map(d=>({id:d.id,text:d.text}));
      const call={status:'running',usage:null,promptSha256:hash(prompt),selectedIds:submitted.map(d=>d.id)};
      write(path.join(folder,rowId+'-input.json'),{task:modelTask,prompt,allowedSourceIds:options.allowedSourceIds,promptSha256:call.promptSha256});
      try{const result=await execute(modelTask,prompt,onTool,options);call.status='complete';call.usage=result.usage||null;call.answer=result.answer;call.diagnostics=result.diagnostics||null;call.toolEvents=result.toolEvents||0;consecutiveFailures=0;return result;}
      catch(e){call.status='failed';call.usage=e.usage||null;call.diagnostics=e.diagnostics||null;consecutiveFailures++;throw e;}
      finally{calls.push(call);data.cost.modelCalls++;const cost=costs([call]);data.cost.knownTokens+=cost.knownTokens;data.cost.unknownCalls+=cost.unknownCalls;write(path.join(folder,rowId+'-call.json'),call);}
    };
    onProgress(`第${entry.repeat}次 · ${spec.title} / ${strategy.label}`);
    const options={scanCharBudget:total,contextCharBudget,execute:recordedExecute,beforeCall,onInput:({plan})=>write(path.join(folder,rowId+'-plan.json'),plan)};
    const result=strategy.method==='v1'?await runReview(task,options):await runPassageReview(task,{...options,allowPartialCandidate:strategy.allowPartialCandidate});
    if(result.status==='budget_stopped'){data.status='stopped';break;}
    const grading=grade(spec,result.answer,submitted,result.status,result.protocolDeviation);
    const row={id:rowId,entryId:entry.id,taskId:spec.id,title:spec.title,repeat:entry.repeat,strategy:entry.strategy,status:result.status,...grading,answer:result.answer||null,plan:result.plan,selectedIds:result.plan.selectedIds,skippedBeforeCall:!!result.skippedBeforeCall,reason:result.reason||null,calls,cost:costs(calls),durationSec:(Date.now()-started)/1000,protocolDeviation:!!result.protocolDeviation,humanReviewRequired:result.status==='needs_review'};
    write(path.join(folder,rowId+'-plan.json'),result.plan);data.rows.push(row);persist();
  }
  if(data.status==='running')data.status='complete';persist();return data;
}
function latestPassageStudy(){try{return read(__dirname,'runs/passage-latest.json');}catch{return null;}}
module.exports={checkPassageStudy,scheduleFor,summarize,grade,preflight,runPassageStudy,latestPassageStudy};
if(require.main===module){if(process.argv.length===2)console.log(JSON.stringify(preflight(),null,2));else if(process.argv.length===3&&process.argv[2]==='--run')runPassageStudy().then(d=>console.log(JSON.stringify({id:d.protocol.id,status:d.status,cost:d.cost,summary:d.summary},null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});else{console.error('用法：node passage-study.cjs（仅检查）；node passage-study.cjs --run（使用模型额度）');process.exitCode=1;}}
