'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('./evaluation.js');
const { createEntryBuilder, MAX_BYTES } = require('./record-entry-core.js');
const { createReportBuilder } = require('./record-evaluation.js');
const B = createEntryBuilder({ evaluation: E });
function fixture() {
  return { id: 'task-entry-test', title: '验证导出功能', description: '只检查已有日志中的导出结果', scenario: 'coding',
    goals: [{ id: 'g1', label: '文件可重新导入', weight: 5, required: true }],
    runs: [{ strategy: '按需读取', model: '用户提供的模型版本', comparisonGroup: '相同输入与环境', tokens: '', durationSec: '', checks: { g1: { status: 'unknown', evidence: '' } } }] };
}

test('未知用量留空转为 null；未填写验收默认 unknown，不生成事件', () => {
  const input = fixture(); input.runs[0].tokens = '  '; delete input.runs[0].checks;
  const data = B.buildDataset(input);
  assert.equal(data.version, 1); assert.equal(data.demo, false);
  const run = data.tasks[0].runs[0];
  assert.equal(run.tokens, null); assert.equal(run.durationSec, null);
  assert.deepEqual(run.checks.g1, { status: 'unknown', evidence: '' }); assert.deepEqual(run.events, []);
  assert.equal(E.evaluate(data.tasks[0], run, 0).eligible, false);
});

test('真实的零用量与零预算保留；已通过的零成本记录可满足候选条件', () => {
  const input = fixture(); input.runs[0].tokens = '0'; input.runs[0].durationSec = 0;
  input.runs[0].checks.g1 = { status: 'pass', evidence: '已人工重新导入，日志输出 1 条记录。' };
  const data = B.buildDataset(input), run = data.tasks[0].runs[0];
  assert.equal(run.tokens, 0); assert.equal(run.durationSec, 0);
  assert.equal(B.parseBudget('0'), 0); assert.equal(E.evaluate(data.tasks[0], run, 0).eligible, true);
});

test('任务、目标、模型、策略及条件组必填，目标数与权重符合 v1', () => {
  for (const field of ['id', 'title', 'description']) { const input = fixture(); input[field] = ' '; assert.throws(() => B.buildDataset(input), /非空文本/); }
  const invalidTask = fixture(); delete invalidTask.id; assert.throws(() => B.buildDataset(invalidTask), /任务 ID/);
  invalidTask.id = 'task-test'; invalidTask.scenario = 'other'; assert.throws(() => B.normalizeTask(invalidTask), /任务类型/);
  for (const field of ['strategy', 'model', 'comparisonGroup']) { const input = fixture(); input.runs[0][field] = ''; assert.throws(() => B.buildDataset(input), /非空文本/); }
  const input = fixture(); input.goals[0].weight = 1.5; assert.throws(() => B.buildDataset(input), /1—5/);
  input.goals = []; assert.throws(() => B.buildDataset(input), /1—20/);
  input.goals = Array.from({ length: 21 }, (_, i) => ({ id: `g${i}`, label: '目标', weight: 1, required: true })); assert.throws(() => B.buildDataset(input), /1—20/);
});

test('通过与未通过必须提供非空证据；未知允许空证据', () => {
  for (const status of ['pass', 'fail']) {
    const input = fixture(); input.runs[0].checks.g1 = { status, evidence: ' \n ' };
    assert.throws(() => B.buildDataset(input), /必须填写证据/);
  }
  const input = fixture(); input.runs[0].checks.g1.status = 'approved'; assert.throws(() => B.buildDataset(input), /状态无效/);
  input.runs[0].checks.g1.status = 'unknown'; assert.doesNotThrow(() => B.buildDataset(input));
  input.runs[0].checks.extra = { status: 'pass', evidence: '不能静默丢掉的未知目标证据' }; assert.throws(() => B.buildDataset(input), /不存在目标/);
});

test('多条记录自动产生唯一 ID；导出直接兼容首页及报告生成器', () => {
  const input = fixture(); input.runs = Array.from({ length: 30 }, () => structuredClone(input.runs[0]));
  const result = B.serializeDataset(input);
  assert.equal(new Set(result.dataset.tasks[0].runs.map(run => run.id)).size, 30);
  assert.equal(result.dataset.tasks[0].id, input.id);
  assert.equal(B.serializeDataset(input).dataset.tasks[0].id, result.dataset.tasks[0].id);
  const anotherTask = structuredClone(input); anotherTask.id = 'different-task-id';
  const anotherResult = B.serializeDataset(anotherTask);
  assert.notEqual(anotherResult.dataset.tasks[0].id, result.dataset.tasks[0].id);
  assert.notEqual(anotherResult.dataset.tasks[0].runs[0].id, result.dataset.tasks[0].runs[0].id);
  assert.deepEqual(E.validateDataset(JSON.parse(result.json)), result.dataset);
  const reportBuilder = createReportBuilder({ evaluation: E, ruleHash: 'a'.repeat(64), softwareVersion: 'test' });
  assert.deepEqual(reportBuilder.parseDataset(new TextEncoder().encode(result.json)), result.dataset);
  input.runs.push(structuredClone(input.runs[0])); assert.throws(() => B.buildDataset(input), /1—30/);
  input.runs = input.runs.slice(0, 2); input.runs.forEach(run => { run.id = 'duplicate'; }); assert.throws(() => B.buildDataset(input), /id 重复/);
});

test('拒绝空白或非法预算、负用量和超过字段长度的输入', () => {
  for (const value of ['', ' ', null, undefined, -1, NaN, Infinity, '0x10', true, '1e999']) assert.throws(() => B.parseBudget(value));
  assert.equal(B.parseBudget(' 1.5 '), 1.5);
  for (const field of ['tokens', 'durationSec']) { const input = fixture(); input.runs[0][field] = '-1'; assert.throws(() => B.buildDataset(input), /非负有限数/); }
  const input = fixture(); input.runs[0].model = 'a'.repeat(301); assert.throws(() => B.buildDataset(input), /300/);
  input.runs[0].model = '实际模型'; input.goals[0].label = '目'.repeat(301); assert.throws(() => B.buildDataset(input), /300/);
  input.goals[0].label = '目标'; input.runs[0].checks.g1.evidence = '证'.repeat(6001); assert.throws(() => B.buildDataset(input), /6000/);
});

test('按 UTF-8 字节限制整个导出，字符数未超字段长度也可能超过 2MiB', () => {
  const input = fixture();
  const small = B.serializeDataset(input); assert.equal(small.bytes, Buffer.byteLength(small.json, 'utf8')); assert.ok(small.bytes < MAX_BYTES);
  input.goals = Array.from({ length: 20 }, (_, i) => ({ id: `g${i + 1}`, label: `目标 ${i}`, weight: 1, required: false }));
  input.runs = Array.from({ length: 8 }, () => ({ strategy: '策略', model: '模型', comparisonGroup: '同组', tokens: null, durationSec: null, checks: Object.fromEntries(input.goals.map(goal => [goal.id, { status: 'unknown', evidence: '证'.repeat(6000) }])) }));
  assert.doesNotThrow(() => B.buildDataset(input)); assert.throws(() => B.serializeDataset(input), /超过 2MiB/);
});

test('文本按数据保留、忽略额外执行字段，构造和序列化不修改原输入', () => {
  const input = fixture(), payload = '<img src=x onerror=alert(1)> & </script>';
  input.title = payload; input.goals[0].label = payload; input.runs[0].checks.g1.evidence = payload;
  input.runs[0].events = [{ atSec: 0, type: 'act', label: '不应自动复制的事件', detail: '用户未在此表单声明' }];
  const before = structuredClone(input), result = B.serializeDataset(input);
  assert.deepEqual(input, before); assert.equal(result.dataset.tasks[0].title, payload);
  assert.equal(JSON.parse(result.json).tasks[0].runs[0].checks.g1.evidence, payload);
  assert.deepEqual(result.dataset.tasks[0].runs[0].events, []);
  result.dataset.tasks[0].goals[0].label = '只改返回值'; result.dataset.tasks[0].runs[0].checks.g1.evidence = '只改返回值';
  assert.deepEqual(input, before);
});

test('目标定义变化仅复位对应状态并保留证据，不修改原记录', () => {
  const previous = [{ id: 'g1', label: '原目标', weight: 3, required: true }, { id: 'g2', label: '未变目标', weight: 1, required: false }];
  const runs = [{ id: 'r1', checks: { g1: { status: 'pass', evidence: '旧日志仍需复核' }, g2: { status: 'fail', evidence: '保留原结论' } } }];
  const snapshot = structuredClone(runs);
  for (const change of [{ label: '新目标' }, { weight: 5 }, { required: false }]) {
    const next = structuredClone(previous); Object.assign(next[0], change);
    const result = B.updateGoalChecks(previous, next, runs);
    assert.equal(result.resetCount, 1); assert.deepEqual(result.runs[0].checks.g1, { status: 'unknown', evidence: '旧日志仍需复核' });
    assert.deepEqual(result.runs[0].checks.g2, runs[0].checks.g2); assert.deepEqual(runs, snapshot);
  }
  const taskChanged = B.updateGoalChecks(previous, previous, runs, { resetAll: true });
  assert.equal(taskChanged.resetCount, 2);
  assert.deepEqual(taskChanged.runs[0].checks, { g1: { status: 'unknown', evidence: '旧日志仍需复核' }, g2: { status: 'unknown', evidence: '保留原结论' } });
  assert.deepEqual(runs, snapshot);
});

test('已有记录时禁止删除目标；追加目标以 unknown 开始，不改变已有结论', () => {
  const input = fixture(); input.runs[0].checks.g1 = { status: 'pass', evidence: '原证据' };
  const next = [...input.goals, { id: 'g2', label: '新目标', weight: 1, required: false }];
  const update = B.updateGoalChecks(input.goals, next, input.runs);
  assert.deepEqual(update.runs[0].checks.g1, input.runs[0].checks.g1);
  assert.deepEqual(update.runs[0].checks.g2, { status: 'unknown', evidence: '' }); assert.equal(update.resetCount, 1);
  assert.throws(() => B.updateGoalChecks(next, input.goals, update.runs), /不能删除目标/);
  assert.equal(B.updateGoalChecks(next, next, update.runs).resetCount, 0);
});
