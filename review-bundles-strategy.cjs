'use strict';
const {planBundles,documentsForPlan}=require('./review-bundles.js'),{infer,buildPrompt}=require('./retrieval-study.cjs'),{promptSuffix}=require('./quality-study.cjs'),{callCosts}=require('./evidence-study.cjs');
async function runBundleReview(spec,{scanCharBudget,contextCharBudget,mode='stop',execute=infer,beforeCall=()=>{},onInput=()=>{}}={}){
  if(!['stop','candidate','full-fallback'].includes(mode))throw Error('未知证据组运行模式');
  const initial=planBundles(spec,{scanCharBudget,contextCharBudget});let plan=initial;
  if(mode==='full-fallback'&&initial.coverage==='incomplete'){
    const total=spec.documents.reduce((n,d)=>n+d.text.length,0);
    // Full fallback explicitly enlarges both budgets; it is never charged as half context.
    const full=planBundles(spec,{scanCharBudget:total,contextCharBudget:total});
    // v3 bundles can omit non-cue filler even with full budget. A full fallback sends exact originals.
    plan={...full,selectedPassages:spec.documents.map(d=>({sourceId:d.id,start:0,end:d.text.length,text:d.text,cueTags:[],score:0,matches:[]})),submittedChars:total,scannedChars:total,selectedIds:spec.documents.map(d=>d.id),omittedIds:[],partialIds:[],unsubmittedCues:[],documentCoverage:spec.documents.map(d=>({id:d.id,totalChars:d.text.length,submittedChars:d.text.length,scanned:true,complete:true,omittedRanges:[]})),coverage:'all_provided_documents',disposition:'ready_for_verification',callRecommendation:'eligible_for_verification',fallback:{reason:'半量计划正文不完整，调用前提交全部原文',requestedScanCharBudget:initial.scanCharBudget,requestedContextCharBudget:initial.contextCharBudget,initialSubmittedChars:initial.submittedChars,budgetIncrease:total-initial.contextCharBudget},controllerMs:initial.controllerMs+full.controllerMs};
  }
  const empty={plan,status:'needs_review',answer:null,calls:[],cost:{tokens:0,knownTokens:0,unknownCalls:0}};
  if(mode==='stop'&&plan.coverage==='incomplete')return {...empty,skippedBeforeCall:true,reason:'证据组未覆盖全部正文，默认停止'};
  const documents=documentsForPlan(spec,plan);if(!documents.length)return {...empty,skippedBeforeCall:true,reason:'预算内没有完整证据组'};
  const task={id:spec.id,title:spec.title||'资料配置核对',goals:spec.goals.map(({id,label})=>({id,label})),documents};
  try{beforeCall();}catch{return {...empty,status:'budget_stopped'};}
  const prompt=buildPrompt(task,documents)+'\n'+promptSuffix+'\nsourceId 只允许使用本轮资料的裸编号：'+documents.map(d=>d.id).join('、')+'；无依据时为 null。'+(plan.coverage==='incomplete'?'\n这是部分原文，省略内容未知。只生成待核验候选，不声称资料完整或任务完成。':'');
  onInput({task,prompt,plan});
  try{const result=await execute(task,prompt,()=>{},{allowedSourceIds:documents.map(d=>d.id)}),calls=[{status:'complete',usage:result.usage||null,diagnostics:result.diagnostics||null}];return {plan,status:result.toolEvents?'needs_review':plan.disposition,answer:result.answer,calls,cost:callCosts(calls),protocolDeviation:!!result.toolEvents,skippedBeforeCall:false};}
  catch(e){const calls=[{status:'failed',usage:e.usage||null,diagnostics:e.diagnostics||null}];return {...empty,status:'execution_failed',calls,cost:callCosts(calls),skippedBeforeCall:false};}
}
module.exports={runBundleReview};
