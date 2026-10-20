'use strict';
const E = AgentEvaluation;
let dataset = E.validateDataset(structuredClone(AGENT_SAMPLE));
let selectedTaskId = dataset.tasks[0].id;
let selectedGroup = dataset.tasks[0].runs[0].comparisonGroup;
let budget = 10000;
let activeRunId = null;
let localDataset = false;
// New requests and local edits invalidate older asynchronous work.
let datasetEpoch = 0;
let runEpoch = 0;
function preserveSession() { datasetEpoch++; }
function closeStaleDetail() { if ($('detail-dialog').open) $('detail-dialog').close(); activeRunId=null; }
const $ = id => document.getElementById(id);
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = value => value === null ? '未知' : value.toLocaleString('zh-CN');
const statusLabel = { pass:'已通过', fail:'未通过', unknown:'待核验' };
const typeLabel = { explore:'探索', act:'执行', verify:'验证' };
function toast(message, error = false) { $('toast').textContent = message; $('toast').className = `toast${error ? ' error' : ''}`; $('toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { $('toast').hidden = true; }, 5500); }
function download(name, payload, compact = false) {
  const blob = new Blob([JSON.stringify(payload, null, compact ? undefined : 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function showReport(payload) {
  const isCost = payload.type === 'cost-estimate';
  const content=JSON.stringify(payload,null,2);
  const url=URL.createObjectURL(new Blob([content],{type:'application/json'}));
  $('detail-content').innerHTML=`<header class="dialog-header"><div><p class="eyebrow">EXPORT REPORT</p><h2>${escapeHTML(isCost ? '成本估算已生成' : '评估报告已生成')}</h2><p>${escapeHTML(isCost ? '包含假设值、估算结果与引用样本；可复制下方文本保存。' : '包含当前目标、证据和比较结果；也可以直接复制下方文本保存。')}</p></div><button id="close-report" class="icon-button" aria-label="关闭报告">×</button></header><p class="muted">${isCost?'成本模型估算，不是新的实验结果。':dataset.demo?'人工构造演示数据，不代表真实实验结果。':'导入记录；来源与验收结论需独立复核。'}</p><label for="report-json">JSON 报告内容</label><textarea id="report-json" readonly rows="15" style="display:block;width:100%;margin:10px 0 20px;font-family:monospace">${escapeHTML(content)}</textarea><a id="report-download" class="button primary" download="${isCost ? 'cost-assumptions.json' : 'agent-context-report.json'}">下载 JSON 文件</a>`;
  $('report-download').href=url;
  $('close-report').addEventListener('click',()=>$('detail-dialog').close());
  $('detail-dialog').addEventListener('close',()=>URL.revokeObjectURL(url),{once:true});
  $('detail-dialog').showModal();
}
function currentTask() { return dataset.tasks.find(t => t.id === selectedTaskId); }
function notice() {
  $('notice').innerHTML = dataset.demo
    ? '<span class="notice-icon">i</span><div><strong>当前为人工构造的演示数据</strong><span>用于体验评估流程；真实记录可在<a href="#experiments">实验中心</a>查看。</span></div><span class="tag">DEMO</span>'
    : localDataset ? '<span class="notice-icon">✓</span><div><strong>当前显示本机 Codex 真实执行记录</strong><span>逐项独立验收；用量来自执行器。原始结果保存在本机，人工复核修改需导出留存。少量任务不代表普遍提升。</span></div><span class="tag">LIVE</span>'
    : '<span class="notice-icon">i</span><div><strong>当前为你导入的记录</strong><span>数据仅在当前页面内存中处理；来源与验收证据需自行复核。刷新会恢复示例，请先点“保存当前数据”。</span></div><span class="tag">IMPORTED</span>';
  if(dataset.source==='local-quality-study')$('notice').insertAdjacentHTML('beforeend','<p><strong>本组按安全响应约定验收：</strong>冲突或缺失资料时，正确留空可以通过；通过不表示配置已经恢复。与旧实验的配置完成率分开理解。</p>');
}
function renderOverview() {
  const all = dataset.tasks.flatMap(t => t.runs.map(r => ({run:r, result:E.evaluate(t,r)})));
  const complete = all.filter(x => x.result.accepted && x.result.allReviewed).length;
  const known = all.filter(x => x.run.tokens !== null);
  const stats = [
    ['已定义任务', dataset.tasks.length, '软件、资料与数据工作流'],
    ['执行记录', all.length, dataset.demo ? '人工构造示例' : localDataset?'本机 Codex 真实调用':'来自导入文件 · 待复核'],
    ['验收合格记录', `${complete} / ${all.length}`, '必需项通过且所有目标已核验'],
    ['已记录 token', number(known.reduce((n,x) => n+x.run.tokens,0)), `成本数据完整度 ${known.length} / ${all.length}`]
  ];
  $('stats').innerHTML = stats.map((s,i) => `<div class="stat"><div>${s[0]}<span>${['◫','⇄','✓','◈'][i]}</span></div><strong>${s[1]}</strong><small>${s[2]}</small></div>`).join('');
  const pending = all.filter(x=>!x.result.allReviewed).length;
  const rejected = all.length-complete-pending;
  const parts=[{label:'验收合格',count:complete,className:'accepted'},{label:'待核验',count:pending,className:'pending'},{label:'未满足验收',count:rejected,className:'rejected'}];
  $('outcome-summary').innerHTML='<div class="outcome-total"><strong>'+complete+'<small> / '+all.length+'</small></strong><span>记录满足当前验收要求</span></div><div class="outcome-track" role="img" aria-label="'+parts.map(p=>p.label+' '+p.count+' 条').join('，')+'">'+parts.filter(p=>p.count).map(p=>'<span class="'+p.className+'" style="width:'+p.count/Math.max(1,all.length)*100+'%"></span>').join('')+'</div><div class="outcome-legend">'+parts.map(p=>'<span><i class="'+p.className+'"></i>'+p.label+'<strong>'+p.count+'</strong></span>').join('')+'</div>';
  const search = $('search').value.trim().toLowerCase(), filter = $('scenario-filter').value;
  const tasks = dataset.tasks.filter(t => (filter === 'all' || t.scenario === filter) && `${t.title} ${t.description}`.toLowerCase().includes(search));
  $('task-count').textContent = tasks.length;
  $('task-grid').innerHTML = tasks.length ? tasks.map(t => {
    const required = t.goals.filter(g => g.required).length;
    const pass = t.runs.filter(r => { const e=E.evaluate(t,r); return e.accepted && e.allReviewed; }).length;
    return `<article class="task-card"><div class="card-top"><span class="scenario ${t.scenario}">${escapeHTML(E.scenarios[t.scenario])}</span><span class="muted">${t.runs.length} 条记录</span></div><h3>${escapeHTML(t.title)}</h3><p>${escapeHTML(t.description)}</p><div class="goal-preview">${t.goals.slice(0,2).map(g=>`<span><i>${g.required?'◆':'◇'}</i>${escapeHTML(g.label)}</span>`).join('')}</div><div class="task-progress"><span>验收合格 <strong>${pass} / ${t.runs.length}</strong></span><div aria-hidden="true"><i style="width:${pass/Math.max(1,t.runs.length)*100}%"></i></div></div><div class="card-meta"><span>${required} 项必需目标</span><span>${dataset.demo?'演示记录':localDataset?'本机实测':'导入记录'}</span></div><button class="card-action" data-task="${escapeHTML(t.id)}">进入目标与策略比较 <span>↗</span></button></article>`;
  }).join('') : '<div class="empty">没有匹配的任务。试试其他关键词或场景。</div>';
  $('task-grid').querySelectorAll('[data-task]').forEach(button => button.addEventListener('click', () => { selectTask(button.dataset.task); location.hash = 'compare'; route(); }));
}
function selectTask(id) {
  preserveSession(); closeStaleDetail();
  selectedTaskId = id; selectedGroup = currentTask().runs[0].comparisonGroup;
  budget = Math.max(10000, ...currentTask().runs.map(r => r.tokens ?? 0));
  $('compare-task').value = selectedTaskId; renderCompare();
}
function renderCompare() {
  const task = currentTask();
  const groups = [...new Set(task.runs.map(r => r.comparisonGroup))];
  const {rows,bestIds} = E.compare(task,budget,selectedGroup);
  const max = Math.max(1,...rows.map(x=>x.run.tokens ?? 0));
  $('compare-content').innerHTML = `<div class="comparison-intro"><div><span class="scenario ${task.scenario}">${E.scenarios[task.scenario]}</span><h3>${escapeHTML(task.title)}</h3><p>${escapeHTML(task.description)}</p></div><button id="export-report" class="button">↓ 导出评估报告</button></div>
    <div class="settings-grid"><section class="goal-settings"><div class="subheading"><h3>目标与验收约定</h3><small>更改条件只重评已有记录，不重新运行 AI</small></div>${task.goals.map((g,i)=>`<div class="goal-row"><span class="goal-index">${String(i+1).padStart(2,'0')}</span><span class="goal-label">${escapeHTML(g.label)}</span><label class="required-control"><input type="checkbox" data-required="${i}" ${g.required?'checked':''}>必需</label><label class="weight-control">权重 <select aria-label="${escapeHTML(g.label)}的权重" data-weight="${i}">${[1,2,3,4,5].map(n=>`<option value="${n}" ${g.weight===n?'selected':''}>${n}</option>`).join('')}</select></label></div>`).join('')}<p class="fine-print">目标得分 = 已通过目标的权重 / 全部目标权重。得分不能覆盖未通过的必需项；未知结果不算通过。未设置必需项时要求全部目标通过。</p></section><section class="budget-settings"><span class="eyebrow">资源约束</span><label for="budget-input">单次执行 token 上限</label><div class="budget-field"><input id="budget-input" type="number" min="0" max="1000000000" step="100" value="${budget}"><span>tokens</span></div><label for="group-select">可比条件组</label><select id="group-select"></select><p>仅比较同一任务、同一条件组中的记录。分组由导入者声明，平台无法独立验证。token 不等同于硬件算力。</p></section></div>
    <div class="recommendation ${bestIds.length?'':'neutral'}"><span>${bestIds.length?'✓':'i'}</span><div><strong>${bestIds.length?'找到符合当前条件的执行记录':'当前没有可推荐的记录'}</strong><p>${bestIds.length?'下方标记的是已核验、满足必需项与预算，并在当前组内 token 最少的记录。单次表现不代表策略普遍更好。':'可能存在验收失败、缺失证据、未知成本或预算不足。平台不会把“更省”自动视为“更好”。'}</p></div></div>
    <div class="run-grid">${rows.map(({run,evaluation:v})=>`<article class="run-card ${bestIds.includes(run.id)?'best':''}"><div class="card-top"><span class="status ${v.eligible?'pass':'unknown'}">${escapeHTML(v.status)}</span>${bestIds.includes(run.id)?'<span class="best-label">'+(rows.length>1?'合格记录中最省':'单次记录 · 已合格')+'</span>':''}</div><h3>${escapeHTML(run.strategy)}</h3><p class="run-model">${escapeHTML(run.model)}</p><div class="run-score"><strong>${v.score}<small>%</small></strong><span>加权目标得分<br><small>已核验 ${v.known}/${v.total} 项</small></span></div><div class="token-track"><span style="width:${run.tokens===null?0:run.tokens/max*100}%"></span></div><div class="resource-row"><span><strong>${number(run.tokens)}</strong> tokens</span><span>${number(run.durationSec)} 秒</span></div><div class="checks-list">${task.goals.map(g=>`<div><span class="check-mark ${run.checks[g.id].status}">${{pass:'✓',fail:'×',unknown:'?'}[run.checks[g.id].status]}</span><span>${escapeHTML(g.label)}</span>${g.required?'<small>必需</small>':''}</div>`).join('')}</div><button class="button full" data-run="${escapeHTML(run.id)}">查看过程与验收证据 →</button></article>`).join('')}</div>`;
  // Option text collapses whitespace when used as an implicit value.
  // Assign DOM values directly so imported group identities stay exact.
  const groupSelect = $('group-select');
  groups.forEach(group => {
    const option = document.createElement('option');
    option.value = group; option.textContent = group;
    groupSelect.append(option);
  });
  groupSelect.value = selectedGroup;
  const applyBudget = document.createElement('button');
  applyBudget.className='button full'; applyBudget.textContent='应用预算'; applyBudget.style.marginTop='10px';
  $('budget-input').parentElement.after(applyBudget);
  const commitBudget = () => {const field=$('budget-input'), n=Number(field.value); if(field.value==='' || !Number.isFinite(n) || n<0 || n>1e9) {toast('请输入 0—1,000,000,000 的预算',true);field.value=budget;return;}preserveSession();budget=n;renderCompare();};
  applyBudget.addEventListener('click',commitBudget);
  $('budget-input').addEventListener('input',preserveSession);
  $('budget-input').addEventListener('keydown',event=>{if(event.key==='Enter')commitBudget();});
  $('group-select').addEventListener('change',event=>{preserveSession();selectedGroup=event.target.value;renderCompare();});
  $('compare-content').querySelectorAll('[data-weight]').forEach(el=>el.addEventListener('change',()=>{preserveSession();task.goals[Number(el.dataset.weight)].weight=Number(el.value);renderOverview();renderCompare();}));
  $('compare-content').querySelectorAll('[data-required]').forEach(el=>el.addEventListener('change',()=>{preserveSession();task.goals[Number(el.dataset.required)].required=el.checked;renderOverview();renderCompare();}));
  $('compare-content').querySelectorAll('[data-run]').forEach(el=>el.addEventListener('click',()=>showDetail(el.dataset.run)));
  $('export-report').addEventListener('click',()=>{showReport({reportVersion:1,generatedAt:new Date().toISOString(),demo:dataset.demo,scope:'离线记录评估；非在线智能体控制；不代表因果关系或真实提升',budgetTokens:budget,comparisonGroup:selectedGroup,task:structuredClone(task),results:rows.map(x=>({runId:x.run.id,...x.evaluation})),lowestTokenEligibleRunIds:bestIds});});
}
function showDetail(id) {
  preserveSession();
  const task = currentTask(), run = task.runs.find(r=>r.id===id); activeRunId=id;
  $('detail-content').innerHTML = `<header class="dialog-header"><div><p class="eyebrow">EXECUTION REVIEW</p><h2>${escapeHTML(run.strategy)}</h2><p>${escapeHTML(task.title)} · ${dataset.demo?'人工构造示例':localDataset?'本机真实执行':'导入记录'}</p></div><button id="close-dialog" class="icon-button" aria-label="关闭详情">×</button></header><div class="detail-grid"><section><h3>执行时间线</h3><p class="muted">过程记录用于复核，不代表模型内部思维。</p><ol class="timeline">${run.events.length?run.events.map(e=>`<li><span class="timeline-dot ${e.type}"></span><div class="event-top"><strong>${escapeHTML(e.label)}</strong><small>${number(e.atSec)} 秒 · ${typeLabel[e.type]}</small></div><p>${escapeHTML(e.detail)}</p></li>`).join(''):'<li>没有提供过程记录。</li>'}</ol></section><section class="evidence-section"><h3>验收证据</h3><p class="muted">可以人工复核并修正；变更在当前页面内存中保留。</p><form id="review-form">${task.goals.map((g,i)=>`<div class="evidence-item"><label for="evidence-${i}">${escapeHTML(g.label)} ${g.required?'<small>必需</small>':''}</label><select aria-label="${escapeHTML(g.label)}的验收状态" name="status-${i}">${['pass','fail','unknown'].map(s=>`<option value="${s}" ${run.checks[g.id].status===s?'selected':''}>${statusLabel[s]}</option>`).join('')}</select><textarea id="evidence-${i}" name="evidence-${i}" maxlength="6000" rows="3" placeholder="填写可追溯的验收依据">${escapeHTML(run.checks[g.id].evidence)}</textarea></div>`).join('')}<button class="button primary full" type="submit">保存本次复核</button></form></section></div>`;
  $('close-dialog').addEventListener('click',()=>$('detail-dialog').close());
  $('review-form').addEventListener('input',preserveSession);
  $('review-form').addEventListener('change',preserveSession);
  $('review-form').addEventListener('submit',event=>{
    event.preventDefault();
    if(currentTask()!==task || !task.runs.includes(run)){toast('记录已切换，请重新打开当前记录复核',true);return;}
    preserveSession(); const form = new FormData(event.target), updates=Object.create(null);
    for(let i=0;i<task.goals.length;i++) {const status=form.get(`status-${i}`), evidence=form.get(`evidence-${i}`).trim();if(status!=='unknown'&&!evidence){toast('判定通过或未通过时，请补充验收证据',true);return;}updates[task.goals[i].id]={status,evidence};}
    run.checks=updates;renderOverview();renderCompare();$('detail-dialog').close();toast('复核已更新到当前会话；请点“保存当前数据”下载留存，下次可重新导入');
  });
  $('detail-dialog').showModal();
}
function renderAll() {
  notice();
  renderStudy();
  $('compare-task').innerHTML=dataset.tasks.map(t=>`<option value="${escapeHTML(t.id)}">${escapeHTML(t.title)}</option>`).join('');
  $('compare-task').value=selectedTaskId;renderOverview();renderCompare();route();
}
function route() {
  const requested=location.hash.slice(1), view=['overview','compare','experiments','research'].includes(requested)?requested:'overview';
  for(const name of ['overview','compare','experiments','research']) $(`view-${name}`).hidden=name!==view;
  document.querySelectorAll('[data-view]').forEach(link=>{link.classList.toggle('active',link.dataset.view===view);if(link.dataset.view===view)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
  const copy={overview:['任务概览','工作空间概览','追踪任务、复核证据，让每一次投入对准目标。'],experiments:['实验中心','让每一次取舍，都有依据。','在这里探索证据、停止条件与资源投入；读取记录不会重新运行模型。'],compare:['策略比较','策略比较','在相同条件下复核证据，找到符合你要求的执行记录。'],research:['课题与路线','从一个观察，走向可验证的研究。','扩大应用视野，同时保留具体、可落地的研究问题。']}[view];
  document.body.dataset.view=view;
  $('breadcrumb').textContent=copy[0];$('page-title').textContent=copy[1];$('page-subtitle').textContent=copy[2];
}
$('search').addEventListener('input',()=>{preserveSession();renderOverview();});$('scenario-filter').addEventListener('change',()=>{preserveSession();renderOverview();});
$('compare-task').addEventListener('change',e=>selectTask(e.target.value));
$('import-button').addEventListener('click',()=>$('file-input').click());
$('file-input').addEventListener('change',async event=>{
  const file=event.target.files[0];if(!file)return;
  const epoch=++datasetEpoch;event.target.value='';
  try {if(file.size>2*1024*1024)throw new Error('文件不能超过 2 MB');const text=await file.text();if(epoch!==datasetEpoch)return;replaceDataset(JSON.parse(text),false);toast(`已导入 ${dataset.tasks.length} 个任务，原有会话记录已替换`);} catch(error){if(epoch===datasetEpoch)toast(`导入失败：${error.message}`,true);}
});
$('template-button').addEventListener('click',()=>{download('agent-context-example.json',AGENT_SAMPLE);toast('已下载示例 JSON，可按相同结构替换为自己的记录');});
$('save-dataset').addEventListener('click',()=>{
  try {
    const snapshot=E.validateDataset(structuredClone(dataset));
    if(new Blob([JSON.stringify(snapshot)]).size>2*1024*1024)throw new Error('当前数据超过 2 MB，无法生成可重新导入的整份文件；请在策略比较中按任务导出评估报告留存');
    preserveSession();download('agent-context-dataset.json',snapshot,true);
    toast('已发起整份数据下载，请确认文件已保存；下次用“导入记录”继续。预算与筛选不包含在文件中');
  } catch(error) { toast(`未能保存：${error.message}`,true); }
});
$('reset-button').addEventListener('click',()=>{if(!confirm('恢复内置示例会清除本页导入记录和复核修改。需要保留的数据请先导出报告。确认恢复？'))return;preserveSession();closeStaleDetail();dataset=structuredClone(AGENT_SAMPLE);localDataset=false;selectedTaskId=dataset.tasks[0].id;selectedGroup=dataset.tasks[0].runs[0].comparisonGroup;budget=10000;$('search').value='';$('scenario-filter').value='all';renderAll();toast('已恢复内置演示数据');});
document.querySelectorAll('.sidebar a[href^="#"], .inline-link[href^="#"]').forEach(link=>link.addEventListener('click',()=>window.scrollTo({top:0,left:0,behavior:'instant'})));
window.addEventListener('hashchange',route);renderAll();

function replaceDataset(data,isLocal) {
  const next=E.validateDataset(data);
  const previous={dataset,localDataset,selectedTaskId,selectedGroup,budget,
    search:$('search').value,filter:$('scenario-filter').value,budgetDraft:$('budget-input').value,
    hash:location.hash,connection:$('connection-status').textContent};
  try {
    dataset=next;localDataset=isLocal;selectedTaskId=next.tasks[0].id;selectedGroup=next.tasks[0].runs[0].comparisonGroup;
    budget=isLocal?Math.max(10000,...next.tasks[0].runs.map(r=>r.tokens??0)):10000;
    $('search').value='';$('scenario-filter').value='all';
    if(isLocal){
      const r=next.tasks[0].runs[0],u=r.usage;
      $('connection-status').textContent=`最近测试：${r.durationSec} 秒，${number(r.tokens)} tokens${u?`（输入 ${number(u.input_tokens)}，输出 ${number(u.output_tokens)}，输入中缓存 ${number(u.cached_input_tokens??null)}）`:''}。`;
      if(next.source==='local-codex-study')$('connection-status').textContent=`已载入 ${next.tasks[0].runs.length} 次对照运行；汇总与逐次证据见下方。`;
      location.hash='compare';
    }
    renderAll();
  } catch(error) {
    // Rendering also consumes optional study metadata, beyond the core dataset schema.
    ({dataset,localDataset,selectedTaskId,selectedGroup,budget}=previous);
    $('search').value=previous.search;$('scenario-filter').value=previous.filter;
    location.hash=previous.hash;$('connection-status').textContent=previous.connection;
    renderAll();$('budget-input').value=previous.budgetDraft;
    throw new Error('记录无法完整显示，已保留原有数据。请检查实验汇总或用量字段。',{cause:error});
  }
  closeStaleDetail();
}
function showLive(data) { replaceDataset(data,true); }
async function loadRecords(url,onLoaded=()=>{}) {
  const epoch=++datasetEpoch;
  try {
    const response=await fetch(url),data=await response.json();
    if(epoch!==datasetEpoch)return;
    if(!response.ok)throw new Error(data.error||'读取失败');
    showLive(data);onLoaded(data);
  } catch(error) { if(epoch===datasetEpoch)toast(error.message||'请启动本机服务后查看',true); }
}
function renderStudy() {
  const panel=$('study-results');panel.hidden=!(localDataset&&['local-codex-study','local-retrieval-study','local-evidence-study','local-validation-study','local-scaling-study','local-quality-study'].includes(dataset.source));if(panel.hidden)return;
  if(dataset.source==='local-quality-study'){renderEvidence(panel);renderQuality(panel);return;}
  if(dataset.source==='local-scaling-study'){renderEvidence(panel);renderScaling(panel);return;}
  if(['local-evidence-study','local-validation-study'].includes(dataset.source)){renderEvidence(panel);return;}
  if(dataset.source==='local-retrieval-study'){renderRetrieval(panel);return;}
  const study=dataset.study,fmt=v=>v===null||v===undefined?'未知':Number(v).toLocaleString('zh-CN',{maximumFractionDigits:1});
  panel.innerHTML=`<p class="eyebrow">真实对照 / ${escapeHTML(study.protocol.requestedModel)} · ${escapeHTML(study.protocol.reasoningEffort)}</p><h2>上下文对照结果</h2><p>${study.status==='complete'?'9 次预定运行已完成':study.status==='running'?'实验正在进行，可再次点击查看以更新':'实验提前停止'} · ${escapeHTML(study.protocol.cliVersion)}${study.stopReason?' · '+escapeHTML(study.stopReason):''}</p><div class="study-table-wrap"><table class="study-table"><thead><tr><th>输入配置</th><th>验收合格 / 尝试</th><th>平均总 token</th><th>token 范围</th><th>平均秒数</th><th>平均缓存输入</th></tr></thead><tbody>${study.summary.map(s=>`<tr><td>${escapeHTML(s.label)}</td><td>${s.successes} / ${s.attempts}</td><td>${fmt(s.tokens.mean)}</td><td>${fmt(s.tokens.min)}—${fmt(s.tokens.max)}</td><td>${fmt(s.durationSec.mean)}</td><td>${fmt(s.cachedInputTokens.mean)}</td></tr>`).join('')}</tbody></table></div><p class="muted">汇总基于原始自动验收；人工复核仅影响下方记录。均值覆盖所有已知成本的尝试，包含失败。未知成本 ${study.summary.reduce((n,s)=>n+s.unknownCost,0)} 条；执行失败 ${study.summary.reduce((n,s)=>n+s.executionFailures,0)} 条；出现额外工具操作 ${study.summary.reduce((n,s)=>n+s.protocolDeviations,0)} 条（已分到独立条件组）。缓存输入包含在总输入内，不重复相加。</p><p><strong>研究边界：</strong>只有一道受限选择题；模型名和推理强度固定，但不是不可变模型快照。额外资料长度不完全相同，缓存与网络也未完全控制。结果不能证明通用节省算力，也不能证明额外探索没有价值。</p><button id="study-report" class="button">导出完整对照记录</button>`;
  $('study-report').addEventListener('click',()=>showReport(dataset));
}
$('load-study').addEventListener('click',()=>loadRecords('/api/study',data=>{$('study-results').scrollIntoView({behavior:'smooth',block:'start'});}));
function renderRetrieval(panel){
  const s=dataset.retrievalStudy,fmt=v=>v===null?'未知':Number(v).toLocaleString('zh-CN',{maximumFractionDigits:1});
  panel.innerHTML=`<p class="eyebrow">真实调用 · 平台选择资料</p><h2>检索与停止实验</h2><p>${s.status==='complete'?'9 次预定调用已完成':s.status==='running'?'实验进行中，点击查看可刷新':'实验提前停止'} · ${escapeHTML(s.protocol.model)} / ${escapeHTML(s.protocol.effort)}</p><div class="study-table-wrap"><table class="study-table"><thead><tr><th>读取策略</th><th>任务合格 / 尝试</th><th>平均资料数</th><th>平均总 token</th><th>平均秒数</th></tr></thead><tbody>${s.summary.map(row=>`<tr><td>${escapeHTML(row.label)}</td><td>${row.successes} / ${row.attempts}</td><td>${fmt(row.meanFiles)}</td><td>${fmt(row.meanTokens)}</td><td>${fmt(row.meanSeconds)}</td></tr>`).join('')}</tbody></table></div><h3>逐任务结果</h3><div class="study-table-wrap"><table class="study-table"><thead><tr><th>任务</th>${s.summary.map(p=>`<th>${escapeHTML(p.label)}</th>`).join('')}</tr></thead><tbody>${dataset.tasks.map(t=>`<tr><td><button class="text-button" data-retrieval-task="${escapeHTML(t.id)}">${escapeHTML(t.title)}</button></td>${s.summary.map(p=>{const r=t.runs.find(r=>r.policy===p.id);return `<td>${!r?'尚未运行':({passed:'合格',insufficient_evidence:'证据不足',verification_failed:'验收未通过',execution_failed:'执行失败'}[r.outcome]||'未知')}</td>`;}).join('')}</tr>`).join('')}</tbody></table></div><p class="muted">汇总采用原始验收；下方允许人工复核。未知成本 ${s.summary.reduce((n,x)=>n+x.unknownCosts,0)} 条，执行失败 ${s.summary.reduce((n,x)=>n+x.executionFailures,0)} 条，额外模型工具事件涉及 ${s.summary.reduce((n,x)=>n+x.protocolDeviations,0)} 次运行。均值包含失败的已知成本。平台规则未额外调用模型，读取与选择的本机耗时已计入总时长。</p><p><strong>研究边界：</strong>资料由平台按手工标签选择，模型负责从所选正文恢复配置。标签覆盖不代表证据充分。只有 3 个人工任务，每任务每策略 1 次；验收核对配置与引用，不是完整代码测试，不能证明自主探索或通用算力优化。</p><button id="retrieval-export" class="button">导出检索实验完整记录</button>`;
  panel.querySelectorAll('[data-retrieval-task]').forEach(button=>button.addEventListener('click',()=>{selectTask(button.dataset.retrievalTask);$('compare-content').scrollIntoView({behavior:'smooth',block:'start'});}));
  $('retrieval-export').addEventListener('click',()=>showReport(dataset));
}
$('load-retrieval').addEventListener('click',()=>loadRecords('/api/retrieval',data=>{$('connection-status').textContent=`已载入 ${data.tasks.length} 个任务、${data.tasks.reduce((n,t)=>n+t.runs.length,0)} 次检索实验记录。`;$('study-results').scrollIntoView({behavior:'smooth',block:'start'});}));
function renderEvidence(panel) {
  const study=dataset.retrievalStudy,fmt=v=>v==null?'未知':Number(v).toLocaleString('zh-CN',{maximumFractionDigits:1});
  const runs=dataset.tasks.flatMap(t=>t.runs),total=study.protocol.schedule.length;
  const sourceFormatRuns=runs.filter(run=>Object.values(run.answer||{}).some(field=>typeof field?.sourceId==='string'&&/^资料\s+\d+$/.test(field.sourceId)));
  const outcomeLabel={passed:'合格',insufficient_evidence:'证据不足',verification_failed:'验收未通过',execution_failed:'执行失败',budget_stopped:'额度阈值停止'};
  panel.innerHTML=`<p class="eyebrow">真实调用 · ${dataset.source==='local-quality-study'?'质量反例审计':dataset.source==='local-scaling-study'?'长度与标签对照':dataset.source==='local-validation-study'?'新编任务检查':'开发任务集'}</p><h2>${dataset.source==='local-quality-study'?'引文检查与最终响应验收':'正文有依据，才考虑停止'}</h2>
    <p>${runs.length} / ${total} 次策略运行已记录 · ${study.status==='complete'?'本轮完成':study.status==='running'?'仍在进行，可再次点击刷新':'已提前停止'} · ${escapeHTML(study.protocol.model)} / ${escapeHTML(study.protocol.effort)}</p>
    <p>先检查配置值和引文能否对应到已读正文；检查未通过就补读剩余资料。标准答案仅用于策略结束后的独立验收。</p>
    ${sourceFormatRuns.length?`<p class="notice"><strong>来源格式需复核：</strong>本轮 ${sourceFormatRuns.length} 条记录使用了“资料 01”这类写法，严格验收要求“01”。原始结论保留；请查看具体答案，不能把格式差异直接解释为任务理解能力差异。</p>`:''}
    <div class="study-table-wrap"><table class="study-table"><thead><tr><th>策略</th><th>合格 / 尝试</th><th>平均资料数</th><th>模型调用总数</th><th>补读后调用</th><th>平均总 token</th><th>平均秒数</th></tr></thead><tbody>${study.summary.map(row=>`<tr><td>${escapeHTML(row.label)}</td><td>${row.successes} / ${row.attempts}</td><td>${fmt(row.meanFiles)}</td><td>${row.modelCalls}</td><td>${row.fallbacks}</td><td>${fmt(row.meanTokens)}</td><td>${fmt(row.meanSeconds)}</td></tr>`).join('')}</tbody></table></div>
    <h3>每一步的资料和代价</h3><div class="study-table-wrap"><table class="study-table"><thead><tr><th>任务 / 策略</th><th>各次调用</th><th>停止原因</th><th>最终独立验收</th></tr></thead><tbody>${dataset.tasks.flatMap(task=>task.runs.map(run=>`<tr><td><button class="text-button" data-evidence-task="${escapeHTML(task.id)}">${escapeHTML(task.title)}</button><br>${escapeHTML(run.strategy)}</td><td>${run.calls.map(call=>`第 ${call.round} 次：资料 ${escapeHTML(call.selectedIds.join('、'))}<br>${fmt(call.usage&&Number.isFinite(call.usage.input_tokens)&&Number.isFinite(call.usage.output_tokens)?call.usage.input_tokens+call.usage.output_tokens:null)} tokens`).join('<br><br>')}</td><td>${escapeHTML(run.retrieval.stopReason)}${run.error?'<br>'+escapeHTML(run.error):''}</td><td>${escapeHTML(outcomeLabel[run.outcome]||'未知')}</td></tr>`)).join('')}</tbody></table></div>
    <p class="muted">已知累计 ${fmt(study.cost.knownTokens)} tokens；用量未知 ${study.cost.unknownCalls} 次调用。两轮输入和输出均计入，缓存输入不重复相加。误停 ${study.summary.reduce((n,row)=>n+row.prematureStops,0)} 次（检查通过后最终验收仍未完成）。汇总保留原始自动验收；下方人工复核不改写它。</p>
    <p><strong>当前边界：</strong>${escapeHTML(study.protocol.design)} ${escapeHTML(study.protocol.limitations[0])} 引文真实和数值匹配不代表语义正确，也不能保证没有冲突；这一步只修补可识别的证据缺失。</p>
    <button id="evidence-export" class="button">导出完整补读实验记录</button>`;
  panel.querySelectorAll('[data-evidence-task]').forEach(button=>button.addEventListener('click',()=>{selectTask(button.dataset.evidenceTask);$('compare-content').scrollIntoView({behavior:'smooth',block:'start'});}));
  $('evidence-export').addEventListener('click',()=>showReport(dataset));
}
$('load-evidence').addEventListener('click',()=>loadRecords('/api/evidence',data=>{$('connection-status').textContent=`已载入 ${data.tasks.length} 个任务的证据补读实验；调用与成本见下表。`;$('study-results').scrollIntoView({behavior:'smooth',block:'start'});}));
$('load-validation').addEventListener('click',()=>loadRecords('/api/validation',data=>{$('connection-status').textContent='已载入新编任务的检查结果；来源编号使用预先约束的格式。';$('study-results').scrollIntoView({behavior:'smooth',block:'start'});}));
function renderQuality(panel){
  const names={correct_answer:'正确恢复配置',correct_abstention:'按约定留空（未恢复配置）',unnecessary_abstention:'可回答却留空',unsupported_assertion:'应留空但未遵守约定',incorrect_answer:'答案或引用不正确',unassessed:'尚未判定'};
  const studies=dataset.retrievalStudy,checks=dataset.tasks.flatMap(t=>t.runs.flatMap(r=>Object.values(r.checks)));
  const count=judgment=>checks.filter(c=>c.judgment===judgment).length;
  const cases=studies.protocol.auditCases||[];
  const rows=studies.protocol.schedule.map(entry=>{
    const t=dataset.tasks.find(t=>t.id===entry.taskId),r=t?.runs.find(r=>r.policy===entry.policy),audit=cases.find(c=>c.taskId===entry.taskId);
    const premature=r&&r.policy==='evidence'&&r.retrieval.stopReason==='引文完整性检查通过'&&r.outcome!=='passed';
    const unavailable=!r||['execution_failed','budget_stopped'].includes(r.outcome);
    const state=unavailable?'未评估':r.policy==='all'?'不适用（全读）':premature?'发现误停':'本次未发现误停';
    const response=!r?'尚未运行':unavailable?'执行未完成，无法判定':Object.values(r.checks).map(c=>names[c.judgment]||'尚未判定').join('；');
    return `<tr><td>${escapeHTML(audit?.kind||entry.taskId)}</td><td>${escapeHTML(audit?.expectedResponse||'未定义')}</td><td>${entry.policy==='all'?'一次读取全部资料':'检查引文，不足时补读'}</td><td>${escapeHTML(response)}</td><td>${state}</td><td>${r?number(r.tokens)+' tokens / '+r.calls.length+' 次':'尚未运行'}</td></tr>`;
  }).join('');
  panel.insertAdjacentHTML('afterbegin',`<section aria-label="安全响应审计"><h2>能回答时准确回答，依据不足时留空</h2><p>${escapeHTML(studies.protocol.verificationContract)}</p><p>字段级原始验收：正确恢复 ${count('correct_answer')} 项；按约定留空 ${count('correct_abstention')} 项；应留空但未遵守约定 ${count('unsupported_assertion')} 项；可回答却留空 ${count('unnecessary_abstention')} 项；答案或引用不正确 ${count('incorrect_answer')} 项；尚未判定 ${checks.filter(c=>c.status==='unknown').length} 项。</p><div class="study-table-wrap"><table class="study-table"><thead><tr><th>反例</th><th>完整资料要求</th><th>策略</th><th>实际响应判定</th><th>停止审计</th><th>总用量</th></tr></thead><tbody>${rows}</tbody></table></div><p class="muted">误停指引文检查通过后停止，但最终响应未达到本题约定。完整资料金标准只在停止后使用；控制器尚未具备通用语义相关性或冲突检测能力。每格一次的开发反例不代表真实错误率。</p></section>`);
}
$('load-quality').addEventListener('click',()=>loadRecords('/api/quality',data=>{$('connection-status').textContent='已载入质量反例；正确留空只表示响应符合约定，不表示配置恢复完成。';$('study-results').scrollIntoView({behavior:'smooth',block:'start'});}));
function renderScaling(panel){
  const fmt=v=>v==null?'未知':Number(v).toLocaleString('zh-CN',{maximumFractionDigits:1});
  const label={passed:'合格',insufficient_evidence:'证据不足',verification_failed:'未通过',execution_failed:'执行失败',budget_stopped:'阈值停止'};
  const rows=(dataset.retrievalStudy.protocol.conditions||[]).map(c=>{
    const runs=dataset.tasks.find(t=>t.id===c.taskId)?.runs||[],a=runs.find(r=>r.policy==='all'),b=runs.find(r=>r.policy==='evidence');
    const valid=r=>r&&r.outcome==='passed'&&!r.protocolDeviation&&Number.isFinite(r.tokens);
    const saving=valid(a)&&valid(b)?a.tokens-b.tokens:null;
    const cell=r=>r?`${escapeHTML(label[r.outcome]||'未知')} · ${fmt(r.tokens)} tokens · ${r.calls.length} 次调用`:'尚未运行';
    return `<tr><td>${fmt(c.charsPerDocument)} 字符/份</td><td>${c.labelError?'标签错误':'标签正确'}</td><td>${cell(a)}</td><td>${cell(b)}</td><td>${saving===null?'未满足比较条件':saving>=0?'少用 '+fmt(saving):'多用 '+fmt(-saving)}</td></tr>`;
  }).join('');
  panel.insertAdjacentHTML('afterbegin',`<section aria-label="按实验条件比较"><h2>同一任务，分条件比较</h2><p>每份正文的长度固定，六份资料；同长度下正文相同，仅改变标签。差值为全读总 token 减去补读策略总 token，仅在两者验收通过、用量已知且无额外工具事件时显示。</p><div class="study-table-wrap"><table class="study-table"><thead><tr><th>资料长度</th><th>目录状态</th><th>一次全读</th><th>按需补读</th><th>按需补读的 token 差值</th></tr></thead><tbody>${rows}</tbody></table></div><p class="muted">人工背景填充、同一道题、每格一次；不估计自然遗漏概率，不支持泛化结论。下方跨条件均值仅描述本次设计，不代表实际工作负载。</p></section>`);
}
$('load-scaling').addEventListener('click',()=>loadRecords('/api/scaling',data=>{$('connection-status').textContent='已载入长度与标签对照；请按条件分别查看，勿将设置比例当作自然概率。';$('study-results').scrollIntoView({behavior:'smooth',block:'start'});}));
async function checkConnection() {
  const epoch=datasetEpoch,runAtStart=runEpoch;
  try {const response=await fetch('/api/status');if(!response.ok)throw new Error();const state=await response.json();if(runAtStart!==runEpoch)return;if(epoch===datasetEpoch)$('connection-status').textContent=state.running?'真实任务正在运行，可稍后查看最近结果':state.message;$('run-live').disabled=!state.available||state.running;if(epoch===datasetEpoch||state.hasLatest)$('load-live').disabled=!state.hasLatest;}
  catch {if(epoch!==datasetEpoch)return;$('connection-status').textContent='真实执行需要本机服务：运行 npm start 后打开 http://127.0.0.1:4173。';}
}
$('run-live').addEventListener('click',async()=>{
  runEpoch++;
  const epoch=++datasetEpoch;
  $('run-live').disabled=true;$('load-live').disabled=true;const started=Date.now();
  const progress=setInterval(()=>{if(epoch!==datasetEpoch)return;$('connection-status').textContent=`Codex 正在执行真实任务… ${Math.floor((Date.now()-started)/1000)} 秒`;},1000);
  $('connection-status').textContent='正在提交真实任务…';
  try {const response=await fetch('/api/run',{method:'POST',headers:{'X-Agent-Context':'local-run'}});const data=await response.json();if(epoch!==datasetEpoch)return;if(!response.ok)throw new Error(data.error||'运行失败');clearInterval(progress);showLive(data);$('load-live').disabled=false;toast('真实运行完成，已显示独立验收结果');}
  catch(e){if(epoch===datasetEpoch){$('connection-status').textContent=e.message;toast(e.message,true);}}
  finally{clearInterval(progress);$('run-live').disabled=false;$('load-live').disabled=false;}
});
$('load-live').addEventListener('click',()=>loadRecords('/api/latest'));
checkConnection();


