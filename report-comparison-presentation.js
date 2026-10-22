(function (root) {
  'use strict';
  const fields = { status: '验收状态', evidence: '证据文本', tokens: 'token 用量', durationSec: '耗时（秒）', score: '目标得分', eligible: '推荐资格', bestIds: '推荐记录', label: '目标名称', weight: '目标权重', required: '是否为必需项', model: '模型', strategy: '策略', title: '任务名称', known: '已核验目标数', total: '目标总数', accepted: '必需目标是否满足', allReviewed: '是否全部核验' };
  function valueText(value, field) {
    if (value === null) return '未知（null）';
    if (value === true) return '是'; if (value === false) return '否';
    if (value === '') return '（空文本）';
    const statuses = { pass: '通过（pass）', fail: '未通过（fail）', unknown: '证据待补（unknown）' };
    if (field === 'status' && Object.hasOwn(statuses, value)) return statuses[value];
    return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
  }

  // Match structural positions, not identifier text: IDs may themselves be "status" or "__proto__".
  function shape(p) {
    if (p[0] !== 'tasks') return null;
    if (p.length === 2) return 'task';
    if (p[2] === 'goals') return p.length === 3 ? 'goals' : p.length === 4 ? 'goal' : null;
    if (p[2] !== 'groups') return null;
    if (p.length === 3) return 'groups';
    if (p.length === 4) return 'group';
    if (p[4] === 'bestIds' && p.length === 5) return 'recommendations';
    if (p[4] !== 'runs') return null;
    if (p.length === 5) return 'runs';
    if (p.length === 6) return 'run';
    if (p[6] === 'evaluation' && p.length === 7) return 'evaluation';
    if (p[6] === 'checks') return p.length === 7 ? 'checks' : p.length === 8 ? 'check' : null;
    return null;
  }
  const structures = { task: '整个任务', group: '整个条件组', run: '整条运行记录', goal: '验收目标', check: '目标验收项', goals: '目标定义', groups: '条件组', runs: '运行记录', checks: '逐项目标验收', evaluation: '该记录的评价', recommendations: '推荐记录' };

  function titleForPath(path) {
    const type = shape(path), field = path.at(-1);
    return type ? structures[type] : Object.hasOwn(fields, field) ? fields[field] : '条目变化';
  }
  function isStructured(value, path) { return value !== null && typeof value === 'object' && !Array.isArray(value) && shape(path) !== null; }
  // Plain data for both text-only DOM and Markdown renderers. No HTML or scoring here.
  function describeValue(value, path, report) {
    const type = shape(path), field = path.at(-1);
    if (type === 'recommendations' && Array.isArray(value)) return value.length
      ? [{ kind: 'list', label: '推荐记录标识', items: value.map(id => JSON.stringify(id)) }]
      : [{ kind: 'text', text: '没有推荐记录。' }];
    if (!isStructured(value, path)) return [{ kind: 'code', text: valueText(value, field) }];
    const entries = [], collection = { goals: '目标标识', groups: '条件组标识', runs: '记录标识', checks: '目标标识' };
    if (!Object.keys(value).length) return [{ kind: 'text', text: '没有条目。' }];
    for (const [key, child] of Object.entries(value)) {
      const next = [...path, key], childType = shape(next);
      if (Object.hasOwn(collection, type)) {
        const goal = type === 'checks' ? report?.tasks.find(t => t.id === path[1])?.goals.find(g => g.id === key) : null;
        entries.push({ kind: 'heading', text: collection[type] + '：' + JSON.stringify(key) });
        if (goal) entries.push({ kind: 'field', label: '目标名称', text: goal.label });
        entries.push(...describeValue(child, next, report));
      } else if (childType) {
        entries.push({ kind: 'heading', text: structures[childType] }, ...describeValue(child, next, report));
      } else {
        const label = key === 'status' && type === 'evaluation' ? '评价结论' : Object.hasOwn(fields, key) ? fields[key] : key;
        const block = key === 'evidence' || (child !== null && typeof child === 'object') || (typeof child === 'string' && /[\r\n]/.test(child));
        entries.push({ kind: 'field', label, text: valueText(child, key), block });
      }
    }
    return entries;
  }
  const api = { describeValue, titleForPath, isStructured, valueText };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AgentReportPresentation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
