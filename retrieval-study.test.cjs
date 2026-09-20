const test=require('node:test'),assert=require('node:assert/strict');
const {fixtures,selectDocuments,buildPrompt,verify,summarize}=require('./retrieval-study.cjs');
const answer=task=>Object.fromEntries(task.goals.map(g=>[g.id,{value:g.expected,sourceId:g.sourceId,quote:g.sentence}]));
test('选择器只按目录标签取资料，不依赖期望答案',()=>{
  const t=fixtures.tasks[0];assert.equal(selectDocuments(t.documents,t.goals,'fixed').length,1);assert.equal(selectDocuments(t.documents,t.goals,'all').length,6);
  const goals=t.goals.map(g=>({id:g.id}));assert.deepEqual(selectDocuments(t.documents,goals,'coverage').map(d=>d.id),['01','03','05']);
});
test('未检索到的业务规则不进入模型提示词',()=>{
  for(const t of fixtures.tasks){const docs=selectDocuments(t.documents,t.goals,'fixed'),prompt=buildPrompt(t,docs);assert.ok(prompt.includes(t.goals[0].sentence));for(const g of t.goals.slice(1))assert.ok(!prompt.includes(g.sentence));assert.ok(!prompt.includes('expected'));}
});
test('标签覆盖也会漏掉关键正文，独立验收能识别这个反例',()=>{
  const t=fixtures.tasks[2],docs=selectDocuments(t.documents,t.goals,'coverage');assert.deepEqual(docs.map(d=>d.id),['01','03','04']);const result=verify(t,answer(t),docs);assert.equal(result.hold.status,'fail');assert.equal(result.duration.status,'pass');
});
test('缺失信息保留未知；正确值配伪造引文仍不通过',()=>{
  const t=fixtures.tasks[0];assert.equal(verify(t,{},t.documents).cancel.status,'unknown');const a=answer(t);a.cancel.quote='虚构业务规则';assert.equal(verify(t,a,t.documents).cancel.status,'fail');
});
test('完整资料支持的配置与准确引文通过核验',()=>{
  for(const t of fixtures.tasks)assert.ok(Object.values(verify(t,answer(t),t.documents)).every(c=>c.status==='pass'));
});
test('汇总保留失败成本和未知费用',()=>{
  const data={tasks:[{runs:[{policy:'fixed',outcome:'insufficient_evidence',tokens:20,durationSec:1,retrieval:{selectedIds:['01']}},{policy:'fixed',outcome:'execution_failed',tokens:null,durationSec:2,retrieval:{selectedIds:['01']}}]}]};const s=summarize(data)[0];assert.equal(s.meanTokens,20);assert.equal(s.successes,0);assert.equal(s.attempts,2);assert.equal(s.unknownCosts,1);
});
