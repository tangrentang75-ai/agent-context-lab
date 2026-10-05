(()=>{'use strict';
const el=id=>document.getElementById(id),add=(tag,value,parent)=>{const n=document.createElement(tag);n.textContent=value;parent.append(n);return n;};
const fmt=n=>n==null?'未知':Number(n).toLocaleString('zh-CN',{maximumFractionDigits:1});
function table(parent,headers,rows){const wrap=document.createElement('div');wrap.style.overflowX='auto';parent.append(wrap);const t=document.createElement('table');t.style.cssText='width:100%;border-collapse:collapse;font-size:14px';wrap.append(t);for(const [index,row] of [headers,...rows].entries()){const tr=document.createElement('tr');t.append(tr);for(const cell of row){const c=add(index?'td':'th',String(cell),tr);c.style.cssText='padding:12px;text-align:left;border-bottom:1px solid #dce4ed;min-width:95px';}}}
el('load-review-study').addEventListener('click',async()=>{
  try{const response=await fetch('/api/review-study');const d=await response.json();if(!response.ok)throw Error(d.error);if(d.type!=='review-study')throw Error('结果类型不匹配');
    const root=el('review-study-results');root.replaceChildren();el('review-study-export').hidden=true;
    el('review-study-status').textContent=`${d.demo?'模拟':'真实调用'} · ${d.rows.length}/${d.protocol.schedule.length} 格 · ${d.status==='complete'?'本轮完成':d.status==='running'?'运行中，可再次读取':'提前停止'} · ${d.cost.modelCalls} 次调用 / 已知 ${fmt(d.cost.knownTokens)} tokens`;
    add('p','候选通过仅表示结束后金标准评分通过；“自动完成”还要求策略放行且无额外工具偏离。待核验不是完成。',root).className='status';
    table(root,['策略','候选通过 / 已评分','策略放行 / 已尝试','自动完成 / 已尝试','错误放行','待核验','总 tokens'],d.summary.map(s=>[s.label,`${s.candidatePasses}/${s.assessed}`,`${s.released}/${s.attempted}`,`${s.verifiedCompletions}/${s.attempted}`,s.unsafeReleases,s.needsReview,fmt(s.cost.tokens)]));
    const labels=Object.fromEntries(d.summary.map(s=>[s.id,s.label]));
    table(root,['任务','策略','候选响应','策略状态','自动完成','提交资料','总 tokens'],d.protocol.schedule.map(entry=>{const r=d.rows.find(r=>r.taskId===entry.taskId&&r.strategy===entry.strategy);return [r?.title||entry.taskId,labels[entry.strategy],!r?'尚未运行':r.candidatePassed===null?'未评分':r.candidatePassed?'通过':'未通过',!r?'尚未运行':({needs_review:'仍需核验',ready_for_verification:'进入验收',execution_failed:'执行失败',budget_stopped:'阈值停止'}[r.status]||r.status),r?.verifiedCompletion?'是':'否',r?.selectedIds.join('、')||'—',r?fmt(r.cost.tokens):'尚未运行'];}));
    add('p',`本次未运行的预留任务：${d.protocol.unrunTaskIds.join('、')}。${d.protocol.provenance}`,root).className='muted';
    add('p',d.protocol.budgetRule+' '+d.protocol.promptDifference,root).className='muted';
    for(const r of d.rows){const details=document.createElement('details');root.append(details);add('summary',`${r.title} · ${labels[r.strategy]} · 答案与验收证据`,details);add('pre',JSON.stringify({answer:r.answer,checks:r.checks,coverage:r.plan?.coverage,omittedIds:r.plan?.omittedIds,possibleConflicts:r.plan?.possibleConflicts,scannedChars:r.plan?.scannedChars,submittedChars:r.plan?.submittedChars,controllerMs:r.plan?.controllerMs},null,2),details);}
    const button=add('button','生成实测 JSON 报告',root);button.addEventListener('click',()=>{el('review-study-json').value=JSON.stringify(d,null,2);el('review-study-export').hidden=false;el('review-study-export').scrollIntoView({behavior:'smooth'});});
  }catch(e){el('review-study-status').textContent=e.message||'读取失败';}
});
})();
