'use strict';

const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual: equal } = require('node:util');
const E = require('./evaluation.js');
const MAX_REPORT_BYTES = 16 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const ruleHash = hash(fs.readFileSync(require.resolve('./evaluation.js')));
const fail = message => { throw new Error(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 3000) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const keyed = (items, key, project = x => x) => Object.fromEntries(items.map(x => [x[key], project(x)]));
const pick = (value, fields) => Object.fromEntries(fields.map(key => [key, value[key]]));
const evaluationFields = ['score', 'known', 'total', 'accepted', 'allReviewed', 'eligible', 'status'];

function validateReport(report) {
  if (!object(report) || report.schema !== 'acl-record-evaluation-v1') fail('需要 acl-record-evaluation-v1 报告，不是首页数据集');
  if (!text(report.softwareVersion, 100) || !text(report.generatedAt, 100) || !Number.isFinite(Date.parse(report.generatedAt))) fail('报告版本或时间无效');
  if (!object(report.source) || !sha(report.source.sha256) || !Number.isInteger(report.source.bytes) || report.source.bytes < 1 || report.source.bytes > 2 * 1024 * 1024 || typeof report.source.demo !== 'boolean') fail('输入来源标识无效');
  if (!object(report.evaluator) || report.evaluator.file !== 'evaluation.js' || !sha(report.evaluator.sha256)) fail('评价规则标识无效');
  if (!Number.isFinite(report.budgetTokensPerRun) || report.budgetTokensPerRun < 0) fail('预算必须是非负有限数');
  if (!Array.isArray(report.tasks) || !report.tasks.length || report.tasks.length > 100) fail('报告需要 1—100 个任务');
  const currentRules = report.evaluator.sha256 === ruleHash;
  const projected = [];
  let groupCount = 0, groupsWithoutCandidate = 0;
  for (const task of report.tasks) {
    if (!object(task) || !Array.isArray(task.groups) || !task.groups.length || task.groups.length > 30) fail('任务条件组格式错误');
    const groups = new Set(), runs = [];
    for (const group of task.groups) {
      if (!object(group) || !text(group.comparisonGroup, 300) || groups.has(group.comparisonGroup)) fail('条件组无效或重复');
      groups.add(group.comparisonGroup);
      if (!Array.isArray(group.runs) || !group.runs.length || group.runs.length > 30) fail('条件组记录数量无效');
      if (!Array.isArray(group.bestIds) || group.bestIds.some(id => !text(id, 300)) || new Set(group.bestIds).size !== group.bestIds.length) fail('推荐 ID 无效或重复');
      for (const run of group.runs) {
        if (!object(run) || !object(run.evaluation)) fail('缺少逐条评价');
        const v = run.evaluation;
        if (!Number.isInteger(v.score) || v.score < 0 || v.score > 100 || !Number.isInteger(v.known) || !Number.isInteger(v.total) || v.known < 0 || v.known > v.total || v.total !== task.goals?.length || !['accepted', 'allReviewed', 'eligible'].every(k => typeof v[k] === 'boolean') || !text(v.status, 300)) fail('逐条评价字段无效');
        runs.push({ ...run, comparisonGroup: group.comparisonGroup, events: [] });
      }
      if (group.bestIds.some(id => !group.runs.some(run => run.id === id && run.evaluation.eligible))) fail('推荐引用了不存在或不合格的记录');
      groupCount++;
      if (!group.bestIds.length) groupsWithoutCandidate++;
    }
    // Reuse core field validation only. v1 reports omit scenario, description and events;
    // these placeholders are not claims about the original task or a reconstructed dataset.
    projected.push({ id: task.id, title: task.title, description: 'report field validation', scenario: 'coding', goals: task.goals, runs });
  }
  E.validateDataset({ version: 1, demo: report.source.demo, tasks: projected });
  for (const task of projected) {
    const sourceTask = report.tasks.find(t => t.id === task.id);
    if (currentRules) {
      for (const run of task.runs) {
        if (!equal(pick(run.evaluation, evaluationFields), E.evaluate(task, run, report.budgetTokensPerRun))) fail(`记录 ${run.id} 的评价与声明的当前规则不一致`);
      }
      for (const group of sourceTask.groups) {
        const expected = E.compare(task, report.budgetTokensPerRun, group.comparisonGroup).bestIds;
        if (!equal([...group.bestIds].sort(), [...expected].sort())) fail('推荐结果与当前规则不一致');
      }
    }
  }
  const summary = { taskCount: report.tasks.length, groupCount, groupsWithoutCandidate, everyGroupHasCandidate: groupsWithoutCandidate === 0 };
  if (!object(report.summary) || !equal(pick(report.summary, Object.keys(summary)), summary)) fail('报告汇总与逐组记录不一致');
  return { report, currentRules };
}

function snapshot(report, includeResults) {
  return keyed(report.tasks, 'id', task => ({
    title: task.title,
    goals: keyed(task.goals, 'id', goal => pick(goal, ['label', 'weight', 'required'])),
    groups: keyed(task.groups, 'comparisonGroup', group => ({
      ...(includeResults ? { bestIds: [...group.bestIds].sort() } : {}),
      runs: keyed(group.runs, 'id', run => ({
        ...pick(run, ['strategy', 'model', 'tokens', 'durationSec']),
        checks: Object.fromEntries(Object.entries(run.checks).map(([id, check]) => [id, pick(check, ['status', 'evidence'])])),
        ...(includeResults ? { evaluation: pick(run.evaluation, evaluationFields) } : {})
      }))
    }))
  }));
}

function differences(before, after, path = [], result = []) {
  if (equal(before, after)) return result;
  if (object(before) && object(after)) {
    for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
      const next = [...path, key];
      if (!Object.hasOwn(before, key)) result.push({ path: next, kind: 'added', after: after[key] });
      else if (!Object.hasOwn(after, key)) result.push({ path: next, kind: 'removed', before: before[key] });
      else differences(before[key], after[key], next, result);
    }
  } else result.push({ path, kind: 'changed', before, after });
  return result;
}

function compareReports(before, after) {
  const a = validateReport(before), b = validateReport(after);
  const reasons = [];
  const condition = (code, message, left, right) => { if (!equal(left, right)) reasons.push({ code, message, before: left, after: right }); };
  condition('source_changed', '输入文件校验值不同，不能直接判断效果提升或退步。', before.source.sha256, after.source.sha256);
  condition('source_metadata_changed', '输入大小或示例标记变化。', pick(before.source, ['bytes', 'demo']), pick(after.source, ['bytes', 'demo']));
  condition('budget_changed', '每条记录的预算变化。', before.budgetTokensPerRun, after.budgetTokensPerRun);
  condition('rules_changed', '评价规则校验值变化。', before.evaluator.sha256, after.evaluator.sha256);
  if (!a.currentRules || !b.currentRules) reasons.push({ code: 'rules_unverified', message: '至少一份报告的规则不是本机当前版本，未重算该报告的评价；请用同一规则重新生成两份报告。' });
  const changes = differences(snapshot(before, true), snapshot(after, true), ['tasks']);
  const sameSource = before.source.sha256 === after.source.sha256;
  const inputConflict = sameSource && (!equal(before.source, after.source) || !equal(snapshot(before, false), snapshot(after, false)));
  const resultConflict = sameSource && before.evaluator.sha256 === after.evaluator.sha256 && before.budgetTokensPerRun === after.budgetTokensPerRun && changes.length > 0;
  const conflict = inputConflict || resultConflict;
  if (conflict) reasons.push({ code: 'identity_conflict', message: '报告声明的来源或评价条件相同，但内容冲突。请检查原文件并重新生成报告，不能据此认定改进。' });
  const status = conflict ? 'inconsistent' : reasons.length ? 'conditions_changed' : 'unchanged';
  const message = { unchanged: '已检查字段一致；仅生成时间、软件版本或排列顺序不同不会被当作改进。', conditions_changed: '条件有变化或规则未核验。下方只列记录差异，不给出效果提升、退步或节省比例结论。', inconsistent: '来源声明与报告内容冲突，需要先核对报告。' }[status];
  return {
    schema: 'acl-record-comparison-v1', softwareVersion: require('./package.json').version,
    generatedAt: new Date().toISOString(), status, message,
    before: pick(before, ['softwareVersion', 'generatedAt', 'source', 'evaluator', 'budgetTokensPerRun']),
    after: pick(after, ['softwareVersion', 'generatedAt', 'source', 'evaluator', 'budgetTokensPerRun']),
    validation: { beforeRecomputedWithCurrentRules: a.currentRules, afterRecomputedWithCurrentRules: b.currentRules },
    reasons, changeCount: changes.length, changes,
    limitations: [
      '只检查报告内已保存字段；v1 报告没有完整任务输入、原始输出和执行环境，不能证明两次模型实验可比。',
      '源数据哈希由报告声明，未读取原始数据验证。重算只核对评分计算，不核验证据真实性。',
      '未统计改进率或节省率；未知用量保留 null，新增和删除记录不视为通过。',
      '差异包含目标和证据文本，分享前检查私人信息。'
    ]
  };
}

function readReport(filename) {
  const fd = fs.openSync(filename, 'r');
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_REPORT_BYTES) fail('报告必须为不超过 16MiB 的普通文件');
    const buffer = Buffer.alloc(MAX_REPORT_BYTES + 1);
    let length = 0, count;
    while (length < buffer.length && (count = fs.readSync(fd, buffer, length, buffer.length - length, null)) > 0) length += count;
    if (length > MAX_REPORT_BYTES) fail('报告超过 16MiB');
    const bytes = buffer.subarray(0, length);
    return { report: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), sha256: hash(bytes) };
  } finally { fs.closeSync(fd); }
}

function main(args = process.argv.slice(2)) {
  try {
    if (args.length === 1 && args[0] === '--help') {
      process.stdout.write('node compare-record-reports.cjs --before before.json --after after.json [--output difference.json]\n只比较已有评估报告，不调用模型。拒绝覆盖输出。退出码：0 已检查内容一致；1 有差异、条件变化或待核对；2 输入/写入错误。\n');
      return 0;
    }
    const options = new Map();
    for (let i = 0; i < args.length; i += 2) {
      if (!['--before', '--after', '--output'].includes(args[i]) || options.has(args[i]) || !text(args[i + 1]) || args[i + 1].startsWith('--')) fail('未知、重复或缺值的参数；使用 --help 查看用法');
      options.set(args[i], args[i + 1]);
    }
    if (!options.has('--before') || !options.has('--after')) fail('必须提供 --before 和 --after');
    const before = readReport(options.get('--before')), after = readReport(options.get('--after'));
    const report = compareReports(before.report, after.report);
    report.reportFiles = { beforeSha256: before.sha256, afterSha256: after.sha256 };
    const json = JSON.stringify(report, null, 2) + '\n';
    if (options.has('--output')) fs.writeFileSync(options.get('--output'), json, { encoding: 'utf8', flag: 'wx' });
    process.stdout.write(json);
    return report.status === 'unchanged' ? 0 : 1;
  } catch (error) {
    process.stderr.write(`比较未完成：${error.message}\n`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = { compareReports, validateReport, readReport, MAX_REPORT_BYTES };
