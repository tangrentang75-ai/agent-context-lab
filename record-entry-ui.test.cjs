'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const D = require('./record-entry-draft.js');
const html = fs.readFileSync(require.resolve('./record-entry.html'), 'utf8');
const encode = text => new TextEncoder().encode(text);
const file = state => rawFile(D.serialize(state).json);
function rawFile(text) {
  const bytes = typeof text === 'string' ? encode(text) : Uint8Array.from(text);
  return { size: bytes.byteLength, arrayBuffer: async () => bytes.buffer };
}
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function savedState(title = '恢复的任务', id = 'task-restored') {
  const task = { id, title, description: '核对已有输出和日志', scenario: 'coding' };
  const goals = [{ id: 'g3', label: '输出符合目标', weight: 3, required: true }, { id: 'g7', label: '日志完整', weight: 2, required: false }];
  return { draft: { ...task, goals, runs: [{ id: id + '-run-4', strategy: '已执行策略', model: '日志中的模型', comparisonGroup: '固定条件', tokens: '', durationSec: '0',
    checks: { g3: { status: 'pass', evidence: '保留的原输出片段' }, g7: { status: 'fail', evidence: '保留的不完整日志' } }, open: true }] },
    locked: true, lockedTask: { ...task }, lockedGoals: structuredClone(goals), budget: '1234', goalSequence: 7, runSequence: 4 };
}

// Minimal tree and events needed by the real UI; core validation and downloads remain real.
function harness() {
  const elements = new Map(), downloads = [], windowListeners = {}, effects = [];
  let failGoalRender = false;
  class Element {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.listeners = {}; this.value = ''; this.hidden = false; this.disabled = false; this._text = ''; this.className = ''; this.parentNode = null; this.attributes = new Map(); this.classList = { toggle: (name, force) => { const names = new Set(this.className.split(/\s+/).filter(Boolean)); if (force ?? !names.has(name)) names.add(name); else names.delete(name); this.className = [...names].join(' '); } }; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this._text = String(value); this.children = []; }
    set innerHTML(_) { throw Error('Imported drafts must be rendered as text'); }
    append(...nodes) { for (const child of nodes) child.parentNode = this; this.children.push(...nodes); }
    replaceChildren(...nodes) { if (this.id === 'goals' && failGoalRender) { failGoalRender = false; throw Error('One simulated render failure'); } this._text = ''; this.children = []; this.append(...nodes); }
    get lastElementChild() { return this.children.at(-1); }
    querySelectorAll(selector) { const found = []; for (const child of this.children) { if (selector.startsWith('.') ? child.className.split(/\s+/).includes(selector.slice(1)) : child.tagName === selector.toUpperCase()) found.push(child); found.push(...child.querySelectorAll(selector)); } return found; }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    removeAttribute(name) { this.attributes.delete(name); }
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
    async emit(type) { const event = { target: this, preventDefault() {} }; for (const listener of this.listeners[type] || []) await listener(event); }
    click() { return this.disabled ? Promise.resolve() : this.emit('click'); }
    focus() { context.document.activeElement = this; }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); }
  }
  for (const match of html.matchAll(/<([a-z][\w-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)) {
    const node = new Element(match[1]); node.id = match[3]; node.hidden = /\bhidden\b/.test(match[2]); node.disabled = /\bdisabled\b/.test(match[2]); node.value = match[2].match(/\bvalue="([^"]*)"/)?.[1] || ''; elements.set(node.id, node);
  }
  const get = id => { assert.ok(elements.has(id), 'Missing page element: ' + id); return elements.get(id); };
  get('task-scenario').value = 'coding';
  const forbidden = name => () => { effects.push(name); throw Error('Unexpected side effect: ' + name); };
  const context = { AgentEvaluation: require('./evaluation.js'), AgentRecordEntry: require('./record-entry-core.js'), AgentRecordEntryDraft: D,
    structuredClone, TextEncoder, Uint8Array, Blob, crypto: { randomUUID: () => 'new-session' },
    URL: { createObjectURL(blob) { downloads.push(blob); return 'blob:test-draft'; }, revokeObjectURL() {} }, setTimeout: () => 0,
    document: { getElementById: get, createElement: tag => new Element(tag), createTextNode: text => { const node = new Element('#text'); node.textContent = text; return node; }, body: new Element('body') },
    addEventListener(type, listener) { (windowListeners[type] ||= []).push(listener); }, confirm: () => true,
    fetch: forbidden('network request'), localStorage: { setItem: forbidden('storage write'), getItem: forbidden('storage read') }
  };
  context.window = context;
  vm.createContext(context); vm.runInContext(fs.readFileSync(require.resolve('./record-entry.js'), 'utf8'), context);
  return { get, downloads, effects,
    get activeElement() { return context.document.activeElement; },
    async input(node, value) { node.value = value; await node.emit('input'); },
    goal(index = 0) { return get('goals').children[index].querySelector('input'); },
    select(selected) { get('draft-file').files = selected ? [selected] : []; get('draft-file').value = selected ? 'selected' : ''; return get('draft-file').emit('change'); },
    beforeUnload() { const event = { prevented: false, preventDefault() { this.prevented = true; } }; for (const listener of windowListeners.beforeunload || []) listener(event); return event.prevented; },
    failNextGoalRender() { failGoalRender = true; },
    async state() { const count = downloads.length; await get('save-draft').click(); assert.equal(downloads.length, count + 1, get('draft-notice').textContent); return D.parseBytes(new Uint8Array(await downloads.at(-1).arrayBuffer())); }
  };
}
async function fillCurrent(h) {
  await h.input(h.get('task-title'), '当前任务'); await h.input(h.get('task-description'), '当前输入范围'); await h.input(h.goal(), '当前目标');
  await h.get('lock-goals').click();
  const run = h.get('runs').children[0], fields = run.querySelectorAll('input');
  await h.input(fields[0], '当前策略'); await h.input(fields[1], '当前模型'); await h.input(fields[2], '当前条件');
  await h.input(run.querySelector('textarea'), '当前尚待复核的证据');
}
function assertNoPreview(h) { assert.equal(h.get('draft-preview').hidden, true); assert.equal(h.get('confirm-draft').disabled, true); assert.equal(h.get('draft-summary').textContent, ''); }

test('读取仅预览，取消恢复保留当前表单、原证据和离页提醒状态', async () => {
  for (const edited of [false, true]) {
    const h = harness(); if (edited) await fillCurrent(h);
    const before = await h.state(), dirtyBefore = h.beforeUnload();
    await h.select(file(savedState('<img src=x onerror=alert(1)>')));
    assert.equal(h.get('draft-preview').hidden, false);
    assert.equal(h.get('confirm-draft').disabled, false);
    assert.match(h.get('draft-summary').textContent, /<img src=x onerror=alert\(1\)>/);
    assert.deepEqual(await h.state(), before);
    assert.equal(h.beforeUnload(), dirtyBefore);
    await h.get('cancel-draft').click(); assertNoPreview(h);
    assert.equal(h.get('draft-file').value, '');
    assert.deepEqual(await h.state(), before);
    assert.equal(h.beforeUnload(), dirtyBefore);
    assert.deepEqual(h.effects, []);
  }
});

test('明确确认才恢复并标记未保存，追加记录沿用恢复的任务 ID 与序号', async () => {
  const h = harness(), incoming = savedState(); assert.equal(h.beforeUnload(), false);
  await h.select(file(incoming)); await h.get('confirm-draft').click();
  assertNoPreview(h); assert.equal(h.beforeUnload(), true);
  assert.deepEqual(await h.state(), incoming);
  assert.equal(h.get('task-title').value, incoming.draft.title);
  assert.equal(h.get('entry-budget').value, '1234'); assert.equal(h.get('add-run').disabled, false);
  await h.get('add-run').click();
  const current = await h.state();
  assert.equal(current.draft.runs.length, 2);
  assert.equal(current.draft.runs[1].id, 'task-restored-run-5'); assert.equal(current.runSequence, 5);
  assert.deepEqual(current.draft.runs[0], incoming.draft.runs[0]);
});

test('读取中编辑表单会作废旧读取，迟到成功与读取错误都不弹出恢复预览', async () => {
  for (const outcome of ['success', 'failure']) {
    const h = harness(), slow = deferred(), pending = h.select({ size: 100, arrayBuffer: () => slow.promise });
    await h.input(h.get('task-title'), '读取期间的新输入');
    const notice = h.get('draft-notice').textContent;
    if (outcome === 'failure') slow.reject(Error('旧读取失败')); else slow.resolve(encode(D.serialize(savedState()).json).buffer);
    await pending; assertNoPreview(h);
    assert.equal(h.get('draft-notice').textContent, notice);
    assert.equal(h.get('task-title').value, '读取期间的新输入');
    assert.equal((await h.state()).draft.title, '读取期间的新输入');
    assert.equal(h.get('draft-preview').hidden, true);
    assert.doesNotMatch(notice, /已恢复草稿/);
  }
});

test('后选择的文件先完成时，旧成功、旧坏 JSON 和旧读取错误不能替换新预览', async () => {
  for (const outcome of ['success', 'parse', 'failure']) {
    const h = harness(), slow = deferred(), pending = h.select({ size: 100, arrayBuffer: () => slow.promise });
    const newest = savedState('后选择的草稿', 'task-newest'); await h.select(file(newest));
    const summary = h.get('draft-summary').textContent, notice = h.get('draft-notice').textContent;
    if (outcome === 'failure') slow.reject(Error('旧读取失败'));
    else slow.resolve(encode(outcome === 'parse' ? '{' : D.serialize(savedState('旧草稿')).json).buffer);
    await pending;
    assert.equal(h.get('draft-summary').textContent, summary); assert.equal(h.get('draft-notice').textContent, notice);
    await h.get('confirm-draft').click(); assert.deepEqual(await h.state(), newest);
  }
});

test('预览后修改任务、目标或预算会取消快照，旧确认操作不能覆盖新输入', async () => {
  for (const field of ['task', 'goal', 'budget']) {
    const h = harness(); await h.select(file(savedState()));
    const control = field === 'task' ? h.get('task-title') : field === 'goal' ? h.goal() : h.get('entry-budget');
    await h.input(control, field === 'budget' ? '9' : '预览后的修改');
    assertNoPreview(h); assert.match(h.get('draft-notice').textContent, /原恢复预览已取消/);
    const before = await h.state();
    await h.get('confirm-draft').emit('click');
    assert.deepEqual(await h.state(), before);
  }
});

test('损坏与超限草稿取消旧预览并保留当前表单；超限文件不读取', async () => {
  let oversizedReads = 0;
  const badFiles = [rawFile('{'), rawFile([0xff]), rawFile(JSON.stringify({ version: 1, demo: false, tasks: [{}] })),
    { size: 100, arrayBuffer: async () => { throw Error('文件无法读取'); } },
    { size: D.MAX_BYTES + 1, arrayBuffer: async () => { oversizedReads++; return new ArrayBuffer(0); } }];
  for (const bad of badFiles) {
    const h = harness(); await fillCurrent(h); const before = await h.state();
    await h.select(file(savedState())); await h.select(bad);
    assertNoPreview(h); assert.match(h.get('draft-notice').textContent, /无法恢复草稿.*当前表单保留/);
    assert.deepEqual(await h.state(), before);
  }
  assert.equal(oversizedReads, 0);
});

test('恢复待锁定的任务或目标改动，重新锁定仍会复位相关状态且保留旧证据', async () => {
  for (const change of ['goal', 'task']) {
    const h = harness(), incoming = savedState(); incoming.locked = false;
    if (change === 'goal') incoming.draft.goals[0].label = '修改后的验收目标'; else incoming.draft.description = '修改后的输入范围';
    await h.select(file(incoming)); await h.get('confirm-draft').click();
    const restored = await h.state(); assert.equal(restored.locked, false); assert.equal(restored.draft.runs[0].checks.g3.status, 'pass');
    assert.equal(h.get('add-run').disabled, true);
    await h.get('lock-goals').click(); const relocked = await h.state();
    assert.equal(relocked.locked, true); assert.equal(relocked.draft.runs[0].checks.g3.status, 'unknown');
    assert.equal(relocked.draft.runs[0].checks.g7.status, change === 'task' ? 'unknown' : 'fail');
    for (const goal of incoming.draft.goals) assert.equal(relocked.draft.runs[0].checks[goal.id].evidence, incoming.draft.runs[0].checks[goal.id].evidence);
    assert.equal(relocked.draft.runs[0].needsReview, true);
    assert.match(h.get('goal-notice').textContent, /原证据文字保留/);
  }
});

test('应用草稿时的一次渲染故障回滚全部数据、预算、序号和原离页提醒状态', async () => {
  for (const edited of [false, true]) {
    const h = harness(); if (edited) await fillCurrent(h);
    const before = await h.state(), dirtyBefore = h.beforeUnload();
    await h.select(file(savedState())); h.failNextGoalRender(); await h.get('confirm-draft').click();
    assertNoPreview(h); assert.match(h.get('draft-notice').textContent, /恢复未完成，原表单已保留/);
    assert.deepEqual(await h.state(), before); assert.equal(h.beforeUnload(), dirtyBefore);
    assert.equal(h.get('task-title').value, before.draft.title); assert.equal(h.get('entry-budget').value, before.budget);
    assert.equal(h.get('runs').children.length, before.draft.runs.length);
    assert.deepEqual(h.effects, []);
  }
});

test('恢复接近安全整数上限的序号后，拒绝新增且仍能保存完整草稿', async () => {
  const h = harness(), incoming = savedState();
  incoming.goalSequence = incoming.runSequence = Number.MAX_SAFE_INTEGER - 1;
  await h.select(file(incoming)); await h.get('confirm-draft').click();
  const before = await h.state();
  await h.get('add-run').click(); assert.match(h.get('entry-notice').textContent, /记录编号已达上限/);
  assert.deepEqual(await h.state(), before);
  await h.get('edit-goals').click(); const editing = await h.state();
  await h.get('add-goal').click(); assert.match(h.get('entry-notice').textContent, /目标编号已达上限/);
  assert.deepEqual(await h.state(), editing);
  assert.deepEqual(editing.draft.runs, before.draft.runs);
});

function feedback(input) { return input.parentNode.parentNode.querySelector('.field-feedback'); }
function assertFieldError(h, input, box) {
  assert.equal(h.activeElement, input);
  assert.equal(input.getAttribute('aria-invalid'), 'true');
  assert.equal(box.hidden, false);
  assert.ok(input.getAttribute('aria-describedby').split(' ').includes(box.querySelector('p').id));
  assert.match(box.querySelector('p').textContent, /^请修改：/);
}

test('锁定时定位任务及目标缺项，附近继续校验逐项修正且输入不抢焦点', async () => {
  const h = harness(), title = h.get('task-title'), description = h.get('task-description');
  const titleBox = h.get('task-title-field').querySelector('.field-feedback');
  await h.get('lock-goals').click(); assertFieldError(h, title, titleBox);
  assert.equal(h.beforeUnload(), false, 'validation alone does not mark untouched data dirty');
  await h.input(title, '手动验收任务');
  assert.equal(h.activeElement, title); assert.equal(title.getAttribute('aria-invalid'), null);
  assert.equal(title.getAttribute('aria-describedby'), null);
  assert.equal(titleBox.hidden, false); assert.match(titleBox.textContent, /内容已修改，请继续校验/);
  assert.equal(h.get('goal-notice').textContent, '内容已修改，请重新锁定任务与目标。');
  await titleBox.querySelector('button').click();
  const descriptionBox = h.get('task-description-field').querySelector('.field-feedback');
  assertFieldError(h, description, descriptionBox); assert.equal(titleBox.hidden, true);
  await h.input(description, '既有输入和验收范围'); await descriptionBox.querySelector('button').click();
  const goal = h.goal(), goalBox = feedback(goal), hint = goal.getAttribute('aria-describedby').split(' ')[0];
  assertFieldError(h, goal, goalBox);
  await h.input(goal, '实际结果符合要求');
  assert.equal(goal.getAttribute('aria-describedby'), hint, 'keep the original hint after clearing the error');
  assert.equal(h.activeElement, goal);
  await goalBox.querySelector('button').click();
  assert.equal(h.get('lock-goals').hidden, true); assert.equal(h.get('runs').children.length, 1);
  assert.equal(goal.getAttribute('aria-invalid'), null); assert.equal(goalBox.hidden, true);
  assert.equal(h.downloads.length, 0); assert.deepEqual(h.effects, []);
});

test('后续折叠记录的特殊 ID 证据准确定位，原状态及证据保留，修正后能继续校验', async () => {
  const h = harness(), state = savedState(), ids = ['g[0]." / <img>', '__proto__'];
  state.draft.goals.forEach((goal, index) => { goal.id = ids[index]; });
  state.lockedGoals = structuredClone(state.draft.goals);
  state.draft.runs[0].checks = Object.fromEntries(ids.map(id => [id, { status: 'pass', evidence: '原始证据 ' + id }]));
  state.draft.runs[0].open = false;
  const second = structuredClone(state.draft.runs[0]); second.id = 'task-restored-run-5';
  second.checks[ids[1]].evidence = ''; state.draft.runs.push(second); state.runSequence = 5;
  await h.select(file(state)); await h.get('confirm-draft').click();
  const firstView = h.get('runs').children[0], secondView = h.get('runs').children[1];
  const evidence = secondView.querySelectorAll('textarea')[1], box = feedback(evidence);
  const hint = evidence.getAttribute('aria-describedby');
  await h.get('validate').click(); assertFieldError(h, evidence, box);
  assert.equal(firstView.open, false); assert.equal(secondView.open, true);
  assert.match(box.textContent, /记录 2.*日志完整.*必须填写证据/);
  assert.equal(secondView.querySelectorAll('textarea')[0].value, '原始证据 ' + ids[0]);
  const saved = await h.state();
  assert.equal(saved.draft.runs[1].checks[ids[1]].status, 'pass');
  assert.equal(saved.draft.runs[1].checks[ids[1]].evidence, '');
  assert.equal(saved.draft.runs[0].checks[ids[0]].evidence, '原始证据 ' + ids[0]);
  await h.input(evidence, '<script>仍按文字保留的实际证据</script>');
  assert.equal(h.activeElement, evidence); assert.equal(evidence.getAttribute('aria-invalid'), null);
  assert.equal(evidence.getAttribute('aria-describedby'), hint);
  const downloads = h.downloads.length; await box.querySelector('button').click();
  assert.equal(box.hidden, true); assert.equal(h.get('review').hidden, false);
  assert.equal(h.activeElement, h.get('review'));
  assert.equal(h.downloads.length, downloads); assert.deepEqual(h.effects, []);
});

test('空预算定位并保持原输入，0 可通过校验而不会当作未知', async () => {
  const h = harness(); await fillCurrent(h);
  const budget = h.get('entry-budget'), box = h.get('entry-budget-field').querySelector('.field-feedback');
  await h.input(budget, ''); await h.get('validate').click(); assertFieldError(h, budget, box);
  assert.equal(budget.value, ''); assert.match(box.textContent, /不能为空；0 是有效数值/);
  await h.input(budget, '0'); await box.querySelector('button').click();
  assert.equal(budget.value, '0'); assert.equal(budget.getAttribute('aria-invalid'), null);
  assert.equal(box.hidden, true); assert.equal(h.get('review').hidden, false);
  assert.match(h.get('review-summary').textContent, /每条记录预算 0 token/);
  assert.equal(h.downloads.length, 0);
});

test('导出失败不下载，附近继续校验不会自动导出，保留修正后的数字与证据', async () => {
  const h = harness(); await fillCurrent(h);
  const run = h.get('runs').children[0], tokens = run.querySelectorAll('input')[3], box = feedback(tokens);
  await h.input(tokens, '-1'); await h.get('entry-form').emit('submit');
  assertFieldError(h, tokens, box); assert.equal(h.downloads.length, 0); assert.equal(h.get('review').hidden, true);
  await h.input(tokens, '0'); await box.querySelector('button').click();
  assert.equal(h.get('review').hidden, false); assert.equal(h.downloads.length, 0);
  await h.get('entry-form').emit('submit'); assert.equal(h.downloads.length, 1);
  const exported = JSON.parse(await h.downloads[0].text());
  assert.equal(exported.tasks[0].runs[0].tokens, 0);
  assert.equal(exported.tasks[0].runs[0].checks.g1.evidence, '当前尚待复核的证据');
  assert.equal(h.beforeUnload(), true); assert.equal(tokens.getAttribute('aria-invalid'), null);
});

test('恢复预览和取消保留当前错误，确认替换才清除静态和动态旧错误', async () => {
  for (const kind of ['task', 'run']) {
    const h = harness(); let input, box;
    if (kind === 'task') {
      await h.get('lock-goals').click(); input = h.get('task-title'); box = h.get('task-title-field').querySelector('.field-feedback');
    } else {
      await fillCurrent(h); input = h.get('runs').children[0].querySelectorAll('input')[1];
      await h.input(input, ''); await h.get('validate').click(); box = feedback(input);
    }
    assertFieldError(h, input, box);
    const message = box.textContent;
    await h.select(file(savedState())); assert.equal(input.getAttribute('aria-invalid'), 'true'); assert.equal(box.textContent, message);
    await h.get('cancel-draft').click(); assert.equal(box.hidden, false); assert.equal(box.textContent, message);
    await h.select(file(savedState())); await h.get('confirm-draft').click();
    assert.equal(input.getAttribute('aria-invalid'), null); assert.equal(box.hidden, true); assert.equal(box.querySelector('p').textContent, '');
    await h.get('validate').click(); assert.equal(h.get('review').hidden, false);
  }
});

test('删除前一条记录后，重新校验定位新索引的现有节点而非已移除节点', async () => {
  const h = harness(), state = savedState(), second = structuredClone(state.draft.runs[0]);
  second.id = 'task-restored-run-5'; second.model = ''; state.draft.runs.push(second); state.runSequence = 5;
  await h.select(file(state)); await h.get('confirm-draft').click(); await h.get('validate').click();
  const oldInput = h.get('runs').children[1].querySelectorAll('input')[1], oldBox = feedback(oldInput);
  assertFieldError(h, oldInput, oldBox); assert.match(oldBox.textContent, /记录 2/);
  await h.get('runs').children[0].querySelector('.run-actions').querySelector('button').click();
  assert.equal(oldInput.getAttribute('aria-invalid'), null); assert.equal(oldBox.hidden, true);
  assert.equal(h.get('runs').children.length, 1);
  const newInput = h.get('runs').children[0].querySelectorAll('input')[1];
  assert.notEqual(newInput, oldInput); await h.get('validate').click();
  assertFieldError(h, newInput, feedback(newInput)); assert.match(feedback(newInput).textContent, /记录 1/);
  const saved = await h.state(); assert.equal(saved.draft.runs[0].id, second.id);
  assert.deepEqual(saved.draft.runs[0].checks, second.checks);
});
