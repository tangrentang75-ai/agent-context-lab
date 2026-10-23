/* Only routes files; destination pages retain responsibility for full validation. */
(function () {
  'use strict';
  const G = globalThis.AgentFileGuide;
  const byId = id => document.getElementById(id);
  let selection = 0;
  function clearResult() {
    byId('file-result').hidden = true;
    for (const id of ['file-title', 'file-description', 'file-steps', 'file-destinations', 'file-note']) byId(id).replaceChildren();
  }
  function notice(message, error = false) {
    byId('file-notice').textContent = message;
    byId('file-notice').dataset.error = String(error);
  }
  function render(result) {
    byId('file-title').textContent = result.title;
    byId('file-description').textContent = result.description;
    for (const step of result.steps) {
      const item = document.createElement('li'); item.textContent = step;
      byId('file-steps').append(item);
    }
    for (const destination of result.destinations) {
      const link = document.createElement('a');
      link.textContent = destination.label + ' ↗'; link.href = destination.href;
      link.target = '_blank'; link.rel = 'noopener'; link.className = 'button';
      byId('file-destinations').append(link);
    }
    byId('file-note').textContent = result.note;
    byId('file-result').hidden = false;
  }
  byId('guide-file').addEventListener('change', async event => {
    const epoch = ++selection;
    clearResult();
    const file = event.target.files?.[0];
    if (!file) { notice('尚未选择文件。'); return; }
    notice('正在本地识别文件用途…');
    try {
      if (file.size > G.MAX_BYTES) throw new Error('文件超过 16MiB，未读取或识别；请保留原文件。');
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (epoch !== selection) return;
      const result = G.identifyBytes(bytes);
      render(result);
      notice(result.kind === 'unknown' ? '暂不能确定用途。请查看下方说明，保留原文件。' : '用途已识别。请按下方步骤，到目标页面重新选择文件。');
    } catch (error) {
      if (epoch !== selection) return;
      clearResult();
      notice(error instanceof Error && /^(文件|请选择)/.test(error.message) ? error.message : '无法读取此文件。请重新选择原始 JSON 文件；已有工作未改变。', true);
    }
  });
  byId('clear-file').addEventListener('click', () => {
    selection++;
    byId('guide-file').value = '';
    clearResult();
    notice('已清空选择。原文件与其他页面的数据未改变。');
  });
})();
