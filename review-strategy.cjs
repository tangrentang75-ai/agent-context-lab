'use strict';
const {planReview}=require('./review-planner.js');
const {infer,buildPrompt}=require('./retrieval-study.cjs');
const {promptSuffix}=require('./quality-study.cjs');
const {callCosts}=require('./evidence-study.cjs');
// One-call candidate strategy. Gold values and audit annotations never cross this boundary.
async function runReview(spec,{scanCharBudget,contextCharBudget,execute=infer,beforeCall=()=>{},onInput=()=>{}}={}){
  const plan=planReview(spec,{scanCharBudget,contextCharBudget});
  const documents=spec.documents.filter(d=>plan.selectedIds.includes(d.id)).map(({id,text})=>({id,text}));
  const task={id:spec.id,title:spec.title||'资料配置核对',goals:spec.goals.map(({id,label})=>({id,label})),documents};
  if(!documents.length)return {plan,status:'needs_review',reason:'预算内没有可提交的完整资料',answer:null,calls:[],cost:{tokens:0,knownTokens:0,unknownCalls:0}};
  try{beforeCall();}catch{return {plan,status:'budget_stopped',answer:null,calls:[],cost:{tokens:0,knownTokens:0,unknownCalls:0}};}
  const prompt=buildPrompt(task,documents)+'\n'+promptSuffix+'\nsourceId 只允许使用本轮资料的裸编号：'+documents.map(d=>d.id).join('、')+'；无依据时为 null。';
  onInput({task,prompt,plan});
  try{
    const result=await execute(task,prompt,()=>{},{allowedSourceIds:documents.map(d=>d.id)});
    const calls=[{status:'complete',usage:result.usage||null,diagnostics:result.diagnostics||null}];
    return {plan,status:result.toolEvents?'needs_review':plan.disposition,answer:result.answer,calls,cost:callCosts(calls),protocolDeviation:!!result.toolEvents};
  }catch(e){const calls=[{status:'failed',usage:e.usage||null,diagnostics:e.diagnostics||null}];return {plan,status:'execution_failed',answer:null,calls,cost:callCosts(calls)};}
}
module.exports={runReview};
