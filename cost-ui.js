'use strict';
(()=>{
  const panel=document.getElementById('cost-lab'),form=document.getElementById('cost-form');
  const fields=['full','first','second','probability'];
  const getField=key=>document.getElementById('cost-'+key);
  const fmt=n=>n.toLocaleString('zh-CN',{maximumFractionDigits:2});
  let calibration=null,current=null;
  function render(){
    try{
      const values=Object.fromEntries(fields.map(key=>{const raw=getField(key).value;if(!raw.trim())throw new Error('请填完四项假设值');return [key,Number(raw)];}));
      const model=AgentCostModel.estimate({...values,probability:values.probability/100});current=model;
      const threshold=model.threshold===null?'第二次调用设为零成本，直接比较首次与全读成本。':model.threshold<=0?'即使不补读，首次调用也不比全读更省。':model.threshold>1?'在当前假设下，0%—100% 的补读概率均低于持平点。':`补读概率低于 ${fmt(model.threshold*100)}% 才可能减少 token；等于该值时持平。`;
      const max=Math.max(1,model.full,model.adaptive);
      document.getElementById('cost-result').innerHTML=`<h3>${model.lowerCost==='adaptive'?'当前假设下，先少读的期望用量较低':model.lowerCost==='full'?'当前假设下，一次全读的用量较低':'两种方式的估算用量相同'}</h3><div class="cost-bars"><div><span>一次全读 · ${fmt(model.full)} tokens</span><i style="width:${model.full/max*100}%"></i></div><div><span>先少读，必要时补读 · ${fmt(model.adaptive)} tokens</span><i style="width:${model.adaptive/max*100}%"></i></div></div><p>${threshold}</p><p>先少读的期望用量 = ${fmt(model.first)} + ${fmt(values.probability)}% × ${fmt(model.second)}。${model.saving>=0?'预计少用':'预计多用'} ${fmt(Math.abs(model.saving))} tokens。</p>`;
      document.getElementById('cost-export').disabled=false;
    }catch(e){current=null;document.getElementById('cost-result').textContent=e.message;document.getElementById('cost-export').disabled=true;}
  }
  document.getElementById('open-cost').addEventListener('click',()=>{panel.hidden=!panel.hidden;if(!panel.hidden){render();panel.scrollIntoView({behavior:'smooth',block:'start'});}});
  form.addEventListener('input',()=>{document.getElementById('cost-origin').textContent=calibration?'已修改假设值；所引实验用于参考，补读概率不是未来任务的保证。':'手动假设，尚未引用实测记录。';render();});
  form.addEventListener('submit',e=>e.preventDefault());
  document.getElementById('cost-calibrate').addEventListener('click',async()=>{
    try{const response=await fetch('/api/evidence'),data=await response.json();if(!response.ok)throw new Error(data.error);const c=AgentCostModel.calibrate(data);calibration=c;
      for(const key of fields)getField(key).value=String(c[key]*(key==='probability'?100:1));
      document.getElementById('cost-origin').textContent=`引用上轮 ${c.pairs} 对完整记录、${c.fallbackSamples} 个补读成本样本；排除 ${c.excluded} 对缺失或异常记录。补读频率仅为样本观察，格式验收失败的已知成本仍包含在内。`;
      render();
    }catch(e){document.getElementById('cost-origin').textContent=e.message+'；当前假设未改变。';}
  });
  document.getElementById('cost-export').addEventListener('click',()=>{if(current)showReport({type:'cost-estimate',isExperimentResult:false,generatedAt:new Date().toISOString(),assumptions:current,reference:calibration,limitations:['不预测任务质量','补读成本为发生补读时的条件平均用量','单次样本不代表未来概率；未估计置信区间','只比较 token，不推断硬件算力或货币费用']});});
  render();
})();
