'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { createServer } = require('./server.cjs');
const { evaluateRecords } = require('./evaluate-records.cjs');
const cli = require('./compare-record-reports.cjs');
const fixture = () => JSON.parse(fs.readFileSync(require.resolve('./report-comparison-example.json'), 'utf8'));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const bytes = value => new TextEncoder().encode(JSON.stringify(value));
const file = (value, name = 'report.json') => ({ name, size: bytes(value).byteLength, arrayBuffer: async () => bytes(value).buffer });

async function harness({ failInit = false } = {}) {
  const elements = new Map(), downloads = [], requests = [], demo = deferred();
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.listeners = {}; this.value = ''; this.textContent = ''; this.hidden = false; this.disabled = false; this.dataset = {}; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    async emit(name) { return this.listeners[name]?.({ target: this }); }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = [...nodes]; }
    remove() {}
    click() { return this.emit('click'); }
    set innerHTML(_) { throw new Error('Imported text must not be rendered as HTML'); }
  }
  const get = id => { if (!elements.has(id)) elements.set(id, new Element('div')); return elements.get(id); };
  let digest = (...args) => webcrypto.subtle.digest(...args);
  const context = { console, AgentEvaluation: require('./evaluation.js'), crypto: { subtle: { digest: (...args) => digest(...args) } }, TextDecoder, TextEncoder, Uint8Array, structuredClone, Blob, setTimeout: () => 0,
    URL: { createObjectURL: blob => { downloads.push(blob); return 'blob:report'; }, revokeObjectURL() {} },
    document: { getElementById: get, createElement: tag => new Element(tag), body: new Element('body') },
    fetch: async url => {
      requests.push(url);
      if (url === 'report-comparison-example.json') return demo.promise;
      if (url === 'evaluation.js') return { ok: !failInit, arrayBuffer: async () => new Uint8Array(fs.readFileSync(require.resolve('./evaluation.js'))).buffer };
      if (url === '/api/local-info') return { ok: !failInit, json: async () => ({ app: 'agent-context-lab', version: require('./package.json').version }) };
      throw new Error('Unexpected request: ' + url);
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve('./record-evaluation.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(require.resolve('./report-comparison.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(require.resolve('./report-comparison-ui.js'), 'utf8'), context);
  for (let i = 0; i < 100 && get('before-file').disabled && get('retry').hidden; i++) await tick();
  return { get, downloads, requests, demo, context,
    setDigest(fn) { digest = fn; },
    importDataset(selected) { get('dataset-file').files = [selected]; return get('dataset-file').emit('change'); },
    import(side, selected) { get(side + '-file').files = [selected]; return get(side + '-file').emit('change'); },
    text(el) { return el.textContent + el.children.map(child => this.text(child)).join(''); }
  };
}

test('browser uses the same comparison results as the CLI and imports never upload', async () => {
  const h = await harness(), f = fixture();
  await h.import('before', file(f.before)); await h.import('after', file(f.after));
  await h.get('compare').click(); await h.get('download').click();
  const actual = JSON.parse(await h.downloads[0].text()), expected = cli.compareReports(f.before, f.after);
  delete actual.generatedAt; delete expected.generatedAt; delete actual.reportFiles;
  assert.deepEqual(actual, expected);
  assert.deepEqual(h.requests, ['evaluation.js', '/api/local-info']);
  assert.equal(h.get('results').hidden, false);
});

test('bad replacement immediately invalidates the old result and download', async () => {
  const h = await harness(), f = fixture();
  await h.import('before', file(f.before)); await h.import('after', file(f.after)); await h.get('compare').click();
  await h.import('after', file({}));
  assert.equal(h.get('results').hidden, true); assert.equal(h.get('download').disabled, true); assert.equal(h.get('compare').disabled, true);
  await h.get('download').click(); assert.equal(h.downloads.length, 0);
  assert.match(h.get('notice').textContent, /读取未完成/);
});

test('slower older read cannot replace a newer selected report', async () => {
  const h = await harness(), f = fixture(), slow = deferred();
  const old = h.import('before', { name: 'old.json', size: 10, arrayBuffer: () => slow.promise });
  await h.import('before', file(f.before, 'new.json'));
  slow.resolve(bytes(f.after).buffer); await old;
  assert.match(h.get('before-name').textContent, /new.json/);
  await h.import('after', file(f.before)); await h.get('compare').click();
  assert.equal(h.get('verdict').dataset.status, 'unchanged');
});

test('reset cancels an in-flight file read and hides results', async () => {
  const h = await harness(), f = fixture(), slow = deferred();
  const loading = h.import('before', { name: 'slow.json', size: 10, arrayBuffer: () => slow.promise });
  await h.get('reset').click(); slow.resolve(bytes(f.before).buffer); await loading;
  assert.equal(h.get('before-name').textContent, '尚未选择'); assert.equal(h.get('compare').disabled, true); assert.equal(h.get('results').hidden, true);
});

test('an older demo fetch cannot replace a subsequently imported user file', async () => {
  const h = await harness(), f = fixture();
  const pending = h.get('demo').click(); await h.import('before', file(f.before, 'chosen.json'));
  h.demo.resolve({ ok: true, json: async () => f }); await pending;
  assert.match(h.get('before-name').textContent, /chosen.json/); assert.equal(h.get('after-name').textContent, '尚未选择');
  assert.equal(h.get('results').hidden, true);
});

test('HTML-like evidence is rendered as literal text, and filters affect only display', async () => {
  const h = await harness(), d = JSON.parse(fs.readFileSync(require.resolve('./example.json'), 'utf8'));
  d.tasks = [d.tasks[0]];
  const before = evaluateRecords(Buffer.from(JSON.stringify(d)), 20000);
  d.tasks[0].runs[1].checks.docs.evidence = '<img src=x onerror="alert(1)">';
  const after = evaluateRecords(Buffer.from(JSON.stringify(d)), 20000);
  await h.import('before', file(before)); await h.import('after', file(after)); await h.get('compare').click();
  assert.match(h.text(h.get('changes')), /<img src=x/);
  h.get('search').value = 'no match'; await h.get('search').emit('input');
  assert.match(h.get('filter-count').textContent, /符合筛选 0 项/);
  await h.get('download').click(); assert.ok(JSON.parse(await h.downloads[0].text()).changeCount > 0);
});

test('oversized or invalid UTF-8 imports are rejected and service failure stays disabled', async () => {
  const h = await harness();
  await h.import('before', { size: 16 * 1024 * 1024 + 1, arrayBuffer: () => { throw new Error('must not read'); } });
  assert.match(h.get('notice').textContent, /16MiB/);
  await h.import('before', { size: 1, arrayBuffer: async () => Uint8Array.of(255).buffer });
  assert.match(h.get('notice').textContent, /读取未完成/);
  const failed = await harness({ failInit: true });
  assert.equal(failed.get('before-file').disabled, true); assert.equal(failed.get('demo').disabled, true); assert.equal(failed.get('retry').hidden, false);
});

test('large differences are paged for display but every change remains in the download', async () => {
  const h = await harness(), d = JSON.parse(fs.readFileSync(require.resolve('./example.json'), 'utf8'));
  d.tasks = [d.tasks[0]];
  const original = d.tasks[0].runs[0];
  d.tasks[0].runs = Array.from({ length: 20 }, (_, i) => ({ ...structuredClone(original), id: 'many-' + i }));
  const before = evaluateRecords(Buffer.from(JSON.stringify(d)), 20000);
  for (const run of d.tasks[0].runs) for (const check of Object.values(run.checks)) check.evidence += ' 新增复核说明';
  const after = evaluateRecords(Buffer.from(JSON.stringify(d)), 20000);
  await h.import('before', file(before)); await h.import('after', file(after)); await h.get('compare').click();
  assert.equal(h.get('changes').children.length, 40); assert.equal(h.get('more').hidden, false);
  await h.get('download').click(); assert.equal(JSON.parse(await h.downloads[0].text()).changeCount, 80);
  await h.get('more').click(); assert.equal(h.get('changes').children.length, 80); assert.equal(h.get('more').hidden, true);
});

test('new page serves only explicit assets and a synthetic example, not report source files', async t => {
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const asset of ['report-comparison.html', 'report-comparison.css', 'report-comparison.js', 'record-evaluation.js', 'report-comparison-ui.js', 'report-comparison-example.json']) {
    const response = await fetch(base + '/' + asset); assert.equal(response.status, 200);
    if (asset.endsWith('.json')) { const f = await response.json(); assert.equal(f.demo, true); assert.equal(f.before.source.demo, true); assert.equal(f.after.source.demo, true); }
    else await response.text();
  }
  for (const denied of ['/compare-record-reports.cjs', '/artifacts/handoff-2026-10-21.md', '/data/private/report.json']) assert.equal((await fetch(base + denied)).status, 404);
});

const taskData = () => JSON.parse(fs.readFileSync(require.resolve('./example.json'), 'utf8'));
async function preparedGenerator() {
  const h = await harness(); h.get('report-budget').value = '20000';
  await h.importDataset(file(taskData(), 'tasks.json')); return h;
}

test('web generator matches CLI output and hashes the exact original bytes', async () => {
  const h = await harness(), source = new TextEncoder().encode('\ufeff' + JSON.stringify(taskData(), null, 3) + '\n');
  h.get('report-budget').value = '20000';
  await h.importDataset({ name: 'exact.json', size: source.byteLength, arrayBuffer: async () => source.buffer });
  await h.get('generate').click(); await h.get('download-generated').click();
  const actual = JSON.parse(await h.downloads[0].text()), expected = evaluateRecords(Buffer.from(source), 20000);
  delete actual.generatedAt; delete expected.generatedAt; assert.deepEqual(actual, expected);
  assert.deepEqual(h.requests, ['evaluation.js', '/api/local-info']);
});

test('budget edits invalidate only the generator, leaving explicitly selected report copies intact', async () => {
  const h = await preparedGenerator(); await h.get('generate').click(); await h.get('use-before').click();
  h.get('report-budget').value = '0'; await h.get('report-budget').emit('input');
  assert.equal(h.get('generated').hidden, true); assert.equal(h.get('download-generated').disabled, true);
  await h.get('download-generated').click(); assert.equal(h.downloads.length, 0);
  await h.get('generate').click(); await h.get('use-after').click(); await h.get('compare').click(); await h.get('download').click();
  const diff = JSON.parse(await h.downloads[0].text());
  assert.equal(diff.before.budgetTokensPerRun, 20000); assert.equal(diff.after.budgetTokensPerRun, 0);
  assert.equal(diff.status, 'conditions_changed'); assert.match(h.get('generated-summary').textContent, /组没有可推荐记录/);
});

test('blank, negative and nonfinite budgets cannot reuse or download a generated report', async () => {
  const h = await preparedGenerator(); await h.get('generate').click();
  for (const value of ['', '-1', 'Infinity', '1e999', '0x10']) {
    h.get('report-budget').value = value; await h.get('report-budget').emit('input');
    assert.equal(h.get('generate').disabled, true); assert.equal(h.get('use-before').disabled, true);
    await h.get('generate').click(); await h.get('download-generated').click();
    assert.match(h.get('generator-notice').textContent, /预算/);
  }
  assert.equal(h.downloads.length, 0);
});

test('generator rejects reports, oversized data and failed replacements without retaining old data', async () => {
  const h = await preparedGenerator(); await h.get('generate').click();
  await h.importDataset(file(fixture().before));
  assert.equal(h.get('generated').hidden, true); assert.equal(h.get('generate').disabled, true);
  await h.importDataset({ size: 2 * 1024 * 1024 + 1, arrayBuffer() { throw new Error('must not read'); } });
  assert.match(h.get('generator-notice').textContent, /2MiB/);
  await h.importDataset({ size: 1, arrayBuffer: async () => Uint8Array.of(255).buffer });
  assert.match(h.get('generator-notice').textContent, /读取未完成/);
});

test('slow dataset reads cannot overwrite a later dataset or resurrect data after reset', async () => {
  const h = await preparedGenerator(), slow = deferred();
  const loading = h.importDataset({ name: 'old.json', size: 100, arrayBuffer: () => slow.promise });
  await h.importDataset(file(taskData(), 'new.json')); slow.resolve(bytes(taskData()).buffer); await loading;
  assert.match(h.get('dataset-name').textContent, /new.json/);
  const next = deferred(), pending = h.importDataset({ name: 'pending.json', size: 100, arrayBuffer: () => next.promise });
  await h.get('reset').click(); next.resolve(bytes(taskData()).buffer); await pending;
  assert.equal(h.get('dataset-name').textContent, '尚未选择任务数据'); assert.equal(h.get('generate').disabled, true);
});

test('editing the budget or resetting cancels an in-flight generated report hash', async () => {
  for (const action of ['budget', 'reset']) {
    const h = await preparedGenerator(), slow = deferred(); let finish;
    h.setDigest((...args) => { finish = () => webcrypto.subtle.digest(...args).then(slow.resolve); return slow.promise; });
    const pending = h.get('generate').click();
    if (action === 'budget') { h.get('report-budget').value = '5000'; await h.get('report-budget').emit('input'); } else await h.get('reset').click();
    await finish(); await pending;
    assert.equal(h.get('generated').hidden, true); assert.equal(h.get('download-generated').disabled, true);
  }
});

test('generated report replaces the selected side and invalidates an existing comparison', async () => {
  const h = await preparedGenerator(), f = fixture();
  await h.import('before', file(f.before)); await h.import('after', file(f.after)); await h.get('compare').click();
  await h.get('generate').click(); await h.get('use-after').click();
  assert.equal(h.get('results').hidden, true); assert.equal(h.get('download').disabled, true);
  assert.match(h.get('after-name').textContent, /网页评估-20000token/);
});

test('generated report hash matches the downloaded bytes used in the comparison', async () => {
  const h = await preparedGenerator(); await h.get('generate').click();
  await h.get('download-generated').click(); const json = await h.downloads[0].text();
  await h.get('use-before').click(); await h.get('use-after').click(); await h.get('compare').click(); await h.get('download').click();
  const comparison = JSON.parse(await h.downloads[1].text());
  const expectedHash = require('node:crypto').createHash('sha256').update(json).digest('hex');
  assert.equal(comparison.reportFiles.beforeSha256, expectedHash); assert.equal(comparison.reportFiles.afterSha256, expectedHash);
  assert.equal(comparison.status, 'unchanged');
});
