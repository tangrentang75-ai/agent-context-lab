const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createHash}=require('node:crypto');
const fixtures=require('./quality-fixtures.json');
const {runPolicy,publicTask,inspectEvidence}=require('./evidence-study.cjs');
const {verifyQuality,runQuality,promptSuffix}=require('./quality-study.cjs');
const empty={value:null,sourceId:null,quote:null};
const cost={input_tokens:100,output_tokens:10};
test('按约定留空与恢复配置分别验收；缺字段不算正确拒答',()=>{
  const answerable=fixtures.tasks[0],missing=fixtures.tasks[2],conflict=fixtures.tasks[1];
  assert.equal(verifyQuality(missing,{quota:empty},missing.documents).quota.judgment,'correct_abstention');
  assert.equal(verifyQuality(conflict,{hours:empty},conflict.documents).hours.status,'pass');
  assert.equal(verifyQuality(answerable,{hold:empty},answerable.documents).hold.judgment,'unnecessary_abstention');
  assert.equal(verifyQuality(answerable,{hold:{...empty,sourceId:'03'}},answerable.documents).hold.status,'fail');
  assert.equal(verifyQuality(missing,{},missing.documents).quota.status,'unknown');
  assert.equal(verifyQuality(missing,{quota:{...empty,quote:'任意引文'}},missing.documents).quota.status,'fail');
});
test('真实但无关的数值引文可骗过旧控制器，最终语义金标准仍判失败',async()=>{
  const t=fixtures.tasks[0],a={hold:{value:'11',sourceId:'01',quote:'设备巡检间隔为 11 分钟。'}};
  assert.equal(inspectEvidence(t.goals,a,t.documents)[0].supported,true);
  const r=await runPolicy(publicTask(t),'evidence',{execute:async()=>({answer:a,usage:cost})});
  assert.equal(r.calls.length,1);assert.equal(verifyQuality(t,r.answer,r.documents).hold.status,'fail');
});
test('未读取的冲突不会自动触发补读；结束后的金标准不得反馈给控制器',async()=>{
  const t=fixtures.tasks[1];let calls=0;
  const r=await runPolicy(publicTask(t),'evidence',{promptSuffix,execute:async(task,prompt)=>{
    calls++;assert.ok(!('audit' in task));assert.ok(!('expected' in task.goals[0]));assert.ok(!prompt.includes('9 小时'));
    return {answer:{hours:{value:'4',sourceId:'01',quote:'单次借用时长上限为 4 小时。'}},usage:cost};
  }});
  assert.equal(calls,1);assert.equal(r.retrieval.stopReason,'引文完整性检查通过');
  assert.equal(verifyQuality(t,r.answer,r.documents).hours.judgment,'unsupported_assertion');
});
test('审计协议与真实提示词在调用前保存；安全留空、误停和成本独立保留',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'quality-test-'));let calls=0;
  try{
    const d=await runQuality({outputDir:root,cliVersion:'test-only',onProgress:()=>{},execute:async(t,prompt)=>{
      calls++;const folder=fs.readdirSync(root).find(n=>n.startsWith('quality-'));
      const protocol=JSON.parse(fs.readFileSync(path.join(root,folder,'protocol.json')));assert.equal(protocol.promptSuffix,promptSuffix);
      const inputs=fs.readdirSync(path.join(root,folder)).filter(n=>n.endsWith('-input.json')).map(n=>JSON.parse(fs.readFileSync(path.join(root,folder,n))));assert.ok(inputs.some(i=>i.prompt===prompt));
      assert.ok(prompt.endsWith(promptSuffix));
      if(t.id==='irrelevant-quote')return {answer:{hold:prompt.includes('37 分钟')?{value:'37',sourceId:'03',quote:'未支付预约的保留时间为 37 分钟。'}:empty},usage:cost};
      if(t.id==='hidden-conflict')return {answer:{hours:prompt.includes('9 小时')?empty:{value:'4',sourceId:'01',quote:'单次借用时长上限为 4 小时。'}},usage:cost};
      return {answer:{quota:empty},usage:cost};
    }});
    assert.equal(calls,8);assert.equal(d.retrievalStudy.cost.knownTokens,880);
    assert.equal(d.retrievalStudy.summary.find(p=>p.id==='evidence').prematureStops,1);
    assert.equal(d.tasks[2].runs[0].checks.quota.judgment,'correct_abstention');
    assert.ok(d.tasks.flatMap(t=>t.runs).flatMap(r=>r.calls).every(c=>c.promptChars>0));
    assert.ok(fs.existsSync(path.join(root,'quality-latest.json')));assert.ok(!fs.existsSync(path.join(root,'evidence-latest.json')));
  }finally{const target=path.resolve(root);if(path.dirname(target)===path.resolve(os.tmpdir())&&path.basename(target).startsWith('quality-test-'))fs.rmSync(target,{recursive:true,force:true});}
});
