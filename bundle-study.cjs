'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const {runReview}=require('./review-strategy.cjs'),{runPassageReview}=require('./review-passages-strategy.cjs'),{runBundleReview}=require('./review-bundles-strategy.cjs');
const {infer}=require('./retrieval-study.cjs'),{callCosts}=require('./evidence-study.cjs'),{grade,summarize}=require('./passage-study.cjs'),{capture}=require('./codex-bridge.cjs');
const hash=x=>createHash('sha256').update(x).digest('hex'),read=(root,file)=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const write=(file,data)=>{fs.writeFileSync(file+'.tmp',JSON.stringify(data,null,2));fs.renameSync(file+'.tmp',file);};
function checkBundleStudy(root=__dirname){
  const method=read(root,'review-bundles-protocol.json'),lock=read(root,'bundle-study-lock.json');
  for(const [label,p] of [['方法',method],['试验',lock]])for(const [file,value] of Object.entries(p.sourceHashes))if(hash(fs.readFileSync(path.join(root,file)))!==value)throw Error(label+'源码已变化：'+file+'；必须另立版本与协议');
  const design=read(root,'bundle-study-design.json'),fixtures=read(root,'bundle-study-fixtures.json');
  if(!(Date.parse(fixtures.createdAt)>Date.parse(method.frozenAt)&&Date.parse(lock.preparedAt)>Date.parse(fixtures.createdAt)))throw Error('方法冻结、题目创建、执行锁时间次序不符');
  if(design.strategies.length!==4||design.repeats!==4||design.pilotTaskIds.length!==16||fixtures.tasks.length!==16)throw Error('范围偏离预定设计');
  const ids=new Set(fixtures.tasks.map(t=>t.id));if(ids.size!==16||design.pilotTaskIds.some(id=>!ids.has(id))||fixtures.tasks.some(t=>method.observedDevelopmentTaskIds.includes(t.id)))throw Error('重复、缺失或已见任务编号');
  return {method,lock,design,fixtures};
}
function scheduleFor(design){return Array.from({length:design.repeats},(_,repeat)=>design.pilotTaskIds.flatMap((taskId,index)=>design.strategies.map((_,j)=>{const strategy=design.strategies[(repeat+index+j)%4].id;return {id:`${repeat+1}:${taskId}:${strategy}`,repeat:repeat+1,taskId,strategy};}))).flat();}
function preflight(){const {method,lock,design,fixtures}=checkBundleStudy();return {type:'bundle-study-preflight',status:'protocol_valid',method:method.method,frozenAt:method.frozenAt,preparedAt:lock.preparedAt,rows:scheduleFor(design).length,repeats:design.repeats,tasks:design.pilotTaskIds.length,families:new Set(fixtures.tasks.map(t=>t.familyId)).size,maxCalls:design.maxCalls,maxKnownTokens:design.maxKnownTokens,modelCalls:0,provenance:fixtures.provenance,limitations:design.scopeLimit};}
async function runBatch({execute=infer,outputDir=path.join(__dirname,'runs'),batchCalls=16,cliVersion,onProgress=console.log}={}){
  if(!Number.isSafeInteger(batchCalls)||batchCalls<1||batchCalls>64)throw Error('单批调用上限为1–64');
  const {method,lock,design,fixtures}=checkBundleStudy(),schedule=scheduleFor(design);fs.mkdirSync(outputDir,{recursive:true});
  const latest=path.join(outputDir,'bundle-latest.json');let data,folder;
  if(fs.existsSync(latest)){
    data=JSON.parse(fs.readFileSync(latest,'utf8'));folder=path.join(outputDir,data.protocol.id);
    if(data.demo!==(execute!==infer))throw Error('不能混用替身与真实记录');
    if(JSON.stringify(data.protocol.method)!==JSON.stringify(method)||JSON.stringify(data.protocol.lock)!==JSON.stringify(lock))throw Error('不能将新方法或协议混入已有运行');
    if(['complete','stopped'].includes(data.status))throw Error('该协议已完成或停止，禁止自动重跑；新实验另立协议');
    if(data.status==='running')throw Error('已有运行未正常结束，先审计调用存档，不能盲目重试');
    for(const [file,value] of Object.entries(data.protocol.sourceHashes))if(hash(fs.readFileSync(path.join(folder,file)))!==value)throw Error('存档源码不匹配');
    if(JSON.stringify(data.rows.map(r=>r.entryId))!==JSON.stringify(schedule.slice(0,data.rows.length).map(e=>e.id)))throw Error('日程前缀不匹配');
  }else{
    const id='bundle-'+randomUUID();folder=path.join(outputDir,id);fs.mkdirSync(folder);
    const protocol={id,createdAt:new Date().toISOString(),method,lock,design,schedule,provenance:fixtures.provenance,cliVersion:cliVersion||(await capture(['--version'])).output.trim(),sourceHashes:{}};
    for(const file of new Set([...Object.keys(method.sourceHashes),...Object.keys(lock.sourceHashes),'bundle-study-lock.json'])){const bytes=fs.readFileSync(path.join(__dirname,file));protocol.sourceHashes[file]=hash(bytes);fs.writeFileSync(path.join(folder,file),bytes);}
    write(path.join(folder,'protocol.json'),protocol);data={version:1,type:'bundle-study',demo:execute!==infer,protocol,status:'waiting_batch',stopReason:null,rows:[],summary:[],cost:{modelCalls:0,knownTokens:0,unknownCalls:0},consecutiveFailures:0,batches:[],humanReviewMeasurement:'not_measured'};
  }
  const batch={number:data.batches.length+1,startedAt:new Date().toISOString(),callLimit:batchCalls,modelCalls:0,startRows:data.rows.length};data.batches.push(batch);data.status='running';
  const persist=()=>{data.summary=summarize(design,data.rows);data.unrunEntryIds=schedule.slice(data.rows.length).map(e=>e.id);write(path.join(folder,'results.json'),data);write(latest,data);};
  const stopReason=()=>data.cost.unknownCalls?'出现未知用量，停止协议':data.consecutiveFailures>=design.maxConsecutiveFailures?'连续执行失败，停止协议':data.cost.modelCalls>=design.maxCalls?'达到预定调用上限':data.cost.knownTokens>=design.maxKnownTokens?'达到已知用量调用间阈值':null;
  const beforeCall=()=>{const reason=stopReason();if(reason){data.stopReason=reason;throw Error(reason);}};persist();
  for(const entry of schedule.slice(data.rows.length)){
    if(stopReason()){data.stopReason=stopReason();data.status='stopped';break;}
    if(batch.modelCalls>=batchCalls){data.status='waiting_batch';break;}
    const spec=fixtures.tasks.find(t=>t.id===entry.taskId),config=design.strategies.find(s=>s.id===entry.strategy),total=spec.documents.reduce((n,d)=>n+d.text.length,0),budget=config.budget==='full'?total:Math.floor(total/2),rowId=randomUUID(),started=Date.now(),calls=[];let submitted=[];
    const task={id:spec.id,title:spec.title,goals:spec.goals.map(({id,label})=>({id,label})),documents:spec.documents.map(({id,text})=>({id,text}))};
    const recordedExecute=async(modelTask,prompt,onTool,options)=>{
      beforeCall();submitted=modelTask.documents.map(({id,text})=>({id,text}));const call={status:'running',usage:null,promptSha256:hash(prompt),selectedIds:submitted.map(d=>d.id)};
      write(path.join(folder,rowId+'-input.json'),{task:modelTask,prompt,allowedSourceIds:options.allowedSourceIds,promptSha256:call.promptSha256});
      try{const result=await execute(modelTask,prompt,onTool,options);call.status='complete';call.usage=result.usage||null;call.answer=result.answer;call.diagnostics=result.diagnostics||null;call.toolEvents=result.toolEvents||0;data.consecutiveFailures=0;return result;}
      catch(e){call.status='failed';call.usage=e.usage||null;call.diagnostics=e.diagnostics||null;data.consecutiveFailures++;throw e;}
      finally{calls.push(call);batch.modelCalls++;data.cost.modelCalls++;const c=callCosts([call]);data.cost.knownTokens+=c.knownTokens;data.cost.unknownCalls+=c.unknownCalls;write(path.join(folder,rowId+'-call.json'),call);}
    };
    onProgress(`批次 ${batch.number} · ${data.rows.length+1}/${schedule.length} · 第${entry.repeat}次 · ${spec.title} / ${config.label}`);
    const options={scanCharBudget:total,contextCharBudget:budget,execute:recordedExecute,beforeCall,onInput:({plan})=>write(path.join(folder,rowId+'-plan.json'),plan)};
    const result=config.method==='v1'?await runReview(task,options):config.method==='v2'?await runPassageReview(task,{...options,allowPartialCandidate:config.allowPartialCandidate}):await runBundleReview(task,{...options,mode:config.mode});
    if(result.status==='budget_stopped'){data.status='stopped';break;}
    const scoring=grade(spec,result.answer,submitted,result.status,result.protocolDeviation),cost=calls.length?callCosts(calls):{tokens:0,knownTokens:0,unknownCalls:0};
    const row={id:rowId,entryId:entry.id,taskId:spec.id,title:spec.title,familyId:spec.familyId,length:spec.length,repeat:entry.repeat,strategy:entry.strategy,status:result.status,...scoring,answer:result.answer||null,plan:result.plan,selectedIds:result.plan.selectedIds,skippedBeforeCall:!!result.skippedBeforeCall,reason:result.reason||null,calls,cost,durationSec:(Date.now()-started)/1000,protocolDeviation:!!result.protocolDeviation,humanReviewRequired:result.status==='needs_review'};
    write(path.join(folder,rowId+'-plan.json'),result.plan);data.rows.push(row);persist();
  }
  if(data.rows.length===schedule.length)data.status='complete';else if(data.status==='running')data.status='waiting_batch';
  if(stopReason()&&data.status!=='complete'){data.status='stopped';data.stopReason=stopReason();}
  batch.finishedAt=new Date().toISOString();batch.endRows=data.rows.length;persist();return data;
}
function latestBundleStudy(){try{return read(__dirname,'runs/bundle-latest.json');}catch{return null;}}
module.exports={checkBundleStudy,scheduleFor,preflight,runBatch,latestBundleStudy};
if(require.main===module){const args=process.argv.slice(2);if(!args.length)console.log(JSON.stringify(preflight(),null,2));else if(args.length===1&&args[0]==='--run')runBatch().then(d=>console.log(JSON.stringify({id:d.protocol.id,status:d.status,rows:d.rows.length,cost:d.cost,stopReason:d.stopReason},null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});else{console.error('用法：node bundle-study.cjs（检查）；node bundle-study.cjs --run（最多16次，顺序续接同一协议）');process.exitCode=1;}}
