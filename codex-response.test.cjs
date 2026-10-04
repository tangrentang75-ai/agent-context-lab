const test=require('node:test'),assert=require('node:assert/strict');
const {responseTracker}=require('./codex-response.cjs'),{jsonlReader}=require('./jsonl-reader.cjs');
test('JSONL 保留跨字节中文和无换行的最后事件',()=>{
  const events=[],reader=jsonlReader(e=>events.push(e));const bytes=Buffer.from('{"text":"预约"}\n{"type":"turn.completed"}');
  for(const b of bytes)reader.push(Buffer.from([b]));reader.end();assert.deepEqual(events,[{text:'预约'},{type:'turn.completed'}]);
});
test('用量或答案单独出现均不足以确认完整成功',()=>{
  const a=responseTracker();a.accept({type:'turn.completed',usage:{input_tokens:5,output_tokens:1}});assert.throws(()=>a.finish({code:0}),e=>e.diagnostics.reason==='missing_answer'&&e.usage.input_tokens===5);
  const b=responseTracker();b.accept({type:'item.completed',item:{type:'agent_message',text:'{}'}});assert.throws(()=>b.finish({code:0}),e=>e.diagnostics.reason==='missing_completion');
});
test('区分进程失败、流错误、终结失败与无效 JSON，不保留原始错误文本',()=>{
  for(const [event,code,reason] of [[{type:'error',message:'SECRET'},0,'stream_error'],[{type:'turn.failed'},0,'turn_failed'],[null,1,'process_exit'],[null,0,'invalid_json']]){
    const t=responseTracker();t.accept({type:'item.completed',item:{type:'agent_message',text:'bad JSON'}});t.accept({type:'turn.completed',usage:{input_tokens:7,output_tokens:2}});if(event)t.accept(event);
    assert.throws(()=>t.finish({code,errors:'SECRET'}),e=>e.diagnostics.reason===reason&&!JSON.stringify(e.diagnostics).includes('SECRET'));
  }
});
test('完整成功保留用量、工具事件和可诊断的事件计数',()=>{
  const seen=[],t=responseTracker(e=>seen.push(e));t.accept({type:'item.completed',item:{type:'command_execution'}});t.accept({type:'item.completed',item:{type:'agent_message',text:'{"value":"37"}'}});t.accept({type:'turn.completed',usage:{input_tokens:10,output_tokens:2}});
  const r=t.finish({code:0});assert.equal(r.answer.value,'37');assert.equal(r.toolEvents,1);assert.deepEqual(seen,['command_execution']);assert.equal(r.diagnostics.eventCounts['item.completed'],2);
});
test('完成前的错误保留为警告，完整成功仍可进入独立验收',()=>{
  const t=responseTracker();t.accept({type:'turn.started'});
  for(let i=0;i<4;i++)t.accept({type:'error',message:'SECRET'});
  t.accept({type:'item.completed',item:{type:'agent_message',text:'{"value":"37"}'}});
  t.accept({type:'turn.completed',usage:{input_tokens:10,output_tokens:2}});
  const r=t.finish({code:0});assert.equal(r.answer.value,'37');assert.equal(r.diagnostics.errorEvents,4);
  assert.deepEqual(r.diagnostics.warnings,['errors_before_completion']);assert.ok(!JSON.stringify(r).includes('SECRET'));
});
test('错误后未完成、终止失败或多轮混合不能借旧答案成为成功',()=>{
  for(const [events,reason] of [
    [[{type:'error'}],'stream_error'],
    [[{type:'turn.failed'},{type:'turn.completed'}],'turn_failed'],
    [[{type:'turn.started'},{type:'turn.completed'},{type:'turn.started'}],'unexpected_multiple_turns'],
    [[{type:'turn.completed'},{type:'error'}],'stream_error']
  ]){const t=responseTracker();t.accept({type:'item.completed',item:{type:'agent_message',text:'{}'}});events.forEach(t.accept);assert.throws(()=>t.finish({code:0}),e=>e.diagnostics.reason===reason);}
});
test('事件回调异常在数据块和末行均转为 Promise 失败，子进程被清理',async()=>{
  const {capture}=require('./codex-bridge.cjs');const before=process.env.CODEX_BIN;process.env.CODEX_BIN=process.execPath;
  try{
    for(const suffix of ['\n','']){
      const script=`process.stdout.write(${JSON.stringify('{"type":"turn.completed"}'+suffix)});${suffix?'setInterval(()=>{},1000);':''}`;
      await assert.rejects(capture(['-e',script],{timeout:5000,onEvent:()=>{throw new Error('SECRET');}}),e=>e.message==='事件处理失败，本次调用未生成成功记录。');
    }
  }finally{if(before===undefined)delete process.env.CODEX_BIN;else process.env.CODEX_BIN=before;}
});
