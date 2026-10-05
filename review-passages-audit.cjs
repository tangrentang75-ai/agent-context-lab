'use strict';
const fs=require('node:fs'),path=require('node:path');
const {planReview}=require('./review-planner.js'),{planPassages}=require('./review-passages.js');
const {checkFrozen}=require('./review-study.cjs');
function auditPassages(fixtures=JSON.parse(fs.readFileSync(path.join(__dirname,'review-eval-fixtures.json'),'utf8'))){
  checkFrozen();
  const rows=fixtures.tasks.flatMap(spec=>{
    // Existing observed tasks are development replay, never independent evaluation.
    const task={id:spec.id,goals:spec.goals.map(({id,label})=>({id,label})),documents:spec.documents.map(({id,text})=>({id,text}))},total=task.documents.reduce((n,d)=>n+d.text.length,0);
    return ['zero','half','full'].map(budget=>{const contextCharBudget=budget==='zero'?0:budget==='half'?Math.floor(total/2):total,options={scanCharBudget:total,contextCharBudget},old=planReview(task,options),plan=planPassages(task,options);return {taskId:spec.id,title:spec.title,budget,totalChars:total,contextCharBudget,v1:{submittedChars:old.submittedChars,selectedIds:old.selectedIds,disposition:old.disposition},v2:plan,candidatePassed:null,verifiedCompletion:null};});
  });
  return {type:'passage-development-audit',method:'lexical-passages-v2',generatedAt:new Date().toISOString(),demo:true,provenance:'重放已见的六个开发任务；开发过程中查看过结果，不是独立评估，也未生成模型答案。',modelCalls:0,modelTokens:null,costNote:'没有模型调用；未测量端到端性能或费用。字符、片段数量和调用建议不能当作真实 token 或质量结果。',rows};
}
module.exports={auditPassages};
if(require.main===module){const data=auditPassages(),folder=path.join(__dirname,'artifacts');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'review-passages-audit.json'),JSON.stringify(data,null,2));console.log(JSON.stringify({type:data.type,modelCalls:data.modelCalls,half:data.rows.filter(r=>r.budget==='half').map(r=>({taskId:r.taskId,budget:r.contextCharBudget,v1:r.v1.submittedChars,v2:r.v2.submittedChars,sources:r.v2.selectedIds,passages:r.v2.selectedPassages.map(p=>({sourceId:p.sourceId,text:p.text})),recommendation:r.v2.callRecommendation}))},null,2));}
