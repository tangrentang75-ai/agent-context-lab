'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const { evaluateRecords } = require('./evaluate-records.cjs');
const { compareReports } = require('./compare-record-reports.cjs');
const { renderComparisonMarkdown } = require('./report-comparison-markdown.js');
const data = () => { const d = JSON.parse(fs.readFileSync(require.resolve('./example.json'), 'utf8')); d.tasks = [d.tasks[0]]; return d; };
const report = (d, budget = 20000) => evaluateRecords(Buffer.from(JSON.stringify(d)), budget);

test('readable export retains conclusions, named changes, provenance and boundaries without changing input', () => {
  const d = data(), before = report(d);
  d.tasks[0].runs[1].checks.docs.evidence = '待补：完整回归记录';
  const after = report(d), result = compareReports(before, after);
  result.reportFiles = { beforeSha256: 'a'.repeat(64), afterSha256: 'b'.repeat(64) };
  const original = structuredClone({ result, before, after });
  const text = renderComparisonMarkdown(result, { before, after });
  assert.match(text, /比较条件有变化/); assert.match(text, /人工构造示例/);
  assert.ok(text.includes(d.tasks[0].title)); assert.ok(text.includes(d.tasks[0].goals.find(g => g.id === 'docs').label));
  assert.ok(text.includes('待补：完整回归记录')); assert.ok(text.includes(before.source.sha256));
  for (const hash of Object.values(result.reportFiles)) assert.ok(text.includes(hash));
  assert.ok(text.includes(before.evaluator.sha256));
  assert.match(text, /本报告不证明证据真实|不核验证据真实性/);
  assert.match(text, /不能证明两次模型实验可比/); assert.match(text, /token 是用量记录/);
  assert.equal((text.match(/^### \d+\./gm) || []).length, result.changeCount);
  assert.deepEqual({ result, before, after }, original);
});

test('zero field changes do not hide budget changes or imply all goals passed', () => {
  const d = data(), before = report(d, 20000), after = report(d, 21000);
  const result = compareReports(before, after); assert.equal(result.changeCount, 0);
  const text = renderComparisonMarkdown(result, { before, after });
  assert.match(text, /比较条件有变化/); assert.match(text, /每条记录的预算变化/);
  assert.match(text, /20000 token/); assert.match(text, /21000 token/);
  assert.match(text, /不等于所有目标通过/);
  const same = renderComparisonMarkdown(compareReports(before, before));
  assert.match(same, /已检查的内容一致/); assert.match(same, /不代表已批准的基准/);
});

test('unknown, missing, empty and full nested records remain distinguishable', () => {
  const d = data(), before = report(d);
  d.tasks[0].runs[0].tokens = null;
  d.tasks[0].runs[0].checks.docs = { status: 'unknown', evidence: '' };
  const removed = d.tasks[0].runs.pop();
  const after = report(d), result = compareReports(before, after);
  const text = renderComparisonMarkdown(result, { before, after });
  assert.match(text, /未知（null）/); assert.match(text, /证据待补（unknown）/);
  assert.match(text, /（空文本）/); assert.match(text, /此侧没有该条目/);
  assert.ok(text.includes(removed.checks.docs.evidence));
  const reversed = renderComparisonMarkdown(compareReports(after, before));
  assert.match(reversed, /新增 · 条目变化/); assert.ok(reversed.includes(removed.checks.docs.evidence));
});

test('untrusted names and multiline evidence cannot introduce Markdown structure', () => {
  const d = data();
  d.tasks[0].title = '<img src=x> ![remote](https://invalid.test/image)\n# Fake';
  const before = report(d);
  const payload = '原始证据\n```\n<img src=x onerror=alert(1)>\n![remote](https://invalid.test/image)\n``````\n# Fake\n&copy;';
  d.tasks[0].runs[0].checks.docs.evidence = payload;
  const after = report(d), text = renderComparisonMarkdown(compareReports(before, after), { before, after });
  assert.ok(text.includes('```````\n' + payload + '\n```````'));
  // No raw HTML/image syntax or user headings may occur outside fenced data.
  let fence = null;
  for (const line of text.split('\n')) {
    if (fence) { if (line === fence) fence = null; continue; }
    if (/^`{3,}$/.test(line)) { fence = line; continue; }
    assert.doesNotMatch(line, /<img|!\[remote\]|^# Fake/);
  }
  assert.equal(fence, null); assert.match(text, /&lt;img/);
});

test('unverified rules and conflicting source claims retain their warnings', () => {
  const d = data(), before = report(d), after = report(d);
  after.evaluator.sha256 = 'f'.repeat(64);
  let text = renderComparisonMarkdown(compareReports(before, after));
  assert.match(text, /未重算该报告/); assert.match(text, /按本机当前规则重算：未完成/);
  after.evaluator.sha256 = before.evaluator.sha256;
  after.tasks[0].groups[0].runs[0].checks.docs.evidence += ' 新说明';
  text = renderComparisonMarkdown(compareReports(before, after));
  assert.match(text, /来源声明有冲突/); assert.match(text, /不能据此认定改进/);
});
