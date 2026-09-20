const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {runStudy,summarize,schedule,variants}=require('./context-study.cjs');
test('三组都保留原题且各重复三次，位置平衡',()=>{
  for(const v of variants){assert.equal(schedule.filter(s=>s.variant===v.id).length,3);assert.ok(v.prompt.startsWith(variants[0].prompt));}
  for(let pos=0;pos<3;pos++)assert.equal(new Set([schedule[pos].variant,schedule[pos+3].variant,schedule[pos+6].variant]).size,3);
});
test('均值包含失败的已知成本，不把未知成本计作零',()=>{
  const [s]=summarize([{variant:'essential',outcome:'passed',tokens:100,durationSec:2},{variant:'essential',outcome:'execution_failed',tokens:200,durationSec:3},{variant:'essential',outcome:'execution_failed',tokens:null,durationSec:4}]);
  assert.equal(s.attempts,3);assert.equal(s.successes,1);assert.equal(s.tokens.mean,150);assert.equal(s.unknownCost,1);
});
test('运行前保存协议，连续失败后停止并持久化未知验收',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'context-study-test-'));let calls=0;
  try{const data=await runStudy({outputDir:root,cliVersion:'fake-test-only',onProgress:()=>{},execute:async()=>{calls++;const folder=fs.readdirSync(root).find(n=>n.startsWith('context-'));assert.ok(fs.existsSync(path.join(root,folder,'protocol.json')));throw new Error('模拟离线');}});
    assert.equal(calls,2);assert.equal(data.study.status,'stopped');assert.equal(data.tasks[0].runs[0].tokens,null);assert.equal(data.tasks[0].runs[0].checks.capacity.status,'unknown');assert.equal(JSON.parse(fs.readFileSync(path.join(root,'study-latest.json'))).tasks[0].runs.length,2);
  }finally{const resolved=path.resolve(root);if(path.dirname(resolved)===path.resolve(os.tmpdir())&&path.basename(resolved).startsWith('context-study-test-'))fs.rmSync(resolved,{recursive:true,force:true});}
});
