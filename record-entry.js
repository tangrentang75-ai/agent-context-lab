(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const E = window.AgentEvaluation;
  const B = window.AgentRecordEntry.createEntryBuilder({ evaluation: E });
  const D = window.AgentRecordEntryDraft;
  const taskId = `task-${typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')}`;
  const draft = { id: taskId, title: '', description: '', scenario: 'coding', goals: [{ id: 'g1', label: '', weight: 3, required: true }], runs: [] };
  let goalSequence = 1, runSequence = 0, locked = false, dirty = false, lockedGoals = [], lockedTask = null;
  let restoreEpoch = 0, pendingDraft = null, restoreReading = false;
  const runViews = new Map();
  const fieldViews = new Map();
  let fieldSequence = 0, activeError = null, validationAction = 'validate';
  function node(tag, className, content) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (content !== undefined) element.textContent = content;
    return element;
  }
  function say(message, error = false) {
    $('entry-notice').textContent = message;
    $('entry-notice').classList.toggle('error', error);
  }
  function clearFieldError(edited = false) {
    if (!activeError) return;
    const view = activeError;
    view.input.removeAttribute('aria-invalid');
    if (view.description) view.input.setAttribute('aria-describedby', view.description);
    else view.input.removeAttribute('aria-describedby');
    view.feedback.hidden = !edited;
    view.feedback.classList.toggle('error', false);
    view.message.textContent = edited ? '内容已修改，请继续校验。' : '';
    activeError = edited ? view : null;
  }
  function registerField(input, path, container, details = null) {
    if (!input.id) input.id = `entry-field-${++fieldSequence}`;
    const feedback = node('div', 'field-feedback'); feedback.hidden = true;
    const message = node('p'); message.id = `${input.id}-error`;
    const retry = node('button', 'retry-validation', '修改后，继续校验'); retry.type = 'button';
    retry.addEventListener('click', () => $(validationAction).click());
    feedback.append(message, retry); container.append(feedback);
    fieldViews.set(JSON.stringify(path), { input, feedback, message, details, description: input.getAttribute('aria-describedby') || '' });
  }
  function clearFieldGroup(group) {
    clearFieldError();
    for (const key of fieldViews.keys()) if (JSON.parse(key)[0] === group) fieldViews.delete(key);
  }
  function showValidationError(error, action = 'validate') {
    clearFieldError(); validationAction = action;
    $('review').hidden = true;
    say(error.message, true);
    const view = Array.isArray(error.fieldPath) ? fieldViews.get(JSON.stringify(error.fieldPath)) : null;
    if (!view || view.input.disabled || (view.details && !locked)) return;
    view.message.textContent = `请修改：${error.message}`;
    view.feedback.hidden = false; view.feedback.classList.toggle('error', true); view.input.setAttribute('aria-invalid', 'true');
    view.input.setAttribute('aria-describedby', [view.description, view.message.id].filter(Boolean).join(' '));
    if (view.details) view.details.open = true;
    activeError = view; view.input.focus();
  }
  function changed() {
    if (activeError && validationAction === 'lock-goals') $('goal-notice').textContent = '内容已修改，请重新锁定任务与目标。';
    clearFieldError(true);
    invalidateRestore();
    dirty = true;
    $('review').hidden = true;
    say('内容已修改。下载前会重新校验；刷新或关闭前请保存任务数据。');
  }
  function draftNotice(message, error = false) {
    $('draft-notice').textContent = message;
    $('draft-notice').classList.toggle('error', error);
  }
  function invalidateRestore() {
    restoreEpoch++;
    const hadPreview = restoreReading || pendingDraft !== null || !$('draft-preview').hidden;
    restoreReading = false; pendingDraft = null; $('draft-preview').hidden = true; $('confirm-draft').disabled = true;
    $('draft-summary').textContent = '';
    if (hadPreview) draftNotice('当前表单已变化，原恢复预览已取消。需要恢复时，请重新选择草稿。');
  }
  function snapshot() {
    return structuredClone({ draft, locked, lockedTask, lockedGoals, budget: $('entry-budget').value, goalSequence, runSequence });
  }
  function applySnapshot(state) {
    clearFieldError();
    Object.assign(draft, state.draft);
    locked = state.locked; lockedTask = state.lockedTask; lockedGoals = state.lockedGoals;
    goalSequence = state.goalSequence; runSequence = state.runSequence;
    $('task-title').value = draft.title; $('task-description').value = draft.description; $('task-scenario').value = draft.scenario;
    $('entry-budget').value = state.budget; currentBudget = state.budget;
    renderGoals(); renderRuns(); syncControls(); $('review').hidden = true;
  }
  function downloadJson(json, prefix) {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8' }));
    const anchor = node('a'); anchor.href = url;
    anchor.download = `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function bind(input, object, key, after) {
    const update = () => {
      const value = input.type === 'checkbox' ? input.checked : input.value;
      if (String(object[key]) === String(value)) return;
      object[key] = value;
      changed();
      if (after) after();
    };
    input.addEventListener('input', update);
    input.addEventListener('change', update);
  }
  function textInput(value, max, placeholder) {
    const input = node('input'); input.type = 'text'; input.maxLength = max;
    input.value = value ?? ''; if (placeholder) input.placeholder = placeholder;
    return input;
  }
  function field(labelText, input, hint, path, details) {
    const wrapper = node('div', 'entry-field');
    const label = node('label', '', labelText);
    if (!input.id) input.id = `entry-field-${++fieldSequence}`;
    if (hint) {
      const help = node('span', '', hint); help.id = `${input.id}-hint`;
      label.append(help); input.setAttribute('aria-describedby', help.id);
    }
    label.append(input);
    wrapper.append(label);
    if (path) registerField(input, path, wrapper, details);
    return wrapper;
  }
  function select(options, value) {
    const input = node('select');
    options.forEach(([id, label]) => { const option = node('option', '', label); option.value = id; input.append(option); });
    input.value = value;
    return input;
  }
  function syncControls() {
    $('goal-count').textContent = `${draft.goals.length} / 20 项目标`;
    $('run-count').textContent = `${draft.runs.length} / 30 条记录`;
    $('add-goal').disabled = locked || draft.goals.length >= 20;
    $('lock-goals').hidden = locked;
    $('edit-goals').hidden = !locked;
    ['task-title', 'task-description', 'task-scenario'].forEach(id => { $(id).disabled = locked; });
    $('add-run').disabled = !locked || draft.runs.length >= 30;
    $('validate').disabled = $('download').disabled = !locked || !draft.runs.length;
    $('runs-empty').hidden = draft.runs.length > 0;
  }
  function renderGoals() {
    clearFieldGroup('goals');
    $('goals').replaceChildren();
    draft.goals.forEach((goal, index) => {
      const row = node('div', 'goal');
      const labelInput = textInput(goal.label, 300, '例如：现有测试全部通过');
      labelInput.required = true; labelInput.disabled = locked;
      const goalField = field(`目标 ${index + 1}`, labelInput, '最多 300 字符', ['goals', index, 'label']); goalField.className = 'goal-title';
      const weight = select([1, 2, 3, 4, 5].map(n => [String(n), String(n)]), goal.weight); weight.disabled = locked;
      const required = node('input'); required.type = 'checkbox'; required.checked = goal.required; required.disabled = locked;
      const requiredLabel = node('label', 'required'); requiredLabel.append(required, document.createTextNode('必需项'));
      const requiredField = node('div', 'entry-field'); requiredField.append(requiredLabel);
      registerField(required, ['goals', index, 'required'], requiredField);
      const remove = node('button', 'remove', '删除目标'); remove.type = 'button';
      remove.disabled = locked || draft.goals.length === 1 || draft.runs.length > 0;
      remove.title = draft.runs.length ? '已有记录时保留所有目标，避免丢失验收证据' : '至少保留一项目标';
      remove.addEventListener('click', () => {
        if (goal.label.trim() && !window.confirm('删除这项目标？该操作只影响尚未录入记录的目标列表。')) return;
        draft.goals = draft.goals.filter(item => item.id !== goal.id); changed(); renderGoals(); syncControls();
      });
      bind(labelInput, goal, 'label'); bind(weight, goal, 'weight'); bind(required, goal, 'required');
      row.append(goalField, field('权重', weight, null, ['goals', index, 'weight']), requiredField, remove); $('goals').append(row);
    });
  }
  function updateSummary(run) {
    const view = runViews.get(run.id); if (!view) return;
    const index = draft.runs.indexOf(run) + 1;
    view.title.textContent = `记录 ${index} · ${run.strategy.trim() || '策略未填写'} · ${run.model.trim() || '模型未填写'}`;
    const known = Object.values(run.checks).filter(check => check.status !== 'unknown').length;
    const passed = Object.values(run.checks).filter(check => check.status === 'pass').length;
    view.metrics.textContent = `条件组：${run.comparisonGroup.trim() || '未填写'}  ·  token：${String(run.tokens).trim() || '未知'}  ·  耗时：${String(run.durationSec).trim() ? `${run.durationSec} 秒` : '未知'}  ·  已选择判定 ${known}/${draft.goals.length}，选为通过 ${passed}（填写草稿）`;
  }
  function renderRuns() {
    clearFieldGroup('runs');
    runViews.clear(); $('runs').replaceChildren();
    draft.runs.forEach((run, runIndex) => {
      const details = node('details', 'run'); details.open = run.open !== false;
      details.addEventListener('toggle', () => { run.open = details.open; });
      const summary = node('summary'); const title = node('span', 'run-label'); const metrics = node('span', 'run-metrics');
      summary.append(title, metrics); details.append(summary);
      runViews.set(run.id, { title, metrics, details });
      const body = node('div', 'run-body');
      if (!locked) body.append(node('p', 'review-warning', '正在修改任务与目标。记录内容已保留，重新锁定后可继续填写；任务信息改动会复位全部验收状态，目标改动会复位对应状态，证据文字保留。'));
      if (run.needsReview) body.append(node('p', 'review-warning', '此记录的任务或目标定义曾调整，旧证据已保留；下方显示当前填写的状态。'));
      const fields = node('fieldset', 'run-fields'); fields.disabled = !locked;
      const meta = node('div', 'run-meta');
      [['strategy', '策略名称', '填写实际使用的策略'], ['model', '模型与版本', '例如：实际执行日志中的模型标识'], ['comparisonGroup', '条件组', '相同输入、模型、工具与环境使用同一标识']].forEach(([key, label, placeholder]) => {
        const input = textInput(run[key], 300, placeholder); input.required = true;
        bind(input, run, key, () => updateSummary(run));
        const labelNode = field(label, input, '必填，最多 300 字符', ['runs', runIndex, key], details); if (key === 'comparisonGroup') labelNode.className = 'run-group'; meta.append(labelNode);
      });
      [['tokens', '总 token 用量', '未知留空；实际为 0 时填 0'], ['durationSec', '总耗时（秒）', '未知留空；可填写小数']].forEach(([key, label, hint]) => {
        const input = textInput(run[key], 100, '未知'); input.inputMode = 'decimal';
        bind(input, run, key, () => updateSummary(run)); meta.append(field(label, input, hint, ['runs', runIndex, key], details));
      });
      fields.append(meta);
      const checks = node('div', 'checks');
      draft.goals.forEach((goal, index) => {
        // A newly added goal can be pending while its original checks are kept.
        const check = run.checks[goal.id] ?? { status: 'unknown', evidence: '' };
        const row = node('div', 'check'); row.append(node('h3', '', `${index + 1}. ${goal.label} · ${goal.required ? '必需项' : '可选项'} · 权重 ${goal.weight}`));
        const status = select([['unknown', '待核验'], ['pass', '通过'], ['fail', '未通过']], check.status);
        const evidence = node('textarea'); evidence.rows = 3; evidence.maxLength = 6000; evidence.value = check.evidence; evidence.placeholder = '粘贴实际验收结果、日志摘录、输出片段或可查证的位置。';
        const statusLabel = field('当前状态', status, null, ['runs', runIndex, 'checks', goal.id, 'status'], details); statusLabel.className = 'status-label';
        bind(status, check, 'status', () => updateSummary(run)); bind(evidence, check, 'evidence');
        row.append(statusLabel, field('验收证据', evidence, '通过 / 未通过时必填；最多 6000 字符', ['runs', runIndex, 'checks', goal.id, 'evidence'], details)); checks.append(row);
      });
      fields.append(checks);
      const actions = node('div', 'run-actions'); const remove = node('button', 'remove', '删除这条记录'); remove.type = 'button';
      remove.addEventListener('click', () => {
        if (!window.confirm('删除这条执行记录及其全部证据？其他记录会保留。')) return;
        draft.runs = draft.runs.filter(item => item.id !== run.id); changed(); renderRuns(); renderGoals(); syncControls();
      });
      actions.append(remove); fields.append(actions); body.append(fields); details.append(body); $('runs').append(details); updateSummary(run);
    });
  }
  function addRun() {
    if (!locked || draft.runs.length >= 30) return;
    let id, nextSequence = runSequence;
    do {
      if (!Number.isSafeInteger(nextSequence + 1) || nextSequence + 1 >= Number.MAX_SAFE_INTEGER) { say('记录编号已达上限，未新增。请保存当前草稿。', true); return; }
      id = `${draft.id}-run-${++nextSequence}`;
    } while (draft.runs.some(run => run.id === id));
    runSequence = nextSequence;
    const run = { id, strategy: '', model: '', comparisonGroup: '', tokens: '', durationSec: '', checks: Object.fromEntries(draft.goals.map(goal => [goal.id, { status: 'unknown', evidence: '' }])), open: true };
    draft.runs.push(run); changed(); renderRuns(); renderGoals(); syncControls();
    runViews.get(run.id).details.querySelector('input').focus();
  }
  function validate() {
    clearFieldError();
    if (!locked) throw new Error('请先重新锁定任务与目标，复核相关状态后再导出');
    const budget = B.parseBudget($('entry-budget').value);
    const result = B.serializeDataset(draft);
    const task = result.dataset.tasks[0];
    $('review-rows').replaceChildren();
    task.runs.forEach((run, index) => {
      const evaluation = E.evaluate(task, run, budget);
      $('review-rows').append(node('p', 'review-row', `记录 ${index + 1} · ${run.strategy} / ${run.model} · ${evaluation.status} · 目标得分 ${evaluation.score}% · 已核验 ${evaluation.known}/${evaluation.total} · ${evaluation.eligible ? '满足候选条件' : '暂不满足候选条件'}`));
    });
    $('review-summary').textContent = `1 个任务 · ${task.goals.length} 项目标 · ${task.runs.length} 条记录 · ${(result.bytes / 1024).toFixed(1)}KiB / 2MiB · 每条记录预算 ${budget} token。状态依据你填写的证据，不代表独立核验。`;
    $('review').hidden = false;
    return result;
  }
  [['task-title', 'title'], ['task-description', 'description'], ['task-scenario', 'scenario'], ['entry-budget', 'budget']].forEach(([id, key]) => registerField($(id), [key], $(`${id}-field`)));
  bind($('task-title'), draft, 'title'); bind($('task-description'), draft, 'description'); bind($('task-scenario'), draft, 'scenario');
  let currentBudget = $('entry-budget').value;
  $('entry-budget').addEventListener('input', () => { if (currentBudget !== $('entry-budget').value) { currentBudget = $('entry-budget').value; changed(); } });
  $('add-goal').addEventListener('click', () => {
    if (locked || draft.goals.length >= 20) return;
    let id, nextSequence = goalSequence;
    do {
      if (!Number.isSafeInteger(nextSequence + 1) || nextSequence + 1 >= Number.MAX_SAFE_INTEGER) { say('目标编号已达上限，未新增。请保存当前草稿。', true); return; }
      id = `g${++nextSequence}`;
    } while (draft.goals.some(goal => goal.id === id));
    goalSequence = nextSequence;
    draft.goals.push({ id, label: '', weight: 3, required: true }); changed(); renderGoals(); syncControls();
    $('goals').lastElementChild.querySelector('input').focus();
  });
  $('lock-goals').addEventListener('click', () => {
    clearFieldError();
    invalidateRestore();
    try {
      const nextTask = B.normalizeTask(draft);
      const taskChanged = lockedTask !== null && JSON.stringify(nextTask) !== JSON.stringify(lockedTask);
      const nextGoals = B.normalizeGoals(draft.goals);
      const update = B.updateGoalChecks(lockedGoals, nextGoals, draft.runs, { resetAll: taskChanged });
      draft.goals = nextGoals; draft.runs = update.runs;
      if (update.resetCount) draft.runs.forEach(run => { run.needsReview = true; });
      lockedGoals = nextGoals.map(goal => ({ ...goal })); lockedTask = nextTask; locked = true;
      $('goal-notice').textContent = update.resetCount ? `${taskChanged ? '任务信息已更新' : '目标已更新'}：${update.resetCount} 个目标验收状态回到待核验，原证据文字保留，请重新复核。` : '任务与目标已锁定。已有记录时可修改或追加目标，不能删除目标；修改任务信息会复位全部状态，修改目标只复位对应状态，证据保留。';
      renderGoals(); renderRuns(); syncControls();
      if (!draft.runs.length) addRun();
      say(update.resetCount ? '任务或目标已调整，相关状态已回到待核验；请逐条复核保留的证据。' : '任务与目标已锁定，可以填写实际执行记录。');
    } catch (error) { $('goal-notice').textContent = error.message; showValidationError(error, 'lock-goals'); }
  });
  $('edit-goals').addEventListener('click', () => {
    invalidateRestore();
    locked = false; $('review').hidden = true;
    $('goal-notice').textContent = '修改后请重新锁定。任务信息改动会复位全部验收状态，目标改动只复位对应状态，原证据文字保留；已有记录时不允许删除目标。';
    renderGoals(); renderRuns(); syncControls(); $('goals').querySelector('input').focus();
  });
  $('add-run').addEventListener('click', addRun);
  $('validate').addEventListener('click', () => {
    try { validate(); say('数据格式校验通过。请查看下方复核结果；待核验和成本未知仍可保存，不会被当作通过。'); $('review').focus(); }
    catch (error) { showValidationError(error); }
  });
  $('entry-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const result = validate();
      downloadJson(result.json, 'agent-records');
      say('已发起任务数据下载，填写内容仍保留。请确认文件已保存；到首页或报告生成器后，再次选择刚下载的文件。');
    } catch (error) { showValidationError(error); }
  });
  $('save-draft').addEventListener('click', () => {
    try {
      const saved = D.serialize(snapshot()); downloadJson(saved.json, 'agent-entry-draft');
      draftNotice('已发起草稿下载，当前填写内容保留。请确认文件已保存；草稿不能直接导入任务工作台或报告生成器。');
    } catch (error) { draftNotice('未保存草稿：' + error.message, true); }
  });
  $('choose-draft').addEventListener('click', () => { invalidateRestore(); $('draft-file').value = ''; $('draft-file').click(); });
  $('draft-file').addEventListener('change', async event => {
    invalidateRestore(); const epoch = restoreEpoch, file = event.target.files?.[0];
    if (!file) { draftNotice('未选择草稿，当前表单保留。'); return; }
    restoreReading = true; draftNotice('正在本地读取草稿，尚未替换当前表单…');
    try {
      if (file.size > D.MAX_BYTES) throw new Error('草稿超过 16MiB，未读取。');
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (epoch !== restoreEpoch) return;
      const state = D.parseBytes(bytes);
      restoreReading = false; pendingDraft = { state, epoch };
      $('draft-summary').textContent = `任务：${state.draft.title.trim() || '尚未填写名称'}；${state.draft.goals.length} 项目标，${state.draft.runs.length} 条记录；${state.locked ? '任务与目标已锁定' : '任务与目标正在编辑'}。这只说明草稿结构可读取，不代表证据或验收通过。`;
      $('draft-preview').hidden = false; $('confirm-draft').disabled = false;
      draftNotice('草稿已读取。确认替换之前，当前表单保持原样。');
    } catch (error) {
      if (epoch !== restoreEpoch) return;
      invalidateRestore(); draftNotice('无法恢复草稿：' + error.message + ' 当前表单保留。', true);
    }
  });
  $('cancel-draft').addEventListener('click', () => { invalidateRestore(); $('draft-file').value = ''; draftNotice('已取消恢复，当前表单保留。'); });
  $('confirm-draft').addEventListener('click', () => {
    if (!pendingDraft || pendingDraft.epoch !== restoreEpoch) return;
    const incoming = pendingDraft.state, previous = snapshot(), previousDirty = dirty;
    invalidateRestore();
    try {
      applySnapshot(incoming); dirty = true;
      $('goal-notice').textContent = locked ? '已恢复锁定的任务与目标，可继续填写记录。' : '已恢复正在编辑的任务与目标。重新锁定时，改动仍会使对应判断回到待核验，证据保留。';
      say('录入草稿已恢复。内容仍在当前页面内存中，完成后请校验并下载任务数据。');
      draftNotice('已恢复草稿，任务编号和填写进度保留。草稿结构检查不替代任务数据校验或证据复核。');
    } catch (error) {
      applySnapshot(previous); dirty = previousDirty;
      draftNotice('恢复未完成，原表单已保留。请保存当前草稿后重新尝试。', true);
    }
  });
  window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  renderGoals(); syncControls();
})();
