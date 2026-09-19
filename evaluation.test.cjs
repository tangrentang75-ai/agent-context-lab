const test=require('node:test');
const assert=require('node:assert/strict');
const E=require('./evaluation.js');
require('./sample-data.js');
const fresh=()=>structuredClone(globalThis.AGENT_SAMPLE);
test('sample structure is valid; cheapest failed run cannot be recommended',()=>{
  const data=E.validateDataset(fresh());const result=E.compare(data.tasks[0],20000,data.tasks[0].runs[0].comparisonGroup);
  assert.deepEqual(result.bestIds,['code-b']);assert.equal(result.rows[0].evaluation.eligible,false);
});
test('budget excludes qualified but unaffordable records',()=>{
  const task=fresh().tasks[0];assert.deepEqual(E.compare(task,5000,task.runs[0].comparisonGroup).bestIds,[]);
});
test('unknown evidence and unknown token costs are never a free success',()=>{
  const data=fresh(), task=data.tasks[0], run=task.runs[1];run.tokens=null;
  assert.equal(E.evaluate(task,run).eligible,false);
  run.tokens=10;run.checks.docs.status='unknown';assert.equal(E.evaluate(task,run).eligible,false);
  assert.equal(E.evaluate(data.tasks[1],data.tasks[1].runs[0]).accepted,false);
});
test('optional failure is visible but does not invalidate completed mandatory goals',()=>{
  const task=fresh().tasks[2], result=E.evaluate(task,task.runs[1]);
  assert.equal(result.eligible,true);assert.equal(result.score,88);
  task.goals[3].required=true;assert.equal(E.evaluate(task,task.runs[1]).eligible,false);
});
test('cannot compare records from other experiment conditions',()=>{
  const task=fresh().tasks[0];task.runs[1].comparisonGroup='different version';
  const result=E.compare(task,20000,task.runs[0].comparisonGroup);
  assert.equal(result.rows.length,2);assert.deepEqual(result.bestIds,['code-c']);
});
test('invalid imports reject duplicates, missing evidence, invalid costs and event chronology',()=>{
  const mutations=[d=>d.tasks.push(d.tasks[0]),d=>d.tasks[0].runs[0].checks.refund.evidence='',d=>d.tasks[0].runs[0].tokens=-1,d=>d.tasks[0].runs[0].events[1].atSec=-5,d=>delete d.tasks[0].runs[0].checks.refund,d=>d.tasks[0].scenario='__proto__'];
  for(const mutate of mutations){const d=fresh();mutate(d);assert.throws(()=>E.validateDataset(d));}
});
test('high weighted score does not override a failing required condition',()=>{
  const task=fresh().tasks[0];task.goals[1].weight=1;const r=E.evaluate(task,task.runs[0]);assert.equal(r.eligible,false);
});
test('all-pass and tied token records remain equally eligible',()=>{
  const task=fresh().tasks[0];task.runs[2].tokens=task.runs[1].tokens;
  assert.deepEqual(E.compare(task,20000,task.runs[0].comparisonGroup).bestIds,['code-b','code-c']);
});
