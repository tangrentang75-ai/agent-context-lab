'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const F = require('./file-guide.js');
const bytes = value => Buffer.from(JSON.stringify(value));
const identify = value => F.identifyBytes(bytes(value));
const entryDraft = () => ({ schema: 'acl-record-entry-draft-v1', savedAt: '2026-10-23T00:00:00.000Z',
  state: { draft: { task: {}, goals: [], runs: [] }, locked: false, lockedTask: null, lockedGoals: [], budget: '', goalSequence: 1, runSequence: 0 } });
const examples = [
  [{ version: 1, demo: false, tasks: [{}] }, 'dataset'],
  [{ schema: 'acl-record-evaluation-v1', tasks: [{}] }, 'record-evaluation'],
  [{ schema: 'project-review-v1', criteria: [], evidence: [] }, 'project-review'],
  [{ schema: 'project-review-backup-v1', records: [] }, 'project-review-backup'],
  [{ schema: 'acl-record-comparison-v1', before: {}, after: {}, changes: [] }, 'record-comparison'],
  [{ reportVersion: 1, task: {}, results: [] }, 'single-task-report'],
  [{ type: 'cost-estimate', assumptions: {} }, 'cost-estimate'],
  [{ schema: 'observation-plan-envelope-v1', plan: {}, sha256: '由目标页检查' }, 'observation-plan'],
  [{ schema: 'project-review-storage-recovery-v1', storageKey: 'acl-project-reviews-v1', raw: '损坏的原内容' }, 'storage-recovery'],
  [entryDraft(), 'record-entry-draft']
];

test('识别十类用途，只辨识最少结构而不替目标页校验内容', () => {
  for (const [input, kind] of examples) {
    const r = identify(input);
    assert.equal(r.kind, kind);
    assert.deepEqual(Object.keys(r), ['kind', 'title', 'description', 'steps', 'destinations', 'note']);
    assert.ok(r.steps.length > 0);
    assert.match(r.note, /仅识别文件格式与用途/);
    assert.match(r.note, /不校验内容完整性、评分或真实性/);
    assert.match(r.note, /再次选择文件/);
    assert.match(r.note, /不会自动导入/);
  }
  assert.match(identify(examples[4][0]).description, /不能作为原始评估报告/);
  assert.match(identify(examples[5][0]).description, /不能当作首页任务数据或完整评估报告/);
  assert.match(identify(examples[6][0]).description, /不是新的实测结果/);
  assert.match(identify(examples[8][0]).description, /不是检查备份，不能直接恢复/);
});

test('未知、非对象、空任务和声明冲突不猜测用途', () => {
  for (const input of [null, [], [examples[0][0]], 'text', 2, {},
    { version: 1, demo: false, tasks: [] }, { version: 1, demo: 'false', tasks: [{}] },
    { schema: 'unknown', ...examples[0][0] }, { schema: 'constructor', tasks: [{}] },
    { schema: 'project-review-backup-v1' },
    { ...examples[0][0], schema: 'acl-record-evaluation-v1' },
    { ...examples[0][0], reportVersion: 1, task: {}, results: [] },
    { ...examples[1][0], type: 'cost-estimate', assumptions: {} },
    { ...examples[6][0], reportVersion: 1, task: {}, results: [] }]) {
    assert.equal(identify(input).kind, 'unknown');
    assert.deepEqual(identify(input).destinations, []);
  }
});

test('严格 UTF-8，允许 BOM，尊重 Uint8Array 的视图边界', () => {
  const original = bytes(examples[0][0]);
  assert.equal(F.identifyBytes(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), original])).kind, 'dataset');
  const padded = Buffer.concat([Buffer.from([0xff]), original, Buffer.from([0xff])]);
  assert.equal(F.identifyBytes(padded.subarray(1, -1)).kind, 'dataset');
  for (const bad of [Buffer.from([0xff]), Buffer.from([0xc3, 0x28]), Buffer.from([0xef, 0xbb])]) assert.throws(() => F.identifyBytes(bad), /UTF-8/);
});

test('无效 JSON 和非字节输入使用固定中文错误，不泄露输入内容', () => {
  for (const bad of ['', '{', '{"secret":"PRIVATE"', '{"a":1,}', '//注释\n{}']) {
    assert.throws(() => F.identifyBytes(Buffer.from(bad)), error => /不是有效的 JSON/.test(error.message) && !error.message.includes('PRIVATE'));
  }
  for (const bad of ['{}', null, [], new ArrayBuffer(2), new DataView(new ArrayBuffer(2))]) assert.throws(() => F.identifyBytes(bad), /原始字节/);
});

test('16MiB 总上限与 2MiB 首页上限精确按原字节计算，不截断', () => {
  assert.equal(F.MAX_BYTES, 16 * 1024 * 1024);
  const core = bytes(examples[0][0]);
  const atHomeLimit = Buffer.concat([core, Buffer.alloc(2 * 1024 * 1024 - core.length, 32)]);
  assert.doesNotMatch(F.identifyBytes(atHomeLimit).note, /超过 2MiB/);
  const aboveHomeLimit = Buffer.concat([atHomeLimit, Buffer.from(' ')]);
  assert.equal(F.identifyBytes(aboveHomeLimit).kind, 'dataset');
  assert.match(F.identifyBytes(aboveHomeLimit).note, /首页与报告生成器无法导入/);
  assert.match(F.identifyBytes(aboveHomeLimit).note, /未截断或修改/);
  const atMax = Buffer.concat([core, Buffer.alloc(F.MAX_BYTES - core.length, 32)]);
  assert.equal(F.identifyBytes(atMax).kind, 'dataset');
  assert.throws(() => F.identifyBytes(Buffer.alloc(F.MAX_BYTES + 1)), /超过 16MiB/);
});

test('特殊键和输入正文不进入输出，不更改字节或对象原型', () => {
  const input = Buffer.from('{"version":1,"demo":false,"tasks":[{}],"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"title":"PRIVATE_TITLE","text":"PRIVATE_BODY","path":"PRIVATE_PATH","href":"https://evil.example"}');
  const before = Buffer.from(input), output = F.identifyBytes(input);
  assert.equal(output.kind, 'dataset');
  assert.deepEqual(input, before);
  assert.equal({}.polluted, undefined);
  assert.doesNotMatch(JSON.stringify(output), /PRIVATE_|evil\.example|polluted/);
  assert.equal(identify(JSON.parse('{"__proto__":{"version":1,"demo":false,"tasks":[{}]}}')).kind, 'unknown');
});

test('目的链接均为固定同站入口，锚点或首页视图确实存在', () => {
  const allowed = new Set(['/#overview', '/report-comparison.html#generator', '/report-comparison.html', '/project-review.html', '/project-review.html#review-backup', '/project-review.html#plan-import', '/record-entry.html#draft-tools']);
  for (const [input] of examples) for (const destination of identify({ ...input, href: 'https://evil.example' }).destinations) {
    assert.ok(allowed.has(destination.href));
    const [file, anchor] = destination.href.slice(1).split('#');
    if (anchor) {
      const html = fs.readFileSync(require('node:path').join(__dirname, file || 'index.html'), 'utf8');
      assert.ok(html.includes('id="' + (file ? anchor : 'view-' + anchor) + '"'));
      if (!file) assert.ok(html.includes('data-view="' + anchor + '"'));
    }
  }
});

test('浏览器全局和 CommonJS 暴露相同 API，调用结果互不共享可变数组', () => {
  const context = vm.createContext({ TextDecoder, Uint8Array });
  vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, 'file-guide.js'), 'utf8'), context);
  assert.equal(context.AgentFileGuide.MAX_BYTES, F.MAX_BYTES);
  assert.equal(context.AgentFileGuide.identifyBytes(bytes(examples[0][0])).kind, 'dataset');
  const a = identify(examples[0][0]);
  a.steps.push('污染'); a.destinations[0].href = 'https://evil.example';
  const b = identify(examples[0][0]);
  assert.doesNotMatch(JSON.stringify(b), /污染|evil\.example/);
});

test('录入草稿引导重新选择、预览与确认替换，不把未完成表单当作有效任务数据', () => {
  for (const input of [entryDraft(), { schema: 'acl-record-entry-draft-v1', savedAt: '由目标页校验时间', state: { draft: {} } }]) {
    const result = identify(input);
    assert.equal(result.kind, 'record-entry-draft');
    assert.match(result.description, /尚未完成的录入表单/);
    assert.match(result.description, /不是有效任务数据/);
    assert.deepEqual(result.destinations, [{ label: '任务记录：恢复录入草稿', href: '/record-entry.html#draft-tools' }]);
    assert.match(result.steps[0], /恢复录入草稿.*再次选择/);
    assert.match(result.steps[1], /预览.*完整校验/);
    assert.match(result.steps[2], /明确确认替换当前表单/);
    assert.match(result.note, /不会自动恢复、导入或上传/);
  }
});

test('录入草稿缺少基本结构、声明未知格式或混入其他格式标记时不猜测入口', () => {
  const input = entryDraft();
  for (const bad of [
    { ...input, savedAt: null }, { ...input, state: null }, { ...input, state: [] },
    { ...input, state: {} }, { ...input, state: { draft: [] } },
    { ...input, schema: 'unrecognized-draft' }, { ...input, schema: ['acl-record-entry-draft-v1', 'project-review-backup-v1'] },
    { ...input, version: 1, demo: false, tasks: [{}] },
    { ...input, reportVersion: 1, task: {}, results: [] },
    { ...input, type: 'cost-estimate', assumptions: {} }
  ]) {
    const result = identify(bad);
    assert.equal(result.kind, 'unknown');
    assert.deepEqual(result.destinations, []);
  }
});

test('录入草稿内容和特殊键不影响固定恢复链接，不回显或更改文件字节', () => {
  const input = entryDraft();
  input.savedAt = 'PRIVATE_TIMESTAMP';
  input.state.draft = JSON.parse('{"title":"PRIVATE_TITLE","body":"<script>PRIVATE_BODY</script>","href":"javascript:PRIVATE_LINK","__proto__":{"polluted":true}}');
  input.href = 'https://evil.example/restore';
  const original = bytes(input), before = Buffer.from(original), result = F.identifyBytes(original);
  assert.equal(result.kind, 'record-entry-draft');
  assert.deepEqual(original, before);
  assert.equal({}.polluted, undefined);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|<script>|evil\.example|polluted/);
  assert.deepEqual(result.destinations.map(destination => destination.href), ['/record-entry.html#draft-tools']);
});
