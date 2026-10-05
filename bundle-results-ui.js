(()=>{'use strict';
const el=id=>document.getElementById(id),add=(tag,value,parent)=>{const n=document.createElement(tag);n.textContent=value;parent.append(n);return n;},fmt=n=>n==null?'未知':Number(n).toLocaleString('zh-CN');
function table(root,headers,rows){const wrap=document.createElement('div');wrap.style.overflowX='auto';root.append(wrap);const t=document.createElement('table');t.className='study-table';wrap.append(t);for(const [i,row] of [headers,...rows].entries()){const tr=document.createElement('tr');t.append(tr);for(const cell of row)add(i?'td':'th',String(cell),tr);}}
el('load-bundle-results').addEventListener('click',async()=>{const root=el('bundle-results');root.replaceChildren();el('bundle-export').hidden=true;try{
 const response=await fetch('/api/bundle-study'),d=await response.json();if(!response.ok)throw Error(d.error);if(d.type!=='bundle-study')throw Error('结果类型不符');
 const labels=Object.fromEntries(d.summary.map(s=>[s.id,s.label]));
 el('bundle-result-status').textContent=`${d.demo?'替身测试，非实测':'真实调用'} · ${d.rows.length}/${d.protocol.schedule.length} 格 · ${({running:'运行中',waiting_batch:'批间检查点',stopped:'提前停止',complete:'日程完成'})[d.status]||d.status} · ${d.cost.modelCalls} 次调用 / 已知 ${fmt(d.cost.knownTokens)} tokens / 未知 ${d.cost.unknownCalls} 次`;
 if(d.stopReason)add('p',d.stopReason,root).className='status';
 add('p',`尚有 ${d.unrunEntryIds.length} 个未运行配置格；未运行不计零成本或失败。短长资料属于同题成对版本，重复响应不算独立任务。`,root);
 table(root,['配置','已尝试 / 计划','候选通过 / 评分','放行','自动完成','待核验','跳过','已知 tokens / 未知调用'],d.summary.map(s=>[s.label,`${s.attempted}/${s.planned}`,s.assessed?`${s.candidatePasses}/${s.assessed}`:'未评分',s.released,s.verifiedCompletions,s.needsReview,s.skippedBeforeCall,`${fmt(s.cost.knownTokens)} / ${s.cost.unknownCalls}`]));
 const groups=d.protocol.design.strategies.flatMap(s=>['short','padded'].map(length=>{const rows=d.rows.filter(r=>r.strategy===s.id&&r.length===length),assessed=rows.filter(r=>r.candidatePassed!==null);return [s.label,length==='short'?'短文':'人工加长',rows.length,assessed.length?`${assessed.filter(r=>r.candidatePassed).length}/${assessed.length}`:'未评分',rows.filter(r=>r.verifiedCompletion).length,rows.reduce((n,r)=>n+r.cost.knownTokens,0).toLocaleString('zh-CN'),rows.reduce((n,r)=>n+r.cost.unknownCalls,0)];}));
 table(root,['配置','长度','已尝试','候选通过 / 评分','自动完成','已知 tokens','未知调用'],groups);
 const fields=document.createElement('details');root.append(fields);add('summary',`逐次日程与预算（${d.protocol.schedule.length} 格）`,fields);
 table(fields,['重复','任务','配置','结果','正文 / 上限','回退','tokens'],d.protocol.schedule.map(e=>{const r=d.rows.find(r=>r.entryId===e.id);return [e.repeat,r?.title||e.taskId,labels[e.strategy],!r?'未运行':r.candidatePassed===null?'未评分':r.candidatePassed?'候选通过':'候选未通过',r?`${r.plan.submittedChars} / ${r.plan.contextCharBudget}`:'未运行',r?.plan.fallback?`扩大 ${r.plan.fallback.budgetIncrease} 字符`:'无',r?fmt(r.cost.tokens):'未运行'];}));
 const evidence=document.createElement('details');root.append(evidence);add('summary','已运行记录的验收证据',evidence);
 for(const r of d.rows){const detail=document.createElement('details');evidence.append(detail);add('summary',`第${r.repeat}次 · ${r.title} · ${labels[r.strategy]}`,detail);add('pre',JSON.stringify({answer:r.answer,checks:r.checks,coverage:r.plan.coverage,bundles:r.plan.bundles,unsubmittedCues:r.plan.unsubmittedCues,fallback:r.plan.fallback,calls:r.calls},null,2),detail);}
 add('p',d.protocol.provenance+' '+d.protocol.design.scopeLimit+' 全文回退使用扩大后的正文预算，不计作半量完成；部分候选保持待核验。',root).className='muted';
 add('button','生成 v3 实验 JSON',root).addEventListener('click',()=>{el('bundle-json').value=JSON.stringify(d,null,2);el('bundle-export').hidden=false;el('bundle-export').scrollIntoView({behavior:'smooth'});});
 }catch(e){el('bundle-result-status').textContent=e.message||'读取失败';}});
})();
