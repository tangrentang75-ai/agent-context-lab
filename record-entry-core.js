(function (root) {
  'use strict';
  const MAX_BYTES = 2 * 1024 * 1024;
  function createEntryBuilder({ evaluation: E }) {
    if (!E || typeof E.validateDataset !== 'function') throw new Error('缺少本机数据校验规则');
    function number(value, label, optional) {
      if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) {
        if (optional) return null;
        throw new Error(`${label}不能为空；0 是有效数值`);
      }
      if (typeof value !== 'number' && (typeof value !== 'string' || !/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))) throw new Error(`${label}必须是非负有限数`);
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label}必须是非负有限数`);
      return parsed;
    }
    function text(value, label, max, allowEmpty = false) {
      if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > max) throw new Error(`${label}${allowEmpty ? '' : '必须是非空文本，且'}不超过 ${max} 字符`);
      return value;
    }
    function normalizeGoals(goals) {
      if (!Array.isArray(goals) || goals.length < 1 || goals.length > 20) throw new Error('需要 1—20 项目标');
      const seen = new Set();
      return goals.map((goal, index) => {
        if (!goal || typeof goal !== 'object') throw new Error(`目标 ${index + 1} 格式错误`);
        const id = goal.id === undefined ? `g${index + 1}` : text(goal.id, `目标 ${index + 1} ID`, 100);
        if (seen.has(id)) throw new Error('目标 ID 重复');
        seen.add(id);
        const weight = number(goal.weight, `目标 ${index + 1} 权重`, false);
        if (!Number.isInteger(weight) || weight < 1 || weight > 5) throw new Error(`目标 ${index + 1} 权重应为 1—5 的整数`);
        if (typeof goal.required !== 'boolean') throw new Error(`目标 ${index + 1} 必须明确是否为必需项`);
        return { id, label: text(goal.label, `目标 ${index + 1}`, 300), weight, required: goal.required };
      });
    }
    function normalizeTask(draft) {
      if (!draft || typeof draft !== 'object') throw new Error('请先填写任务');
      const task = { id: text(draft.id, '任务 ID', 100), title: text(draft.title, '任务名称', 3000), description: text(draft.description, '任务要求与输入范围', 3000), scenario: draft.scenario };
      if (!['coding', 'research', 'data'].includes(task.scenario)) throw new Error('请选择有效的任务类型');
      return task;
    }
    function buildDataset(draft) {
      const task = normalizeTask(draft);
      const goals = normalizeGoals(draft.goals);
      if (!Array.isArray(draft.runs) || draft.runs.length < 1 || draft.runs.length > 30) throw new Error('需要 1—30 条执行记录');
      const runs = draft.runs.map((run, index) => {
        if (!run || typeof run !== 'object') throw new Error(`记录 ${index + 1} 格式错误`);
        const label = `记录 ${index + 1}`;
        if (run.checks !== undefined && (!run.checks || typeof run.checks !== 'object' || Array.isArray(run.checks))) throw new Error(`${label}的目标状态格式错误`);
        if (run.checks && Object.keys(run.checks).some(id => !goals.some(goal => goal.id === id))) throw new Error(`${label}含有不存在目标的验收记录，请检查目标与证据的对应关系`);
        const checks = Object.fromEntries(goals.map(goal => {
          const check = run.checks && Object.hasOwn(run.checks, goal.id) ? run.checks[goal.id] : undefined;
          if (check !== undefined && (!check || typeof check !== 'object' || Array.isArray(check))) throw new Error(`${label}的目标状态格式错误`);
          const status = check?.status === undefined ? 'unknown' : check.status;
          const evidence = check?.evidence === undefined ? '' : text(check.evidence, `${label}的证据`, 6000, true);
          if (!['unknown', 'pass', 'fail'].includes(status)) throw new Error(`${label}的目标状态无效`);
          if (status !== 'unknown' && !evidence.trim()) throw new Error(`${label}的目标“${goal.label}”已判定，必须填写证据`);
          return [goal.id, { status, evidence }];
        }));
        return {
          id: run.id === undefined ? `${task.id}-run-${index + 1}` : text(run.id, `${label} ID`, 300),
          strategy: text(run.strategy, `${label}策略`, 300),
          model: text(run.model, `${label}模型与版本`, 300),
          comparisonGroup: text(run.comparisonGroup, `${label}条件组`, 300),
          tokens: number(run.tokens, `${label} token`, true),
          durationSec: number(run.durationSec, `${label}耗时`, true), checks, events: []
        };
      });
      const data = { version: 1, demo: false, tasks: [{ ...task, goals, runs }] };
      return E.validateDataset(data);
    }
    function serializeDataset(draft) {
      const dataset = buildDataset(draft);
      const json = JSON.stringify(dataset, null, 2) + '\n';
      const bytes = new TextEncoder().encode(json).byteLength;
      if (bytes > MAX_BYTES) throw new Error(`导出文件为 ${(bytes / 1024 / 1024).toFixed(2)}MiB，超过 2MiB；请缩短证据或减少记录后重试`);
      return { dataset, json, bytes };
    }
    function updateGoalChecks(previousGoals, nextGoals, runs, { resetAll = false } = {}) {
      const goals = normalizeGoals(nextGoals);
      if (!Array.isArray(previousGoals) || !Array.isArray(runs)) throw new Error('原目标或记录格式错误');
      if (runs.length && previousGoals.some(goal => !goals.some(next => next.id === goal.id))) throw new Error('已有记录时不能删除目标，以免丢失对应证据');
      let resetCount = 0;
      const updated = runs.map(run => ({ ...run, checks: Object.fromEntries(goals.map(goal => {
        const prior = previousGoals.find(item => item.id === goal.id);
        const existing = run.checks && Object.hasOwn(run.checks, goal.id) ? run.checks[goal.id] : undefined;
        const changed = resetAll || !prior || prior.label !== goal.label || prior.weight !== goal.weight || prior.required !== goal.required;
        if (changed) resetCount++;
        return [goal.id, { status: changed ? 'unknown' : (existing?.status ?? 'unknown'), evidence: existing?.evidence ?? '' }];
      })) }));
      return { runs: updated, resetCount };
    }
    function parseBudget(value) { return number(value, '每条记录的 token 预算', false); }
    return { normalizeTask, normalizeGoals, buildDataset, serializeDataset, parseBudget, updateGoalChecks };
  }
  const api = { MAX_BYTES, createEntryBuilder };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AgentRecordEntry = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
