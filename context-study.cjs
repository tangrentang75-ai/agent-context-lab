'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {runExperiment,prompt,capture}=require('./codex-bridge.cjs');
const {validateDataset}=require('./evaluation.js');
const sha=text=>createHash('sha256').update(text).digest('hex');
const variants=[
  {id:'essential',label:'仅必要信息',extra:''},
  {id:'relevant',label:'补充相关说明',extra:Array.from({length:24},(_,i)=>`补充说明 ${i+1}：报名记录包含用户标识和活动标识；同一用户可能参与多个活动；名额由各活动分别统计；容量是允许报名的最大人数；历史记录需要按当前活动区分。`).join('\n')},
  {id:'unrelated',label:'补充无关背景',extra:Array.from({length:24},(_,i)=>`界面资料 ${i+1}：校园门户使用浅色背景和紫色按钮；首页展示活动海报与校园通知；导航栏包含资讯和个人中心；站点页脚显示联系信息；设计稿采用统一间距。`).join('\n')}
].map(v=>({...v,prompt:prompt+(v.extra?'\n以下为额外项目资料：\n'+v.extra:'')}));
const schedule=[['essential','relevant','unrelated'],['relevant','unrelated','essential'],['unrelated','essential','relevant']].flatMap((row,i)=>row.map(variant=>({variant,repetition:i+1})));
function summarize(runs) {
  const stats=values=>{const a=values.filter(Number.isFinite).sort((a,b)=>a-b);return {n:a.length,mean:a.length?a.reduce((x,y)=>x+y,0)/a.length:null,min:a[0]??null,max:a.at(-1)??null};};
  return variants.map(v=>{const rows=runs.filter(r=>r.variant===v.id);return {variant:v.id,label:v.label,attempts:rows.length,successes:rows.filter(r=>r.outcome==='passed').length,executionFailures:rows.filter(r=>r.outcome==='execution_failed').length,protocolDeviations:rows.filter(r=>r.protocolDeviation).length,tokens:stats(rows.map(r=>r.tokens)),durationSec:stats(rows.map(r=>r.durationSec)),cachedInputTokens:stats(rows.map(r=>r.usage?.cached_input_tokens)),unknownCost:rows.filter(r=>r.tokens===null).length};});
}
function makeFailure(entry,error,id) {
  const u=error.observed?.usage;
  const tokens=u&&Number.isFinite(u.input_tokens)&&Number.isFinite(u.output_tokens)?u.input_tokens+u.output_tokens:null;
  return {id,strategy:`${variants.find(v=>v.id===entry.variant).label} · 第 ${entry.repetition} 次`,variant:entry.variant,repetition:entry.repetition,model:'gpt-6-astra / high（请求配置；非不可变版本）',comparisonGroup:'pending',tokens,durationSec:error.observed?.durationSec??null,outcome:'execution_failed',error:error.message,checks:Object.fromEntries(['capacity','duplicate','regression'].map(g=>[g,{status:'unknown',evidence:`执行失败，未能验收：${error.message}`} ])),events:error.observed?.events||[],usage:u||null};
}
function atomicWrite(file,data){const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(data,null,2));fs.renameSync(temp,file);}
async function runStudy({execute=runExperiment,outputDir=path.join(__dirname,'runs'),onProgress=console.log,cliVersion}={}) {
  fs.mkdirSync(outputDir,{recursive:true});
  const id=`context-${randomUUID()}`,folder=path.join(outputDir,id);fs.mkdirSync(folder);
  const protocol={id,version:1,createdAt:new Date().toISOString(),requestedModel:'gpt-6-astra',reasoningEffort:'high',cliVersion:cliVersion||(await capture(['--version'])).output.trim(),task:'registration-choice-v1',repetitions:3,schedule,variants:variants.map(v=>({id:v.id,label:v.label,prompt:v.prompt,promptChars:v.prompt.length,sha256:sha(v.prompt)})),harnessSha256:sha(fs.readFileSync(path.join(__dirname,'codex-bridge.cjs'))),studySha256:sha(fs.readFileSync(__filename)),stoppingRule:'最多 9 次，连续 2 次执行失败或累计已报告 token >= 180000 时停止后续调用；这是调用间停止规则，非单次硬上限；不自动重试。',limits:['只有一道受限选择题；存在天花板效应','相关与无关资料并非 token 等长，只能比较整个输入配置','固定请求模型名，不是服务端不可变快照','Latin square 顺序平衡位置，不能消除缓存、网络和时间变化','用量为执行器总输入加输出，不等于算力或费用；失败用量未知则保留未知']};
  atomicWrite(path.join(folder,'protocol.json'),protocol);
  const task={id:'registration-context-study-v1',title:'上下文对照：活动报名修复',scenario:'coding',description:'一道受限修复题，三种上下文各重复 3 次；固定模型请求名与推理强度。仅作探索性实验，不能推广到复杂代码任务。',goals:[{id:'capacity',label:'满员与零容量拒绝报名',weight:5,required:true},{id:'duplicate',label:'阻止同一活动重复报名',weight:5,required:true},{id:'regression',label:'跨活动与正常报名不受影响',weight:4,required:true}],runs:[]};
  const data={version:1,demo:false,source:'local-codex-study',study:{protocol,status:'running',summary:[]},tasks:[task]};
  const persist=()=>{data.generatedAt=new Date().toISOString();data.study.summary=summarize(task.runs);validateDataset(data);atomicWrite(path.join(folder,'results.json'),data);atomicWrite(path.join(outputDir,'study-latest.json'),data);};
  let consecutiveFailures=0;
  for(const entry of schedule){
    const variant=variants.find(v=>v.id===entry.variant);onProgress(`开始 ${task.runs.length+1}/9：${variant.label}，重复 ${entry.repetition}`);
    let run;
    try {const d=await execute({model:protocol.requestedModel,effort:protocol.reasoningEffort,prompt:variant.prompt,persist:false});run=d.tasks[0].runs[0];run.variant=entry.variant;run.repetition=entry.repetition;run.strategy=`${variant.label} · 第 ${entry.repetition} 次`;run.outcome=Object.values(run.checks).every(c=>c.status==='pass')?'passed':'verification_failed';consecutiveFailures=0;}
    catch(e){run=makeFailure(entry,e,randomUUID());consecutiveFailures++;}
    run.comparisonGroup=id;run.promptSha256=sha(variant.prompt);run.promptChars=variant.prompt.length;
    run.protocolDeviation=run.events.some(e=>e.type==='explore');
    if(run.protocolDeviation)run.comparisonGroup=id+'-tool-deviation';
    task.runs.push(run);persist();onProgress(`完成 ${task.runs.length}/9：${run.outcome}，${run.tokens??'未知'} tokens，${run.durationSec??'未知'} 秒`);
    if(consecutiveFailures>=2||task.runs.reduce((sum,r)=>sum+(r.tokens||0),0)>=180000){data.study.status='stopped';data.study.stopReason=consecutiveFailures>=2?'连续两次执行失败':'累计已报告 token 达到停止阈值';break;}
  }
  if(data.study.status==='running')data.study.status='complete';persist();return data;
}
function latestStudy(){try{return validateDataset(JSON.parse(fs.readFileSync(path.join(__dirname,'runs','study-latest.json'),'utf8')));}catch{return null;}}
module.exports={runStudy,summarize,makeFailure,variants,schedule,latestStudy};
if(require.main===module)runStudy().then(d=>console.log(JSON.stringify({status:d.study.status,summary:d.study.summary},null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
