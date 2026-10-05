(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./review-passages.js'):root.ReviewPassages);if(typeof module==='object'&&module.exports)module.exports=api;else root.ReviewBundles=api;})(typeof globalThis==='object'?globalThis:this,function(base){
  'use strict';
  const cues=[
    ['boundary',/严格|超过|至少|至多|恰好|恰满|等于|不超过|不低于|大于|小于|strict(?:ly)?|greater than|less than|at least|at most|equal/i],
    ['negation',/不允许|禁止|拒绝|不得|不能|并非|不是|无须|无需|没有|not\b|never\b|prohibit|reject|except/i],
    ['scope',/仅|只对|只适用|范围|适用|所有|每个|个人|共享|正式|临时|scope|appl(?:y|ies|icable)|only\b|all\b/i],
    ['precedence',/废止|替代|取代|失效|生效|优先|同等效力|历史|旧版|旧手册|新版|现行|replac|supersed|priorit|obsolete|effective/i],
    ['quantity',/(?:\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百千万]+)\s*(?:秒|分钟|小时|天|次|个|条|毫秒|seconds?\b|minutes?\b|hours?\b|days?\b|ms\b|Hz\b)/i]
  ];
  function planBundles(task,options={}){
    const start=performance.now(),contextCharBudget=options.contextCharBudget??10000;
    if(!Number.isSafeInteger(contextCharBudget)||contextCharBudget<0||contextCharBudget>200000)throw Error('预算须为 0–200,000 的整数');
    // Reuse the frozen tokenizer and exact ranges; a full local scan is not a model call.
    const scanned=base.planPassages(task,{scanCharBudget:options.scanCharBudget??20000,contextCharBudget:200000});
    const units=scanned.selectedPassages.map(p=>({...p,cueTags:cues.filter(([,pattern])=>pattern.test(p.text)).map(([tag])=>tag)}));
    const groups=task.documents.filter(d=>scanned.scannedIds.includes(d.id)).map((d,index)=>{
      const source=units.filter(u=>u.sourceId===d.id),matches=source.filter(u=>u.score>0),core=matches.length?source.filter(u=>u.score>0||u.cueTags.length):source;
      const chosen=new Set(core);
      // Keep immediate context of the strongest lexical sentence together with all rule cues.
      if(matches.length){const strongest=[...matches].sort((a,b)=>b.score-a.score||a.start-b.start)[0],i=source.indexOf(strongest);if(source[i-1])chosen.add(source[i-1]);if(source[i+1])chosen.add(source[i+1]);}
      const passages=source.filter(u=>chosen.has(u)),chars=passages.reduce((n,p)=>n+p.text.length,0);
      return {sourceId:d.id,sourceIndex:index,score:Math.max(0,...source.map(u=>u.score)),chars,passages,reason:matches.length?'匹配句、规则线索及最强句的相邻上下文成组保留':'无词语匹配也不能断言无关，整份作为保守证据组'};
    }).sort((a,b)=>b.score-a.score||a.sourceIndex-b.sourceIndex);
    const selected=new Set();let submittedChars=0;
    for(const group of groups){group.selected=group.chars+submittedChars<=contextCharBudget;if(group.selected){submittedChars+=group.chars;for(const p of group.passages)selected.add(p);}}
    const selectedPassages=units.filter(p=>selected.has(p));
    // Group passages are objects from source; selected holds their identity.
    const coverage=task.documents.map(d=>{const spans=selectedPassages.filter(p=>p.sourceId===d.id),omittedRanges=[];let cursor=0;for(const p of spans){if(cursor<p.start)omittedRanges.push({start:cursor,end:p.start});cursor=p.end;}if(cursor<d.text.length)omittedRanges.push({start:cursor,end:d.text.length});const chars=spans.reduce((n,p)=>n+p.text.length,0);return {id:d.id,totalChars:d.text.length,submittedChars:chars,scanned:scanned.scannedIds.includes(d.id),complete:chars===d.text.length,omittedRanges};});
    const incomplete=coverage.some(d=>!d.complete);
    const candidates=scanned.candidates.map(c=>({...c,submitted:selectedPassages.some(p=>p.sourceId===c.sourceId&&p.start===c.start&&p.end===c.end)}));
    return {...scanned,version:3,method:'constraint-bundles-v3',contextCharBudget,submittedChars,selectedPassages,documentCoverage:coverage,selectedIds:coverage.filter(d=>d.submittedChars).map(d=>d.id),omittedIds:coverage.filter(d=>!d.submittedChars).map(d=>d.id),partialIds:coverage.filter(d=>d.submittedChars&&!d.complete).map(d=>d.id),candidates,coverage:incomplete?'incomplete':'all_provided_documents',disposition:incomplete?'needs_review':'ready_for_verification',callRecommendation:incomplete?'skip_incomplete':'eligible_for_verification',bundles:groups.map(({passages,...g})=>({...g,ranges:passages.map(p=>({start:p.start,end:p.end,cueTags:p.cueTags}))})),bundleChars:groups.reduce((n,g)=>n+g.chars,0),unsubmittedCues:units.filter(p=>p.cueTags.length&&!selected.has(p)).map(({sourceId,start,end,text,cueTags})=>({sourceId,start,end,text,cueTags})),controllerMs:performance.now()-start,limitations:['规则词和数量单位是启发式线索，不是语义证明；来源编号与金标准不参与排序','证据组整体提交或整体省略；预算不足时不拆掉否定或优先级句凑长度','即使全部证据组已提交，任意正文省略仍需核验；不声称资料无冲突','扫描与提交按 UTF-16 字符计，模型提示与执行器开销另计']};
  }
  function documentsForPlan(task,plan){return task.documents.filter(d=>plan.selectedIds.includes(d.id)).map(d=>{let text='',cursor=0;for(const p of plan.selectedPassages.filter(p=>p.sourceId===d.id)){if(cursor<p.start)text+=(cursor?'\n':'')+'[省略未提供正文]\n';text+=p.text;cursor=p.end;}if(cursor<d.text.length)text+='\n[省略未提供正文]';return {id:d.id,text};});}
  return {planBundles,documentsForPlan};
});
