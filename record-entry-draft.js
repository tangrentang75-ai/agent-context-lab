(function (root) {
  'use strict';
  const MAX_BYTES = 16 * 1024 * 1024;
  const SCHEMA = 'acl-record-entry-draft-v1';
  const own = (value, key) => Object.hasOwn(value, key);
  function fail(message) { throw new Error(message); }
  function record(value, allowed, label) {
    if (!value || typeof value !== 'object' || Object.prototype.toString.call(value) !== '[object Object]') fail(`${label}必须是普通对象`);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null && Object.getPrototypeOf(prototype) !== null) fail(`${label}必须是普通对象`);
    for (const key of Reflect.ownKeys(value)) if (typeof key !== 'string' || !allowed.includes(key)) fail(`${label}包含不支持的字段 ${String(key)}；为避免丢失内容，未恢复草稿`);
    return value;
  }
  function text(value, label, max, required = false, multiline = false) {
    if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(`${label}需要${required ? '非空' : ''}文本，最多 ${max} 字符`);
    if (value.includes('\r') || (!multiline && value.includes('\n'))) fail(`${label}含有表单不能原样恢复的换行符；多行文字请使用 LF 换行`);
    return value;
  }
  function bool(value, label) {
    if (typeof value !== 'boolean') fail(`${label}必须是布尔值`);
    return value;
  }
  function sequence(value, label) {
    if (!Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER) fail(`${label}必须是可安全递增的非负整数`);
    return value;
  }
  function list(value, label, min, max) {
    if (!Array.isArray(value) || value.length < min || value.length > max) fail(`${label}需要 ${min}—${max} 项`);
    for (const key of Reflect.ownKeys(value)) if (key !== 'length' && (typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) fail(`${label}包含不支持的数组字段`);
    return value;
  }
  function task(value, label, required, withLists) {
    record(value, withLists ? ['id', 'title', 'description', 'scenario', 'goals', 'runs'] : ['id', 'title', 'description', 'scenario'], label);
    const result = { id: text(value.id, `${label} ID`, 100, true), title: text(value.title, `${label}名称`, 3000, required), description: text(value.description, `${label}范围`, 3000, required, true), scenario: value.scenario };
    if (!['coding', 'research', 'data'].includes(result.scenario)) fail(`${label}类型无效`);
    return result;
  }
  function goals(value, label, required, emptyAllowed = false) {
    list(value, label, emptyAllowed ? 0 : 1, 20);
    const ids = new Set();
    return Array.from(value, (goal, index) => {
      const path = `${label} ${index + 1}`;
      record(goal, ['id', 'label', 'weight', 'required'], path);
      const id = text(goal.id, `${path} ID`, 100, true);
      if (ids.has(id)) fail(`${label} ID 重复`);
      ids.add(id);
      if (!((typeof goal.weight === 'number' && Number.isInteger(goal.weight) && goal.weight >= 1 && goal.weight <= 5) || (typeof goal.weight === 'string' && /^[1-5]$/.test(goal.weight)))) fail(`${path}权重应为 1—5`);
      return { id, label: text(goal.label, `${path}名称`, 300, required), weight: required ? Number(goal.weight) : goal.weight, required: bool(goal.required, `${path}必需标记`) };
    });
  }
  function sameGoals(a, b) {
    return a.length === b.length && a.every((goal, index) => {
      const other = b[index];
      return goal.id === other.id && goal.label === other.label && Number(goal.weight) === other.weight && goal.required === other.required;
    });
  }
  function checkSequence(ids, prefix, value, label) {
    for (const id of ids) {
      if (!id.startsWith(prefix)) continue;
      const suffix = id.slice(prefix.length);
      if (!/^[1-9]\d*$/.test(suffix)) continue;
      const used = Number(suffix);
      if (!Number.isSafeInteger(used) || used > value) fail(`${label}小于已有 ID 序号；恢复后可能产生重复 ID`);
    }
  }
  function normalize(snapshot) {
    record(snapshot, ['draft', 'locked', 'lockedTask', 'lockedGoals', 'budget', 'goalSequence', 'runSequence'], '草稿状态');
    const locked = bool(snapshot.locked, '锁定状态');
    const draft = task(snapshot.draft, '当前任务', locked, true);
    draft.goals = goals(snapshot.draft.goals, '当前目标', locked);
    const lockedTask = snapshot.lockedTask === null ? null : task(snapshot.lockedTask, '已锁定任务', true, false);
    const lockedGoals = goals(snapshot.lockedGoals, '已锁定目标', true, true);
    if ((lockedTask === null) !== (lockedGoals.length === 0)) fail('已锁定任务与目标的基线不完整');
    if (lockedTask && lockedTask.id !== draft.id) fail('当前任务 ID 与已锁定任务不一致');
    if (locked && (!lockedTask || JSON.stringify(draftWithoutLists(draft)) !== JSON.stringify(lockedTask) || !sameGoals(draft.goals, lockedGoals))) fail('锁定状态下的任务与目标必须和基线一致');
    list(snapshot.draft.runs, '执行记录', 0, 30);
    const currentIds = new Set(draft.goals.map(goal => goal.id));
    const baselineIds = new Set(lockedGoals.map(goal => goal.id));
    if (snapshot.draft.runs.length && !lockedTask) fail('已有执行记录必须保留任务与目标基线');
    if (snapshot.draft.runs.length && lockedGoals.some(goal => !currentIds.has(goal.id))) fail('已有记录时不能删除基线目标，以免丢失证据');
    const runIds = new Set();
    draft.runs = Array.from(snapshot.draft.runs, (run, index) => {
      const label = `执行记录 ${index + 1}`;
      record(run, ['id', 'strategy', 'model', 'comparisonGroup', 'tokens', 'durationSec', 'checks', 'needsReview', 'open'], label);
      const result = { id: text(run.id, `${label} ID`, 300, true), strategy: text(run.strategy, `${label}策略`, 300), model: text(run.model, `${label}模型`, 300), comparisonGroup: text(run.comparisonGroup, `${label}条件组`, 300), tokens: text(run.tokens, `${label} token 输入`, 100), durationSec: text(run.durationSec, `${label}耗时输入`, 100) };
      if (runIds.has(result.id)) fail('执行记录 ID 重复');
      runIds.add(result.id);
      record(run.checks, [...currentIds], `${label}验收记录`);
      result.checks = Object.fromEntries(draft.goals.map(goal => {
        if (!own(run.checks, goal.id)) {
          if (locked || baselineIds.has(goal.id)) fail(`${label}缺少已有目标 ${goal.id} 的验收记录，不能推测或丢弃证据`);
          return [goal.id, { status: 'unknown', evidence: '' }];
        }
        const check = run.checks[goal.id];
        record(check, ['status', 'evidence'], `${label}目标 ${goal.id}`);
        if (!['pass', 'fail', 'unknown'].includes(check.status)) fail(`${label}目标 ${goal.id} 的验收状态无效`);
        return [goal.id, { status: check.status, evidence: text(check.evidence, `${label}目标 ${goal.id} 的证据`, 6000, false, true) }];
      }));
      for (const key of ['open', 'needsReview']) if (own(run, key)) result[key] = bool(run[key], `${label} ${key}`);
      return result;
    });
    const budget = text(snapshot.budget, '预算输入', 100);
    const goalSequence = sequence(snapshot.goalSequence, '目标序号');
    const runSequence = sequence(snapshot.runSequence, '执行记录序号');
    checkSequence([...currentIds, ...baselineIds], 'g', goalSequence, '目标序号');
    checkSequence(runIds, `${draft.id}-run-`, runSequence, '执行记录序号');
    return { draft, locked, lockedTask, lockedGoals, budget, goalSequence, runSequence };
  }
  function draftWithoutLists(draft) {
    return { id: draft.id, title: draft.title, description: draft.description, scenario: draft.scenario };
  }
  function serialize(snapshot) {
    const state = normalize(snapshot);
    const json = JSON.stringify({ schema: SCHEMA, savedAt: new Date().toISOString(), state }, null, 2) + '\n';
    const bytes = new TextEncoder().encode(json).byteLength;
    if (bytes > MAX_BYTES) fail('草稿文件超过 16MiB，未生成下载文件；请缩短证据或减少记录');
    return { json, bytes, snapshot: state };
  }
  // JSON.parse would silently overwrite repeated keys, including evidence. Reject them first.
  function rejectDuplicateKeys(json) {
    const stack = [];
    for (let i = 0; i < json.length; i++) {
      const char = json[i];
      if (char === '{') stack.push({ object: true, key: true, keys: new Set() });
      else if (char === '[') stack.push({ object: false });
      else if (char === '}' || char === ']') stack.pop();
      else if (char === ',') { if (stack.at(-1)?.object) stack.at(-1).key = true; }
      else if (char === '"') {
        const start = i;
        while (++i < json.length) { if (json[i] === '\\') i++; else if (json[i] === '"') break; }
        const parent = stack.at(-1);
        if (parent?.object && parent.key) {
          const key = JSON.parse(json.slice(start, i + 1));
          if (parent.keys.has(key)) fail(`草稿 JSON 包含重复字段 ${key}；为避免覆盖证据，未恢复草稿`);
          parent.keys.add(key); parent.key = false;
        }
      }
    }
  }
  function parseBytes(bytes) {
    if (!ArrayBuffer.isView(bytes) || Object.prototype.toString.call(bytes) !== '[object Uint8Array]' || bytes.byteLength < 1 || bytes.byteLength > MAX_BYTES) fail('请选择非空且不超过 16MiB 的 UTF-8 草稿文件');
    let json;
    try { json = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { fail('草稿不是有效的 UTF-8 文件'); }
    let envelope;
    try { envelope = JSON.parse(json); }
    catch { fail('草稿不是有效的 JSON 文件'); }
    rejectDuplicateKeys(json);
    record(envelope, ['schema', 'savedAt', 'state'], '草稿文件');
    if (envelope.schema !== SCHEMA) fail('这不是受支持的录入草稿文件；任务数据与评估报告不能作为草稿恢复');
    const savedAt = text(envelope.savedAt, '保存时间', 24, true);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(savedAt) || !Number.isFinite(Date.parse(savedAt)) || new Date(savedAt).toISOString() !== savedAt) fail('草稿保存时间不是有效的 ISO 时间');
    return normalize(envelope.state);
  }
  const api = { MAX_BYTES, serialize, parseBytes };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AgentRecordEntryDraft = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
