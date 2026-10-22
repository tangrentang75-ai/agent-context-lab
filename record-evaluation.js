(function (root) {
'use strict';
const MAX_BYTES = 2 * 1024 * 1024;
function createReportBuilder({ evaluation: E, ruleHash, softwareVersion }) {
  const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (!sha(ruleHash) || typeof softwareVersion !== 'string' || !softwareVersion.trim()) throw new Error('报告生成器缺少规则或软件版本');
  function parseDataset(bytes) {
    if (!ArrayBuffer.isView(bytes) || bytes.BYTES_PER_ELEMENT !== 1 || bytes.byteLength > MAX_BYTES) throw new Error('输入必须为不超过 2MiB 的 JSON 文件');
    return E.validateDataset(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  }
  function buildReport(data, budget, source) {
    if (!Number.isFinite(budget) || budget < 0) throw new Error('预算必须是非负有限数');
    if (!source || !sha(source.sha256) || !Number.isInteger(source.bytes) || source.bytes < 1 || source.bytes > MAX_BYTES) throw new Error('原始数据的校验值或字节数无效');
    E.validateDataset(data);
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
  return structuredClone({
    schema: 'acl-record-evaluation-v1',
    softwareVersion,
    generatedAt: new Date().toISOString(),
    source: { sha256: source.sha256, bytes: source.bytes, demo: data.demo },
    evaluator: { file: 'evaluation.js', sha256: ruleHash },
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
  });
}

  return { parseDataset, buildReport };
}
const api = { createReportBuilder, MAX_BYTES };
if (typeof module === 'object' && module.exports) module.exports = api;
root.AgentRecordEvaluation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
