'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {randomUUID,createHash}=require('node:crypto');
const {capture}=require('./codex-bridge.cjs');
const {validateDataset}=require('./evaluation.js');
const fixtures=require('./retrieval-fixtures.json');
const policies=[{id:'fixed',label:'固定读取首份资料'},{id:'all',label:'读取全部资料'},{id:'coverage',label:'按目标标签覆盖停止'}];
const hash=x=>createHash('sha256').update(x).digest('hex');
const write=(file,data)=>{fs.writeFileSync(file+'.tmp',JSON.stringify(data,null,2));fs.renameSync(file+'.tmp',file);};
function selectDocuments(documents,goals,policy){
  if(policy==='fixed')return documents.slice(0,1);
  if(policy==='all')return [...documents];
  if(policy!=='coverage')throw new Error('未知策略');
  const missing=new Set(goals.map(g=>g.id)),selected=[];
  for(const doc of documents){if(doc.tags.some(tag=>missing.has(tag))){selected.push(doc);doc.tags.forEach(tag=>missing.delete(tag));}if(!missing.size)break;}
  return selected;
}
function buildPrompt(task,docs){return `你在恢复软件配置。只使用本次给出的资料，不使用工具、不读取其他文件、不修改文件。目录标签不保证正确，正文才是依据。没有明确依据的配置必须返回 null，不能猜测。
任务：${task.title.replace('（标签错误压力任务）','')}。
待恢复字段：${task.goals.map(g=>g.id+'：'+g.label).join('；')}。
逐字段输出 value（数字用字符串）、sourceId（资料 ID）和 quote（包含该配置规则的完整原句）。资料不支持时三个值都为 null。输出 JSON。
提供的资料：\n${docs.map(d=>'[资料 '+d.id+']\n'+d.text).join('\n\n')}`;}
function answerSchema(task,allowedSourceIds){return {type:'object',additionalProperties:false,required:task.goals.map(g=>g.id),properties:Object.fromEntries(task.goals.map(g=>[g.id,{type:'object',additionalProperties:false,required:['value','sourceId','quote'],properties:{value:{type:['string','null']},sourceId:allowedSourceIds?{type:['string','null'],enum:[...allowedSourceIds,null]}:{type:['string','null']},quote:{type:['string','null']}}}]))};}
function verify(task,answer,docs){
  const checks=Object.create(null);
  for(const g of task.goals){const a=answer?.[g.id];
    if(!a||a.value===null){checks[g.id]={status:'unknown',evidence:'模型未给出有依据的配置，不能判为任务完成。'};continue;}
    const doc=docs.find(d=>d.id===a.sourceId);
    const valid=typeof a.quote==='string'&&a.quote.length<=3000&&doc&&doc.id===g.sourceId&&doc.text.includes(a.quote)&&a.quote.includes(g.sentence);
    const correct=a.value===g.expected;
    checks[g.id]={status:correct&&valid?'pass':'fail',evidence:`配置值：${String(a.value).slice(0,100)}；独立期望：${g.expected}；来源：${String(a.sourceId).slice(0,100)}；引文：${String(a.quote).slice(0,600)}。配置匹配：${correct?'是':'否'}；提供的资料中存在正确依据：${valid?'是':'否'}。`};
  }
  return checks;
}
async function infer(task,prompt,onEvent,{allowedSourceIds}={}){
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'acl-retrieval-'));const schema=path.join(folder,'answer.json');fs.writeFileSync(schema,JSON.stringify(answerSchema(task,allowedSourceIds)));
  const tracker=require('./codex-response.cjs').responseTracker(onEvent);
  try{
    const result=await capture(['exec','--model','gpt-6-astra','-c','model_reasoning_effort="high"','--ignore-user-config','--ephemeral','--skip-git-repo-check','--sandbox','read-only','--json','--color','never','--output-schema',schema,'-'],{cwd:folder,input:prompt,timeout:180000,onEvent:tracker.accept});
    return tracker.finish(result);
  }catch(e){e.usage=e.usage||tracker.usage;e.diagnostics=e.diagnostics||{...tracker.diagnostics(),reason:'capture_failed'};throw e;}
  finally{const target=path.resolve(folder);if(path.dirname(target)===path.resolve(os.tmpdir())&&path.basename(target).startsWith('acl-retrieval-'))fs.rmSync(target,{recursive:true,force:true});}
}
const avg=a=>{const v=a.filter(Number.isFinite);return v.length?v.reduce((n,x)=>n+x,0)/v.length:null;};
function summarize(data){return policies.map(p=>{const runs=data.tasks.flatMap(t=>t.runs).filter(r=>r.policy===p.id);return {id:p.id,label:p.label,attempts:runs.length,successes:runs.filter(r=>r.outcome==='passed').length,meanTokens:avg(runs.map(r=>r.tokens)),meanSeconds:avg(runs.map(r=>r.durationSec)),meanFiles:avg(runs.map(r=>r.retrieval.selectedIds.length)),unknownCosts:runs.filter(r=>r.tokens===null).length,executionFailures:runs.filter(r=>r.outcome==='execution_failed').length,protocolDeviations:runs.filter(r=>r.protocolDeviation).length};});}
async function runRetrieval({execute=infer,outputDir=path.join(__dirname,'runs'),onProgress=console.log,cliVersion}={}){
  fs.mkdirSync(outputDir,{recursive:true});const id='retrieval-'+randomUUID(),folder=path.join(outputDir,id);fs.mkdirSync(folder);
  const schedule=fixtures.tasks.flatMap((t,i)=>[0,1,2].map(j=>({taskId:t.id,policy:policies[(i+j)%3].id})));
  const protocol={id,version:1,createdAt:new Date().toISOString(),model:'gpt-6-astra',effort:'high',cliVersion:cliVersion||(await capture(['--version'])).output.trim(),schedule,fixturesSha256:hash(fs.readFileSync(path.join(__dirname,'retrieval-fixtures.json'))),studySha256:hash(fs.readFileSync(__filename)),bridgeSha256:hash(fs.readFileSync(path.join(__dirname,'codex-bridge.cjs'))),design:'3 个人工配置恢复任务 × 3 种平台检索规则，每格 1 次；第三任务含错误标签。',stoppingRule:'最多9次；连续2次执行失败或已知累计token达到180000后不再启动后续调用；无自动重试。',limitations:['检索由平台确定性规则执行，非模型自主搜索','手工标签有先验信息；专设一个错误标签压力任务','验收为配置值与来源引文核对，不是完整代码行为测试','每任务每策略仅1次，不支持稳定性或泛化结论','服务模型名非不可变快照；缓存、网络和运行时变化未完全控制']};
  for(const task of fixtures.tasks){const dir=path.join(folder,task.id);fs.mkdirSync(dir);for(const doc of task.documents)fs.writeFileSync(path.join(dir,doc.id+'.md'),doc.text);}
  write(path.join(folder,'protocol.json'),protocol);
  const data={version:1,demo:false,source:'local-retrieval-study',retrievalStudy:{protocol,status:'running',summary:[]},tasks:[]};let failures=0;
  const persist=()=>{data.generatedAt=new Date().toISOString();data.retrievalStudy.summary=summarize(data);validateDataset(data);write(path.join(folder,'results.json'),data);write(path.join(outputDir,'retrieval-latest.json'),data);};
  for(const entry of schedule){
    const spec=fixtures.tasks.find(t=>t.id===entry.taskId),policy=policies.find(p=>p.id===entry.policy),started=Date.now(),events=[];
    const elapsed=()=>Math.round((Date.now()-started)/100)/10;
    onProgress(`开始 ${data.tasks.reduce((n,t)=>n+t.runs.length,0)+1}/9：${spec.title} / ${policy.label}`);
    const selectStart=performance.now(),selected=selectDocuments(spec.documents,spec.goals,entry.policy),docs=selected.map(d=>{const text=fs.readFileSync(path.join(folder,spec.id,d.id+'.md'),'utf8');events.push({type:'explore',atSec:elapsed(),label:'平台读取资料 '+d.id,detail:`目录标签：${d.tags.join('、')||'无'}；正文 ${text.length} 字符。由检索规则选择，不是模型自主操作。`});return {...d,text};});
    const retrievalMs=performance.now()-selectStart,prompt=buildPrompt(spec,docs);
    const run={id:randomUUID(),strategy:policy.label,policy:entry.policy,model:'gpt-6-astra / high（请求配置）',comparisonGroup:id+'-'+spec.id,tokens:null,durationSec:0,checks:{},events,retrieval:{selectedIds:docs.map(d=>d.id),controllerMs:retrievalMs,controllerTokens:0,promptChars:prompt.length,promptSha256:hash(prompt),stopReason:entry.policy==='fixed'?'达到一份资料限额':entry.policy==='all'?'已读取全部资料':'目录标签已覆盖所有目标或无更多匹配资料'},protocolDeviation:false};
    write(path.join(folder,run.id+'-input.json'),{taskId:spec.id,policy:entry.policy,prompt,selectedIds:run.retrieval.selectedIds});
    events.push({type:'act',atSec:elapsed(),label:'向模型提交已选资料',detail:run.retrieval.stopReason+'。'});
    try{const result=await execute(spec,prompt,type=>events.push({type:'act',atSec:elapsed(),label:'额外模型工具事件',detail:type}));run.answer=result.answer;run.usage=result.usage;run.checks=verify(spec,result.answer,docs);run.protocolDeviation=result.toolEvents>0;run.outcome=Object.values(run.checks).every(c=>c.status==='pass')?'passed':Object.values(run.checks).some(c=>c.status==='fail')?'verification_failed':'insufficient_evidence';failures=0;}
    catch(e){run.usage=e.usage||null;run.error=e.message;run.outcome='execution_failed';run.checks=Object.fromEntries(spec.goals.map(g=>[g.id,{status:'unknown',evidence:'执行失败，未能验收：'+e.message}]));failures++;}
    const u=run.usage;if(u&&Number.isFinite(u.input_tokens)&&Number.isFinite(u.output_tokens))run.tokens=u.input_tokens+u.output_tokens;
    if(run.protocolDeviation)run.comparisonGroup+='-tool-deviation';
    events.push({type:'verify',atSec:elapsed(),label:'独立配置与引文核验',detail:`${Object.values(run.checks).filter(c=>c.status==='pass').length}/${spec.goals.length} 项通过；缺失依据保留未知。`});run.durationSec=elapsed();
    let task=data.tasks.find(t=>t.id===spec.id);if(!task){task={id:spec.id,title:spec.title,description:spec.description,scenario:'coding',goals:spec.goals.map(g=>({id:g.id,label:g.label,weight:5,required:true})),runs:[]};data.tasks.push(task);}task.runs.push(run);persist();onProgress(`完成：${run.outcome}，${run.tokens??'未知'} tokens，读取 ${docs.length} 份资料`);
    if(failures>=2||data.tasks.flatMap(t=>t.runs).reduce((n,r)=>n+(r.tokens||0),0)>=180000){data.retrievalStudy.status='stopped';break;}
  }
  if(data.retrievalStudy.status==='running')data.retrievalStudy.status='complete';persist();return data;
}
function latestRetrieval(){try{return validateDataset(JSON.parse(fs.readFileSync(path.join(__dirname,'runs','retrieval-latest.json'),'utf8')));}catch{return null;}}
module.exports={fixtures,policies,selectDocuments,buildPrompt,verify,summarize,runRetrieval,latestRetrieval,infer,answerSchema};
if(require.main===module)runRetrieval().then(d=>console.log(JSON.stringify(d.retrievalStudy.summary,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
