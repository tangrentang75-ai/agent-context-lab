'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const html = fs.readFileSync(require.resolve('./start.html'), 'utf8');
const dataset = { version: 1, demo: false, tasks: [{}] };
const backup = { schema: 'project-review-backup-v1', records: [] };
const resultIds = ['file-title', 'file-description', 'file-steps', 'file-destinations', 'file-note'];
const encoded = value => new TextEncoder().encode(JSON.stringify(value));
const file = value => rawFile(encoded(value));
function rawFile(bytes) {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : Uint8Array.from(bytes);
  return { name: 'PRIVATE_FILE.json', size: data.byteLength, arrayBuffer: async () => data.buffer };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Execute both browser scripts against only the elements actually present in start.html.
function harness() {
  class Element {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.listeners = {}; this.dataset = {}; this.value = ''; this.hidden = false; this._text = ''; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this._text = String(value); this.children = []; }
    set innerHTML(_) { throw Error('File instructions must be rendered as text'); }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this._text = ''; this.children = [...nodes]; }
    addEventListener(type, fn) { this.listeners[type] = fn; }
    async emit(type) { return this.listeners[type]?.({ target: this }); }
  }
  const nodes = new Map();
  for (const match of html.matchAll(/<([a-z][\w-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)) {
    const node = new Element(match[1]); node.hidden = /\bhidden\b/.test(match[2]); nodes.set(match[3], node);
  }
  const get = id => { assert.ok(nodes.has(id), 'Missing actual page element: ' + id); return nodes.get(id); };
  const effects = [];
  const forbid = name => () => { effects.push(name); throw Error('Unexpected side effect: ' + name); };
  const context = vm.createContext({ TextDecoder, Uint8Array,
    document: { getElementById: get, createElement: tag => new Element(tag) },
    fetch: forbid('fetch'), localStorage: { setItem: forbid('storage write'), removeItem: forbid('storage removal') },
    open: forbid('automatic navigation')
  });
  for (const path of ['./file-guide.js', './start-ui.js']) vm.runInContext(fs.readFileSync(require.resolve(path), 'utf8'), context);
  return { get, effects,
    select(selected) { get('guide-file').files = selected ? [selected] : []; get('guide-file').value = selected ? 'selected' : ''; return get('guide-file').emit('change'); },
    clear() { return get('clear-file').emit('click'); },
    snapshot() { return JSON.stringify({ hidden: get('file-result').hidden, texts: resultIds.map(id => get(id).textContent), hrefs: get('file-destinations').children.map(a => a.href), notice: get('file-notice').textContent, error: get('file-notice').dataset.error }); }
  };
}
function assertCleared(h) {
  assert.equal(h.get('file-result').hidden, true);
  for (const id of resultIds) { assert.equal(h.get(id).textContent, '', id); assert.equal(h.get(id).children.length, 0, id); }
}

test('后选文件先完成时，旧读取成功、解析失败或读取失败都不能覆盖新结果', async () => {
  for (const outcome of ['success', 'parse', 'read']) {
    const h = harness(), slow = deferred();
    await h.select(file(dataset));
    const old = h.select({ size: 100, arrayBuffer: () => slow.promise });
    assertCleared(h);
    await h.select(file(backup));
    assert.equal(h.get('file-title').textContent, '项目检查备份');
    const latest = h.snapshot();
    if (outcome === 'read') slow.reject(Error('PRIVATE_READ_ERROR'));
    else slow.resolve(outcome === 'parse' ? new TextEncoder().encode('{').buffer : encoded(dataset).buffer);
    await old;
    assert.equal(h.snapshot(), latest);
    assert.deepEqual(h.effects, []);
  }
});

test('清空和空文件选择均作废在途读取，旧成功或错误不重新显示结果', async () => {
  for (const action of ['clear', 'empty']) for (const outcome of ['success', 'read']) {
    const h = harness(), slow = deferred();
    const pending = h.select({ size: 100, arrayBuffer: () => slow.promise });
    if (action === 'clear') await h.clear(); else await h.select(null);
    assert.equal(h.get('guide-file').value, '');
    assertCleared(h);
    const cleared = h.snapshot();
    if (outcome === 'read') slow.reject(Error('PRIVATE_READ_ERROR'));
    else slow.resolve(encoded(dataset).buffer);
    await pending;
    assert.equal(h.snapshot(), cleared);
    assert.equal(h.get('file-notice').dataset.error, 'false');
  }
});

test('无效或超限文件清除旧结果，超限不读取，并阻止更早读取回写', async () => {
  let oversizeReads = 0;
  const cases = [
    [rawFile('{"PRIVATE_CONTENT":'), /JSON/],
    [rawFile([0xff]), /UTF-8/],
    [{ size: 100, arrayBuffer: async () => { throw Error('PRIVATE_PATH'); } }, /无法读取/],
    [{ size: 16 * 1024 * 1024 + 1, arrayBuffer: async () => { oversizeReads++; return encoded(dataset).buffer; } }, /16MiB/]
  ];
  for (const [bad, message] of cases) {
    const h = harness(); await h.select(file(dataset));
    assert.equal(h.get('file-result').hidden, false);
    await h.select(bad);
    assertCleared(h);
    assert.match(h.get('file-notice').textContent, message);
    assert.doesNotMatch(h.get('file-notice').textContent, /PRIVATE_/);
    assert.equal(h.get('file-notice').dataset.error, 'true');
    const slow = deferred(), pending = h.select({ size: 100, arrayBuffer: () => slow.promise });
    await h.select(bad); const failed = h.snapshot();
    slow.resolve(encoded(backup).buffer); await pending;
    assert.equal(h.snapshot(), failed);
  }
  assert.equal(oversizeReads, 0);
});

test('文件指引与静态工具入口均使用固定同站新标签链接，不显示输入或自动导航', async () => {
  const h = harness();
  const cases = [
    [dataset, ['/#overview', '/report-comparison.html#generator']],
    [{ schema: 'acl-record-evaluation-v1', tasks: [{}] }, ['/report-comparison.html']],
    [{ schema: 'project-review-v1', criteria: [], evidence: [] }, ['/project-review.html']],
    [backup, ['/project-review.html#review-backup']],
    [{ schema: 'observation-plan-envelope-v1', plan: {}, sha256: 'unverified' }, ['/project-review.html#plan-import']]
  ];
  for (const [input, destinations] of cases) {
    await h.select(file({ ...input, title: 'PRIVATE_TITLE', body: '<script>PRIVATE_BODY</script>', href: 'javascript:PRIVATE_LINK', path: 'PRIVATE_PATH' }));
    const links = h.get('file-destinations').children;
    assert.deepEqual(links.map(link => link.href), destinations);
    for (const link of links) { assert.equal(link.tagName, 'A'); assert.equal(link.target, '_blank'); assert.match(link.rel, /\bnoopener\b/); }
    assert.doesNotMatch(h.snapshot(), /PRIVATE_|<script>/);
    assert.match(h.get('file-note').textContent, /再次选择文件/);
    assert.match(h.get('file-note').textContent, /不会自动导入/);
  }
  const toolHrefs = new Set(['/', 'project-review.html', 'report-comparison.html', 'record-entry.html', '/#compare']);
  const tools = [...html.matchAll(/<a\b([^>]*\bhref="([^"]+)"[^>]*)>/g)].filter(match => toolHrefs.has(match[2]));
  assert.equal(tools.length, 6);
  for (const [_, attributes] of tools) { assert.match(attributes, /\btarget="_blank"/); assert.match(attributes, /\brel="[^"]*\bnoopener\b/); }
  assert.deepEqual(h.effects, []);
});

test('未知、数组与格式冲突显示说明并移除旧入口，不误导用户导入', async () => {
  const h = harness();
  for (const unknown of [{}, [], null, { ...dataset, schema: 'unsupported-schema' }, { ...dataset, type: 'cost-estimate', assumptions: {} }]) {
    await h.select(file(dataset));
    assert.equal(h.get('file-destinations').children.length, 2);
    await h.select(file(unknown));
    assert.equal(h.get('file-result').hidden, false);
    assert.match(h.get('file-title').textContent, /暂不能识别/);
    assert.match(h.get('file-notice').textContent, /暂不能确定用途/);
    assert.equal(h.get('file-notice').dataset.error, 'false');
    assert.equal(h.get('file-destinations').children.length, 0);
    assert.match(h.get('file-steps').textContent, /保留原文件/);
    assert.doesNotMatch(h.get('file-notice').textContent, /用途已识别/);
  }
});

test('现有模块实际导出的成本假设、观察计划与空备份均能识别用途', async () => {
  const h = harness();
  const assumptions = require('./cost-model.js').estimate({ full: 1000, first: 300, second: 800, probability: 0.5 });
  await h.select(file({ type: 'cost-estimate', isExperimentResult: false, assumptions, reference: null }));
  assert.equal(h.get('file-title').textContent, '成本假设估算');
  assert.match(h.get('file-description').textContent, /不是新的实测结果/);
  assert.equal(h.get('file-destinations').children.length, 0);
  const plan = await require('./observation-plan.js').seal({ schema: 'observation-plan-v1', id: 'guide-test', title: '虚构测试计划', createdAt: '2026-10-22T00:00:00.000Z',
    context: { softwareVersion: 'test-v1', targetAppVersion: 'test-app-v1', deviceAlias: '测试机A', network: '测试网络', taskId: 'test-task' },
    task: '虚构测试步骤', primaryMeasure: '开屏广告次数', durationSeconds: 30, rounds: [{ number: 1, condition: 'A' }, { number: 2, condition: 'B' }] });
  await h.select(file(plan));
  assert.equal(h.get('file-title').textContent, '独立观察计划');
  assert.equal(h.get('file-destinations').children[0].href, '/project-review.html#plan-import');
  await h.select(file(require('./project-review-backup.js').create([], '2026-10-22T00:00:00.000Z')));
  assert.equal(h.get('file-title').textContent, '项目检查备份');
  assert.equal(h.get('file-destinations').children[0].href, '/project-review.html#review-backup');
  assert.deepEqual(h.effects, []);
});

test('HTTP 仅提供新增页面白名单资源及正确 MIME，测试和私有文件仍不可访问', async t => {
  let executionCalls = 0;
  const unexpected = () => { executionCalls++; throw Error('Static asset reads must not execute models or read project data'); };
  const server = require('./server.cjs').createServer(
    { runExperiment: unexpected, connectionStatus: unexpected, latest: unexpected },
    { taskExecutor: { run: unexpected, read: unexpected }, projectReviewReader: unexpected, passageReader: unexpected }
  );
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const assets = {
    '/start.html': 'text/html; charset=utf-8', '/start.css': 'text/css; charset=utf-8',
    '/start-ui.js': 'text/javascript; charset=utf-8', '/file-guide.js': 'text/javascript; charset=utf-8',
    '/record-entry.html': 'text/html; charset=utf-8', '/record-entry.css': 'text/css; charset=utf-8',
    '/record-entry-core.js': 'text/javascript; charset=utf-8', '/record-entry.js': 'text/javascript; charset=utf-8'
  };
  for (const [path, mime] of Object.entries(assets)) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('content-type'), mime, path);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff', path);
    assert.ok((await response.text()).length > 0, path);
  }
  for (const denied of ['/file-guide.test.cjs', '/record-entry.test.cjs', '/artifacts/handoff-2026-10-22.md', '/data/private/example.json']) {
    const response = await fetch(base + denied);
    assert.equal(response.status, 404, denied);
    await response.text();
  }
  assert.equal(executionCalls, 0);
});
