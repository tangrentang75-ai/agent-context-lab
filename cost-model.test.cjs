const test=require('node:test'),assert=require('node:assert/strict');
const {estimate,calibrate}=require('./cost-model.js');
const {answerSchema}=require('./retrieval-study.cjs');
const {runPolicy,publicTask}=require('./evidence-study.cjs');
const fixtures=require('./validation-fixtures.json');
test('边界概率正确，补读成本计入；负节省不伪装为更优',()=>{
  const p={full:15000,first:14000,second:15000};
  assert.equal(estimate({...p,probability:0}).saving,1000);
  assert.equal(estimate({...p,probability:1}).adaptive,29000);
  assert.equal(estimate({...p,probability:1/15}).lowerCost,'tie');
  assert.equal(estimate({...p,probability:0.5}).lowerCost,'full');
  assert.ok(estimate({full:1,first:2,second:3,probability:0}).threshold<0);
  assert.equal(estimate({full:0,first:0,second:0,probability:1}).lowerCost,'tie');
});
test('拒绝未知、负值、越界概率，不能将缺失成本当作零',()=>{
  for(const full of [null,undefined,NaN,Infinity,-1])assert.throws(()=>estimate({full,first:1,second:1,probability:0}));
  for(const probability of [-0.1,1.1,null])assert.throws(()=>estimate({full:1,first:1,second:1,probability}));
});
test('实测校准保留格式验收失败，未知用量配对排除并披露',()=>{
  const call=n=>({status:'complete',usage:{input_tokens:n,output_tokens:0}});
  const pair=(full,first,extra)=>({runs:[{policy:'all',outcome:'verification_failed',calls:[call(full)]},{policy:'evidence',outcome:'passed',calls:[call(first),...(extra===undefined?[]:[call(extra)])]}]});
  const data={demo:false,source:'local-evidence-study',tasks:[pair(100,80,100),pair(100,80),pair(null,80)]};
  const c=calibrate(data);assert.equal(c.probability,0.5);assert.equal(c.pairs,2);assert.equal(c.excluded,1);assert.equal(c.second,100);
  assert.throws(()=>calibrate({...data,tasks:[pair(100,80)]}));
});
test('来源枚举只包含已选资料，下一轮扩展，不包含金标准',async()=>{
  const spec=fixtures.tasks[1];let calls=0;
  await runPolicy(publicTask(spec),'evidence',{strictSources:true,execute:async(task,prompt,event,options)=>{
    calls++;const ids=options.allowedSourceIds;
    assert.equal(ids.includes('06'),calls===2);assert.ok(!('expected' in task.goals[0]));
    assert.deepEqual(answerSchema(task,ids).properties.hold.properties.sourceId.enum,[...ids,null]);
    assert.ok(!answerSchema(task,ids).properties.hold.properties.sourceId.enum.includes('资料 01'));
    return {answer:{},usage:{input_tokens:1,output_tokens:1}};
  }});assert.equal(calls,2);
});
