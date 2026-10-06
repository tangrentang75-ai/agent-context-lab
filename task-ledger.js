(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./resource-decision.js'):root.ResourceDecision);if(typeof module==='object'&&module.exports)module.exports=api;else root.TaskLedger=api;})(typeof globalThis==='object'?globalThis:this,function(decisions){
  'use strict';
  const copy=v=>JSON.parse(JSON.stringify(v));
  const id=()=>globalThis.crypto.randomUUID();
  function text(v,label,max=3000){if(typeof v!=='string'||!v.trim()||v.length>max)throw Error(label+'必须填写，且长度不能超过'+max);return v.trim();}
  function number(v,label){if(v!==null&&(!Number.isSafeInteger(v)||v<0))throw Error(label+'须为非负整数或 null');return v;}
  function date(v){if(typeof v!=='string'||!Number.isFinite(Date.parse(v)))throw Error('记录时间不合法');return v;}
  function snapshot(record){
    if(!record||record.type!=='resource-decision-record'||record.executionStatus!=='not_executed'||typeof record.demo!=='boolean')throw Error('需要尚未执行的资源决策记录');
    const comparison=decisions.compare(record.task,{goal:record.goal,contextCharBudget:record.contextCharBudget,allowExpansion:record.allowExpansion});
    const canonical=decisions.createRecord(record.task,comparison,record.selectedAction,record.reason,{demo:record.demo,now:date(record.createdAt)});
    for(const k of ['proposedCalls','proposedSubmittedChars','expandedChars','coverage'])if(canonical[k]!==record[k])throw Error('决策与资料或资源条件不一致：'+k);
    if(record.id)canonical.id=text(record.id,'决策编号',100);return canonical;
  }
  function open(record,{now=new Date().toISOString(),ledgerId=id()}={}){
    return {type:'task-ledger',version:1,id:text(ledgerId,'台账编号',100),createdAt:date(now),decision:snapshot(record),executions:[],reviews:[]};
  }
  function execution(raw,decision,{now=new Date().toISOString(),executionId=id()}={}){
    if(decision.selectedAction==='stop')throw Error('停止路径不追加模型执行；请另存新的资源决策');
    if(!raw||!['complete','failed'].includes(raw.status))throw Error('执行状态应为 complete 或 failed');
    const output=raw.status==='complete'?text(raw.output,'实际输出',100000):(typeof raw.output==='string'?raw.output.slice(0,100000):'');
    if(!Number.isSafeInteger(raw.modelCalls)||raw.modelCalls<1||raw.modelCalls>1000)throw Error('已尝试模型调用须为 1–1000 的整数');
    const input=number(raw.inputTokens,'输入 tokens'),out=number(raw.outputTokens,'输出 tokens');
    if(input!==null&&out!==null&&!Number.isSafeInteger(input+out))throw Error('总用量超过整数范围');
    const seconds=raw.durationSec;
    if(seconds!==null&&(!Number.isFinite(seconds)||seconds<0||seconds>86400))throw Error('执行耗时须为 0–86400 秒或 null');
    return {id:text(executionId,'执行编号',100),createdAt:date(now),status:raw.status,output,model:text(raw.model,'模型或执行器',300),modelCalls:raw.modelCalls,inputTokens:input,outputTokens:out,knownTokens:(input??0)+(out??0),tokens:input===null||out===null?null:input+out,durationSec:seconds,reference:text(raw.reference,'记录来源',1000),provenance:'user_reported',usageSource:'user_reported',independentlyVerified:false};
  }
  function appendExecution(ledger,raw,options){
    validate(ledger);if(ledger.executions.length>=30)throw Error('每份台账最多30次执行');const next=copy(ledger);next.executions.push(execution(raw,next.decision,options));return next;
  }
  function review(raw,ledger,executionId,{now=new Date().toISOString(),reviewId=id()}={}){
    const run=ledger.executions.find(e=>e.id===executionId);if(!run||run.status!=='complete')throw Error('只能核验已获得输出的执行');
    if(!raw||!raw.checks||typeof raw.reviewedAllDocuments!=='boolean')throw Error('请提供逐目标核验及资料复核声明');
    const checks=Object.create(null);
    for(const goal of ledger.decision.task.goals){
      const check=raw.checks[goal.id];if(!check||!['pass','fail','unknown'].includes(check.status))throw Error('目标 '+goal.id+' 缺少核验状态');
      if(!Array.isArray(check.citations)||check.citations.length>20)throw Error('引文应为最多20项的数组');
      const citations=check.citations.map(c=>{
        const doc=ledger.decision.task.documents.find(d=>d.id===c.sourceId);
        if(!doc||!Number.isSafeInteger(c.start)||!Number.isSafeInteger(c.end)||c.start<0||c.end<=c.start||c.end>doc.text.length||typeof c.quote!=='string'||doc.text.slice(c.start,c.end)!==c.quote)throw Error('引文须与原文位置及文字一致');
        return {sourceId:doc.id,start:c.start,end:c.end,quote:c.quote};
      });
      if(check.status==='pass'&&!citations.length)throw Error('通过目标需要至少一条原文引文');
      checks[goal.id]={status:check.status,reason:check.status==='unknown'?(typeof check.reason==='string'?check.reason.slice(0,3000):''):text(check.reason,'核验依据'),citations};
    }
    if(Object.keys(raw.checks).some(k=>!ledger.decision.task.goals.some(g=>g.id===k)))throw Error('核验含未知目标');
    const duration=raw.humanReviewSec;
    if(duration!==null&&(!Number.isFinite(duration)||duration<0||duration>86400))throw Error('人工复核耗时须为 0–86400 秒或 null');
    if(Date.parse(now)<Date.parse(run.createdAt))throw Error('核验时间不能早于执行');
    return {id:text(reviewId,'核验编号',100),executionId:run.id,createdAt:date(now),reviewer:text(raw.reviewer,'复核者',200),checks,reviewedAllDocuments:raw.reviewedAllDocuments,humanReviewSec:duration,measurement:duration===null?'not_measured':'user_reported',provenance:'human_reported',independentlyVerified:false};
  }
  function appendReview(ledger,executionId,raw,options){validate(ledger);if(ledger.reviews.length>=100)throw Error('每份台账最多100次核验');const next=copy(ledger);next.reviews.push(review(raw,next,executionId,options));return next;}
  function validate(ledger){
    if(!ledger||ledger.type!=='task-ledger'||ledger.version!==1||!Array.isArray(ledger.executions)||!Array.isArray(ledger.reviews)||ledger.executions.length>30||ledger.reviews.length>100)throw Error('台账格式不正确');
    text(ledger.id,'台账编号',100);date(ledger.createdAt);snapshot(ledger.decision);const ids=new Set();
    for(const r of ledger.executions){if(ids.has(r.id))throw Error('执行编号重复');ids.add(r.id);const normalized=execution(r,ledger.decision,{now:r.createdAt,executionId:r.id});for(const k of Object.keys(normalized))if(JSON.stringify(normalized[k])!==JSON.stringify(r[k]))throw Error('执行记录字段不一致：'+k);}
    ids.clear();for(const r of ledger.reviews){if(ids.has(r.id))throw Error('核验编号重复');ids.add(r.id);const normalized=review(r,ledger,r.executionId,{now:r.createdAt,reviewId:r.id});for(const k of Object.keys(normalized))if(JSON.stringify(normalized[k])!==JSON.stringify(r[k]))throw Error('核验记录字段不一致：'+k);}
    return ledger;
  }
  function summarize(ledger){
    validate(ledger);const run=ledger.executions.at(-1),check=run?ledger.reviews.filter(r=>r.executionId===run.id).at(-1):null;
    const allPass=!!check&&Object.values(check.checks).every(c=>c.status==='pass');
    const fullReviewed=ledger.decision.selectedAction==='full'||ledger.decision.coverage==='all_provided_documents'||check?.reviewedAllDocuments===true;
    const state=!run?'not_executed':run.status==='failed'?'execution_failed':!check?'pending_review':Object.values(check.checks).some(c=>c.status==='fail')?'review_failed':allPass?(fullReviewed?'human_accepted':'candidate_accepted'):'pending_review';
    return {state,modelCalls:ledger.executions.reduce((n,r)=>n+r.modelCalls,0),knownTokens:ledger.executions.reduce((n,r)=>n+r.knownTokens,0),unknownUsageExecutions:ledger.executions.filter(r=>r.tokens===null).length,tokens:ledger.executions.some(r=>r.tokens===null)?null:ledger.executions.reduce((n,r)=>n+r.tokens,0),latestExecutionId:run?.id||null,latestReviewId:check?.id||null,humanAccepted:state==='human_accepted',independentlyVerified:false,humanReviewKnownSec:ledger.reviews.reduce((n,r)=>n+(r.humanReviewSec??0),0),unmeasuredReviews:ledger.reviews.filter(r=>r.humanReviewSec===null).length};
  }
  return {open,appendExecution,appendReview,validate,summarize};
});
