'use strict';
const el=id=>document.getElementById(id);
const example={id:'sensor-dev',title:'传感器设置核对',goals:[{id:'period',label:'传感器上报周期'}],documents:[{id:'A',text:'现行设置甲：传感器上报周期为 6 秒。'},{id:'B',text:'现行设置乙：传感器上报周期为 14 秒。两份设置具有同等效力，未说明优先级。'},{id:'C',text:'界面支持导出与键盘操作。'}]};
let report=null;
function text(tag,value,parent){const n=document.createElement(tag);n.textContent=value;parent.append(n);return n;}
function invalidate(){report=null;el('export').disabled=true;el('summary').replaceChildren();el('evidence').hidden=true;el('report-panel').hidden=true;el('report').value='';el('error').textContent='';}
function reset(){el('task-input').value=JSON.stringify(example,null,2);invalidate();}
for(const id of ['task-input','scan-budget','context-budget'])el(id).addEventListener('input',invalidate);
el('reset').addEventListener('click',reset);
el('plan').addEventListener('click',()=>{
  invalidate();try{
    if(!el('scan-budget').value.trim()||!el('context-budget').value.trim())throw new Error('请填写两个预算，允许填 0');
    const task=JSON.parse(el('task-input').value),plan=ReviewPlanner.planReview(task,{scanCharBudget:Number(el('scan-budget').value),contextCharBudget:Number(el('context-budget').value)});
    report={type:'local-review-plan',demo:el('task-input').value===JSON.stringify(example,null,2),generatedAt:new Date().toISOString(),task,plan};
    const box=el('summary');text('p',plan.disposition==='needs_review'?'仍需核验：部分资料未提交，候选答案不能标为完成。':'全部提供资料可进入模型上下文；仍须独立验收答案。',box).className='status'+(plan.disposition==='needs_review'?'':' complete');
    const dl=document.createElement('dl');box.append(dl);for(const [k,v] of [['扫描字符',`${plan.scannedChars} / ${plan.totalChars}`],['拟提交字符',plan.submittedChars],['本地扫描耗时',plan.controllerMs.toFixed(2)+' ms'],['模型调用','0 次'],['未扫描资料',plan.unscannedIds.join('、')||'无'],['未提交资料',plan.omittedIds.join('、')||'无']]){text('dt',k,dl);text('dd',String(v),dl);}
    const evidence=el('evidence');evidence.hidden=false;evidence.replaceChildren();text('h2','候选证据与核验线索',evidence);
    text('p','拟提交资料：'+(plan.selectedIds.join('、')||'无')+'。排序使用目标词语匹配，不依赖目录标签或标准答案。',evidence);
    for(const flag of plan.possibleConflicts)text('p',`目标 ${flag.goalId}：发现数字 ${flag.values.join('、')}，来源 ${flag.sourceIds.join('、')}。${flag.reason}`,evidence).className='status';
    if(!plan.possibleConflicts.length)text('p','未找到不同数字线索；这不表示没有冲突或遗漏。',evidence);
    text('p',`匹配 ${plan.candidates.length} 条目标与原句组合，页面最多显示 100 条；完整结果在 JSON 报告中。`,evidence).className='muted';
    for(const c of plan.candidates.slice(0,100)){const q=text('blockquote',c.quote,evidence);text('p',`目标 ${c.goalId} · 资料 ${c.sourceId} · ${plan.selectedIds.includes(c.sourceId)?'拟提交':'未提交'}`,q).className='muted';}
    el('export').disabled=false;
  }catch(e){el('error').textContent=e instanceof SyntaxError?'JSON 格式不正确，请检查引号和逗号。':e.message;}
});
el('export').addEventListener('click',()=>{if(!report)return;el('report').value=JSON.stringify(report,null,2);el('report-panel').hidden=false;el('report-panel').scrollIntoView({behavior:'smooth'});});
reset();
