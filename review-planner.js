(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ReviewPlanner=api;})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  // Lexical triage only. Neither matching text nor absence of a match proves completeness.
  function terms(text){const parts=text.toLowerCase().match(/[a-z0-9]+|[\u3400-\u9fff]+/g)||[];return [...new Set(parts.flatMap(p=>/^[\u3400-\u9fff]+$/.test(p)?Array.from({length:Math.max(0,p.length-1)},(_,i)=>p.slice(i,i+2)):[p]))];}
  function validate(task){
    if(!task||!Array.isArray(task.goals)||!task.goals.length||task.goals.length>20||!Array.isArray(task.documents)||!task.documents.length||task.documents.length>100)throw new Error('需要 1–20 个目标及 1–100 份资料');
    for(const [items,key] of [[task.goals,'label'],[task.documents,'text']]){const ids=new Set();for(const item of items){if(!item||typeof item.id!=='string'||!item.id.trim()||item.id.length>100||ids.has(item.id)||typeof item[key]!=='string'||!item[key].trim())throw new Error('目标或资料的编号必须唯一，正文和目标名称不能为空');ids.add(item.id);}}
    if(task.documents.reduce((n,d)=>n+d.text.length,0)>200000||task.goals.some(g=>g.label.length>500))throw new Error('资料总长度最多 200,000 字符，目标名称最多 500 字符');
  }
  function planReview(task,{scanCharBudget=20000,contextCharBudget=10000}={}){
    validate(task);for(const value of [scanCharBudget,contextCharBudget])if(!Number.isSafeInteger(value)||value<0||value>200000)throw new Error('预算须为 0–200,000 的整数');
    const started=performance.now(),goalTerms=task.goals.map(g=>({id:g.id,terms:terms(g.label)}));
    let scannedChars=0;const scanned=[],unscannedIds=[],candidates=[];
    // Whole documents, in corpus order. Never treat a truncated prefix as a full scan.
    for(const [index,doc] of task.documents.entries()){
      if(scannedChars+doc.text.length>scanCharBudget){unscannedIds.push(doc.id);continue;}
      scannedChars+=doc.text.length;let score=0;
      const sentences=doc.text.match(/[^。！？\n]+[。！？]?/g)||[doc.text];
      for(const sentence of sentences){const lower=sentence.toLowerCase();for(const goal of goalTerms){const matched=goal.terms.filter(t=>lower.includes(t));if(!matched.length)continue;score+=matched.length;candidates.push({goalId:goal.id,sourceId:doc.id,quote:sentence,matchedTerms:matched,numbers:[...new Set(sentence.match(/-?\d+(?:\.\d+)?/g)||[])]});}}
      scanned.push({id:doc.id,index,chars:doc.text.length,score});
    }
    const selectedIds=[];let submittedChars=0;
    // Include zero-score documents if budget permits: lexical silence is not irrelevance.
    for(const doc of [...scanned].sort((a,b)=>b.score-a.score||a.index-b.index))if(submittedChars+doc.chars<=contextCharBudget){selectedIds.push(doc.id);submittedChars+=doc.chars;}
    const omittedIds=task.documents.filter(d=>!selectedIds.includes(d.id)).map(d=>d.id);
    const possibleConflicts=task.goals.flatMap(g=>{const hits=candidates.filter(c=>c.goalId===g.id&&c.numbers.length);const values=[...new Set(hits.flatMap(c=>c.numbers))];return values.length>1?[{goalId:g.id,values,sourceIds:[...new Set(hits.map(c=>c.sourceId))],reason:'相关句出现不同数字；可能是范围、日期、不同单位或已失效规定，需要核对。'}]:[];});
    return {version:1,method:'lexical-review-v1',scanCharBudget,contextCharBudget,totalChars:task.documents.reduce((n,d)=>n+d.text.length,0),scannedChars,submittedChars,scannedIds:scanned.map(d=>d.id),unscannedIds,selectedIds,omittedIds,candidates,possibleConflicts,coverage:omittedIds.length?'incomplete':'all_provided_documents',disposition:omittedIds.length?'needs_review':'ready_for_verification',controllerMs:performance.now()-started,controllerModelCalls:0,limitations:['字符按 JavaScript UTF-16 长度计，不是 token；上下文预算不含提示词及执行器开销','双字匹配与不同数字仅用于排序和提示，不能判定语义冲突或优先级','完整性仅相对于提供的资料集合；集合之外的遗漏仍未知']};
  }
  return {planReview};
});
