const test=require('node:test'),assert=require('node:assert/strict');
const {planPassages}=require('./review-passages.js'),{runPassageReview}=require('./review-passages-strategy.cjs');
const task=()=>({id:'development',title:'配置核对',goals:[{id:'refresh',label:'缓存刷新间隔'}],documents:[{id:'a',text:'缓存刷新间隔为 7 分钟。旧说明现已废止。'},{id:'b',text:'页面支持排序。缓存刷新间隔为 19 分钟。此说明替代旧版。'},{id:'c',text:'可以导出日志。'}]});
function checkIntegrity(spec,plan){
  assert.ok(plan.scannedChars<=plan.scanCharBudget);assert.ok(plan.submittedChars<=plan.contextCharBudget);
  assert.equal(plan.submittedChars,plan.selectedPassages.reduce((n,p)=>n+p.text.length,0));
  assert.equal(plan.totalChars,plan.documentCoverage.reduce((n,d)=>n+d.totalChars,0));
  for(const doc of spec.documents){const ranges=plan.selectedPassages.filter(p=>p.sourceId===doc.id).map(p=>{assert.equal(p.text,doc.text.slice(p.start,p.end));return {start:p.start,end:p.end};}),coverage=plan.documentCoverage.find(d=>d.id===doc.id);ranges.push(...coverage.omittedRanges);ranges.sort((a,b)=>a.start-b.start);let cursor=0;for(const range of ranges){assert.equal(range.start,cursor);assert.ok(range.end>range.start);cursor=range.end;}assert.equal(cursor,doc.text.length);assert.equal(coverage.complete,coverage.submittedChars===doc.text.length);}
  assert.equal(plan.disposition,plan.documentCoverage.every(d=>d.complete)?'ready_for_verification':'needs_review');
}
test('长文可选择中部完整原句，不会因整篇放不下丢掉整个来源',()=>{
  const spec={goals:[{id:'delay',label:'推送延迟'}],documents:[{id:'one',text:'页面可以搜索。推送延迟为 12 秒。'+'旧页面说明。'.repeat(80)}]};
  const plan=planPassages(spec,{contextCharBudget:'推送延迟为 12 秒。'.length});checkIntegrity(spec,plan);assert.equal(plan.selectedPassages.length,1);assert.equal(plan.selectedPassages[0].text,'推送延迟为 12 秒。');assert.deepEqual(plan.partialIds,['one']);assert.equal(plan.callRecommendation,'skip_incomplete');
});
test('强匹配来源优先获得预算，前面的弱匹配展示说明不能挤掉核心句',()=>{
  const spec={goals:[{id:'rate',label:'设备上传频率'}],documents:[{id:'first',text:'设备页面支持搜索操作。'},{id:'second',text:'设备上传频率为 27 Hz。剩余说明。'}]};
  const plan=planPassages(spec,{contextCharBudget:'设备上传频率为 27 Hz。'.length});checkIntegrity(spec,plan);assert.equal(plan.selectedPassages.length,1);assert.equal(plan.selectedPassages[0].sourceId,'second');assert.equal(plan.disposition,'needs_review');
});
test('完整预算精确保留空白、中文句界、英文小数和 emoji，任意省略不算完整',()=>{
  const spec={goals:[{id:'delay',label:'delay'}],documents:[{id:'one',text:'\n  delay = 2.5 s.\nNext line! 🙂结束。  \n'}]};
  const full=planPassages(spec);checkIntegrity(spec,full);assert.equal(full.selectedPassages.map(p=>p.text).join(''),spec.documents[0].text);assert.ok(full.selectedPassages.some(p=>p.text.includes('2.5')));
  for(let budget=0;budget<=spec.documents[0].text.length;budget++)checkIntegrity(spec,planPassages(spec,{contextCharBudget:budget}));
});
test('先给每个扫描来源一次机会；零匹配资料以及扫描缺口仍如实记录',()=>{
  const spec=task(),plan=planPassages(spec,{contextCharBudget:36});checkIntegrity(spec,plan);assert.equal(plan.selectedIds.length,3);assert.equal(plan.disposition,'needs_review');
  const limited=planPassages(spec,{scanCharBudget:spec.documents[0].text.length});checkIntegrity(spec,limited);assert.ok(limited.unscannedIds.includes('b'));assert.equal(limited.documentCoverage[1].scanned,false);assert.equal(limited.documentCoverage[1].complete,false);
});
test('相邻的替代说明预算允许时一同选择，允许人工查看但不宣判数值冲突',()=>{
  const spec=task(),plan=planPassages(spec,{contextCharBudget:spec.documents[0].text.length+spec.documents[1].text.length});checkIntegrity(spec,plan);assert.ok(plan.possibleConflicts.length);assert.ok(plan.selectedPassages.some(p=>p.text.includes('此说明替代旧版')));
});
test('改名、错误标签和标准答案不会参与排序或泄漏进规划',()=>{
  const spec=task(),renamed={...spec,id:'other',audit:'GOLD_SECRET',goals:spec.goals.map(g=>({...g,expected:'GOLD_SECRET'})),documents:spec.documents.map((d,i)=>({...d,id:'random-'+i,tags:['GOLD_SECRET']}))};
  const a=planPassages(spec,{contextCharBudget:36}),b=planPassages(renamed,{contextCharBudget:36});assert.deepEqual(a.selectedPassages.map(p=>[spec.documents.findIndex(d=>d.id===p.sourceId),p.start,p.end]),b.selectedPassages.map(p=>[renamed.documents.findIndex(d=>d.id===p.sourceId),p.start,p.end]));assert.ok(!JSON.stringify(b).includes('GOLD_SECRET'));
});
test('不同字符预算下所有选择与省略范围无重叠、无缺口，长单句不截断',()=>{
  for(let seed=1;seed<=40;seed++){const spec={goals:[{id:'g',label:'缓存 policy'}],documents:Array.from({length:4},(_,i)=>({id:String(i),text:Array.from({length:1+(seed+i)%7},(_,j)=>`${j%2?'缓存':'policy'} ${seed+j}.5。\n`).join('')}))};for(const budget of [0,1,13,seed*3,200000])checkIntegrity(spec,planPassages(spec,{scanCharBudget:seed*9,contextCharBudget:budget}));}
  const long={goals:[{id:'g',label:'缓存'}],documents:[{id:'d',text:'缓存'+ '说明'.repeat(100)}]};assert.equal(planPassages(long,{contextCharBudget:100}).submittedChars,0);
});
test('非法输入和预算拒绝；零/部分覆盖默认在调用前停止',async()=>{
  const spec=task();assert.throws(()=>planPassages(spec,{contextCharBudget:1.5}));assert.throws(()=>planPassages({...spec,documents:[spec.documents[0],spec.documents[0]]}));assert.throws(()=>planPassages({...spec,documents:[]}));
  for(const budget of [0,36]){const r=await runPassageReview(spec,{contextCharBudget:budget,execute:()=>assert.fail('不应调用'),beforeCall:()=>assert.fail('不应进入调用流程'),onInput:()=>assert.fail('不应构造模型输入')});assert.equal(r.calls.length,0);assert.equal(r.cost.tokens,0);assert.equal(r.skippedBeforeCall,true);assert.equal(r.status,'needs_review');}
});
test('显式允许部分候选才调用；输入只有已选原句，金标准剥离，不能放行',async()=>{
  const spec=task();spec.goals[0].expected='GOLD_SECRET';spec.audit='GOLD_SECRET';let received;
  const r=await runPassageReview(spec,{contextCharBudget:36,allowPartialCandidate:true,execute:async(publicTask,prompt)=>{received=publicTask;assert.ok(!JSON.stringify(publicTask).includes('GOLD_SECRET'));assert.ok(!prompt.includes('此说明替代旧版'));return {answer:{},usage:{input_tokens:12,output_tokens:3}};}});
  assert.equal(r.status,'needs_review');assert.equal(r.calls.length,1);assert.equal(r.cost.tokens,15);for(const d of received.documents)assert.ok(d.text.includes(r.plan.selectedPassages.find(p=>p.sourceId===d.id).text));
});
test('完整输入只进入独立验收；连续原句无虚假省略标记，工具偏离保持待核验',async()=>{
  const spec=task();const r=await runPassageReview(spec,{execute:async(publicTask)=>{assert.deepEqual(publicTask.documents,spec.documents);return {answer:{},usage:null};}});assert.equal(r.status,'ready_for_verification');assert.equal(r.cost.tokens,null);
  const deviated=await runPassageReview(spec,{execute:async()=>({answer:{},toolEvents:1,usage:{input_tokens:2,output_tokens:1}})});assert.equal(deviated.status,'needs_review');assert.equal(deviated.protocolDeviation,true);
});
test('调用预算停止与执行失败费用独立保留，不自动重试',async()=>{
  const stopped=await runPassageReview(task(),{beforeCall:()=>{throw Error();},execute:()=>assert.fail()});assert.equal(stopped.status,'budget_stopped');assert.equal(stopped.calls.length,0);
  let count=0;const failed=await runPassageReview(task(),{execute:async()=>{count++;const e=Error();e.usage={input_tokens:9,output_tokens:4};throw e;}});assert.equal(count,1);assert.equal(failed.status,'execution_failed');assert.equal(failed.cost.knownTokens,13);
});
