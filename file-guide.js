(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AgentFileGuide = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_BYTES = 16 * 1024 * 1024;
  const DATASET_MAX_BYTES = 2 * 1024 * 1024;
  const note = '仅识别文件格式与用途，不校验内容完整性、评分或真实性。文件在本地读取，不修改或外发。打开目标页后需再次选择文件，不会自动导入；目标页仍会完整校验。';
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
  const array = (value, key) => own(value, key) && Array.isArray(value[key]);
  const record = (value, key) => own(value, key) && object(value[key]);
  const text = (value, key) => own(value, key) && typeof value[key] === 'string';
  const dataset = value => own(value, 'version') && value.version === 1 && own(value, 'demo') && typeof value.demo === 'boolean' && array(value, 'tasks') && value.tasks.length > 0;
  const home = () => ({ label: '首页：导入记录', href: '/#overview' });
  const generator = () => ({ label: '报告对照：从任务数据生成', href: '/report-comparison.html#generator' });
  const comparison = () => ({ label: '报告对照：选择之前与之后的报告', href: '/report-comparison.html' });
  const backup = () => ({ label: '项目体检：备份与恢复', href: '/project-review.html#review-backup' });

  function result(kind, title, description, steps, destinations, extraNote = '') {
    return { kind, title, description, steps, destinations, note: extraNote ? extraNote + ' ' + note : note };
  }
  function unknown(reason) {
    return result('unknown', '暂不能识别这份文件', reason,
      ['查看原来的导出入口，确认它是哪一类文件。', '请保留原文件，不要通过修改格式标记把它当作另一类文件导入。'], []);
  }
  function identify(value, byteLength) {
    if (!object(value)) return unknown('JSON 根节点需要是普通对象；数组、空值或其他值不属于这里支持的文件格式。');
    const isDataset = dataset(value);
    const hasSchema = own(value, 'schema'), hasReport = own(value, 'reportVersion'), hasType = own(value, 'type');
    if ((hasSchema && (hasReport || hasType || isDataset)) || (hasReport && (hasType || isDataset)) || (hasType && isDataset)) {
      return unknown('文件同时包含冲突的格式标记，无法确定用途。请核对原始导出文件。');
    }

    if (hasSchema) {
      // These checks identify a route only. The destination owns full validation.
      switch (value.schema) {
        case 'acl-record-entry-draft-v1':
          if (!text(value, 'savedAt') || !record(value, 'state') || !record(value.state, 'draft')) break;
          return result('record-entry-draft', '任务记录录入草稿', '这是尚未完成的录入表单，不是有效任务数据，不能当作任务数据导入首页或报告生成器。',
            ['打开任务记录录入页，点击“恢复录入草稿”，再次选择此文件。', '查看恢复预览，由目标页面完整校验草稿内容。', '确认预览后，明确确认替换当前表单；取消即可保留当前表单。'],
            [{ label: '任务记录：恢复录入草稿', href: '/record-entry.html#draft-tools' }], '仅提供恢复入口，不会自动恢复、导入或上传草稿。');
        case 'acl-record-evaluation-v1':
          if (!array(value, 'tasks') || !value.tasks.length) break;
          return result('record-evaluation', '完整记录评估报告', '可与另一份完整评估报告一起查看条件和记录差异。',
            ['打开报告对照页，在“之前的报告”或“之后的报告”中再次选择此文件。', '另一栏选择另一份完整评估报告，再查看对照结果。'], [comparison()]);
        case 'project-review-v1':
          if (!array(value, 'criteria') || !array(value, 'evidence')) break;
          return result('project-review', '项目检查记录', '用于项目体检中的单份检查记录导入。',
            ['打开项目体检页，点击“导入检查记录”。', '再次选择此文件，由项目体检页检查完整内容。'], [{ label: '项目体检：导入检查记录', href: '/project-review.html' }]);
        case 'project-review-backup-v1':
          if (!array(value, 'records')) break;
          return result('project-review-backup', '项目检查备份', '用于恢复浏览器保存过的项目检查及历次记录。',
            ['打开项目体检的“备份与恢复”，点击“恢复检查备份”。', '再次选择此文件。恢复会与现有记录合并；同编号不同内容会被拒绝。'], [backup()]);
        case 'acl-record-comparison-v1':
          if (!record(value, 'before') || !record(value, 'after') || !array(value, 'changes')) break;
          return result('record-comparison', '报告对照结果', '这是对照后导出的结果，不能作为原始评估报告重新导入。',
            ['使用文本阅读工具查看已导出的对照结果。', '若要重新对照，请找到当时使用的两份 acl-record-evaluation-v1 原报告。', '打开报告对照页，分别选择两份原报告。'], [comparison()]);
        case 'observation-plan-envelope-v1':
          if (!record(value, 'plan') || !text(value, 'sha256')) break;
          return result('observation-plan', '独立观察计划', '用于项目体检页的广告观察工具，不会自动改变项目检查结论。',
            ['打开项目体检页的“准备下一轮广告观察”区域。', '点击“导入已有计划”，再次选择此文件。计划内容与校验值由该工具进一步检查。'], [{ label: '广告观察：导入已有计划', href: '/project-review.html#plan-import' }]);
        case 'project-review-storage-recovery-v1':
          if (!text(value, 'storageKey') || !text(value, 'raw')) break;
          return result('storage-recovery', '损坏保存区排查文件', '用于排查浏览器保存区问题；它不是检查备份，不能直接恢复。',
            ['保留这份排查文件，交给维护者检查保存区问题。', '如需恢复记录，请寻找之前导出的 project-review-backup-v1 检查备份。', '不要将这份排查文件直接交给“恢复检查备份”。'], [backup()]);
        default:
          return unknown('文件声明的 schema 不属于已支持的格式，不能据其他字段推测用途。');
      }
      return unknown('文件声明了已知格式，但缺少辨识用途所需的基本结构；请核对原始导出文件。');
    }

    if (isDataset) {
      const oversized = byteLength > DATASET_MAX_BYTES;
      return result('dataset', '首页任务数据', '可用于首页导入记录，或先生成完整评估报告再做报告对照。',
        oversized ? ['此文件超过 2MiB，首页与报告生成器当前均无法导入。', '回到原始数据来源准备符合大小限制的完整任务数据；不要截断 JSON 或丢弃未知记录。'] : ['要查看任务记录：打开首页，点击“导入记录”，再次选择此文件。', '要生成完整评估报告：打开“从任务数据生成”，再次选择此文件并设置预算。'],
        [home(), generator()], oversized ? '超过 2MiB：仅完成用途识别，首页与报告生成器无法导入此文件；未截断或修改数据。' : '首页与报告生成器的任务数据上限均为 2MiB。');
    }
    if (hasReport && value.reportVersion === 1 && record(value, 'task') && array(value, 'results')) {
      return result('single-task-report', '首页单任务评估报告', '这是单个任务的导出报告，不能当作首页任务数据或完整评估报告导入。',
        ['使用文本阅读工具查看这份单任务报告。', '若要导入首页，请寻找“保存当前数据”导出的任务数据。', '若要做报告对照，请用原任务数据在“从任务数据生成”中生成完整评估报告。'], [home(), generator()]);
    }
    if (hasType && value.type === 'cost-estimate' && record(value, 'assumptions')) {
      return result('cost-estimate', '成本假设估算', '这是依据假设计算的估算，不是新的实测结果，不能当作实测数据导入。',
        ['使用文本阅读工具查看保存的假设与估算结果。', '需要实测结论时，请另外取得并核对真实执行记录；不要将估算冒充实测。'], []);
    }
    return unknown('没有找到支持的格式及基本结构，暂不能确定应在哪个入口使用。');
  }

  function identifyBytes(bytes) {
    if (!(bytes instanceof Uint8Array)) throw new Error('请选择文件的原始字节（Uint8Array）。');
    if (bytes.byteLength > MAX_BYTES) throw new Error('文件超过 16MiB，未读取或识别；请保留原文件。');
    let decoded;
    try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new Error('文件不是有效的 UTF-8 文本，请选择 UTF-8 编码的 JSON 文件。'); }
    let value;
    try { value = JSON.parse(decoded); }
    catch { throw new Error('文件不是有效的 JSON，请核对原始导出文件。'); }
    return identify(value, bytes.byteLength);
  }
  return { MAX_BYTES, identifyBytes };
});
