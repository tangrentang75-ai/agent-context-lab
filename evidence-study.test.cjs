const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {fixtures,verify}=require('./retrieval-study.cjs');
const {publicTask,inspectEvidence,runPolicy,runStudy}=require('./evidence-study.cjs');
const fullAnswer=t=>Object.fromEntries(t.goals.map(g=>[g.id,{value:g.expected,sourceId:g.sourceId,quote:g.sentence}]));
const usage={input_tokens:100,output_tokens:10,cached_input_tokens:20};

test('控制器输入剥离标准答案；缺少证据后补读，两个调用用量都累计',async()=>{
  const t=fixtures.tasks[2];let calls=0;
  const result=await runPolicy(publicTask(t),'evidence',{execute:async(task,prompt)=>{
    assert.ok(task.goals.every(g=>!('expected' in g)&&!('sentence' in g)&&!('sourceId' in g)));
    calls++;const a=fullAnswer(t);if(calls===1){assert.ok(!prompt.includes(t.goals[1].sentence));a.hold={value:null,sourceId:null,quote:null};}
    else assert.ok(prompt.includes(t.goals[1].sentence));
    return {answer:a,usage};
  }});
  assert.equal(calls,2);assert.equal(result.tokens,220);assert.equal(result.retrieval.selectedIds.length,6);
  assert.equal(result.calls[0].answer.hold.value,null);assert.equal(result.answer.hold.value,'17');
  assert.ok(Object.values(verify(t,result.answer,result.documents)).every(c=>c.status==='pass'));
});
test('正确引文足够时不补读；全部策略只调用一次',async()=>{
  for(const policy of ['all','evidence']){const t=fixtures.tasks[0];const r=await runPolicy(publicTask(t),policy,{execute:async()=>({answer:fullAnswer(t),usage})});assert.equal(r.calls.length,1);assert.equal(r.retrieval.selectedIds.length,policy==='all'?6:3);}
});
test('伪造原句与数值子串被拒绝，真实但答非所问的引文仍可能骗过检查',()=>{
  const t=fixtures.tasks[2],a=fullAnswer(t);a.hold.quote='不存在的规则 17';assert.equal(inspectEvidence(t.goals,a,t.documents)[1].supported,false);
  a.hold={...fullAnswer(t).hold,value:'7'};assert.equal(inspectEvidence(t.goals,a,t.documents)[1].supported,false);
  a.hold={...a.duration};assert.equal(inspectEvidence(t.goals,a,t.documents)[1].supported,true);assert.equal(verify(t,a,t.documents).hold.status,'fail');
});
test('补读后的模型调用失败保留第一轮成本，未知费用不当作零',async()=>{
  const t=fixtures.tasks[2];let count=0;
  const r=await runPolicy(publicTask(t),'evidence',{execute:async()=>{if(++count===1)return {answer:{},usage};throw new Error('模拟离线');}});
  assert.equal(r.outcome,'execution_failed');assert.equal(r.tokens,null);assert.equal(r.cost.knownTokens,110);assert.equal(r.cost.unknownCalls,1);
});
test('在补读调用之前检查限制，不能超出已授权调用次数',async()=>{
  let calls=0;const r=await runPolicy(publicTask(fixtures.tasks[2]),'evidence',{beforeCall:()=>{if(calls===1)throw new Error('测试额度已用尽');},execute:async()=>{calls++;return {answer:{},usage};}});
  assert.equal(calls,1);assert.equal(r.outcome,'budget_stopped');assert.equal(r.tokens,110);
});
test('协议先保存，连续两次失败停止，记录失败而不生成成功验收',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'evidence-test-'));let calls=0;
  try {const d=await runStudy({outputDir:root,cliVersion:'test-only',onProgress:()=>{},execute:async()=>{calls++;const folder=fs.readdirSync(root).find(n=>n.startsWith('evidence-'));assert.ok(fs.existsSync(path.join(root,folder,'protocol.json')));throw new Error('模拟失败');}});
    assert.equal(calls,2);assert.equal(d.retrievalStudy.status,'stopped');assert.equal(d.retrievalStudy.cost.unknownCalls,2);
    assert.ok(d.tasks.flatMap(t=>t.runs).every(r=>Object.values(r.checks).every(c=>c.status==='unknown')));
    assert.equal(JSON.parse(fs.readFileSync(path.join(root,'evidence-latest.json'))).retrievalStudy.status,'stopped');
  } finally {const target=path.resolve(root);if(path.dirname(target)===path.resolve(os.tmpdir())&&path.basename(target).startsWith('evidence-test-'))fs.rmSync(target,{recursive:true,force:true});}
});
