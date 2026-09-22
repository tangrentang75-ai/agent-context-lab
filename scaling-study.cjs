'use strict';
const fs=require('node:fs'),path=require('node:path');
const {runStudy}=require('./evidence-study.cjs');
const {validateDataset}=require('./evaluation.js');
const base=require('./validation-fixtures.json').tasks[1];
const padding=[
  '界面说明：页面标题采用清晰文字，操作入口保持统一。',
  '维护说明：工作人员检查设备状态，并将处理过程登记归档。',
  '帮助说明：使用者可以查阅操作指南，遇到故障可联系管理员。',
  '展示说明：文件预览支持缩放，按钮同时提供文字和图标提示。',
  '无障碍说明：页面保留键盘导航，并提供清晰的焦点状态。',
  '归档说明：维护日志按设备分类，便于后续追溯处理过程。'
];
function documentText(text,length,index){
  if(text.length>length)throw new Error('目标长度小于原文');
  const extra=Array.from({length:Math.ceil(length/20)},(_,i)=>padding[(i+index)%padding.length]).join('');
  const gap=length-text.length;
  // Keep the original evidence intact at the middle of every document.
  return extra.slice(0,Math.floor(gap/2))+text+extra.slice(0,Math.ceil(gap/2));
}
function makeFixtures(){
  const conditions=[{chars:128,labelError:false},{chars:4096,labelError:true},{chars:4096,labelError:false},{chars:128,labelError:true}];
  return {version:1,
    design:'同一打印配置任务，2 种正文长度（每份 128 / 4096 字符）× 2 种标签状态 × 2 种策略；每格一次。正文保持配对一致，仅改变无关背景长度及目录标签。',
    limitations:'人工填充背景且复用已观察过的题目；错误标签是人为设置的实验条件，不是自然发生概率。每格一次，不支持泛化、显著性或实际业务收益结论。',
    tasks:conditions.map(c=>{
      const t=structuredClone(base);t.id=`print-${c.chars}-${c.labelError?'error':'clean'}`;
      t.condition={charsPerDocument:c.chars,labelError:c.labelError,documents:6};
      if(!c.labelError){t.documents[1].tags=[];t.documents[5].tags=['hold'];}
      t.documents=t.documents.map((d,i)=>({...d,text:documentText(d.text,c.chars,i)}));return t;
    })};
}
function summarizeConditions(data){
  return (data.retrievalStudy.protocol.conditions||[]).map(c=>{
    const task=data.tasks.find(t=>t.id===c.taskId),runs=task?.runs||[];
    const all=runs.find(r=>r.policy==='all'),evidence=runs.find(r=>r.policy==='evidence');
    const usable=r=>r&&r.outcome==='passed'&&!r.protocolDeviation&&Number.isFinite(r.tokens);
    return {...c,all:all?{outcome:all.outcome,tokens:all.tokens,calls:all.calls.length}:null,
      evidence:evidence?{outcome:evidence.outcome,tokens:evidence.tokens,calls:evidence.calls.length}:null,
      saving:usable(all)&&usable(evidence)?all.tokens-evidence.tokens:null};
  });
}
const runScaling=options=>runStudy({...options,taskSet:makeFixtures(),studyName:'scaling',strictSources:true,extraSourceFiles:['scaling-study.cjs','validation-fixtures.json'],maxCalls:12,maxTokens:260000});
function latestScaling(){try{return validateDataset(JSON.parse(fs.readFileSync(path.join(__dirname,'runs','scaling-latest.json'),'utf8')));}catch{return null;}}
module.exports={makeFixtures,runScaling,latestScaling,summarizeConditions};
if(require.main===module)runScaling().then(d=>console.log(JSON.stringify({status:d.retrievalStudy.status,cost:d.retrievalStudy.cost,conditions:summarizeConditions(d)},null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
