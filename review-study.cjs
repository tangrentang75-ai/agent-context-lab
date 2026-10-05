'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const {runReview}=require('./review-strategy.cjs');
const {runPolicy,publicTask,callCosts}=require('./evidence-study.cjs');
const {verifyQuality,promptSuffix}=require('./quality-study.cjs');
const {infer}=require('./retrieval-study.cjs'),{capture}=require('./codex-bridge.cjs');
const strategies=[{id:'all',label:'一次全读'},{id:'evidence',label:'旧引文补读'},{id:'review-tight',label:'覆盖核验 · 半量正文'},{id:'review-full',label:'覆盖核验 · 完整正文'}];
const hash=v=>createHash('sha256').update(v).digest('hex');
const write=(file,data)=>{fs.writeFileSync(file+'.tmp',JSON.stringify(data,null,2));fs.renameSync(file+'.tmp',file);};
function checkFrozen(root=__dirname){const p=JSON.parse(fs.readFileSync(path.join(root,'review-method-protocol.json'),'utf8'));for(const [file,value] of Object.entries(p.sourceHashes))if(hash(fs.readFileSync(path.join(root,file)))!==value)throw new Error('冻结方法已变化：'+file+'；请另立方法版本与评估协议');return p;}
function score(spec,answer,documents,status,protocolDeviation=false){
  const unavailable=['execution_failed','budget_stopped','not_run'].includes(status)||!answer;
  const checks=unavailable?Object.fromEntries(spec.goals.map(g=>[g.id,{status:'unknown',judgment:'unassessed',evidence:'未取得可评分的最终响应'}])):verifyQuality(spec,answer,documents);
  const candidatePassed=unavailable?null:Object.values(checks).every(c=>c.status==='pass');
  const released=!unavailable&&!protocolDeviation&&status==='ready_for_verification';
  return {checks,candidatePassed,released,verifiedCompletion:released&&candidatePassed===true,unsafeRelease:released&&candidatePassed===false};
}
function summarize(rows){return strategies.map(s=>{const r=rows.filter(x=>x.strategy===s.id),assessed=r.filter(x=>x.candidatePassed!==null),cost=callCosts(r.flatMap(x=>x.calls));return {...s,attempted:r.length,assessed:assessed.length,candidatePasses:assessed.filter(x=>x.candidatePassed).length,released:r.filter(x=>x.released).length,verifiedCompletions:r.filter(x=>x.verifiedCompletion).length,unsafeReleases:r.filter(x=>x.unsafeRelease).length,needsReview:r.filter(x=>x.status==='needs_review').length,executionFailures:r.filter(x=>x.status==='execution_failed').length,cost};});}
async function runReviewStudy({execute=infer,outputDir=path.join(__dirname,'runs'),cliVersion,onProgress=console.log,maxCalls=10,maxTokens=160000}={}){
  const method=checkFrozen(),fixtures=JSON.parse(fs.readFileSync(path.join(__dirname,'review-eval-fixtures.json'),'utf8'));
  const specs=fixtures.pilotTaskIds.map(id=>fixtures.tasks.find(t=>t.id===id));
  const id='review-'+randomUUID(),folder=path.join(outputDir,id);fs.mkdirSync(folder,{recursive:true});
  const schedule=specs.flatMap((t,i)=>strategies.map((_,j)=>({taskId:t.id,strategy:strategies[(i+j)%strategies.length].id})));
  const protocol={id,createdAt:new Date().toISOString(),model:'gpt-6-astra',effort:'high',cliVersion:cliVersion||(await capture(['--version'])).output.trim(),method,maxCalls,maxTokens,maxConsecutiveFailures:2,schedule,selection:fixtures.pilotSelection,provenance:fixtures.provenance,unrunTaskIds:fixtures.tasks.filter(t=>!fixtures.pilotTaskIds.includes(t.id)).map(t=>t.id),budgetRule:'扫描预算为全部正文长度；tight 提交预算为总正文长度向下取整的一半，full 为总长。正文字符不是token，调用间阈值不是硬计费上限。',grading:'候选响应评分与是否获准进入验收分别报告；needs_review 不算自动完成。旧策略正常停止视为放行，包括错误放行。',promptDifference:'新模块与旧基线的来源枚举提示措辞和顺序不同；本轮比较完整实现，非仅停止规则的因果消融。',sourceHashes:{}};
  const files=[...new Set([...Object.keys(method.sourceHashes),'review-method-protocol.json','review-eval-fixtures.json','review-study.cjs'])];
  for(const file of files){const bytes=fs.readFileSync(path.join(__dirname,file));protocol.sourceHashes[file]=hash(bytes);fs.writeFileSync(path.join(folder,file),bytes);}
  write(path.join(folder,'protocol.json'),protocol);
  const data={version:1,type:'review-study',demo:false,protocol,status:'running',rows:[],summary:[],cost:{modelCalls:0,knownTokens:0,unknownCalls:0}};
  let consecutiveFailures=0;
  const persist=()=>{data.summary=summarize(data.rows);write(path.join(folder,'results.json'),data);write(path.join(outputDir,'review-latest.json'),data);};
  const beforeCall=()=>{if(data.cost.modelCalls>=maxCalls||data.cost.knownTokens>=maxTokens||consecutiveFailures>=2)throw new Error('达到调用间停止阈值');};
  persist();
  for(const entry of schedule){
    try{beforeCall();}catch{data.status='stopped';break;}
    const spec=specs.find(t=>t.id===entry.taskId),rowId=randomUUID(),started=Date.now();let round=0;
    const callRecords=[];
    const recordedExecute=async(task,prompt,onTool,options)=>{
      const call={round:++round,selectedIds:task.documents.filter(d=>options.allowedSourceIds.includes(d.id)).map(d=>d.id),promptSha256:hash(prompt),usage:null,status:'running'};
      write(path.join(folder,rowId+'-'+round+'-input.json'),{prompt,selectedIds:call.selectedIds});
      try{const r=await execute(task,prompt,onTool,options);call.status='complete';call.usage=r.usage||null;call.answer=r.answer;call.diagnostics=r.diagnostics||null;consecutiveFailures=0;return r;}
      catch(e){call.status='failed';call.usage=e.usage||null;call.diagnostics=e.diagnostics||null;consecutiveFailures++;throw e;}
      finally{callRecords.push(call);data.cost.modelCalls++;const cost=callCosts([call]);data.cost.knownTokens+=cost.knownTokens;data.cost.unknownCalls+=cost.unknownCalls;write(path.join(folder,rowId+'-'+round+'-call.json'),call);}
    };
    onProgress('开始 '+spec.title+' / '+entry.strategy);
    let result,status,documents;const total=spec.documents.reduce((n,d)=>n+d.text.length,0);
    if(entry.strategy.startsWith('review-')){
      result=await runReview(publicTask(spec),{execute:recordedExecute,beforeCall,scanCharBudget:total,contextCharBudget:entry.strategy==='review-tight'?Math.floor(total/2):total});status=result.status;documents=spec.documents.filter(d=>result.plan.selectedIds.includes(d.id));
    }else{
      result=await runPolicy(publicTask(spec),entry.strategy,{execute:recordedExecute,beforeCall,strictSources:true,promptSuffix});status=result.outcome||'ready_for_verification';documents=result.documents;
    }
    const grading=score(spec,result.answer,documents,status,result.protocolDeviation);
    const row={id:rowId,taskId:spec.id,title:spec.title,kind:spec.kind,strategy:entry.strategy,status,...grading,answer:result.answer||null,plan:result.plan||null,retrieval:result.retrieval||null,selectedIds:documents.map(d=>d.id),calls:callRecords,cost:callCosts(callRecords),durationSec:(Date.now()-started)/1000,protocolDeviation:!!result.protocolDeviation};
    data.rows.push(row);persist();onProgress(`完成 ${status}；候选通过=${grading.candidatePassed}；自动完成=${grading.verifiedCompletion}；${row.cost.tokens??'未知'} tokens`);
    if(status==='budget_stopped'){data.status='stopped';break;}
  }
  if(data.status==='running')data.status='complete';persist();return data;
}
function latestReview(){try{return JSON.parse(fs.readFileSync(path.join(__dirname,'runs','review-latest.json'),'utf8'));}catch{return null;}}
module.exports={checkFrozen,score,summarize,runReviewStudy,latestReview};
if(require.main===module)runReviewStudy().then(d=>console.log(JSON.stringify({id:d.protocol.id,status:d.status,summary:d.summary,cost:d.cost},null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
