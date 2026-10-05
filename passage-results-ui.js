(()=>{'use strict';
const el=id=>document.getElementById(id),add=(tag,value,parent)=>{const n=document.createElement(tag);n.textContent=value;parent.append(n);return n;},fmt=n=>n==null?'未知':Number(n).toLocaleString('zh-CN');
function table(parent,headers,rows){const wrap=document.createElement('div');wrap.style.overflowX='auto';parent.append(wrap);const t=document.createElement('table');t.className='study-table';wrap.append(t);for(const [i,row] of [headers,...rows].entries()){const tr=document.createElement('tr');t.append(tr);for(const cell of row)add(i?'td':'th',String(cell),tr);}}
function ratio(a,n){return n?`${a}/${n}`:'未评分';}
el('load-passage-plan').addEventListener('click',async()=>{try{
  const response=await fetch('/api/passage-plan'),p=await response.json();if(!response.ok)throw Error(p.error);const root=el('passage-plan');root.replaceChildren();
  add('p',`协议已准备 · ${p.plannedRows} 个配置格 · 每配置重复 ${p.repeats} 次 · 最多 ${p.maxCalls} 次模型调用`,root).className='status';
  add('p',`试点任务：${p.pilotTasks.join('、')}。另外 ${p.reservedTaskIds.length} 类预留。请求模型 ${p.modelRequest} / ${p.reasoningEffort}。`,root);
  add('p',`已知累计用量阈值 ${fmt(p.maxKnownTokens)} tokens；调用间检查不是硬计费上限，出现未知用量或连续两次失败停止后续运行。`,root);
  add('p',`方法冻结：${p.methodFrozenAt}；试点准备：${p.preparedAt}。${p.provenance} ${p.limitations}`,root).className='muted';
  add('p','四配置：一次全读、整篇 v1 半量、片段 v2 默认停止、片段 v2 显式候选诊断。网页只检查协议和读取记录，启动真实实验需在本机终端执行明确的运行命令。',root);
  el('passage-plan-status').textContent='检查完成，未调用模型。';
}catch(e){el('passage-plan-status').textContent=e.message||'读取失败';}});
el('load-passage-results').addEventListener('click',async()=>{const root=el('passage-results');root.replaceChildren();el('passage-export').hidden=true;try{
  const response=await fetch('/api/passage-study'),d=await response.json();if(!response.ok)throw Error(d.error);if(d.type!=='passage-study')throw Error('结果类型不匹配');
  el('passage-result-status').textContent=`${d.demo?'替身测试，非实测':'真实调用'} · ${d.rows.length}/${d.protocol.schedule.length} 格 · ${d.status==='complete'?'本轮完成':d.status==='running'?'运行中':'提前停止'} · ${d.cost.modelCalls} 次调用 / 已知 ${fmt(d.cost.knownTokens)} tokens / 未知用量 ${d.cost.unknownCalls} 次`;
  if(d.stopReason)add('p','停止原因：'+d.stopReason,root).className='status';
  add('p','调用前跳过没有模型候选，不能计作候选答对；未运行格子没有零成本或完成结论。待核验仍未自动完成，人工核验耗时未测量。',root);
  table(root,['配置','已尝试 / 计划','候选通过 / 已评分','策略放行 / 已尝试','自动完成 / 已尝试','错误放行','调用前跳过','待核验','总 tokens'],d.summary.map(s=>[s.label,`${s.attempted}/${s.planned}`,ratio(s.candidatePasses,s.assessed),s.attempted?`${s.released}/${s.attempted}`:'未运行',s.attempted?`${s.verifiedCompletions}/${s.attempted}`:'未运行',s.unsafeReleases,s.skippedBeforeCall,s.needsReview,fmt(s.cost.tokens)]));
  const labels=Object.fromEntries(d.summary.map(s=>[s.id,s.label]));
  table(root,['重复','任务','配置','候选响应','状态','tokens'],d.protocol.schedule.map(e=>{const r=d.rows.find(r=>r.entryId===e.id);return [e.repeat,r?.title||e.taskId,labels[e.strategy],!r?'未运行':r.candidatePassed===null?'未评分':r.candidatePassed?'通过':'未通过',!r?'未运行':r.skippedBeforeCall?'调用前停止':({needs_review:'待核验',ready_for_verification:'进入验收',execution_failed:'执行失败'}[r.status]||r.status),r?fmt(r.cost.tokens):'未运行'];}));
  table(root,['配置','重复','已尝试','已评分','自动完成','tokens'],d.summary.flatMap(s=>s.byRepeat.map(r=>[s.label,r.repeat,r.attempted,r.assessed,r.verifiedCompletions,fmt(r.cost.tokens)])));
  for(const r of d.rows){const details=document.createElement('details');root.append(details);add('summary',`第${r.repeat}次 · ${r.title} · ${labels[r.strategy]} · 证据`,details);add('pre',JSON.stringify({answer:r.answer,checks:r.checks,skippedBeforeCall:r.skippedBeforeCall,reason:r.reason,coverage:r.plan.coverage,partialIds:r.plan.partialIds,omittedIds:r.plan.omittedIds,calls:r.calls},null,2),details);}
  add('p',d.protocol.provenance+' '+d.protocol.design.comparisonLimits+' '+d.protocol.design.scopeLimit,root).className='muted';
  add('button','生成 v2 实验 JSON',root).addEventListener('click',()=>{el('passage-json').value=JSON.stringify(d,null,2);el('passage-export').hidden=false;el('passage-export').scrollIntoView({behavior:'smooth'});});
}catch(e){el('passage-result-status').textContent=e.message||'读取失败';}});
})();
