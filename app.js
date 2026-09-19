'use strict';
const E = AgentEvaluation;
let dataset = E.validateDataset(structuredClone(AGENT_SAMPLE));
let selectedTaskId = dataset.tasks[0].id;
let selectedGroup = dataset.tasks[0].runs[0].comparisonGroup;
let budget = 10000;
let activeRunId = null;
let localDataset = false;
const $ = id => document.getElementById(id);
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = value => value === null ? '未知' : value.toLocaleString('zh-CN');
const statusLabel = { pass:'已通过', fail:'未通过', unknown:'待核验' };
const typeLabel = { explore:'探索', act:'执行', verify:'验证' };
function toast(message, error = false) { $('toast').textContent = message; $('toast').className = `toast${error ? ' error' : ''}`; $('toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { $('toast').hidden = true; }, 5500); }
function download(name, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function showReport(payload) {
  const content=JSON.stringify(payload,null,2);
  const url=URL.createObjectURL(new Blob([content],{type:'application/json'}));
  $('detail-content').innerHTML=`<header class="dialog-header"><div><p class="eyebrow">EXPORT REPORT</p><h2>评估报告已生成</h2><p>包含当前目标、证据和比较结果；也可以直接复制下方文本保存。</p></div><button id="close-report" class="icon-button" aria-label="关闭报告">×</button></header><p class="muted">${dataset.demo?'人工构造演示数据，不代表真实实验结果。':'导入记录；来源与验收结论需独立复核。'}</p><label for="report-json">JSON 报告内容</label><textarea id="report-json" readonly rows="15" style="display:block;width:100%;margin:10px 0 20px;font-family:monospace">${escapeHTML(content)}</textarea><a id="report-download" class="button primary" download="agent-context-report.json">下载 JSON 文件</a>`;
  $('report-download').href=url;
  $('close-report').addEventListener('click',()=>$('detail-dialog').close());
  $('detail-dialog').addEventListener('close',()=>URL.revokeObjectURL(url),{once:true});
  $('detail-dialog').showModal();
}
function currentTask() { return dataset.tasks.find(t => t.id === selectedTaskId); }
function notice() {
  $('notice').innerHTML = dataset.demo
    ? '<span class="notice-icon">i</span><div><strong>当前为人工构造的演示数据</strong><span>下方记录用于体验交互。可点击“运行真实测试”获取实际模型记录。</span></div><span class="tag">DEMO</span>'
    : localDataset ? '<span class="notice-icon">✓</span><div><strong>当前显示本机 Codex 真实执行记录</strong><span>8 条独立测试；用量来自执行器。原始结果保存在本机，人工复核修改需导出留存。单次测试不代表策略提升。</span></div><span class="tag">LIVE</span>'
    : '<span class="notice-icon">i</span><div><strong>当前为你导入的记录</strong><span>数据仅在当前页面内存中处理；来源与验收证据需自行复核。刷新会恢复示例，请导出保存。</span></div><span class="tag">IMPORTED</span>';
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
  const search = $('search').value.trim().toLowerCase(), filter = $('scenario-filter').value;
  const tasks = dataset.tasks.filter(t => (filter === 'all' || t.scenario === filter) && `${t.title} ${t.description}`.toLowerCase().includes(search));
  $('task-count').textContent = tasks.length;
  $('task-grid').innerHTML = tasks.length ? tasks.map(t => {
    const required = t.goals.filter(g => g.required).length;
    const pass = t.runs.filter(r => { const e=E.evaluate(t,r); return e.accepted && e.allReviewed; }).length;
    return `<article class="task-card"><div class="card-top"><span class="scenario ${t.scenario}">${escapeHTML(E.scenarios[t.scenario])}</span><span class="muted">${t.runs.length} 条记录</span></div><h3>${escapeHTML(t.title)}</h3><p>${escapeHTML(t.description)}</p><div class="goal-preview">${t.goals.slice(0,2).map(g=>`<span><i>${g.required?'◆':'◇'}</i>${escapeHTML(g.label)}</span>`).join('')}</div><div class="card-meta"><span>${required} 项必需目标</span><span>验收合格 ${pass}/${t.runs.length}</span></div><button class="card-action" data-task="${escapeHTML(t.id)}">进入目标与策略比较 <span>↗</span></button></article>`;
  }).join('') : '<div class="empty">没有匹配的任务。试试其他关键词或场景。</div>';
  $('task-grid').querySelectorAll('[data-task]').forEach(button => button.addEventListener('click', () => { selectTask(button.dataset.task); location.hash = 'compare'; route(); }));
}
function selectTask(id) {
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
    <div class="settings-grid"><section class="goal-settings"><div class="subheading"><h3>目标与验收约定</h3><small>更改条件只重评已有记录，不重新运行 AI</small></div>${task.goals.map((g,i)=>`<div class="goal-row"><span class="goal-index">${String(i+1).padStart(2,'0')}</span><span class="goal-label">${escapeHTML(g.label)}</span><label class="required-control"><input type="checkbox" data-required="${i}" ${g.required?'checked':''}>必需</label><label class="weight-control">权重 <select aria-label="${escapeHTML(g.label)}的权重" data-weight="${i}">${[1,2,3,4,5].map(n=>`<option value="${n}" ${g.weight===n?'selected':''}>${n}</option>`).join('')}</select></label></div>`).join('')}<p class="fine-print">目标得分 = 已通过目标的权重 / 全部目标权重。得分不能覆盖未通过的必需项；未知结果不算通过。未设置必需项时要求全部目标通过。</p></section><section class="budget-settings"><span class="eyebrow">资源约束</span><label for="budget-input">单次执行 token 上限</label><div class="budget-field"><input id="budget-input" type="number" min="0" max="1000000000" step="100" value="${budget}"><span>tokens</span></div><label for="group-select">可比条件组</label><select id="group-select">${groups.map(g=>`<option ${g===selectedGroup?'selected':''}>${escapeHTML(g)}</option>`).join('')}</select><p>仅比较同一任务、同一条件组中的记录。分组由导入者声明，平台无法独立验证。token 不等同于硬件算力。</p></section></div>
    <div class="recommendation ${bestIds.length?'':'neutral'}"><span>${bestIds.length?'✓':'i'}</span><div><strong>${bestIds.length?'找到符合当前条件的执行记录':'当前没有可推荐的记录'}</strong><p>${bestIds.length?'下方标记的是已核验、满足必需项与预算，并在当前组内 token 最少的记录。单次表现不代表策略普遍更好。':'可能存在验收失败、缺失证据、未知成本或预算不足。平台不会把“更省”自动视为“更好”。'}</p></div></div>
    <div class="run-grid">${rows.map(({run,evaluation:v})=>`<article class="run-card ${bestIds.includes(run.id)?'best':''}"><div class="card-top"><span class="status ${v.eligible?'pass':'unknown'}">${escapeHTML(v.status)}</span>${bestIds.includes(run.id)?'<span class="best-label">'+(rows.length>1?'合格记录中最省':'单次记录 · 已合格')+'</span>':''}</div><h3>${escapeHTML(run.strategy)}</h3><p class="run-model">${escapeHTML(run.model)}</p><div class="run-score"><strong>${v.score}<small>%</small></strong><span>加权目标得分<br><small>已核验 ${v.known}/${v.total} 项</small></span></div><div class="token-track"><span style="width:${run.tokens===null?0:run.tokens/max*100}%"></span></div><div class="resource-row"><span><strong>${number(run.tokens)}</strong> tokens</span><span>${number(run.durationSec)} 秒</span></div><div class="checks-list">${task.goals.map(g=>`<div><span class="check-mark ${run.checks[g.id].status}">${{pass:'✓',fail:'×',unknown:'?'}[run.checks[g.id].status]}</span><span>${escapeHTML(g.label)}</span>${g.required?'<small>必需</small>':''}</div>`).join('')}</div><button class="button full" data-run="${escapeHTML(run.id)}">查看过程与验收证据 →</button></article>`).join('')}</div>`;
  const applyBudget = document.createElement('button');
  applyBudget.className='button full'; applyBudget.textContent='应用预算'; applyBudget.style.marginTop='10px';
  $('budget-input').parentElement.after(applyBudget);
  const commitBudget = () => {const field=$('budget-input'), n=Number(field.value); if(field.value==='' || !Number.isFinite(n) || n<0 || n>1e9) {toast('请输入 0—1,000,000,000 的预算',true);field.value=budget;return;}budget=n;renderCompare();};
  applyBudget.addEventListener('click',commitBudget);
  $('budget-input').addEventListener('keydown',event=>{if(event.key==='Enter')commitBudget();});
  $('group-select').addEventListener('change',event=>{selectedGroup=event.target.value;renderCompare();});
  $('compare-content').querySelectorAll('[data-weight]').forEach(el=>el.addEventListener('change',()=>{task.goals[Number(el.dataset.weight)].weight=Number(el.value);renderOverview();renderCompare();}));
  $('compare-content').querySelectorAll('[data-required]').forEach(el=>el.addEventListener('change',()=>{task.goals[Number(el.dataset.required)].required=el.checked;renderOverview();renderCompare();}));
  $('compare-content').querySelectorAll('[data-run]').forEach(el=>el.addEventListener('click',()=>showDetail(el.dataset.run)));
  $('export-report').addEventListener('click',()=>{showReport({reportVersion:1,generatedAt:new Date().toISOString(),demo:dataset.demo,scope:'离线记录评估；非在线智能体控制；不代表因果关系或真实提升',budgetTokens:budget,comparisonGroup:selectedGroup,task:structuredClone(task),results:rows.map(x=>({runId:x.run.id,...x.evaluation})),lowestTokenEligibleRunIds:bestIds});});
}
function showDetail(id) {
  const task = currentTask(), run = task.runs.find(r=>r.id===id); activeRunId=id;
  $('detail-content').innerHTML = `<header class="dialog-header"><div><p class="eyebrow">EXECUTION REVIEW</p><h2>${escapeHTML(run.strategy)}</h2><p>${escapeHTML(task.title)} · ${dataset.demo?'人工构造示例':localDataset?'本机真实执行':'导入记录'}</p></div><button id="close-dialog" class="icon-button" aria-label="关闭详情">×</button></header><div class="detail-grid"><section><h3>执行时间线</h3><p class="muted">过程记录用于复核，不代表模型内部思维。</p><ol class="timeline">${run.events.length?run.events.map(e=>`<li><span class="timeline-dot ${e.type}"></span><div class="event-top"><strong>${escapeHTML(e.label)}</strong><small>${number(e.atSec)} 秒 · ${typeLabel[e.type]}</small></div><p>${escapeHTML(e.detail)}</p></li>`).join(''):'<li>没有提供过程记录。</li>'}</ol></section><section class="evidence-section"><h3>验收证据</h3><p class="muted">可以人工复核并修正；变更在当前页面内存中保留。</p><form id="review-form">${task.goals.map((g,i)=>`<div class="evidence-item"><label for="evidence-${i}">${escapeHTML(g.label)} ${g.required?'<small>必需</small>':''}</label><select aria-label="${escapeHTML(g.label)}的验收状态" name="status-${i}">${['pass','fail','unknown'].map(s=>`<option value="${s}" ${run.checks[g.id].status===s?'selected':''}>${statusLabel[s]}</option>`).join('')}</select><textarea id="evidence-${i}" name="evidence-${i}" maxlength="6000" rows="3" placeholder="填写可追溯的验收依据">${escapeHTML(run.checks[g.id].evidence)}</textarea></div>`).join('')}<button class="button primary full" type="submit">保存本次复核</button></form></section></div>`;
  $('close-dialog').addEventListener('click',()=>$('detail-dialog').close());
  $('review-form').addEventListener('submit',event=>{
    event.preventDefault(); const form = new FormData(event.target), updates=Object.create(null);
    for(let i=0;i<task.goals.length;i++) {const status=form.get(`status-${i}`), evidence=form.get(`evidence-${i}`).trim();if(status!=='unknown'&&!evidence){toast('判定通过或未通过时，请补充验收证据',true);return;}updates[task.goals[i].id]={status,evidence};}
    run.checks=updates;renderOverview();renderCompare();$('detail-dialog').close();toast('复核已保存到当前会话；可导出评估报告留存');
  });
  $('detail-dialog').showModal();
}
function renderAll() {
  notice();
  $('compare-task').innerHTML=dataset.tasks.map(t=>`<option value="${escapeHTML(t.id)}">${escapeHTML(t.title)}</option>`).join('');
  $('compare-task').value=selectedTaskId;renderOverview();renderCompare();route();
}
function route() {
  const requested=location.hash.slice(1), view=['overview','compare','research'].includes(requested)?requested:'overview';
  for(const name of ['overview','compare','research']) $(`view-${name}`).hidden=name!==view;
  document.querySelectorAll('[data-view]').forEach(link=>{link.classList.toggle('active',link.dataset.view===view);if(link.dataset.view===view)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
  const copy={overview:['任务评估','让 AI 的投入，对准你的目标。','把目标、执行与验收放在一起，理解每一次任务的取舍。'],compare:['策略比较','先达成目标，再比较投入。','在相同条件下复核证据，找到符合你要求的执行记录。'],research:['课题与路线','从一个观察，走向可验证的研究。','扩大应用视野，同时保留具体、可落地的研究问题。']}[view];
  $('breadcrumb').textContent=copy[0];$('page-title').textContent=copy[1];$('page-subtitle').textContent=copy[2];
}
$('search').addEventListener('input',renderOverview);$('scenario-filter').addEventListener('change',renderOverview);
$('compare-task').addEventListener('change',e=>selectTask(e.target.value));
$('import-button').addEventListener('click',()=>$('file-input').click());
$('file-input').addEventListener('change',async event=>{
  const file=event.target.files[0];if(!file)return;
  try {if(file.size>2*1024*1024)throw new Error('文件不能超过 2 MB');const next=E.validateDataset(JSON.parse(await file.text()));dataset=next;localDataset=false;selectedTaskId=dataset.tasks[0].id;selectedGroup=dataset.tasks[0].runs[0].comparisonGroup;budget=10000;$('search').value='';$('scenario-filter').value='all';renderAll();toast(`已导入 ${dataset.tasks.length} 个任务，原有会话记录已替换`);} catch(error){toast(`导入失败：${error.message}`,true);} finally{event.target.value='';}
});
$('template-button').addEventListener('click',()=>{download('agent-context-example.json',AGENT_SAMPLE);toast('已下载示例 JSON，可按相同结构替换为自己的记录');});
$('reset-button').addEventListener('click',()=>{if(!confirm('恢复内置示例会清除本页导入记录和复核修改。需要保留的数据请先导出报告。确认恢复？'))return;dataset=structuredClone(AGENT_SAMPLE);localDataset=false;selectedTaskId=dataset.tasks[0].id;selectedGroup=dataset.tasks[0].runs[0].comparisonGroup;budget=10000;$('search').value='';$('scenario-filter').value='all';renderAll();toast('已恢复内置演示数据');});
window.addEventListener('hashchange',route);renderAll();

function showLive(data) {
  dataset=E.validateDataset(data);localDataset=true;selectedTaskId=dataset.tasks[0].id;selectedGroup=dataset.tasks[0].runs[0].comparisonGroup;
  budget=Math.max(10000,...dataset.tasks[0].runs.map(r=>r.tokens||0));
  $('search').value='';$('scenario-filter').value='all';location.hash='compare';renderAll();
  const r=dataset.tasks[0].runs[0],u=r.usage;
  $('connection-status').textContent=`最近测试：${r.durationSec} 秒，${number(r.tokens)} tokens${u?`（输入 ${number(u.input_tokens)}，输出 ${number(u.output_tokens)}，输入中缓存 ${number(u.cached_input_tokens??null)}）`:''}。`;
}
async function checkConnection() {
  try {const response=await fetch('/api/status');if(!response.ok)throw new Error();const state=await response.json();$('connection-status').textContent=state.running?'真实任务正在运行，可稍后查看最近结果':state.message;$('run-live').disabled=!state.available||state.running;$('load-live').disabled=!state.hasLatest;}
  catch {$('connection-status').textContent='真实执行需要本机服务：运行 npm start 后打开 http://127.0.0.1:4173。';}
}
$('run-live').addEventListener('click',async()=>{
  $('run-live').disabled=true;$('load-live').disabled=true;const started=Date.now();
  const progress=setInterval(()=>{$('connection-status').textContent=`Codex 正在执行真实任务… ${Math.floor((Date.now()-started)/1000)} 秒`;},1000);
  $('connection-status').textContent='正在提交真实任务…';
  try {const response=await fetch('/api/run',{method:'POST',headers:{'X-Agent-Context':'local-run'}});const data=await response.json();if(!response.ok)throw new Error(data.error||'运行失败');clearInterval(progress);showLive(data);$('load-live').disabled=false;toast('真实运行完成，已显示独立验收结果');}
  catch(e){$('connection-status').textContent=e.message;toast(e.message,true);}
  finally{clearInterval(progress);$('run-live').disabled=false;$('load-live').disabled=false;}
});
$('load-live').addEventListener('click',async()=>{try{const response=await fetch('/api/latest');const data=await response.json();if(!response.ok)throw new Error(data.error);showLive(data);}catch(e){toast(e.message,true);}});
checkConnection();


