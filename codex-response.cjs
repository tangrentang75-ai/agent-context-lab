'use strict';
// Record structure only; never persist raw stderr, credentials or arbitrary error text.
function responseTracker(onTool=()=>{}) {
  let answer,usage=null,toolEvents=0,completed=false,turnFailed=false,errors=0,lateError=false,turns=0;
  const eventCounts=Object.create(null);
  function accept(event){
    const type=typeof event?.type==='string'?event.type:'unknown';
    // Restrict diagnostic labels to avoid storing arbitrary provider content.
    const safe=/^[a-z_.]{1,60}$/.test(type)?type:'unknown';eventCounts[safe]=(eventCounts[safe]||0)+1;
    if(type==='turn.started')turns++;
    if(type==='turn.completed'){completed=true;usage=event.usage||null;}
    if(type==='turn.failed')turnFailed=true;
    if(type==='error'){errors++;if(completed)lateError=true;}
    if(type==='item.completed'&&event.item?.type==='agent_message')answer=event.item.text;
    if(type==='item.completed'&&['command_execution','file_change','mcp_tool_call','web_search'].includes(event.item?.type)){toolEvents++;onTool(event.item.type);}
  }
  function diagnostics(result={}){return {exitCode:Number.isInteger(result.code)?result.code:null,completed,turnFailed,errorEvents:errors,answerReceived:typeof answer==='string'&&answer.length>0,toolEvents,eventCounts:{...eventCounts},stderrPresent:typeof result.errors==='string'&&result.errors.length>0};}
  function finish(result){
    const d=diagnostics(result);
    // This adapter expects one turn. Pre-completion errors remain observable,
    // but are not terminal when the process subsequently completes successfully.
    const reason=result.code!==0?'process_exit':turnFailed?'turn_failed':turns>1?'unexpected_multiple_turns':lateError?'stream_error':!completed?(errors?'stream_error':'missing_completion'):!d.answerReceived?'missing_answer':null;
    const fail=kind=>{const e=new Error('模型调用未完成：'+kind);e.usage=usage;e.diagnostics={...d,reason:kind};throw e;};
    if(reason)fail(reason);
    let parsed;try{parsed=JSON.parse(answer);}catch{fail('invalid_json');}
    return {answer:parsed,usage,toolEvents,diagnostics:{...d,reason:null,warnings:errors?['errors_before_completion']:[]}};
  }
  return {accept,finish,diagnostics,get usage(){return usage;}};
}
module.exports={responseTracker};
