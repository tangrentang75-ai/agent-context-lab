'use strict';
const {planPassages}=require('./review-passages.js');
const {infer,buildPrompt}=require('./retrieval-study.cjs');
const {promptSuffix}=require('./quality-study.cjs');
const {callCosts}=require('./evidence-study.cjs');
// Partial plans are useful for inspection, but cannot complete a task under this gate.
async function runPassageReview(spec,{scanCharBudget,contextCharBudget,allowPartialCandidate=false,execute=infer,beforeCall=()=>{},onInput=()=>{}}={}){
  if(typeof allowPartialCandidate!=='boolean')throw Error('allowPartialCandidate 必须为布尔值');
  const plan=planPassages(spec,{scanCharBudget,contextCharBudget});
  const empty={plan,status:'needs_review',answer:null,calls:[],cost:{tokens:0,knownTokens:0,unknownCalls:0}};
  if(plan.disposition==='needs_review'&&!allowPartialCandidate)return {...empty,reason:'部分正文未提交，默认在调用前停止；请补足预算或人工核验',skippedBeforeCall:true};
  const documents=spec.documents.filter(d=>plan.selectedIds.includes(d.id)).map(d=>{
    let text='',previousEnd=null;
    for(const p of plan.selectedPassages.filter(p=>p.sourceId===d.id)){if(previousEnd===null&&p.start>0)text+='[省略开头正文]\n';if(previousEnd!==null&&previousEnd!==p.start)text+='\n[省略未提供正文]\n';text+=p.text;previousEnd=p.end;}
    if(previousEnd<d.text.length)text+='\n[省略结尾正文]';
    return {id:d.id,text};
  });
  if(!documents.length)return {...empty,reason:'预算内没有完整句段',skippedBeforeCall:true};
  const task={id:spec.id,title:spec.title||'资料配置核对',goals:spec.goals.map(({id,label})=>({id,label})),documents};
  try{beforeCall();}catch{return {...empty,status:'budget_stopped'};}
  const prompt=buildPrompt(task,documents)+'\n'+promptSuffix+'\nsourceId 只允许使用本轮资料的裸编号：'+documents.map(d=>d.id).join('、')+'；无依据时为 null。'+(plan.disposition==='needs_review'?'\n这是部分原文，省略内容未知。只生成待核验候选，不声称资料完整或任务完成。':'');
  onInput({task,prompt,plan});
  try{const result=await execute(task,prompt,()=>{},{allowedSourceIds:documents.map(d=>d.id)}),calls=[{status:'complete',usage:result.usage||null,diagnostics:result.diagnostics||null}];return {plan,status:result.toolEvents?'needs_review':plan.disposition,answer:result.answer,calls,cost:callCosts(calls),protocolDeviation:!!result.toolEvents,skippedBeforeCall:false};}
  catch(e){const calls=[{status:'failed',usage:e.usage||null,diagnostics:e.diagnostics||null}];return {plan,status:'execution_failed',answer:null,calls,cost:callCosts(calls),skippedBeforeCall:false};}
}
module.exports={runPassageReview};
