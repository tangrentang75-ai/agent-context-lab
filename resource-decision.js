(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./review-bundles.js'):root.ReviewBundles);if(typeof module==='object'&&module.exports)module.exports=api;else root.ResourceDecision=api;})(typeof globalThis==='object'?globalThis:this,function(bundles){
  'use strict';
  function compare(task,{contextCharBudget=10000,allowExpansion=false,goal='verified'}={}){
    if(!['verified','draft'].includes(goal)||typeof allowExpansion!=='boolean')throw Error('交付目标或预算选项不合法');
    const plan=bundles.planBundles(task,{scanCharBudget:200000,contextCharBudget});
    const full=plan.totalChars,partial=plan.coverage==='incomplete',hasCandidate=plan.submittedChars>0;
    const actions=[
      {id:'stop',label:'停止并转人工核验',available:true,proposedCalls:0,submittedChars:0,expandedChars:0,state:'未完成，保留待核验',eligibleForVerification:false,reason:'不追加模型调用；人工核验的时间和费用尚未测量。'},
      {id:'candidate',label:'生成当前证据候选',available:hasCandidate,proposedCalls:hasCandidate?1:0,submittedChars:plan.submittedChars,expandedChars:0,state:partial?'候选待核验':'可进入独立验收',eligibleForVerification:!partial&&hasCandidate,reason:hasCandidate?(partial?'存在正文省略，生成候选后仍不能自动交付。':'正文完整，但还需实际模型执行和独立验收。'):'预算内没有完整证据组，不能启动候选调用。'},
      {id:'full',label:'提交全部原文',available:full<=contextCharBudget||allowExpansion,proposedCalls:1,submittedChars:full,expandedChars:Math.max(0,full-contextCharBudget),state:'可进入独立验收',eligibleForVerification:true,reason:full<=contextCharBudget?'全文处于正文预算内；模型响应仍需验收。':allowExpansion?'你允许扩大正文预算；费用按实际完整输入记录。':'全文超过当前预算，需明确允许扩大预算后才可选择。'}
    ];
    const recommendation=goal==='draft'&&hasCandidate?'candidate':actions[1].eligibleForVerification?'candidate':actions[2].available?'full':'stop';
    return {type:'resource-decision-comparison',goal,allowExpansion,contextCharBudget,plan,actions,recommendation,executionStatus:'not_executed',modelCalls:0,modelTokens:0,proposedTokens:null,humanReviewMeasurement:'not_measured'};
  }
  function createRecord(task,comparison,actionId,reason,{demo=false,now=new Date().toISOString()}={}){
    const action=comparison.actions.find(a=>a.id===actionId);if(!action?.available)throw Error('该选项目前不可选择');if(typeof reason!=='string'||!reason.trim()||reason.length>3000)throw Error('请填写选择依据（最多3000字符）');
    // Persist public task fields only; gold and annotations are not decision inputs.
    const publicTask={id:task.id||'user-task',title:task.title||'资料核对',goals:task.goals.map(({id,label})=>({id,label})),documents:task.documents.map(({id,text})=>({id,text}))};
    return {type:'resource-decision-record',version:1,demo,createdAt:now,task:publicTask,goal:comparison.goal,contextCharBudget:comparison.contextCharBudget,allowExpansion:comparison.allowExpansion,selectedAction:actionId,selectedLabel:action.label,reason:reason.trim(),proposedCalls:action.proposedCalls,proposedSubmittedChars:action.submittedChars,expandedChars:action.expandedChars,proposedTokens:null,coverage:comparison.plan.coverage,executionStatus:'not_executed',modelCalls:0,modelTokens:0,humanReviewMeasurement:'not_measured'};
  }
  return {compare,createRecord};
});
