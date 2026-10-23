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
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.listeners = {}; this.value = ''; this.hidden = false; this.disabled = false; this._text = ''; this.className = ''; this.parentNode = null; this.classList = { toggle() {} }; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this._text = String(value); this.children = []; }
    set innerHTML(_) { throw Error('Imported drafts must be rendered as text'); }
    append(...nodes) { for (const child of nodes) child.parentNode = this; this.children.push(...nodes); }
    replaceChildren(...nodes) { if (this.id === 'goals' && failGoalRender) { failGoalRender = false; throw Error('One simulated render failure'); } this._text = ''; this.children = []; this.append(...nodes); }
    get lastElementChild() { return this.children.at(-1); }
    querySelectorAll(selector) { const found = []; for (const child of this.children) { if (selector.startsWith('.') ? child.className.split(/\s+/).includes(selector.slice(1)) : child.tagName === selector.toUpperCase()) found.push(child); found.push(...child.querySelectorAll(selector)); } return found; }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
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
