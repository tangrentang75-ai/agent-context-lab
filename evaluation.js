(function (root) {
  'use strict';
  const scenarios = { coding: '软件开发', research: '资料研究', data: '数据处理' };
  const statuses = ['pass', 'fail', 'unknown'];
  function validateDataset(data) {
    const fail = message => { throw new Error(message); };
    const string = (v, path, max = 3000) => { if (typeof v !== 'string' || !v.trim() || v.length > max) fail(`${path} 必须是非空文本（不超过 ${max} 字符）`); };
    const num = (v, path) => { if (v !== null && (!Number.isFinite(v) || v < 0)) fail(`${path} 必须是非负数或 null`); };
    if (!data || data.version !== 1) fail('version 必须为 1');
    if (typeof data.demo !== 'boolean') fail('demo 必须明确标记为 true 或 false');
    if (!Array.isArray(data.tasks) || !data.tasks.length || data.tasks.length > 100) fail('tasks 需要包含 1—100 个任务');
    const taskIds = new Set(), runIds = new Set();
    data.tasks.forEach((task, ti) => {
      const p = `tasks[${ti}]`;
      if (!task || typeof task !== 'object') fail(`${p} 不是任务对象`);
      for (const field of ['id', 'title', 'description']) string(task[field], `${p}.${field}`);
      if (taskIds.has(task.id)) fail(`${p}.id 重复`); taskIds.add(task.id);
      if (typeof task.scenario !== 'string' || !Object.hasOwn(scenarios, task.scenario)) fail(`${p}.scenario 应为 coding、research 或 data 字符串`);
      if (!Array.isArray(task.goals) || !task.goals.length || task.goals.length > 20) fail(`${p}.goals 需要包含 1—20 项`);
      const goalIds = new Set();
      task.goals.forEach((goal, gi) => {
        if (!goal || typeof goal !== 'object') fail(`${p}.goals[${gi}] 格式错误`);
        string(goal.id, `${p}.goals[${gi}].id`, 100); string(goal.label, `${p}.goals[${gi}].label`, 300);
        if (goalIds.has(goal.id)) fail(`${p} 目标 ID 重复`); goalIds.add(goal.id);
        if (!Number.isInteger(goal.weight) || goal.weight < 1 || goal.weight > 5) fail(`${p} 目标权重应为 1—5 的整数`);
        if (typeof goal.required !== 'boolean') fail(`${p} 目标必须标记 required`);
      });
      if (!Array.isArray(task.runs) || !task.runs.length || task.runs.length > 30) fail(`${p}.runs 需要包含 1—30 条记录`);
      task.runs.forEach((run, ri) => {
        const rp = `${p}.runs[${ri}]`;
        if (!run || typeof run !== 'object') fail(`${rp} 格式错误`);
        for (const field of ['id', 'strategy', 'model', 'comparisonGroup']) string(run[field], `${rp}.${field}`, 300);
        if (runIds.has(run.id)) fail(`${rp}.id 重复`); runIds.add(run.id);
        num(run.tokens, `${rp}.tokens`); num(run.durationSec, `${rp}.durationSec`);
        if (!run.checks || typeof run.checks !== 'object' || Array.isArray(run.checks)) fail(`${rp}.checks 格式错误`);
        for (const key of Object.keys(run.checks)) if (!goalIds.has(key)) fail(`${rp}.checks 引用了不存在的目标 ${key}`);
        for (const goal of task.goals) {
          const check = run.checks[goal.id];
          if (!check || !statuses.includes(check.status)) fail(`${rp}.checks.${goal.id} 缺少有效状态`);
          if (typeof check.evidence !== 'string' || check.evidence.length > 6000) fail(`${rp} 证据应为不超过 6000 字符的文本`);
          if (check.status !== 'unknown' && !check.evidence.trim()) fail(`${rp} 已判定项目必须提供证据`);
        }
        if (!Array.isArray(run.events) || run.events.length > 300) fail(`${rp}.events 应为不超过 300 项的数组`);
        let last = -1;
        run.events.forEach((event, ei) => {
          if (!event || typeof event !== 'object') fail(`${rp}.events[${ei}] 格式错误`);
          string(event.label, `${rp}.events[${ei}].label`, 500); string(event.detail, `${rp}.events[${ei}].detail`, 3000);
          if (!['explore', 'act', 'verify'].includes(event.type)) fail(`${rp} 事件 type 无效`);
          if (!Number.isFinite(event.atSec) || event.atSec < last || event.atSec < 0) fail(`${rp} 事件时间需要非负且按时间排序`);
          if (run.durationSec !== null && event.atSec > run.durationSec) fail(`${rp} 事件时间超出总耗时`);
          last = event.atSec;
        });
      });
    });
    return data;
  }
  function evaluate(task, run, budget = Infinity) {
    const totalWeight = task.goals.reduce((n, g) => n + g.weight, 0);
    const passedWeight = task.goals.reduce((n, g) => n + (run.checks[g.id].status === 'pass' ? g.weight : 0), 0);
    const known = task.goals.filter(g => run.checks[g.id].status !== 'unknown').length;
    const required = task.goals.filter(g => g.required);
    const hardFailed = required.some(g => run.checks[g.id].status === 'fail');
    const hardUnknown = required.some(g => run.checks[g.id].status === 'unknown');
    const allReviewed = known === task.goals.length;
    // Do not let a missing mandatory goal disappear behind a weighted average.
    const accepted = required.length ? !hardFailed && !hardUnknown : task.goals.every(g => run.checks[g.id].status === 'pass');
    const costKnown = run.tokens !== null;
    const withinBudget = costKnown && run.tokens <= budget;
    return { score: Math.round(passedWeight / totalWeight * 100), known, total: task.goals.length,
      accepted, allReviewed, eligible: accepted && allReviewed && withinBudget,
      status: hardFailed ? '未达必需项' : hardUnknown || !allReviewed ? '证据待补' : !accepted ? '目标未通过' : !costKnown ? '成本未知' : !withinBudget ? '超过预算' : '满足条件' };
  }
  function compare(task, budget, group) {
    const runs = task.runs.filter(r => r.comparisonGroup === group);
    const rows = runs.map(run => ({ run, evaluation: evaluate(task, run, budget) }));
    const eligible = rows.filter(r => r.evaluation.eligible);
    const min = eligible.length ? Math.min(...eligible.map(r => r.run.tokens)) : null;
    return { rows, bestIds: min === null ? [] : eligible.filter(r => r.run.tokens === min).map(r => r.run.id) };
  }
  const api = { scenarios, validateDataset, evaluate, compare };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AgentEvaluation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
