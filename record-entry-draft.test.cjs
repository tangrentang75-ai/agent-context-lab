'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const D = require('./record-entry-draft.js');
const E = require('./evaluation.js');
const B = require('./record-entry-core.js').createEntryBuilder({ evaluation: E });
const encode = json => new TextEncoder().encode(json);
function emptyState() {
  return { draft: { id: 'task-draft-test', title: '', description: '', scenario: 'coding', goals: [{ id: 'g1', label: '', weight: 3, required: true }], runs: [] }, locked: false, lockedTask: null, lockedGoals: [], budget: '20000', goalSequence: 1, runSequence: 0 };
}
function lockedState() {
  const state = emptyState();
  Object.assign(state.draft, { title: '原任务', description: '原范围\n第二行' }); state.draft.goals[0].label = '文件可导入';
  state.locked = true; state.lockedTask = { id: state.draft.id, title: state.draft.title, description: state.draft.description, scenario: state.draft.scenario }; state.lockedGoals = structuredClone(state.draft.goals);
  state.runSequence = 1;
  state.draft.runs = [{ id: `${state.draft.id}-run-1`, strategy: '已有策略', model: '实际模型', comparisonGroup: '相同条件', tokens: '', durationSec: '', checks: { g1: { status: 'unknown', evidence: '' } }, open: true, needsReview: false }];
  return state;
}
function roundtrip(state) { return D.parseBytes(encode(D.serialize(state).json)); }
function fileFor(state, overrides = {}) {
  return JSON.stringify({ schema: 'acl-record-entry-draft-v1', savedAt: '2026-10-23T01:02:03.000Z', state, ...overrides });
}

test('未填写任务与零记录可主动保存；文件具有独立 schema 和 ISO 保存时间', () => {
  const state = emptyState(), saved = D.serialize(state), file = JSON.parse(saved.json);
  assert.deepEqual(saved.snapshot, state); assert.deepEqual(D.parseBytes(encode(saved.json)), state);
  assert.equal(file.schema, 'acl-record-entry-draft-v1'); assert.equal(new Date(file.savedAt).toISOString(), file.savedAt);
  assert.equal(saved.bytes, Buffer.byteLength(saved.json, 'utf8')); assert.equal(D.MAX_BYTES, 16 * 1024 * 1024);
  assert.throws(() => E.validateDataset(file), /version/);
});

test('未完成记录保留空元信息、无效数值输入、0、空证据的 pass/fail，不冒充有效数据集', () => {
  for (const status of ['pass', 'fail']) {
    const state = lockedState(), run = state.draft.runs[0];
    run.strategy = ''; run.model = ' '; run.comparisonGroup = ''; run.tokens = '-未填完'; run.durationSec = '0';
    run.checks.g1 = { status, evidence: '' }; state.budget = '1e-';
    const restored = roundtrip(state);
    assert.deepEqual(restored, state); assert.equal(restored.draft.runs[0].durationSec, '0');
    assert.throws(() => B.buildDataset(restored.draft));
  }
});

test('锁定草稿保留任务与记录身份、折叠状态，恢复后仍可完成并导出 v1', () => {
  const state = lockedState(); state.draft.runs[0].open = false; state.draft.runs[0].needsReview = true;
  const restored = roundtrip(state); restored.draft.runs[0].tokens = '0'; restored.draft.runs[0].checks.g1 = { status: 'pass', evidence: '重新导入成功\n见测试日志' };
  const output = B.serializeDataset(restored.draft);
  assert.equal(output.dataset.tasks[0].id, state.draft.id); assert.equal(output.dataset.tasks[0].runs[0].id, state.draft.runs[0].id);
  assert.equal(restored.draft.runs[0].open, false); assert.equal(restored.draft.runs[0].needsReview, true);
  assert.equal(E.evaluate(output.dataset.tasks[0], output.dataset.tasks[0].runs[0], 0).eligible, true);
});

test('待锁定修改保留旧基线与原证据，仅为新增目标补 unknown，重新锁定才复位判断', () => {
  const state = lockedState(); state.locked = false; state.draft.title = ''; state.draft.goals[0].label = '修改后的目标'; state.draft.goals[0].weight = '4';
  state.draft.runs[0].checks.g1 = { status: 'pass', evidence: '原证据\n不得丢失' };
  state.draft.goals.push({ id: 'g2', label: '', weight: 3, required: false }); state.goalSequence = 2;
  const before = structuredClone(state), restored = roundtrip(state);
  assert.deepEqual(state, before); assert.equal(restored.draft.goals[0].weight, '4'); assert.deepEqual(restored.lockedGoals, before.lockedGoals);
  assert.deepEqual(restored.draft.runs[0].checks.g1, before.draft.runs[0].checks.g1);
  assert.deepEqual(restored.draft.runs[0].checks.g2, { status: 'unknown', evidence: '' });
  restored.draft.goals[1].label = '新增目标';
  const updated = B.updateGoalChecks(restored.lockedGoals, restored.draft.goals, restored.draft.runs);
  assert.deepEqual(updated.runs[0].checks.g1, { status: 'unknown', evidence: '原证据\n不得丢失' });
});

test('拒绝锁定冲突、不完整基线、删除已有目标或缺少旧 check，防止遗失验收证据', () => {
  const mutations = [
    state => { state.draft.title = '不一致'; },
    state => { state.draft.goals[0].required = false; },
    state => { state.lockedTask.description = ''; },
    state => { state.locked = false; state.lockedTask = null; state.lockedGoals = []; },
    state => { state.locked = false; state.draft.goals = [{ id: 'g2', label: '替换目标', weight: 1, required: false }]; state.goalSequence = 2; },
    state => { state.locked = false; delete state.draft.runs[0].checks.g1; },
    state => { state.lockedTask.id = '另一个任务'; },
    state => { state.lockedGoals = []; }
  ];
  for (const mutate of mutations) { const state = lockedState(); mutate(state); assert.throws(() => roundtrip(state)); }
});

test('拒绝重复目标与记录 ID、未知目标 check 和各层未知字段，不静默丢弃内容', () => {
  const mutations = [
    state => state.draft.goals.push(structuredClone(state.draft.goals[0])),
    state => state.draft.runs.push(structuredClone(state.draft.runs[0])),
    state => { state.draft.runs[0].checks.extra = { status: 'pass', evidence: '额外证据' }; },
    state => { state.draft.runs[0].checks.g1.note = '额外证据'; },
    state => { state.draft.runs[0].events = [{ detail: '已有事件，不能丢掉' }]; },
    state => { state.draft.goals[0].note = '额外目标定义'; },
    state => { state.draft.extra = '额外任务内容'; },
    state => { state.extra = '额外状态'; },
    state => { state.draft.runs.extra = '数组额外内容'; }
  ];
  for (const mutate of mutations) { const state = lockedState(); mutate(state); assert.throws(() => D.serialize(state), /重复|不支持|一致/); }
  assert.throws(() => D.parseBytes(encode(fileFor(emptyState(), { extra: '额外文件字段' }))), /不支持/);
});

test('字段长度和数量限制与表单一致，拒绝稀疏数组和非法枚举或类型', () => {
  const mutations = [
    state => { state.draft.title = '字'.repeat(3001); },
    state => { state.draft.description = '字'.repeat(3001); },
    state => { state.draft.goals[0].label = '字'.repeat(301); },
    state => { state.draft.runs[0].model = 'a'.repeat(301); },
    state => { state.draft.runs[0].checks.g1.evidence = '字'.repeat(6001); },
    state => { state.budget = '0'.repeat(101); },
    state => { state.draft.runs[0].tokens = '0'.repeat(101); },
    state => { state.draft.runs[0].durationSec = '0'.repeat(101); },
    state => { state.draft.goals = []; },
    state => { state.draft.goals = Array(21).fill(state.draft.goals[0]); },
    state => { state.draft.runs = Array(31).fill(state.draft.runs[0]); },
    state => { state.draft.runs = Array(1); },
    state => { state.draft.runs[0].checks.g1.status = 'approved'; },
    state => { state.draft.runs[0].open = 'false'; },
    state => { state.draft.runs[0].tokens = null; },
    state => { state.draft.goals[0].weight = '2.0'; },
    state => { state.draft.scenario = 'other'; },
    state => { state.locked = 'true'; }
  ];
  for (const mutate of mutations) { const state = lockedState(); mutate(state); assert.throws(() => D.serialize(state)); }
});

test('保留删除后的序号高水位，恢复追加不重用旧 ID；落后或不安全的序号被拒绝', () => {
  const state = lockedState(); state.goalSequence = 8; state.runSequence = 9;
  const restored = roundtrip(state);
  const nextGoal = `g${++restored.goalSequence}`, nextRun = `${restored.draft.id}-run-${++restored.runSequence}`;
  assert.equal(nextGoal, 'g9'); assert.equal(nextRun, `${state.draft.id}-run-10`);
  assert.ok(!restored.draft.goals.some(goal => goal.id === nextGoal)); assert.ok(!restored.draft.runs.some(run => run.id === nextRun));
  for (const field of ['goalSequence', 'runSequence']) for (const value of [0, -1, 1.2, '1', Number.MAX_SAFE_INTEGER, Infinity]) { const bad = lockedState(); bad[field] = value; assert.throws(() => D.serialize(bad)); }
  const highId = lockedState(); highId.draft.runs[0].id = `${highId.draft.id}-run-27`; assert.throws(() => D.serialize(highId), /小于已有 ID/);
});

test('只接收 UTF-8 草稿 envelope，拒绝无效时间、损坏 JSON、重复 JSON 键及其他文件类型', () => {
  assert.throws(() => D.parseBytes(Uint8Array.from([0xc3, 0x28])), /UTF-8/);
  assert.throws(() => D.parseBytes(encode('{')), /JSON/);
  assert.throws(() => D.parseBytes(new Uint8Array()), /非空/);
  assert.throws(() => D.parseBytes(new Int8Array(3)), /UTF-8/);
  for (const savedAt of ['today', '2026-02-30T00:00:00.000Z']) assert.throws(() => D.parseBytes(encode(fileFor(emptyState(), { savedAt }))), /时间/);
  assert.throws(() => D.parseBytes(encode(fileFor(emptyState(), { schema: 'acl-record-evaluation-v1' }))), /草稿文件/);
  const json = fileFor(lockedState()).replace('"evidence":""', '"evidence":"不能丢失","evid\\u0065nce":"后来值"');
  assert.throws(() => D.parseBytes(encode(json)), /重复字段 evidence/);
});

test('16MiB按实际UTF-8字节限制；边界可恢复，超限不截断输入或证据', () => {
  const json = fileFor(emptyState()), boundary = encode(json + ' '.repeat(D.MAX_BYTES - Buffer.byteLength(json)));
  assert.equal(boundary.byteLength, D.MAX_BYTES); assert.deepEqual(D.parseBytes(boundary), emptyState());
  assert.throws(() => D.parseBytes(new Uint8Array(D.MAX_BYTES + 1)), /16MiB/);
  const state = lockedState();
  state.draft.goals = Array.from({ length: 20 }, (_, i) => ({ id: `g${i + 1}`, label: `目标 ${i}`, weight: 3, required: true }));
  state.lockedGoals = structuredClone(state.draft.goals); state.goalSequence = 20; state.runSequence = 30;
  state.draft.runs = Array.from({ length: 30 }, (_, i) => ({ ...structuredClone(state.draft.runs[0]), id: `${state.draft.id}-run-${i + 1}`, checks: Object.fromEntries(state.draft.goals.map(goal => [goal.id, { status: 'unknown', evidence: '\u0000'.repeat(6000) }])) }));
  assert.throws(() => D.serialize(state), /超过 16MiB/); assert.equal(state.draft.runs[29].checks.g20.evidence.length, 6000);
});

test('数据深度克隆且不执行文本；跨 realm 对象与字节可用，特殊目标键不会改写原型', () => {
  const state = lockedState(), payload = '<img src=x onerror=alert(1)> & </script>';
  state.draft.goals[0].id = '__proto__'; state.lockedGoals[0].id = '__proto__';
  state.draft.runs[0].checks = Object.fromEntries([['__proto__', { status: 'pass', evidence: payload }]]);
  const before = structuredClone(state), saved = D.serialize(state), restored = D.parseBytes(encode(saved.json));
  assert.deepEqual(state, before); assert.equal(restored.draft.runs[0].checks.__proto__.evidence, payload);
  assert.equal(Object.getPrototypeOf(restored.draft.runs[0].checks), Object.prototype);
  restored.draft.runs[0].checks.__proto__.evidence = '只修改返回值'; saved.snapshot.draft.goals[0].label = '另一个副本';
  assert.deepEqual(state, before);
  const foreign = vm.runInNewContext('JSON.parse(json)', { json: JSON.stringify(emptyState()) }); assert.deepEqual(D.serialize(foreign).snapshot, emptyState());
  const foreignBytes = vm.runInNewContext('new Uint8Array(bytes)', { bytes: [...encode(fileFor(emptyState()))] }); assert.deepEqual(D.parseBytes(foreignBytes), emptyState());
});

test('不让浏览器在恢复时静默改写换行：单行字段拒绝CR/LF，多行证据保留LF并拒绝CR', () => {
  for (const field of ['title', 'id']) { const state = emptyState(); state.draft[field] = '两\n行'; assert.throws(() => D.serialize(state), /换行符/); }
  for (const field of ['strategy', 'model', 'comparisonGroup', 'tokens', 'durationSec']) { const state = lockedState(); state.draft.runs[0][field] = '两\n行'; assert.throws(() => D.serialize(state), /换行符/); }
  const goal = emptyState(); goal.draft.goals[0].label = '两\r行'; assert.throws(() => D.serialize(goal), /换行符/);
  const budget = emptyState(); budget.budget = '1\n2'; assert.throws(() => D.serialize(budget), /换行符/);
  const state = lockedState(); state.draft.runs[0].checks.g1.evidence = '第一行\n第二行'; assert.equal(roundtrip(state).draft.runs[0].checks.g1.evidence, '第一行\n第二行');
  state.draft.runs[0].checks.g1.evidence = '第一行\r\n第二行'; assert.throws(() => D.serialize(state), /换行符/);
  const description = emptyState(); description.draft.description = '第一行\r第二行'; assert.throws(() => D.serialize(description), /换行符/);
});
