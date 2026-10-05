(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ReviewPassages=api;})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  function terms(text){const parts=text.toLowerCase().match(/[a-z0-9]+|[\u3400-\u9fff]+/g)||[];return [...new Set(parts.flatMap(p=>/^[\u3400-\u9fff]+$/.test(p)?Array.from({length:Math.max(0,p.length-1)},(_,i)=>p.slice(i,i+2)):[p]))];}
  function validate(task){
    if(!task||!Array.isArray(task.goals)||!task.goals.length||task.goals.length>20||!Array.isArray(task.documents)||!task.documents.length||task.documents.length>100)throw new Error('需要 1–20 个目标及 1–100 份资料');
    for(const [items,key] of [[task.goals,'label'],[task.documents,'text']]){const ids=new Set();for(const item of items){if(!item||typeof item.id!=='string'||!item.id.trim()||item.id.length>100||ids.has(item.id)||typeof item[key]!=='string'||!item[key].trim())throw new Error('目标或资料的编号必须唯一，正文和目标名称不能为空');ids.add(item.id);}}
    if(task.documents.reduce((n,d)=>n+d.text.length,0)>200000||task.goals.some(g=>g.label.length>500))throw new Error('资料总长度最多 200,000 字符，目标名称最多 500 字符');
  }
  // Ranges partition the exact UTF-16 source. Never truncate a sentence to make it fit.
  function ranges(text){
    const out=[];let start=0;
    for(let i=0;i<text.length;i++){
      const ch=text[i],decimal=ch==='.'&&/[0-9]/.test(text[i-1]||'')&&/[0-9]/.test(text[i+1]||'');
      if(/[。！？!?\n]/.test(ch)||(ch==='.'&&!decimal)){
        let end=i+1;while(end<text.length&&/\s/.test(text[end]))end++;
        if(text.slice(start,end).trim()){out.push({start,end});start=end;}
        i=end-1;
      }
    }
    if(start<text.length){if(!text.slice(start).trim()&&out.length)out[out.length-1].end=text.length;else out.push({start,end:text.length});}
    return out;
  }
  function planPassages(task,{scanCharBudget=20000,contextCharBudget=10000}={}){
    const started=performance.now();validate(task);
    for(const value of [scanCharBudget,contextCharBudget])if(!Number.isSafeInteger(value)||value<0||value>200000)throw new Error('预算须为 0–200,000 的整数');
    const goals=task.goals.map(g=>({id:g.id,terms:terms(g.label)})),units=[],scannedIds=[],unscannedIds=[];let scannedChars=0,submittedChars=0;
    for(const [docIndex,doc] of task.documents.entries()){
      if(scannedChars+doc.text.length>scanCharBudget){unscannedIds.push(doc.id);continue;}
      scannedIds.push(doc.id);scannedChars+=doc.text.length;
      for(const [unitIndex,range] of ranges(doc.text).entries()){
        const text=doc.text.slice(range.start,range.end),lower=text.toLowerCase();
        const matches=goals.map(g=>({goalId:g.id,matchedTerms:g.terms.filter(t=>lower.includes(t))})).filter(m=>m.matchedTerms.length);
        units.push({...range,sourceId:doc.id,docIndex,unitIndex,text,chars:text.length,score:matches.reduce((n,m)=>n+m.matchedTerms.length,0),matches});
      }
    }
    const selected=new Set(),byDoc=new Map();
    const ranking=(a,b)=>b.score-a.score||a.docIndex-b.docIndex||a.unitIndex-b.unitIndex;
    const ranked=[...units].sort(ranking);
    for(const unit of ranked){if(!byDoc.has(unit.sourceId))byDoc.set(unit.sourceId,[]);byDoc.get(unit.sourceId).push(unit);}
    const take=unit=>{if(!selected.has(unit)&&submittedChars+unit.chars<=contextCharBudget){selected.add(unit);submittedChars+=unit.chars;return true;}return false;};
    // First give each scanned source a chance; zero lexical matches are not irrelevance.
    for(const sourceUnits of byDoc.values()){const unit=sourceUnits.find(u=>u.chars<=contextCharBudget-submittedChars);if(unit)take(unit);}
    // Preserve immediate context before spending the remainder on other matches.
    const lookup=new Map(units.map(u=>[u.docIndex+':'+u.unitIndex,u]));
    const seeds=[...selected].sort(ranking);
    for(const offset of [1,-1])for(const unit of seeds){const neighbor=lookup.get(unit.docIndex+':'+(unit.unitIndex+offset));if(neighbor)take(neighbor);}
    for(const unit of ranked)take(unit);
    const selectedPassages=units.filter(u=>selected.has(u)).map(({docIndex,unitIndex,chars,...u})=>u);
    const documentCoverage=task.documents.map(doc=>{
      const passages=selectedPassages.filter(p=>p.sourceId===doc.id),omittedRanges=[];let cursor=0;
      for(const p of passages){if(cursor<p.start)omittedRanges.push({start:cursor,end:p.start});cursor=p.end;}
      if(cursor<doc.text.length)omittedRanges.push({start:cursor,end:doc.text.length});
      const submitted=passages.reduce((n,p)=>n+p.end-p.start,0);
      return {id:doc.id,totalChars:doc.text.length,submittedChars:submitted,scanned:scannedIds.includes(doc.id),complete:submitted===doc.text.length,omittedRanges};
    });
    const candidates=units.flatMap(u=>u.matches.map(m=>({goalId:m.goalId,sourceId:u.sourceId,start:u.start,end:u.end,quote:u.text,matchedTerms:m.matchedTerms,submitted:selected.has(u),numbers:[...new Set(u.text.match(/-?\d+(?:\.\d+)?/g)||[])]})));
    const possibleConflicts=goals.flatMap(g=>{const hits=candidates.filter(c=>c.goalId===g.id&&c.numbers.length),values=[...new Set(hits.flatMap(c=>c.numbers))];return values.length>1?[{goalId:g.id,values,sourceIds:[...new Set(hits.map(c=>c.sourceId))],reason:'不同数字仅是线索，日期、范围和替代关系需要核对。'}]:[];});
    const incomplete=documentCoverage.some(d=>!d.complete);
    return {version:2,method:'lexical-passages-v2',scanCharBudget,contextCharBudget,totalChars:task.documents.reduce((n,d)=>n+d.text.length,0),scannedChars,submittedChars,scannedIds,unscannedIds,selectedIds:documentCoverage.filter(d=>d.submittedChars).map(d=>d.id),omittedIds:documentCoverage.filter(d=>!d.submittedChars).map(d=>d.id),partialIds:documentCoverage.filter(d=>d.submittedChars&&!d.complete).map(d=>d.id),documentCoverage,selectedPassages,candidates,possibleConflicts,coverage:incomplete?'incomplete':'all_provided_documents',disposition:incomplete?'needs_review':'ready_for_verification',callRecommendation:incomplete?'skip_incomplete':'eligible_for_verification',controllerMs:performance.now()-started,controllerModelCalls:0,limitations:['位置与字符按 JavaScript UTF-16 计数；正文预算不含提示词、来源标记和执行器开销','句界、词语匹配及相邻片段是启发式规则，不理解同义、否定、冲突或优先级','任意未提交字符都保持待核验；不能把每份资料都有片段当作完整覆盖','完整性仅限提供的资料集合；本地耗时包含校验和规划，不包含输入加载与页面渲染']};
  }
  return {planPassages};
});
