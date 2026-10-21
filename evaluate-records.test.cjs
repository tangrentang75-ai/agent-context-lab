const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { evaluateRecords, parseArgs, MAX_BYTES } = require('./evaluate-records.cjs');
const fresh = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'example.json'), 'utf8'));
const encode = data => Buffer.from(JSON.stringify(data));
const cli = args => spawnSync(process.execPath, [path.join(__dirname, 'evaluate-records.cjs'), ...args], { encoding: 'utf8' });
function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acl-evaluate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('batch report retains evidence, unknown cost, input hash and evaluator identity', () => {
  const data = fresh(); data.tasks[0].runs[0].tokens = null;
  const bytes = encode(data), report = evaluateRecords(bytes, 20000);
  const run = report.tasks[0].groups[0].runs[0];
  assert.equal(run.tokens, null); assert.equal(run.evaluation.eligible, false);
  assert.deepEqual(run.checks, data.tasks[0].runs[0].checks);
  assert.equal(report.source.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(report.source.demo, true);
  assert.equal(report.evaluator.sha256, createHash('sha256').update(fs.readFileSync(path.join(__dirname, 'evaluation.js'))).digest('hex'));
  assert.equal(report.budgetTokensPerRun, 20000);
});

test('groups preserve exact values and never share candidates across conditions', () => {
  const data = fresh(); data.tasks = [data.tasks[0]];
  data.tasks[0].runs[0].comparisonGroup = '__proto__';
  data.tasks[0].runs[1].comparisonGroup = ' group';
  data.tasks[0].runs[2].comparisonGroup = 'group';
  const report = evaluateRecords(encode(data), 20000);
  assert.deepEqual(report.tasks[0].groups.map(g => g.comparisonGroup), ['__proto__', ' group', 'group']);
  assert.deepEqual(report.tasks[0].groups[0].bestIds, []);
  assert.equal(report.summary.groupsWithoutCandidate, 1);
});

test('ties remain visible and an unknown optional goal blocks recommendation', () => {
  const data = fresh(); data.tasks = [data.tasks[0]];
  data.tasks[0].runs[2].tokens = data.tasks[0].runs[1].tokens;
  assert.deepEqual(evaluateRecords(encode(data), 20000).tasks[0].groups[0].bestIds, ['code-b', 'code-c']);
  data.tasks[0].runs[1].checks.docs.status = 'unknown';
  assert.deepEqual(evaluateRecords(encode(data), 20000).tasks[0].groups[0].bestIds, ['code-c']);
});

test('missing and malformed input or budgets are rejected', () => {
  for (const args of [[], ['--input', 'x'], ['--input', 'x', '--budget', '-1'], ['--input', 'x', '--budget', 'Infinity'], ['--input', 'x', '--budget', '1e999'], ['--input', 'x', '--budget', ''], ['--input', 'x', '--budget', '0x10'], ['--input', 'x', '--budget', '1', '--budget', '2'], ['--other', 'x']]) assert.throws(() => parseArgs(args));
  assert.equal(parseArgs(['--input', 'x', '--budget', '0']).budget, 0);
  for (const data of [Buffer.from('{'), Buffer.from([0xff]), Buffer.alloc(MAX_BYTES + 1), encode({ version: 1, demo: true, tasks: [] })]) assert.throws(() => evaluateRecords(data, 20000));
  for (const budget of [NaN, Infinity, -1, null]) assert.throws(() => evaluateRecords(encode(fresh()), budget));
});

test('CLI status 0 means every group has a candidate, not that every run passed', t => {
  const dir = temp(t), input = path.join(dir, 'input.json'), output = path.join(dir, 'report.json');
  const data = fresh(); data.tasks = [data.tasks[0]]; fs.writeFileSync(input, encode(data));
  const result = cli(['--input', input, '--budget', '20000', '--output', output]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.summary.everyGroupHasCandidate, true);
  assert.equal(report.tasks[0].groups[0].runs[0].evaluation.eligible, false);
  assert.equal(fs.readFileSync(output, 'utf8'), result.stdout);
});

test('CLI status 1 preserves a usable report for an insufficient budget', t => {
  const dir = temp(t), output = path.join(dir, 'report.json');
  const result = cli(['--input', path.join(__dirname, 'example.json'), '--budget', '0', '--output', output]);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).summary.everyGroupHasCandidate, false);
});

test('CLI refuses existing output, including the input file and hard links', t => {
  const dir = temp(t), input = path.join(dir, 'input.json'), output = path.join(dir, 'output.json');
  const bytes = encode(fresh()); fs.writeFileSync(input, bytes); fs.linkSync(input, output);
  for (const target of [input, output]) {
    const result = cli(['--input', input, '--budget', '20000', '--output', target]);
    assert.equal(result.status, 2); assert.equal(result.stdout, '');
    assert.deepEqual(fs.readFileSync(input), bytes);
  }
});

test('CLI distinguishes input and write errors from evaluation failures', t => {
  const dir = temp(t), bad = path.join(dir, 'bad.json'), output = path.join(dir, 'new.json');
  fs.writeFileSync(bad, '{}');
  for (const input of [bad, dir, path.join(dir, 'missing.json')]) {
    assert.equal(cli(['--input', input, '--budget', '1', '--output', output]).status, 2);
    assert.equal(fs.existsSync(output), false);
  }
  assert.equal(cli(['--input', path.join(__dirname, 'example.json'), '--budget', '20000', '--output', path.join(dir, 'missing', 'report.json')]).status, 2);
  assert.equal(cli(['--help']).status, 0);
});
