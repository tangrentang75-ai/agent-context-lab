(function (root) {
  'use strict';
  const titles = { unchanged: '已检查的内容一致', conditions_changed: '比较条件有变化，先核对原因', inconsistent: '来源声明有冲突，请先核对文件' };
  const kinds = { added: '新增', removed: '删除', changed: '修改' };
  const fields = { status: '验收状态', evidence: '证据文本', tokens: 'token 用量', durationSec: '耗时（秒）', score: '目标得分', eligible: '推荐资格', bestIds: '推荐记录', label: '目标名称', weight: '目标权重', required: '是否为必需项', model: '模型', strategy: '策略', title: '任务名称', known: '已核验目标数', total: '目标总数', accepted: '必需目标是否满足', allReviewed: '是否全部核验' };
  // Imported names stay on one line and cannot create Markdown links, images or HTML.
  function inline(value) {
    return String(value).replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
      .replace(/[!-/:-@\[-`{-~]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] || '\\' + c));
  }
  function block(value) {
    const text = String(value);
    // A longer fence prevents evidence containing backticks from closing its own block.
    let length = 3;
    for (const run of text.matchAll(/`+/g)) length = Math.max(length, run[0].length + 1);
    const fence = '`'.repeat(length);
    return `${fence}\n${text}\n${fence}`;
  }
  function valueText(value, field) {
    if (value === null) return '未知（null）';
    if (value === true) return '是'; if (value === false) return '否';
    if (value === '') return '（空文本）';
    const statuses = { pass: '通过（pass）', fail: '未通过（fail）', unknown: '证据待补（unknown）' };
    if (field === 'status' && Object.hasOwn(statuses, value)) return statuses[value];
    return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
  }
  function context(path, reports) {
    const before = reports.before?.tasks.find(t => t.id === path[1]);
    const after = reports.after?.tasks.find(t => t.id === path[1]);
    const task = after || before;
    const parts = [`任务：${task?.title || path[1]}`];
    if (path[2] === 'groups') parts.push(`条件组：${path[3]}`);
    if (path[4] === 'runs') parts.push(`记录：${path[5]}`);
    const goalId = path[2] === 'goals' ? path[3] : path[6] === 'checks' ? path[7] : null;
    if (goalId) parts.push(`目标：${after?.goals.find(g => g.id === goalId)?.label || before?.goals.find(g => g.id === goalId)?.label || goalId}`);
    return parts.map(inline).join(' / ');
  }
  // Presentation only: callers pass the current comparator result and validated reports.
  function renderComparisonMarkdown(result, reports = {}) {
    if (result?.schema !== 'acl-record-comparison-v1' || !Object.hasOwn(titles, result.status) || !Array.isArray(result.changes) || result.changeCount !== result.changes.length) throw new Error('请先生成有效的对照结果');
    const lines = ['# 两份报告改了什么', '', '任务罗盘 · 完整对照说明', '', '## 先看结论', '', `**${titles[result.status]}**`, '', inline(result.message), '',
      `共 ${result.changeCount} 项字段或条目变化。下面包含全部变化，不受网页筛选、搜索或分页影响。`, '',
      result.before.source.demo || result.after.source.demo ? '**包含人工构造示例，仅用于演示软件行为。**' : '来源由提供者声明；本报告不证明证据真实。', '',
      '“之前”是选择的对照起点，不代表已批准的基准。变化项数不是通过率，也不表示模型提升或退步。', '',
      '## 为什么需要核对', ''];
    if (!result.reasons.length) lines.push('没有发现已检查的比较条件变化。仍需阅读末尾的检查范围。', '');
    for (const [i, reason] of result.reasons.entries()) {
      lines.push(`### 原因 ${i + 1}`, '', inline(reason.message), '');
      if (['source_changed', 'rules_changed'].includes(reason.code)) {
        lines.push('两侧的完整校验值见末尾“对照依据”。', '');
        continue;
      }
      for (const [side, label] of [['before', '之前'], ['after', '之后']]) {
        if (!Object.hasOwn(reason, side)) continue;
        const value = reason[side];
        if (reason.code === 'budget_changed') lines.push(`${label}：每条记录 ${value} token。`, '');
        else if (reason.code === 'source_metadata_changed') lines.push(`${label}：输入大小 ${value.bytes} 字节；${value.demo ? '人工构造示例' : '来源由提供者声明'}。`, '');
        else lines.push(`${label}：`, '', block(valueText(value)), '');
      }
    }
    lines.push('## 逐项变化', '');
    if (!result.changes.length) lines.push('已检查字段没有变化；这不等于比较条件相同，也不等于所有目标通过。', '');
    for (const [i, change] of result.changes.entries()) {
      const field = change.path.at(-1);
      lines.push(`### ${i + 1}. ${kinds[change.kind]} · ${Object.hasOwn(fields, field) ? fields[field] : '条目变化'}`, '', context(change.path, reports), '');
      for (const [side, label] of [['before', '之前'], ['after', '之后']]) lines.push(`**${label}**`, '', block(Object.hasOwn(change, side) ? valueText(change[side], field) : '此侧没有该条目'), '');
      lines.push('原始位置标识（用于定位，按顺序读取）：', '', block(JSON.stringify(change.path)), '');
    }
    lines.push('## 对照依据', '', `对照生成时间：${inline(result.generatedAt)}`, '', `对照软件版本：${inline(result.softwareVersion)}`, '');
    for (const [side, label] of [['before', '之前'], ['after', '之后']]) {
      const report = result[side];
      lines.push(`### ${label}的报告`, '',
        `每条记录预算：${report.budgetTokensPerRun} token。token 是用量记录，不等于实际算力或能耗。`, '',
        `来源标记：${report.source.demo ? '人工构造示例' : '由提供者声明'}；输入大小：${report.source.bytes} 字节。`, '',
        `按本机当前规则重算：${result.validation[side + 'RecomputedWithCurrentRules'] ? '已完成' : '未完成'}。重算只核对评分计算。`, '',
        `生成时间：${inline(report.generatedAt)}；软件版本：${inline(report.softwareVersion)}。`, '',
        '报告文件 SHA-256（识别本次导入文件）：', '', block(result.reportFiles?.[side + 'Sha256'] ?? '未提供'), '',
        '报告声明的原始输入 SHA-256（本次未读取原始输入复核）：', '', block(report.source.sha256), '',
        '评价规则 SHA-256：', '', block(report.evaluator.sha256), '');
    }
    lines.push('## 检查范围与使用提醒', '');
    for (const limitation of result.limitations) lines.push(`- ${inline(limitation)}`);
    lines.push('', '这是便于阅读的 Markdown 说明，包含目标和证据文本。分享前检查私人信息；如需再次对照，请保留原始评估 JSON。', '');
    return lines.join('\n');
  }
  const api = { renderComparisonMarkdown };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AgentReportMarkdown = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
