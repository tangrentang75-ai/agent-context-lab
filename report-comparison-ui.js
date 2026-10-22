(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const MAX_BYTES = 16 * 1024 * 1024;
  const records = { before: null, after: null }, epochs = { before: 0, after: 0 };
  let engine = null, reportBuilder = null, result = null, visible = 40, initEpoch = 0;
  let dataset = null, generated = null, datasetEpoch = 0, generationEpoch = 0;
  const titles = { unchanged: '已检查的内容一致', conditions_changed: '比较条件有变化，先核对原因', inconsistent: '来源声明有冲突，请先核对文件' };
  const reasonTitles = { source_changed: '两份报告来自不同输入', source_metadata_changed: '输入说明发生变化', budget_changed: '预算变了', rules_changed: '评分规则变了', rules_unverified: '部分评分规则尚未核验', identity_conflict: '来源说明与内容对不上' };
  const fields = { status: '验收状态', evidence: '证据文本', tokens: 'token 用量', durationSec: '耗时（秒）', score: '目标得分', eligible: '推荐资格', bestIds: '推荐记录', label: '目标名称', weight: '目标权重', required: '是否为必需项', model: '模型', strategy: '策略', title: '任务名称', known: '已核验目标数', total: '目标总数', accepted: '必需目标是否满足', allReviewed: '是否全部核验' };
  const kinds = { added: '新增', removed: '删除', changed: '修改' };
  function node(tag, content, className) { const el = document.createElement(tag); if (content !== undefined) el.textContent = content; if (className) el.className = className; return el; }
  function notice(message, error = false) { $('notice').textContent = message; $('notice').className = error ? 'notice error' : 'notice'; }
  function invalidate() { result = null; $('download').disabled = true; $('results').hidden = true; $('empty').hidden = false; $('changes').replaceChildren(); }
  function buttons() { $('compare').disabled = !engine || !records.before || !records.after; }
  function clearSide(side) { records[side] = null; $('' + side + '-name').textContent = '尚未选择'; }
  async function digest(bytes) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join(''); }
  function budgetValue() {
    const value = $('report-budget').value;
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value) || !Number.isFinite(Number(value))) throw new Error('请填写非负有限数预算，不能留空');
    return Number(value);
  }
  function generatorButtons() {
    let validBudget = true; try { budgetValue(); } catch { validBudget = false; }
    $('generate').disabled = !reportBuilder || !dataset || !validBudget;
    for (const id of ['download-generated', 'use-before', 'use-after']) $(id).disabled = !generated;
  }
  function invalidateGenerated() { generationEpoch++; generated = null; $('generated').hidden = true; generatorButtons(); }
  async function importDataset() {
    const input = $('dataset-file'), file = input.files?.[0]; if (!file) return;
    const epoch = ++datasetEpoch; dataset = null; invalidateGenerated(); input.value = '';
    $('dataset-name').textContent = '正在读取任务数据…'; $('generator-notice').textContent = '正在检查任务数据格式。';
    try {
      if (!reportBuilder) throw new Error('本机评价规则尚未准备好');
      if (file.size > AgentRecordEvaluation.MAX_BYTES) throw new Error('任务数据不能超过 2MiB');
      const raw = new Uint8Array(await file.arrayBuffer());
      const data = reportBuilder.parseDataset(raw), sha256 = await digest(raw);
      if (epoch !== datasetEpoch) return;
      dataset = { data, source: { sha256, bytes: raw.byteLength }, name: file.name };
      $('dataset-name').textContent = `${file.name}\n${data.tasks.length} 个任务 · ${data.demo ? '人工构造示例' : '来源由提供者声明'}`;
      $('generator-notice').textContent = '数据已准备好，请确认预算后生成报告。'; generatorButtons();
    } catch (error) { if (epoch === datasetEpoch) { $('dataset-name').textContent = '未载入有效任务数据'; $('generator-notice').textContent = `读取未完成：${error.message}。请重新选择。`; generatorButtons(); } }
  }
  async function generate() {
    invalidateGenerated(); const epoch = generationEpoch;
    try {
      if (!reportBuilder || !dataset) throw new Error('请先选择有效的任务数据');
      const selected = dataset, budget = budgetValue();
      $('generator-notice').textContent = '正在生成报告…';
      const report = reportBuilder.buildReport(selected.data, budget, selected.source);
      const json = JSON.stringify(report, null, 2) + '\n';
      const sha256 = await digest(new TextEncoder().encode(json));
      if (epoch !== generationEpoch) return;
      generated = { report, json, sha256, name: `网页评估-${budget}token.json` };
      const s = report.summary;
      $('generated-summary').textContent = `${s.taskCount} 个任务、${s.groupCount} 个条件组；${s.groupsWithoutCandidate} 组没有可推荐记录。每条记录预算 ${budget} token。`;
      $('generated-origin').textContent = `${selected.name} · ${report.source.demo ? '人工构造示例' : '来源由提供者声明'}。生成报告不等于任务全部通过，也不证明证据真实。`;
      $('generated').hidden = false; $('generator-notice').textContent = '报告已生成，可以下载，或送入下方对照区。'; generatorButtons();
    } catch (error) { if (epoch === generationEpoch) { $('generator-notice').textContent = `生成未完成：${error.message}`; generatorButtons(); } }
  }
  function useGenerated(side) {
    if (!generated) return;
    epochs[side]++; invalidate(); $(side + '-file').value = '';
    accept(side, { report: structuredClone(generated.report), name: generated.name, sha256: generated.sha256 }); buttons();
    notice(`已把生成的报告作为“${side === 'before' ? '之前' : '之后'}”报告。${$('compare').disabled ? '请再准备另一份。' : '可以查看对照结果。'}`);
  }
  function downloadJson(json, filename) {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = node('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function decode(bytes, name) {
    if (bytes.byteLength > MAX_BYTES) throw new Error('每份报告不能超过 16MiB');
    const report = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    engine.validateReport(report);
    return { report, name, sha256: await digest(bytes) };
  }
  function accept(side, value) { records[side] = value; $(side + '-name').textContent = `${value.name}\n${value.report.tasks.length} 个任务 · ${value.report.source.demo ? '人工构造示例' : '来源由提供者声明'}`; }
  async function importFile(side) {
    const input = $(side + '-file'), file = input.files?.[0];
    if (!file) return;
    const epoch = ++epochs[side];
    invalidate(); clearSide(side); buttons(); input.value = '';
    notice(`正在读取${side === 'before' ? '之前' : '之后'}的报告…`);
    try {
      if (!engine) throw new Error('评价规则尚未准备好，请先连接本机服务');
      if (file.size > MAX_BYTES) throw new Error('每份报告不能超过 16MiB');
      const value = await decode(await file.arrayBuffer(), file.name);
      if (epoch !== epochs[side]) return;
      accept(side, value); buttons(); notice($('compare').disabled ? '已读取一份报告，请选择另一份。' : '两份报告已准备好，可以查看对照结果。');
    } catch (error) { if (epoch === epochs[side]) { buttons(); notice(`读取未完成：${error.message}。请重新选择；旧结果已收起。`, true); } }
  }
  function display(value, field) {
    if (value === null) return '未知（null）';
    if (value === true) return '是'; if (value === false) return '否';
    if (field === 'status' && typeof value === 'string') { const statuses = { pass: '通过', fail: '未通过', unknown: '证据待补' }; return Object.hasOwn(statuses, value) ? statuses[value] : value; }
    if (value === '') return '（空文本）';
    return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
  }
  function reasonValue(value, code) {
    if (code === 'source_metadata_changed') return `${value.bytes} 字节 · ${value.demo ? '人工构造示例' : '来源由提供者声明'}`;
    if (code === 'budget_changed') return `${value} token / 每条记录`;
    return display(value);
  }
  function context(change) {
    const p = change.path;
    const task = records.after.report.tasks.find(t => t.id === p[1]) || records.before.report.tasks.find(t => t.id === p[1]);
    const parts = [task?.title || p[1]];
    if (p[2] === 'groups') parts.push(`条件组：${p[3]}`);
    if (p[4] === 'runs') parts.push(`记录：${p[5]}`);
    const goalId = p[2] === 'goals' ? p[3] : p[6] === 'checks' ? p[7] : null;
    if (goalId) {
      const oldTask = records.before.report.tasks.find(t => t.id === p[1]);
      parts.push(`目标：${task?.goals.find(g => g.id === goalId)?.label || oldTask?.goals.find(g => g.id === goalId)?.label || goalId}`);
    }
    return parts.join(' / ');
  }
  function renderChanges() {
    if (!result) return;
    const type = $('filter').value, query = $('search').value.trim().toLowerCase();
    const filtered = result.changes.filter(change => {
      const last = change.path.at(-1);
      const match = type === 'all' || (type === 'status' && change.path[6] === 'checks' && last === 'status') || (type === 'evidence' && last === 'evidence') || (type === 'recommendation' && ['bestIds', 'eligible'].includes(last)) || change.kind === type;
      return match && (!query || (context(change) + JSON.stringify(change)).toLowerCase().includes(query));
    });
    $('changes').replaceChildren();
    for (const change of filtered.slice(0, visible)) {
      const card = node('article', undefined, 'change'), heading = node('div', undefined, 'change-heading');
      const h3 = node('h3'), field = change.path.at(-1); h3.append(node('span', kinds[change.kind], 'badge'), node('span', Object.hasOwn(fields, field) ? fields[field] : '条目变化'));
      heading.append(h3, node('p', context(change))); card.append(heading);
      const sides = node('div', undefined, 'sides');
      for (const [key, label] of [['before', '之前'], ['after', '之后']]) {
        const side = node('div', undefined, 'side'); side.append(node('h4', label), node('pre', Object.hasOwn(change, key) ? display(change[key], change.path.at(-1)) : '此侧没有该条目')); sides.append(side);
      }
      card.append(sides);
      const details = node('details'); details.append(node('summary', '查看原始位置标识'), node('pre', JSON.stringify(change.path))); card.append(details);
      $('changes').append(card);
    }
    if (!filtered.length) $('changes').append(node('p', result.changes.length ? '没有符合当前筛选的变化。' : '已检查字段没有变化。请同时查看上方的比较条件。', 'fine'));
    $('filter-count').textContent = `共 ${result.changeCount} 项字段或条目变化；符合筛选 ${filtered.length} 项，已显示 ${Math.min(visible, filtered.length)} 项。`;
    $('more').hidden = filtered.length <= visible;
  }
  function render() {
    $('verdict').dataset.status = result.status; $('verdict-title').textContent = titles[result.status]; $('verdict-message').textContent = result.message;
    $('demo-note').textContent = records.before.report.source.demo || records.after.report.source.demo ? '包含人工构造示例，仅用于演示软件行为。' : '来源由提供者声明；本页不证明证据真实。';
    $('count').textContent = `之前 ${records.before.report.tasks.length} 个任务 → 之后 ${records.after.report.tasks.length} 个任务 · ${result.changeCount} 项变化`;
    $('reasons').replaceChildren();
    for (const reason of result.reasons) {
      const card = node('article', undefined, 'reason'); card.append(node('h3', reasonTitles[reason.code] || reason.code), node('p', reason.message));
      if (Object.hasOwn(reason, 'before')) {
        const values = node('pre', `之前：${reasonValue(reason.before, reason.code)}\n之后：${reasonValue(reason.after, reason.code)}`);
        if (['source_changed', 'rules_changed'].includes(reason.code)) { const details = node('details'); details.append(node('summary', '查看两侧校验值'), values); card.append(details); }
        else card.append(values);
      }
      $('reasons').append(card);
    }
    $('reason-section').hidden = result.reasons.length === 0;
    $('validation').textContent = `按本机当前规则重算：之前${result.validation.beforeRecomputedWithCurrentRules ? '已完成' : '未完成'}，之后${result.validation.afterRecomputedWithCurrentRules ? '已完成' : '未完成'}。这只检查评分计算。`;
    $('limitations').replaceChildren(...result.limitations.map(line => node('li', line)));
    $('provenance').textContent = `之前报告文件 SHA-256：${records.before.sha256}\n之后报告文件 SHA-256：${records.after.sha256}`;
    visible = 40; $('filter').value = 'all'; $('search').value = ''; renderChanges();
    $('empty').hidden = true; $('results').hidden = false; $('download').disabled = false;
  }
  function compare() {
    if (!engine || !records.before || !records.after) return;
    invalidate();
    try {
      result = engine.compareReports(records.before.report, records.after.report);
      result.reportFiles = { beforeSha256: records.before.sha256, afterSha256: records.after.sha256 };
      render(); notice('对照已完成。请先看条件说明，再看逐项变化。');
    } catch (error) { invalidate(); notice(`比较未完成：${error.message}`, true); }
  }
  function reset() {
    datasetEpoch++; dataset = null; invalidateGenerated(); $('dataset-file').value = ''; $('dataset-name').textContent = '尚未选择任务数据'; $('generator-notice').textContent = '先选择任务数据，再确认预算。';
    epochs.before++; epochs.after++; clearSide('before'); clearSide('after');
    $('before-file').value = ''; $('after-file').value = ''; invalidate(); buttons(); notice('本页已清空，电脑上的原文件不受影响。');
  }
  async function demo() {
    const beforeEpoch = ++epochs.before, afterEpoch = ++epochs.after;
    clearSide('before'); clearSide('after'); invalidate(); buttons();
    $('before-file').value = ''; $('after-file').value = '';
    notice('正在读取虚构示例…');
    try {
      const response = await fetch('report-comparison-example.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('无法读取示例');
      const fixture = await response.json();
      const values = await Promise.all(['before', 'after'].map(side => decode(new TextEncoder().encode(JSON.stringify(fixture[side])), `示例-${side}.json`)));
      if (epochs.before !== beforeEpoch || epochs.after !== afterEpoch) return;
      accept('before', values[0]); accept('after', values[1]); buttons(); compare();
    } catch (error) { if (epochs.before === beforeEpoch && epochs.after === afterEpoch) notice(`示例未加载：${error.message}`, true); }
  }
  async function initialize() {
    const epoch = ++initEpoch;
    engine = null; reportBuilder = null; invalidateGenerated(); buttons(); $('demo').disabled = true; $('before-file').disabled = true; $('after-file').disabled = true; $('dataset-file').disabled = true; $('report-budget').disabled = true; $('retry').hidden = true;
    try {
      const [ruleResponse, identityResponse] = await Promise.all([fetch('evaluation.js', { cache: 'no-store' }), fetch('/api/local-info', { cache: 'no-store' })]);
      if (!ruleResponse.ok || !identityResponse.ok) throw new Error('请通过 npm start 启动的本机地址打开本页');
      const [ruleBytes, identity] = await Promise.all([ruleResponse.arrayBuffer(), identityResponse.json()]);
      if (identity.app !== 'agent-context-lab' || typeof identity.version !== 'string') throw new Error('本机服务身份不符');
      const ruleHash = await digest(ruleBytes);
      if (epoch !== initEpoch) return;
      engine = AgentReportComparison.createComparator({ evaluation: AgentEvaluation, ruleHash, softwareVersion: identity.version });
      reportBuilder = AgentRecordEvaluation.createReportBuilder({ evaluation: AgentEvaluation, ruleHash, softwareVersion: identity.version });
      $('dataset-file').disabled = false; $('report-budget').disabled = false; generatorButtons();
      $('demo').disabled = false; $('before-file').disabled = false; $('after-file').disabled = false; buttons();
      notice('先选两份评估报告，或点击“用示例体验”。文件只在本页处理。');
    } catch (error) { if (epoch === initEpoch) { $('retry').hidden = false; notice(`准备未完成：${error.message}。请启动本机服务后重试。`, true); } }
  }
  $('before-file').addEventListener('change', () => importFile('before')); $('after-file').addEventListener('change', () => importFile('after'));
  $('dataset-file').addEventListener('change', importDataset); $('generate').addEventListener('click', generate);
  $('report-budget').addEventListener('input', () => { invalidateGenerated(); $('generator-notice').textContent = '预算已修改，请重新生成报告；对照区的副本保持原样。'; });
  $('use-before').addEventListener('click', () => useGenerated('before')); $('use-after').addEventListener('click', () => useGenerated('after'));
  $('download-generated').addEventListener('click', () => { if (generated) downloadJson(generated.json, generated.name); });
  $('compare').addEventListener('click', compare); $('reset').addEventListener('click', reset); $('demo').addEventListener('click', demo); $('retry').addEventListener('click', initialize);
  $('filter').addEventListener('change', () => { visible = 40; renderChanges(); }); $('search').addEventListener('input', () => { visible = 40; renderChanges(); }); $('more').addEventListener('click', () => { visible += 40; renderChanges(); });
  $('download').addEventListener('click', () => {
    if (!result) return;
    downloadJson(JSON.stringify(result, null, 2) + '\n', 'report-comparison.json');
  });
  initialize();
})();
