const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createHash}=require('node:crypto');
const {makeFixtures,runScaling,summarizeConditions}=require('./scaling-study.cjs');
const {selectDocuments}=require('./retrieval-study.cjs');
test('长度和标签正交变化；完整正文配对相同，金标准未被截断',()=>{
  const fixtures=makeFixtures();assert.deepEqual(fixtures,makeFixtures());assert.equal(fixtures.tasks.length,4);
  for(const t of fixtures.tasks){
    assert.ok(t.documents.every(d=>d.text.length===t.condition.charsPerDocument));
    for(const g of t.goals)assert.ok(t.documents.find(d=>d.id===g.sourceId).text.includes(g.sentence));
    const selected=selectDocuments(t.documents,t.goals,'coverage');assert.equal(selected.length,3);
    assert.equal(selected.some(d=>d.id==='06'),!t.condition.labelError);
    const paired=fixtures.tasks.find(other=>other.condition.charsPerDocument===t.condition.charsPerDocument&&other.condition.labelError!==t.condition.labelError);
    assert.deepEqual(t.documents.map(d=>d.text),paired.documents.map(d=>d.text));
  }
});
test('运行前冻结资料和协议，金标准不进入控制器，补读费用累加且结果分条件保存',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'scaling-test-'));let calls=0;
  try{
    const d=await runScaling({outputDir:root,cliVersion:'test-only',onProgress:()=>{},execute:async(t,prompt)=>{
      calls++;assert.ok(t.goals.every(g=>!('expected' in g)));const folder=fs.readdirSync(root).find(n=>n.startsWith('scaling-'));
      const protocol=JSON.parse(fs.readFileSync(path.join(root,folder,'protocol.json')));
      const fixtures=JSON.parse(fs.readFileSync(path.join(root,folder,'fixture-set.json')));
      assert.equal(createHash('sha256').update(JSON.stringify(fixtures)).digest('hex'),protocol.fixtureSha256);
      const spec=fixtures.tasks.find(s=>s.id===t.id);
      return {answer:Object.fromEntries(spec.goals.map(g=>[g.id,prompt.includes(g.sentence)?{value:g.expected,sourceId:g.sourceId,quote:g.sentence}:{value:null,sourceId:null,quote:null}])),usage:{input_tokens:100,output_tokens:10}};
    }});
    assert.equal(calls,10);assert.equal(d.retrievalStudy.cost.knownTokens,1100);assert.equal(d.retrievalStudy.status,'complete');
    const rows=summarizeConditions(d);assert.equal(rows.length,4);assert.ok(rows.every(r=>r.all.outcome==='passed'&&r.evidence.outcome==='passed'));
    assert.ok(rows.filter(r=>r.labelError).every(r=>r.saving===-110));
    d.tasks[0].runs[0].tokens=null;assert.equal(summarizeConditions(d)[0].saving,null);
    d.tasks[0].runs[0].tokens=10;d.tasks[0].runs[0].outcome='verification_failed';assert.equal(summarizeConditions(d)[0].saving,null);
    assert.ok(fs.existsSync(path.join(root,'scaling-latest.json')));
    assert.ok(!fs.existsSync(path.join(root,'validation-latest.json')));
  }finally{const target=path.resolve(root);if(path.dirname(target)===path.resolve(os.tmpdir())&&path.basename(target).startsWith('scaling-test-'))fs.rmSync(target,{recursive:true,force:true});}
});
