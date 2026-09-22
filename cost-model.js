(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AgentCostModel=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function estimate({full,first,second,probability}) {
    for(const n of [full,first,second])if(!Number.isFinite(n)||n<0||n>1e9)throw new Error('调用成本应为 0—1,000,000,000 的已知数值');
    if(!Number.isFinite(probability)||probability<0||probability>1)throw new Error('补读概率应在 0%—100% 之间');
    const adaptive=first+probability*second,saving=full-adaptive;
    const threshold=second>0?(full-first)/second:null;
    return {full,first,second,probability,adaptive,saving,threshold,lowerCost:saving>0?'adaptive':saving<0?'full':'tie'};
  }
  function tokens(call){const u=call?.usage;return u&&[u.input_tokens,u.output_tokens].every(n=>Number.isFinite(n)&&n>=0)?u.input_tokens+u.output_tokens:null;}
  function calibrate(data) {
    if(data?.demo!==false||data.source!=='local-evidence-study'||!Array.isArray(data.tasks))throw new Error('需要本机证据补读实验记录');
    const pairs=[],fallbacks=[];let excluded=0;
    for(const task of data.tasks){
      const all=task.runs?.find(r=>r.policy==='all'),evidence=task.runs?.find(r=>r.policy==='evidence');
      const runs=[all,evidence];
      if(runs.some(r=>!r||r.protocolDeviation||r.outcome==='execution_failed'||r.outcome==='budget_stopped'||!r.calls?.length||r.calls.some(c=>c.status!=='complete'||tokens(c)===null))||all.calls.length!==1||evidence.calls.length>2){excluded++;continue;}
      pairs.push({full:tokens(all.calls[0]),first:tokens(evidence.calls[0]),fallback:evidence.calls.length===2});
      if(evidence.calls.length===2)fallbacks.push(tokens(evidence.calls[1]));
    }
    if(!pairs.length||!fallbacks.length)throw new Error('完整配对或补读成本样本不足；请手动填写假设值');
    const mean=(xs)=>xs.reduce((a,b)=>a+b,0)/xs.length;
    return {full:mean(pairs.map(p=>p.full)),first:mean(pairs.map(p=>p.first)),second:mean(fallbacks),probability:fallbacks.length/pairs.length,
      pairs:pairs.length,fallbackSamples:fallbacks.length,excluded,protocolId:data.retrievalStudy?.protocol?.id||'未知协议'};
  }
  return {estimate,calibrate};
});
