const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { evaluateRecords } = require('./evaluate-records.cjs');
const { compareReports, validateReport, readReport, MAX_REPORT_BYTES } = require('./compare-record-reports.cjs');
const data = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'example.json'), 'utf8'));
const report = (d = data(), budget = 20000) => evaluateRecords(Buffer.from(JSON.stringify(d)), budget);
const copy = x => structuredClone(x);
const cli = args => spawnSync(process.execPath, [path.join(__dirname, 'compare-record-reports.cjs'), ...args], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acl-report-diff-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function pair(t, before, after) {
  const dir = temporary(t), left = path.join(dir, 'before.json'), right = path.join(dir, 'after.json');
  fs.writeFileSync(left, JSON.stringify(before)); fs.writeFileSync(right, JSON.stringify(after));
  return { dir, left, right, args: ['--before', left, '--after', right] };
}

test('same evaluation ignores time, software version and keyed array ordering', () => {
  const before = report(), after = copy(before);
  after.generatedAt = '2026-10-21T10:00:00.000Z'; after.softwareVersion = '0.25.11';
  after.tasks.reverse();
  for (const task of after.tasks) { task.goals.reverse(); task.groups.reverse(); for (const group of task.groups) { group.runs.reverse(); group.bestIds.reverse(); } }
  const diff = compareReports(before, after);
  assert.equal(diff.status, 'unchanged'); assert.equal(diff.changeCount, 0);
  assert.equal(diff.validation.beforeRecomputedWithCurrentRules, true);
});

test('budget-only change is explicitly a condition change with recommendation differences', () => {
  const d = data(), diff = compareReports(report(d), report(d, 0));
  assert.equal(diff.status, 'conditions_changed');
  assert.deepEqual(diff.reasons.map(r => r.code), ['budget_changed']);
  assert.ok(diff.changes.some(c => c.path.at(-1) === 'bestIds'));
});

test('pass to unknown and edited evidence remain raw changes, not claimed model regressions', () => {
  const d = data(), before = report(d);
  d.tasks[0].runs[1].checks.docs = { status: 'unknown', evidence: '需要重新核对' };
  const diff = compareReports(before, report(d));
  assert.equal(diff.status, 'conditions_changed');
  assert.ok(diff.reasons.some(r => r.code === 'source_changed'));
  assert.ok(diff.changes.some(c => c.path.at(-1) === 'status' && c.before === 'pass' && c.after === 'unknown'));
  assert.ok(diff.changes.some(c => c.path.at(-1) === 'evidence' && c.after === '需要重新核对'));
  assert.equal(Object.hasOwn(diff, 'improvementRate'), false);
});

test('unknown tokens stay null and no savings or delta is computed', () => {
  const d = data(), before = report(d); d.tasks[0].runs[1].tokens = null;
  const diff = compareReports(before, report(d));
  const change = diff.changes.find(c => c.path.at(-1) === 'tokens');
  assert.equal(change.after, null); assert.equal(Object.hasOwn(change, 'delta'), false);
});

test('added and removed runs are explicit, and records never match by array position', () => {
  const d = data(), before = report(d);
  d.tasks[0].runs[0].id = 'new-run';
  const diff = compareReports(before, report(d));
  assert.ok(diff.changes.some(c => c.kind === 'removed' && c.path.at(-1) === 'code-a'));
  assert.ok(diff.changes.some(c => c.kind === 'added' && c.path.at(-1) === 'new-run'));
});

test('goal policy changes are surfaced even when all runs still have candidates', () => {
  const d = data(), before = report(d); d.tasks[0].goals[0].weight = 1;
  const diff = compareReports(before, report(d));
  assert.ok(diff.changes.some(c => c.path.at(-1) === 'weight' && c.after === 1));
  assert.equal(diff.status, 'conditions_changed');
});

test('group whitespace and prototype-like IDs remain separate and safe', () => {
  const d = data(); d.tasks[0].id = '__proto__'; d.tasks[0].runs[0].comparisonGroup = ' group';
  const before = report(d); d.tasks[0].runs[0].comparisonGroup = 'group';
  const diff = compareReports(before, report(d));
  assert.ok(diff.changes.some(c => c.kind === 'removed' && c.path.includes(' group')));
  assert.ok(diff.changes.some(c => c.kind === 'added' && c.path.includes('group')));
  assert.equal(Object.hasOwn({}, 'polluted'), false);
});

test('changed source hash blocks a direct conclusion even when visible fields match', () => {
  const before = report(), after = copy(before); after.source.sha256 = '0'.repeat(64);
  const diff = compareReports(before, after);
  assert.equal(diff.status, 'conditions_changed'); assert.equal(diff.changeCount, 0);
});

test('same source claim with changed evidence is inconsistent, even if budget also changes', () => {
  const d = data(), before = report(d); d.tasks[0].runs[1].checks.docs.evidence = '另一段证据';
  const after = report(d, 10000); after.source = copy(before.source);
  const diff = compareReports(before, after);
  assert.equal(diff.status, 'inconsistent');
  assert.ok(diff.reasons.some(r => r.code === 'identity_conflict'));
});

test('unknown or changed evaluator is never silently accepted as verified', () => {
  const before = report(), after = copy(before); after.evaluator.sha256 = 'a'.repeat(64);
  const diff = compareReports(before, after);
  assert.equal(diff.status, 'conditions_changed');
  assert.equal(diff.validation.afterRecomputedWithCurrentRules, false);
  assert.ok(diff.reasons.some(r => r.code === 'rules_changed'));
  before.evaluator.sha256 = after.evaluator.sha256;
  assert.equal(compareReports(before, after).status, 'conditions_changed');
});

test('forged scores, winners, eligibility and summary cannot pass current-rule validation', () => {
  for (const mutate of [
    r => { r.tasks[0].groups[0].runs[0].evaluation.score = 100; },
    r => { r.tasks[0].groups[0].runs[0].evaluation.eligible = true; },
    r => { r.tasks[0].groups[0].bestIds = ['code-c']; },
    r => { r.tasks[0].groups[0].bestIds = ['missing']; },
    r => { r.summary.everyGroupHasCandidate = !r.summary.everyGroupHasCandidate; }
  ]) { const bad = report(); mutate(bad); assert.throws(() => validateReport(bad)); }
});

test('malformed and ambiguous reports fail before comparison', () => {
  for (const mutate of [
    r => { r.tasks.push(copy(r.tasks[0])); },
    r => { r.tasks[0].groups.push(copy(r.tasks[0].groups[0])); },
    r => { r.tasks[0].groups[0].runs.push(copy(r.tasks[0].groups[0].runs[0])); },
    r => { r.tasks[0].goals.push(copy(r.tasks[0].goals[0])); },
    r => { delete r.tasks[0].groups[0].runs[0].checks.refund; },
    r => { r.source.sha256 = ''; }, r => { r.source.demo = 'false'; },
    r => { r.budgetTokensPerRun = -1; }, r => { r.tasks = []; },
    r => { r.tasks[0].groups[0].runs[0].tokens = -1; },
    r => { r.tasks[0].groups[0].runs[0].checks.refund.evidence = ''; }
  ]) { const bad = report(); mutate(bad); assert.throws(() => validateReport(bad)); }
  for (const invalid of [null, {}, data()]) assert.throws(() => validateReport(invalid));
});

test('CLI returns 0 for unchanged and 1 for changed conditions, preserving report-file hashes', t => {
  for (const budget of [20000, 0]) {
    const p = pair(t, report(), report(data(), budget)), output = path.join(p.dir, 'diff.json');
    const result = cli([...p.args, '--output', output]);
    assert.equal(result.status, budget === 0 ? 1 : 0, result.stderr);
    const diff = JSON.parse(result.stdout);
    assert.equal(fs.readFileSync(output, 'utf8'), result.stdout);
    assert.equal(diff.reportFiles.beforeSha256, createHash('sha256').update(fs.readFileSync(p.left)).digest('hex'));
  }
});

test('CLI refuses overwrites, missing arguments and bad files without creating reports', t => {
  const p = pair(t, report(), report()), original = fs.readFileSync(p.left);
  const alias = path.join(p.dir, 'alias.json'); fs.linkSync(p.left, alias);
  for (const output of [p.left, p.right, alias]) {
    const result = cli([...p.args, '--output', output]); assert.equal(result.status, 2); assert.equal(result.stdout, '');
  }
  assert.deepEqual(fs.readFileSync(p.left), original);
  for (const args of [[], ['--before', p.left], [...p.args, '--after', p.right], [...p.args, '--bogus', 'x']]) assert.equal(cli(args).status, 2);
  fs.writeFileSync(p.right, '{');
  const output = path.join(p.dir, 'new.json');
  assert.equal(cli([...p.args, '--output', output]).status, 2); assert.equal(fs.existsSync(output), false);
  assert.equal(cli(['--help']).status, 0);
});

test('report reader rejects directories, invalid UTF-8 and oversized files', t => {
  const dir = temporary(t), file = path.join(dir, 'report.json');
  assert.throws(() => readReport(dir));
  fs.writeFileSync(file, Buffer.from([0xff])); assert.throws(() => readReport(file));
  fs.truncateSync(file, MAX_REPORT_BYTES + 1); assert.throws(() => readReport(file), /16MiB/);
});
