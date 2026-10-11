(function (root) {
  'use strict';
  const kinds = { document: '方案与材料', desktop: '电脑测试', device: '设备实测记录', participant: '参与者观察记录' };
  const statuses = { pass: '已有依据', fail: '发现问题', unknown: '证据待补' };
  const own = (obj, key) => Object.hasOwn(obj, key);
  function validate(input) {
    const fail = message => { throw Error(message); };
    const object = (v, p) => { if (!v || typeof v !== 'object' || Array.isArray(v)) fail(p + ' 应为对象'); };
    const text = (v, p, max = 2000) => { if (typeof v !== 'string' || !v.trim() || v.length > max) fail(p + ' 需要非空文本，最多 ' + max + ' 字符'); return v; };
    const id = (v, p) => { text(v, p, 100); if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(v)) fail(p + ' 只能使用字母、数字、短横线和下划线'); return v; };
    const date = (v, p) => { if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v)) || new Date(v).toISOString().slice(0,10) !== v) fail(p + ' 日期无效'); return v; };
    const array = (v, p, min, max) => { if (!Array.isArray(v) || v.length < min || v.length > max) fail(p + ' 数量应为 ' + min + '—' + max); };
    object(input, '记录');
    if (input.schema !== 'project-review-v1') fail('需要 project-review-v1 格式');
    const out = { schema: input.schema, id: id(input.id, '检查编号'), projectId: id(input.projectId, '项目编号'),
      title: text(input.title, '项目名称', 200), date: date(input.date, '检查日期'), version: text(input.version, '当前版本', 120),
      scope: text(input.scope, '检查范围', 3000), reviewer: text(input.reviewer, '审阅方式', 300),
      limitations: [], evidence: [], criteria: [] };
    array(input.limitations, '检查边界', 1, 20);
    out.limitations = input.limitations.map(v => text(v, '检查边界', 1200));
    array(input.evidence, '证据', 0, 150);
    const evidenceIds = new Set();
    for (const e of input.evidence) {
      object(e, '证据'); id(e.id, '证据编号');
      if (evidenceIds.has(e.id)) fail('证据编号重复'); evidenceIds.add(e.id);
      if (!own(kinds, e.kind)) fail('证据类型无效');
      const recordedAt = date(e.date, '证据日期');
      if (recordedAt > out.date) fail('证据日期晚于检查日期');
      const item = { id: e.id, title: text(e.title, '证据标题', 200), kind: e.kind, date: recordedAt,
        version: text(e.version, '证据版本', 120), locator: text(e.locator, '证据位置', 500),
        text: text(e.text, '证据节选', 16000) };
      if (e.sha256 !== undefined) { if (!/^[a-f0-9]{64}$/.test(e.sha256)) fail('证据原文件哈希无效'); item.sha256 = e.sha256; }
      out.evidence.push(item);
    }
    array(input.criteria, '检查项', 1, 20);
    const criterionIds = new Set();
    for (const c of input.criteria) {
      object(c, '检查项'); id(c.id, '检查项编号');
      if (criterionIds.has(c.id)) fail('检查项编号重复'); criterionIds.add(c.id);
      if (typeof c.required !== 'boolean') fail('检查项需要明确是否必需');
      if (!own(statuses, c.status)) fail('检查项状态无效');
      if (!['current', 'any'].includes(c.versionPolicy)) fail('检查项版本要求无效');
      array(c.kinds, '可用证据类型', 1, 4);
      if (c.kinds.some(k => !own(kinds, k)) || new Set(c.kinds).size !== c.kinds.length) fail('检查项证据类型无效或重复');
      array(c.refs, '引用', 0, 20);
      const refs = c.refs.map(r => { object(r, '引用'); if (!evidenceIds.has(r.evidenceId)) fail('引用了不存在的证据'); return { evidenceId: r.evidenceId, quote: text(r.quote, '引文', 3000) }; });
      object(c.next, '下一步');
      if (!['now', 'next', 'later'].includes(c.next.priority)) fail('下一步优先级无效');
      out.criteria.push({ id: c.id, label: text(c.label, '检查项名称', 200), required: c.required,
        kinds: [...c.kinds], versionPolicy: c.versionPolicy, status: c.status, summary: text(c.summary, '判断依据', 3000), refs,
        next: { action: text(c.next.action, '下一步动作', 500), owner: text(c.next.owner, '负责人角色', 200),
          method: text(c.next.method, '验证方法', 1500), doneWhen: text(c.next.doneWhen, '完成证据', 1500), priority: c.next.priority } });
    }
    return out;
  }
  function assess(input) {
    const review = validate(input), evidence = new Map(review.evidence.map(e => [e.id, e]));
    const rows = review.criteria.map(c => {
      const refs = c.refs.map(r => {
        const e = evidence.get(r.evidenceId), issues = [];
        if (!e.text.includes(r.quote)) issues.push('引文与保存的节选不一致');
        if (!c.kinds.includes(e.kind)) issues.push('证据类型不符合本项要求');
        if (c.versionPolicy === 'current' && e.version !== review.version) issues.push('证据来自其他版本');
        return { ...r, evidence: e, valid: issues.length === 0, issues };
      });
      // Reject a claimed conclusion if ANY of its cited support is invalid. Do not silently drop it.
      const supported = refs.length > 0 && refs.every(r => r.valid);
      const status = c.status === 'unknown' || !supported ? 'unknown' : c.status;
      return { ...c, refs, status, declaredStatus: c.status, downgraded: status !== c.status,
        issues: [...new Set(refs.flatMap(r => r.issues).concat(!refs.length && c.status !== 'unknown' ? ['没有可核对的引用'] : []))] };
    });
    const counts = { pass: 0, fail: 0, unknown: 0 };
    rows.forEach(r => counts[r.status]++);
    const required = rows.filter(r => r.required), blockers = required.filter(r => r.status !== 'pass');
    return { review, rows, counts, blockers,
      status: required.some(r => r.status === 'fail') ? '有问题需要先处理' : blockers.length || counts.unknown ? '证据待补' : counts.fail ? '必需项已有依据，仍有补充问题' : '清单已核对，待人工确认',
      independentlyVerified: false, approvedForDeployment: false,
      next: rows.filter(r => r.status !== 'pass').sort((a,b) =>
        Number(b.required) - Number(a.required) || ['now','next','later'].indexOf(a.next.priority) - ['now','next','later'].indexOf(b.next.priority) || Number(b.status==='fail')-Number(a.status==='fail')) };
  }
  function definition(c) {
    return JSON.stringify([c.label, c.required, [...c.kinds].sort(), c.versionPolicy]);
  }
  function newRound(input, fields) {
    const old=validate(input), next={...old,...fields};
    if(next.id===old.id)throw Error('新一轮需要新的检查编号');
    if(next.projectId!==old.projectId)throw Error('新一轮必须属于同一项目');
    if(next.date<old.date)throw Error('新一轮日期不能早于上次检查');
    if(next.version!==old.version)next.criteria=next.criteria.map(c=>c.versionPolicy==='current'?{...c,status:'unknown'}:c);
    return validate(next);
  }
  function compare(before, after) {
    const a = assess(before), b = assess(after);
    if (a.review.projectId !== b.review.projectId) throw Error('只能比较同一项目的检查记录');
    if (a.review.date > b.review.date) throw Error('基线日期不能晚于当前记录');
    const old = new Map(a.rows.map(r => [r.id, r]));
    const rows = b.rows.map(r => {
      const prev = old.get(r.id); old.delete(r.id);
      return { id: r.id, label: r.label, before: prev?.status ?? null, after: r.status,
        change: !prev ? '新增检查项' : definition(prev) !== definition(r) ? '标准已变，不能直接比较' : prev.status === r.status ? '状态未变' : statuses[prev.status] + ' → ' + statuses[r.status] };
    });
    for (const r of old.values()) rows.push({ id:r.id, label:r.label, before:r.status, after:null, change:'本轮移除，不能视为通过' });
    return { before: a.review.id, after: b.review.id, rows, warning: '比较检查记录的变化，不计算产品效果或策略优劣。相同状态可能包含新的证据。' };
  }
  function toDataset(input) {
    const result = assess(input), r = result.review;
    return { version: 1, demo: false, source: 'project-review-declared-evidence', limitations: [...r.limitations, '导入来源由提交者声明，未自动验证真实性或语义。'],
      tasks: [{ id: r.projectId, title: r.title, description: r.scope, scenario: 'research',
        goals: result.rows.map(c => ({ id:c.id, label:c.label, required:c.required, weight:1 })),
        runs: [{ id:r.id, strategy:'项目证据清单审阅', model:r.reviewer, comparisonGroup:r.id, tokens:null, durationSec:null, events:[],
          checks:Object.fromEntries(result.rows.map(c => [c.id,{status:c.status,evidence:c.summary+(c.issues.length ? '；引用问题：'+c.issues.join('；') : '')}])) }] }] };
  }
  function markdown(input) {
    const result = assess(input), r = result.review;
    const clean = v => v.replace(/[\r\n]/g,' ').replace(/[<>]/g,'').replace(/([\\`*_[\]#|])/g,'\\$1');
    let out = '# '+clean(r.title)+'\n\n'+r.date+' · '+clean(r.version)+'\n\n'+result.status+'。已有依据 '+result.counts.pass+' 项，发现问题 '+result.counts.fail+' 项，证据待补 '+result.counts.unknown+' 项。\n\n';
    out += clean(r.scope)+'\n\n## 检查边界\n\n'+r.limitations.map(v => '- '+clean(v)).join('\n')+'\n\n材料匹配只检查引文、类型和版本，不证明原始记录真实或推论正确；不构成上线或扩大试用批准。\n\n';
    for (const c of result.rows) {
      out += '## '+clean(c.label)+'\n\n'+statuses[c.status]+' · '+(c.required?'必需':'补充')+'\n\n'+clean(c.summary)+'\n\n';
      if(c.issues.length) out += '引用问题：'+c.issues.map(clean).join('；')+'。\n\n';
      for (const ref of c.refs) out += '> '+clean(ref.quote)+'\n\n来源：'+clean(ref.evidence.locator)+'；'+ref.evidence.date+'；'+clean(ref.evidence.version)+'。\n\n';
      if(c.status !== 'pass') out += '下一步：'+clean(c.next.action)+'。由'+clean(c.next.owner)+'负责。\n\n方法：'+clean(c.next.method)+'\n\n完成证据：'+clean(c.next.doneWhen)+'\n\n';
    }
    return out;
  }
  const api = { kinds, statuses, validate, assess, newRound, compare, toDataset, markdown };
  if(typeof module==='object' && module.exports) module.exports=api;
  root.ProjectReview=api;
})(typeof globalThis!=='undefined'?globalThis:this);
