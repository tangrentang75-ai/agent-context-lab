'use strict';

const fs = require('node:fs');
const { createHash } = require('node:crypto');
const E = require('./evaluation.js');
const MAX_BYTES = 2 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const HELP = `批量检查已有任务记录（不调用模型）
node evaluate-records.cjs --input example.json --budget 20000 [--output report.json]

--input   首页数据集 JSON，最大 2MiB
--budget  每条执行记录的 token 上限，非负有限数，必须明确填写
--output  可选报告文件；拒绝覆盖已有文件，父目录须已存在

退出码：0 每个任务的每个条件组均有可推荐记录；1 至少一组没有；2 输入或写入错误。
0 不表示全部记录通过，也不证明证据真实或模型质量提高。
`;

function parseArgs(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  const options = {};
  const names = new Map([['--input', 'input'], ['--budget', 'budget'], ['--output', 'output']]);
  for (let i = 0; i < args.length; i += 2) {
    const key = names.get(args[i]);
    if (!key || Object.hasOwn(options, key)) throw new Error('未知或重复参数；使用 --help 查看用法');
    const value = args[i + 1];
    if (typeof value !== 'string' || !value.trim() || value.startsWith('--')) throw new Error('参数缺少值');
    options[key] = value;
  }
  if (!options.input || options.budget === undefined) throw new Error('必须提供 --input 和 --budget');
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(options.budget)) throw new Error('预算必须是非负有限数');
  options.budget = Number(options.budget);
  if (!Number.isFinite(options.budget)) throw new Error('预算必须是非负有限数');
  return options;
}

function evaluateRecords(bytes, budget) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_BYTES) throw new Error('输入必须为不超过 2MiB 的 JSON 文件');
  if (!Number.isFinite(budget) || budget < 0) throw new Error('预算必须是非负有限数');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const data = E.validateDataset(JSON.parse(text));
  const tasks = data.tasks.map(task => ({
    id: task.id, title: task.title, goals: task.goals,
    groups: [...new Set(task.runs.map(run => run.comparisonGroup))].map(comparisonGroup => {
      const result = E.compare(task, budget, comparisonGroup);
      return {
        comparisonGroup, bestIds: result.bestIds,
        runs: result.rows.map(({ run, evaluation }) => ({
          id: run.id, strategy: run.strategy, model: run.model,
          tokens: run.tokens, durationSec: run.durationSec, checks: run.checks, evaluation
        }))
      };
    })
  }));
  const groups = tasks.flatMap(task => task.groups);
  const groupsWithoutCandidate = groups.filter(group => !group.bestIds.length).length;
  return {
    schema: 'acl-record-evaluation-v1',
    softwareVersion: require('./package.json').version,
    generatedAt: new Date().toISOString(),
    source: { sha256: hash(bytes), bytes: bytes.length, demo: data.demo },
    evaluator: { file: 'evaluation.js', sha256: hash(fs.readFileSync(require.resolve('./evaluation.js'))) },
    budgetTokensPerRun: budget,
    summary: { taskCount: tasks.length, groupCount: groups.length, groupsWithoutCandidate,
      everyGroupHasCandidate: groupsWithoutCandidate === 0 },
    limitations: [
      '仅重评已有记录；不执行模型，也不独立核验证据或条件组真实性。',
      '每组有候选不等于全部记录通过；人工构造示例不是实测效果。',
      'token 不等于硬件算力或能源；哈希用于识别输入和规则，不证明内容真实。',
      '报告包含目标和证据文本，分享前需检查私人信息；不能作为首页数据集重新导入。'
    ],
    tasks
  };
}

function main(args = process.argv.slice(2)) {
  try {
    const options = parseArgs(args);
    if (options.help) { process.stdout.write(HELP); return 0; }
    const stat = fs.statSync(options.input);
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('输入必须为不超过 2MiB 的普通文件');
    // Read at most one byte beyond the limit, even if the file grows after stat.
    const fd = fs.openSync(options.input, 'r');
    let bytes;
    try {
      const buffer = Buffer.alloc(MAX_BYTES + 1);
      let length = 0, read;
      while (length < buffer.length && (read = fs.readSync(fd, buffer, length, buffer.length - length, null)) > 0) length += read;
      bytes = buffer.subarray(0, length);
    } finally { fs.closeSync(fd); }
    const report = evaluateRecords(bytes, options.budget);
    const json = JSON.stringify(report, null, 2) + '\n';
    if (options.output) fs.writeFileSync(options.output, json, { encoding: 'utf8', flag: 'wx' });
    process.stdout.write(json);
    return report.summary.everyGroupHasCandidate ? 0 : 1;
  } catch (error) {
    process.stderr.write(`检查未完成：${error.message}\n`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = { evaluateRecords, parseArgs, MAX_BYTES };
