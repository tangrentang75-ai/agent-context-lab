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
    constructor(tag) { this.tagName = tag; this.children = []; this.listeners = {}; this.value = ''; this.textContent = ''; this.hidden = false; this.disabled = false; this.dataset = {}; this.attributes = {}; this.parentNode = null; }
    setAttribute(name, value) { this.attributes[name] = value; }
    get isConnected() { return this === context.document.body || !!this.parentNode?.isConnected; }
    focus() { context.document.activeElement = this; }
    scrollIntoView() { this.scrolled = true; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    async emit(name) { return this.listeners[name]?.({ target: this }); }
    append(...nodes) { for (const n of nodes) n.parentNode = this; this.children.push(...nodes); }
    replaceChildren(...nodes) { for (const n of this.children) n.parentNode = null; this.children = []; this.append(...nodes); }
    remove() {}
    click() { return this.emit('click'); }
    set innerHTML(_) { throw new Error('Imported text must not be rendered as HTML'); }
  }
  const get = id => { if (!elements.has(id)) { const e = new Element('div'); elements.set(id, e); context.document.body.append(e); } return elements.get(id); };
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
  vm.runInContext(fs.readFileSync(require.resolve('./report-comparison-presentation.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(require.resolve('./report-comparison-markdown.js'), 'utf8'), context);
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
  for (const asset of ['report-comparison.html', 'report-comparison.css', 'report-comparison.js', 'report-comparison-presentation.js', 'report-comparison-markdown.js', 'record-evaluation.js', 'report-comparison-ui.js', 'report-comparison-example.json']) {
    const response = await fetch(base + '/' + asset); assert.equal(response.status, 200);
    if (asset.endsWith('.json')) { const f = await response.json(); assert.equal(f.demo, true); assert.equal(f.before.source.demo, true); assert.equal(f.after.source.demo, true); }
    else await response.text();
  }
  for (const denied of ['/compare-record-reports.cjs', '/artifacts/handoff-2026-10-21.md', '/data/private/report.json']) assert.equal((await fetch(base + denied)).status, 404);
});

const taskData = () => JSON.parse(fs.readFileSync(require.resolve('./example.json'), 'utf8'));
const descendants = el => [el, ...el.children.flatMap(descendants)];
const categoryOf = require('./report-comparison-presentation.js').changeCategories;
async function filterBy(h, value) { h.get('filter').value = value; await h.get('filter').emit('change'); }
async function compareData(h, before, after) { await h.import('before', file(before)); await h.import('after', file(after)); await h.get('compare').click(); }
const matching = h => descendants(h.get('changes')).filter(e => e.className === 'value-match');
const locatorButton = h => descendants(h.get('changes')).find(e => e.className === 'locate-match');
async function nestedComparison(h, reverse = false) {
  const d = taskData(); d.tasks = [d.tasks[0]]; d.tasks[0].runs = [d.tasks[0].runs[0]];
  const before = evaluateRecords(Buffer.from(JSON.stringify(d)), 20000), extra = structuredClone(d.tasks[0]);
  extra.id = 'status'; extra.runs[0].id = 'eligible'; extra.runs[0].tokens = null;
  extra.runs[0].checks.docs = { status: 'unknown', evidence: '' };
  d.tasks.push(extra); const after = evaluateRecords(Buffer.from(JSON.stringify(d)), 20000);
  await compareData(h, reverse ? after : before, reverse ? before : after);
}

test('locating opens lazy details, focuses and cycles matching fields without duplication or export changes', async () => {
  const h = await harness(); await nestedComparison(h); await filterBy(h, 'evidence');
  const button = locatorButton(h), details = descendants(h.get('changes')).find(e => e.className === 'structured-value');
  assert.equal(details.children.length, 1); assert.equal(matching(h).length, 0);
  await h.get('download').click(); await h.get('download-readable').click();
  await button.click(); assert.equal(details.open, true); assert.equal(matching(h).length, 4);
  const targets = matching(h), count = details.children.length;
  assert.equal(h.context.document.activeElement, targets[0]); assert.equal(targets[0].scrolled, true);
  assert.ok(targets.every(e => e.dataset.category === 'evidence' && e.tabIndex === -1));
  assert.ok(targets.every(e => h.text(e).includes('匹配筛选')));
  for (let i = 1; i <= 4; i++) { await button.click(); assert.equal(h.context.document.activeElement, targets[i % 4]); }
  await details.emit('toggle'); details.open = false; await details.emit('toggle'); await button.click();
  assert.equal(details.children.length, count); assert.equal(matching(h).length, 4);
  assert.match(h.text(h.get('changes')), /2 \/ 4 处证据文本/);
  assert.match(h.get('filter-count').textContent, /共 1 项/);
  await h.get('download').click(); await h.get('download-readable').click();
  assert.equal(await h.downloads[0].text(), await h.downloads[2].text());
  assert.equal(await h.downloads[1].text(), await h.downloads[3].text());
});

test('empty recommendations, false eligibility, empty evidence and unknown status remain locatable', async () => {
  const h = await harness(); await nestedComparison(h);
  await filterBy(h, 'recommendation'); await locatorButton(h).click();
  assert.equal(matching(h).length, 2);
  assert.match(h.text(matching(h)[0]), /没有推荐记录/);
  assert.match(h.text(matching(h)[1]), /推荐资格否/);
  await filterBy(h, 'status'); await expandDetails(h); const count = matching(h).length;
  assert.equal(count, 4); assert.ok(matching(h).every(e => !h.text(e).includes('评价结论')));
  assert.ok(matching(h).some(e => h.text(e).includes('证据待补')));
  await locatorButton(h).click(); assert.equal(matching(h).length, count);
  await filterBy(h, 'evidence'); await locatorButton(h).click();
  assert.ok(matching(h).some(e => h.text(e).includes('（空文本）')));
});

test('only the populated side of a whole removal offers navigation and direct changes need none', async () => {
  const h = await harness(); await nestedComparison(h, true); await filterBy(h, 'status');
  const sides = descendants(h.get('changes')).filter(e => e.className === 'side');
  assert.ok(descendants(sides[0]).some(e => e.className === 'locate-match'));
  assert.ok(!descendants(sides[1]).some(e => e.className === 'locate-match'));
  await locatorButton(h).click(); assert.equal(h.context.document.activeElement, matching(h)[0]);
  const d = taskData(), before = evaluateRecords(Buffer.from(JSON.stringify(d)), 20000);
  d.tasks[0].runs[0].checks.docs.evidence += ' 新说明';
  await compareData(h, before, evaluateRecords(Buffer.from(JSON.stringify(d)), 20000)); await filterBy(h, 'evidence');
  assert.equal(locatorButton(h), undefined); assert.equal(matching(h).length, 2);
  await filterBy(h, 'all'); assert.equal(matching(h).length, 0);
});

test('stale locator and delayed toggle cannot rebuild or steal focus after rerender, replacement or reset', async () => {
  const h = await harness(); await nestedComparison(h); await filterBy(h, 'evidence');
  const oldButton = locatorButton(h), oldDetails = descendants(h.get('changes')).find(e => e.className === 'structured-value');
  await filterBy(h, 'status'); h.get('filter').focus(); await oldButton.click(); oldDetails.open = true; await oldDetails.emit('toggle');
  assert.equal(h.context.document.activeElement, h.get('filter')); assert.equal(oldDetails.children.length, 1);
  const statusButton = locatorButton(h); h.get('search').value = 'no-match'; await h.get('search').emit('input');
  h.get('search').focus(); await statusButton.click(); assert.equal(h.context.document.activeElement, h.get('search'));
  h.get('search').value = ''; await h.get('search').emit('input');
  const pendingButton = locatorButton(h), slow = deferred();
  const pending = h.import('after', { name: 'pending.json', size: 2, arrayBuffer: () => slow.promise });
  h.get('after-file').focus(); await pendingButton.click(); assert.equal(h.context.document.activeElement, h.get('after-file'));
  slow.resolve(bytes({}).buffer); await pending;
  await nestedComparison(h); await filterBy(h, 'evidence'); const resetButton = locatorButton(h);
  await h.get('reset').click(); h.get('reset').focus(); await resetButton.click();
  assert.equal(h.context.document.activeElement, h.get('reset')); assert.equal(h.get('changes').children.length, 0);
});

test('whole task additions and removals match all relevant filters without splitting or changing identity', async () => {
  const h = await harness(), d = taskData(); d.tasks = [d.tasks[0]];
  const before = evaluateRecords(Buffer.from(JSON.stringify(d)), 20000), extra = structuredClone(d.tasks[0]);
  extra.id = 'new-task'; extra.runs = [extra.runs[0]]; extra.runs[0].id = 'new-run';
  d.tasks.push(extra); const after = evaluateRecords(Buffer.from(JSON.stringify(d)), 20000);
  for (const [left, right, kind] of [[before, after, '新增'], [after, before, '删除']]) {
    await compareData(h, left, right);
    for (const type of ['status', 'evidence', 'recommendation']) {
      await filterBy(h, type);
      assert.equal(h.get('changes').children.length, 1);
      const text = h.text(h.get('changes'));
      assert.ok(text.includes(kind + '整个任务')); assert.ok(text.includes('整项' + kind));
      assert.match(text, /不代表这些字段被逐一修改/); assert.match(h.get('filter-count').textContent, /符合筛选 1 项/);
      assert.equal(descendants(h.get('changes')).filter(e => e.className === 'structured-value')[0].children.length, 1);
    }
  }
});

test('unknown and empty added checks match while goal definitions named evidence do not', async () => {
  const h = await harness(), d = taskData(); d.tasks = [d.tasks[0]]; d.tasks[0].runs = [d.tasks[0].runs[0]];
  const before = evaluateRecords(Buffer.from(JSON.stringify(d)), 20000);
  d.tasks[0].goals.push({ id: 'evidence', label: '新增目标', required: false, weight: 1 });
  d.tasks[0].runs[0].checks.evidence = { status: 'unknown', evidence: '' };
  const after = evaluateRecords(Buffer.from(JSON.stringify(d)), 20000);
  await compareData(h, before, after);
  for (const type of ['status', 'evidence']) {
    await filterBy(h, type); assert.match(h.get('filter-count').textContent, /符合筛选 1 项/);
    assert.match(h.text(h.get('changes')), /新增目标验收项/); assert.doesNotMatch(h.text(h.get('changes')), /新增验收目标/);
    await expandDetails(h); assert.match(h.text(h.get('changes')), /证据待补/); assert.match(h.text(h.get('changes')), /（空文本）/);
  }
});

test('recommendation matching includes empty lists and false eligibility but excludes evaluation status and score', () => {
  const group = ['tasks', 't', 'groups', 'g'], run = [...group, 'runs', 'r'];
  for (const [path, after] of [[ [...group, 'bestIds'], [] ], [ [...run, 'evaluation', 'eligible'], false ]]) {
    assert.equal(categoryOf({ path, kind: 'changed', after }).direct, 'recommendation');
  }
  const nested = categoryOf({ path: [...run, 'evaluation'], kind: 'added', after: { eligible: false, status: '证据待补', score: 0 } });
  assert.deepEqual(nested, { direct: null, nested: ['recommendation'] });
  for (const field of ['score', 'status', 'accepted', 'allReviewed']) {
    assert.deepEqual(categoryOf({ path: [...run, 'evaluation', field], kind: 'changed', before: 0, after: 1 }), { direct: null, nested: [] });
  }
});

test('special IDs and unrelated text cannot impersonate a structural category', () => {
  for (const id of ['evidence', 'status', 'bestIds', 'eligible', '__proto__']) {
    for (const path of [['tasks', id], ['tasks', 't', 'goals', id], ['tasks', 't', 'groups', id], ['tasks', 't', 'groups', 'g', 'runs', id]]) {
      assert.deepEqual(categoryOf({ path, kind: 'added', after: { title: 'evidence bestIds eligible', label: 'status' } }), { direct: null, nested: [] });
    }
    const path = ['tasks', id, 'groups', id, 'runs', id, 'checks', id];
    assert.deepEqual(categoryOf({ path, kind: 'removed', before: { status: 'unknown', evidence: '' } }), { direct: null, nested: ['status', 'evidence'] });
    assert.deepEqual(categoryOf({ path: [...path, 'evidence'], kind: 'changed', after: '说明' }), { direct: 'evidence', nested: [] });
  }
});

test('nested filters compose with search and paging while both downloads retain every original change', async () => {
  const h = await harness(), d = taskData(); d.tasks = [d.tasks[0]]; d.tasks[0].runs = [d.tasks[0].runs[0]];
  const before = evaluateRecords(Buffer.from(JSON.stringify(d)), 20000), seed = structuredClone(d.tasks[0]);
  for (let i = 0; i < 50; i++) {
    const task = structuredClone(seed); task.id = 'nested-' + i; task.title = '嵌套任务' + i; task.runs[0].id = 'nested-run-' + i; d.tasks.push(task);
  }
  const after = evaluateRecords(Buffer.from(JSON.stringify(d)), 20000);
  await compareData(h, before, after); await filterBy(h, 'evidence');
  assert.match(h.get('filter-count').textContent, /符合筛选 50 项，已显示 40 项/);
  await h.get('more').click(); assert.equal(h.get('changes').children.length, 50);
  h.get('search').value = '嵌套任务49'; await h.get('search').emit('input');
  assert.match(h.get('filter-count').textContent, /符合筛选 1 项/);
  h.get('search').value = 'no-such-task'; await h.get('search').emit('input');
  assert.match(h.get('filter-count').textContent, /符合筛选 0 项/);
  await h.get('download').click(); const json = JSON.parse(await h.downloads[0].text());
  assert.equal(json.changeCount, 50); assert.ok(json.changes.every(c => c.kind === 'added' && c.path.length === 2));
  await h.get('download-readable').click(); assert.equal(((await h.downloads[1].text()).match(/^### \d+\./gm) || []).length, 50);
});

async function expandDetails(h) {
  for (const el of descendants(h.get('changes')).filter(e => e.className === 'structured-value')) { el.open = true; await el.emit('toggle'); }
}

test('whole task UI expands safely on demand and collapsed content still exports in full', async () => {
  const h = await harness(), d = taskData(); d.tasks = [d.tasks[0]];
  const before = evaluateRecords(Buffer.from(JSON.stringify(d)), 20000), extra = structuredClone(d.tasks[0]);
  extra.id = 'status'; extra.title = '<img src=x onerror=alert(1)> 新增任务';
  extra.runs = [extra.runs[0]]; extra.runs[0].id = '__proto__'; extra.runs[0].tokens = null;
  const evidence = '<script>alert(1)</script>\n```\n完整证据尾部';
  extra.runs[0].checks.docs = { status: 'unknown', evidence };
  d.tasks.push(extra); const after = evaluateRecords(Buffer.from(JSON.stringify(d)), 20000);
  await h.import('before', file(before)); await h.import('after', file(after)); await h.get('compare').click();
  const details = descendants(h.get('changes')).find(e => e.className === 'structured-value');
  assert.equal(details.children.length, 1); assert.match(h.text(h.get('changes')), /整个任务/);
  await h.get('download-readable').click(); assert.ok((await h.downloads[0].text()).includes(evidence));
  await h.get('download').click(); assert.equal(JSON.parse(await h.downloads[1].text()).changes[0].after.groups[extra.runs[0].comparisonGroup].runs.__proto__.checks.docs.evidence, evidence);
  await expandDetails(h); const count = details.children.length;
  const text = h.text(details); assert.match(text, /token 用量未知（null）/); assert.match(text, /目标定义/); assert.match(text, /验收状态证据待补/);
  assert.ok(text.includes(evidence)); assert.doesNotMatch(text, /"checks":|"evaluation":/);
  assert.ok(!descendants(details).some(e => ['img', 'script', 'iframe', 'a'].includes(e.tagName)));
  details.open = false; await details.emit('toggle'); details.open = true; await details.emit('toggle');
  assert.equal(details.children.length, count);
  await h.get('reset').click(); assert.equal(h.get('changes').children.length, 0);
});

test('removed run details preserve old goal names while newly added checks show unknown and empty', async () => {
  const h = await harness(), d = taskData(); d.tasks = [d.tasks[0]];
  const before = evaluateRecords(Buffer.from(JSON.stringify(d)), 20000);
  const oldName = d.tasks[0].goals.find(g => g.id === 'docs').label;
  d.tasks[0].runs.pop(); d.tasks[0].goals.find(g => g.id === 'docs').label = '新版目标名称';
  d.tasks[0].goals.push({ id: 'new-goal', label: '新增可选目标', required: false, weight: 3 });
  for (const run of d.tasks[0].runs) run.checks['new-goal'] = { status: 'unknown', evidence: '' };
  const after = evaluateRecords(Buffer.from(JSON.stringify(d)), 20000);
  await h.import('before', file(before)); await h.import('after', file(after)); await h.get('compare').click(); await expandDetails(h);
  const removed = h.get('changes').children.find(c => h.text(c.children[0]).includes('删除整条运行记录'));
  assert.ok(h.text(removed).includes(oldName)); assert.ok(!h.text(removed).includes('新版目标名称'));
  const text = h.text(h.get('changes')); assert.match(text, /验收目标/); assert.match(text, /是否为必需项否/); assert.match(text, /（空文本）/);
});

test('whole group details show every tied recommendation and distinguish no recommendation', async () => {
  const h = await harness(), d = taskData(); d.tasks = [d.tasks[0]];
  const before = evaluateRecords(Buffer.from(JSON.stringify(d)), 20000), extra = structuredClone(d.tasks[0].runs[0]);
  for (const check of Object.values(extra.checks)) { check.status = 'pass'; check.evidence = '虚构并列证据'; }
  extra.id = 'tie-first'; extra.comparisonGroup = 'added-group';
  d.tasks[0].runs.push(extra, { ...structuredClone(extra), id: 'tie-second' });
  const after = evaluateRecords(Buffer.from(JSON.stringify(d)), 20000);
  await h.import('before', file(before)); await h.import('after', file(after)); await h.get('compare').click(); await expandDetails(h);
  const list = descendants(h.get('changes')).find(e => e.className === 'value-list');
  assert.deepEqual(list.children.map(e => e.textContent), ['"tie-first"', '"tie-second"']);
  await h.import('after', file(evaluateRecords(Buffer.from(JSON.stringify(d)), 0))); await h.get('compare').click(); await expandDetails(h);
  assert.match(h.text(h.get('changes')), /没有推荐记录/); assert.match(h.text(h.get('changes')), /评价结论超过预算/);
});

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


test('readable download includes all 80 changes even when no filtered row is visible', async () => {
  const h = await harness(), d = taskData(); d.tasks = [d.tasks[0]];
  const original = d.tasks[0].runs[0];
  d.tasks[0].runs = Array.from({ length: 20 }, (_, i) => ({ ...structuredClone(original), id: 'readable-' + i }));
  const before = evaluateRecords(Buffer.from(JSON.stringify(d)), 20000);
  for (const run of d.tasks[0].runs) for (const check of Object.values(run.checks)) check.evidence += ' 导出尾部校验';
  const after = evaluateRecords(Buffer.from(JSON.stringify(d)), 20000);
  await h.import('before', file(before)); await h.import('after', file(after)); await h.get('compare').click();
  assert.equal(h.get('changes').children.length, 40);
  h.get('search').value = 'no-matching-record'; await h.get('search').emit('input');
  assert.match(h.get('filter-count').textContent, /符合筛选 0 项/);
  await h.get('download-readable').click();
  const blob = h.downloads[0], text = await blob.text();
  assert.equal(blob.type, 'text/markdown;charset=utf-8');
  assert.equal((text.match(/^### \d+\./gm) || []).length, 80);
  assert.equal((text.match(/导出尾部校验/g) || []).length, 80);
  assert.ok(text.includes('readable-19'));
  assert.deepEqual(h.requests, ['evaluation.js', '/api/local-info']);
});

test('readable download cannot reuse a comparison after pending, failed or reset inputs', async () => {
  const h = await harness(), f = fixture();
  await h.get('download-readable').click(); assert.equal(h.downloads.length, 0);
  await h.import('before', file(f.before)); await h.import('after', file(f.after)); await h.get('compare').click();
  assert.equal(h.get('download-readable').disabled, false);
  const slow = deferred();
  const loading = h.import('after', { name: 'slow.json', size: 2, arrayBuffer: () => slow.promise });
  assert.equal(h.get('download-readable').disabled, true);
  await h.get('download-readable').click(); assert.equal(h.downloads.length, 0);
  slow.resolve(bytes({}).buffer); await loading;
  await h.get('download-readable').click(); assert.equal(h.downloads.length, 0);
  await h.import('after', file(f.after)); await h.get('compare').click(); await h.get('download-readable').click();
  assert.equal(h.downloads.length, 1);
  await h.get('reset').click(); assert.equal(h.get('download-readable').disabled, true);
  await h.get('download-readable').click(); assert.equal(h.downloads.length, 1);
});
