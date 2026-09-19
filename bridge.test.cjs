const test=require('node:test');
const assert=require('node:assert/strict');
const {verifyPatch}=require('./codex-bridge.cjs');
const {createServer}=require('./server.cjs');
test('验收能检出原始缺陷，也能验证修复后的行为',()=>{
  const before=verifyPatch({duplicateScope:'any_event',capacityOperator:'>',explanation:'原始实现'});
  assert.equal(before.checks.capacity.status,'fail');assert.equal(before.checks.regression.status,'fail');
  const after=verifyPatch({duplicateScope:'same_event',capacityOperator:'>=',explanation:'修复'});
  assert.equal(after.results.length,8);assert.ok(after.results.every(r=>r.expected===r.actual));
});
test('验收拒绝任意模型代码',()=>{assert.throws(()=>verifyPatch({duplicateScope:'none',capacityOperator:'process.exit()',explanation:'拒绝'}));});
test('局部修复不能隐藏剩余缺陷',()=>{
  assert.equal(verifyPatch({duplicateScope:'none',capacityOperator:'>=',explanation:'不完整'}).checks.duplicate.status,'fail');
  assert.equal(verifyPatch({duplicateScope:'any_event',capacityOperator:'>=',explanation:'不完整'}).checks.regression.status,'fail');
});
test('本机接口阻止跨站调用，保留失败状态并限制同时执行',async t=>{
  let calls=0,finish;
  const server=createServer({connectionStatus:async()=>({available:true}),latest:()=>null,runExperiment:()=>{calls++;return new Promise(resolve=>{finish=resolve;});}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
  const url=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(url+'/api/run',{method:'POST',headers:{origin:'https://example.com','x-agent-context':'local-run'}})).status,403);
  assert.equal((await fetch(url+'/api/run',{method:'POST',headers:{origin:url}})).status,403);assert.equal(calls,0);
  assert.equal((await fetch(url+'/api/latest')).status,404);
  const headers={origin:url,'x-agent-context':'local-run'};
  const active=fetch(url+'/api/run',{method:'POST',headers});
  for(let i=0;i<100&&!finish;i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.ok(finish);assert.equal((await fetch(url+'/api/run',{method:'POST',headers})).status,409);
  finish({demo:false});assert.equal((await active).status,200);assert.equal(calls,1);
});
test('执行异常不伪造成成功记录',async t=>{
  const server=createServer({runExperiment:async()=>{throw new Error('测试失败');}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
  const url=`http://127.0.0.1:${server.address().port}`;
  const r=await fetch(url+'/api/run',{method:'POST',headers:{origin:url,'x-agent-context':'local-run'}});assert.equal(r.status,502);assert.deepEqual(await r.json(),{error:'测试失败'});
});
