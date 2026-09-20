'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawn} = require('node:child_process');
const {randomUUID} = require('node:crypto');
const {validateDataset} = require('./evaluation.js');
const storage = path.join(__dirname, 'runs');
const prompt = `这是一次固定的代码修复接入测试。只根据下面的题目回答，不使用工具，不读取任何文件，不修改文件。输出符合给定 JSON Schema 的答案。
报名规则：同一个用户不能重复报名同一活动；可以报名其他活动；活动报名人数达到容量后拒绝报名；未满且无重复时允许。
当前有缺陷的实现：
function canRegister(rows, userId, eventId, capacity) {
  if (rows.some(r => r.userId === userId)) return false;
  const count = rows.filter(r => r.eventId === eventId).length;
  if (count > capacity) return false;
  return true;
}
返回修复选择：duplicateScope 为 same_event（同用户同活动）、any_event（同用户任意活动）或 none（不检查）；capacityOperator 为拒绝报名时 count 与 capacity 的比较符号。explanation 用中文简要解释修复，不需要展开内部推理。`;
const schema = {type:'object',additionalProperties:false,required:['duplicateScope','capacityOperator','explanation'],properties:{duplicateScope:{type:'string',enum:['same_event','any_event','none']},capacityOperator:{type:'string',enum:['>','>=','==','<','<=']},explanation:{type:'string'}}};
function findCodex() {
  if (process.env.CODEX_BIN) return process.env.CODEX_BIN;
  const root = path.join(process.env.LOCALAPPDATA || '', 'OpenAI','Codex','bin');
  try {const bins=fs.readdirSync(root).map(d=>path.join(root,d,'codex.exe')).filter(p=>fs.existsSync(p));bins.sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs);if(bins.length)return bins[0];} catch {}
  return process.platform==='win32'?'codex.exe':'codex';
}
function capture(args, {cwd=__dirname, input, timeout=15000, onEvent}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(findCodex(),args,{cwd,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
    let output='', errors='', pending='', timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;child.kill();},timeout);
    child.on('error',()=>{clearTimeout(timer);reject(new Error('无法启动 Codex。请安装并登录，或设置 CODEX_BIN。'));});
    child.stdout.on('data',chunk=>{
      const text=chunk.toString(); output=(output+text).slice(-2*1024*1024);pending+=text;
      let i;while((i=pending.indexOf('\n'))>=0){const line=pending.slice(0,i);pending=pending.slice(i+1);try{onEvent?.(JSON.parse(line));}catch {}}
    });
    child.stderr.on('data',chunk=>{errors=(errors+chunk.toString()).slice(-16000);});
    child.on('close',code=>{clearTimeout(timer);if(timedOut)reject(new Error('运行超过 3 分钟，已停止本次 Codex 进程；未生成成功记录。'));else resolve({code,output,errors});});
    child.stdin.on('error',()=>{});child.stdin.end(input || '');
  });
}
async function connectionStatus() {
  try {const r=await capture(['login','status']);return {available:r.code===0,message:r.code===0?'Codex 已登录，可运行真实测试':'Codex 尚未登录，请在本机完成 codex login'};}
  catch(e){return {available:false,message:e.message};}
}
function verifyPatch(patch) {
  if(!patch || !schema.properties.duplicateScope.enum.includes(patch.duplicateScope) || !schema.properties.capacityOperator.enum.includes(patch.capacityOperator) || typeof patch.explanation!=='string' || patch.explanation.length>5000) throw new Error('模型返回内容不符合修复协议');
  // Only enum selections enter the trusted fixture. Never eval or execute model text.
  const cmp={'>':(a,b)=>a>b,'>=':(a,b)=>a>=b,'==':(a,b)=>a===b,'<':(a,b)=>a<b,'<=':(a,b)=>a<=b}[patch.capacityOperator];
  function register(rows,user,event,cap){
    if(patch.duplicateScope!=='none' && rows.some(r=>r.userId===user && (patch.duplicateScope==='any_event'||r.eventId===event)))return false;
    return !cmp(rows.filter(r=>r.eventId===event).length,cap);
  }
  const row=(userId,eventId)=>({userId,eventId});
  const cases=[
    {goal:'capacity',name:'人数等于容量时拒绝',args:[[row('u1','e1')],'u2','e1',1],expected:false},
    {goal:'capacity',name:'零容量拒绝',args:[[],'u1','e1',0],expected:false},
    {goal:'capacity',name:'人数超过容量仍拒绝',args:[[row('u1','e1'),row('u2','e1')],'u3','e1',1],expected:false},
    {goal:'duplicate',name:'重复报名同一活动拒绝',args:[[row('u1','e1')],'u1','e1',5],expected:false},
    {goal:'regression',name:'同用户报名另一活动允许',args:[[row('u1','e1')],'u1','e2',2],expected:true},
    {goal:'regression',name:'空活动正常报名允许',args:[[],'u1','e1',2],expected:true},
    {goal:'regression',name:'其他活动人数不占当前名额',args:[[row('u1','e2'),row('u2','e2')],'u3','e1',1],expected:true},
    {goal:'regression',name:'未满活动正常报名允许',args:[[row('u1','e1')],'u2','e1',2],expected:true}
  ];
  const results=cases.map(c=>({...c,actual:register(...c.args)}));
  const checks=Object.fromEntries(['capacity','duplicate','regression'].map(goal=>{const rows=results.filter(r=>r.goal===goal);return [goal,{status:rows.every(r=>r.actual===r.expected)?'pass':'fail',evidence:rows.map(r=>`${r.name}：预期 ${r.expected}，实际 ${r.actual}，${r.actual===r.expected?'通过':'失败'}`).join('\n')}];}));
  return {checks,results};
}
async function runExperiment(options={}) {
  fs.mkdirSync(storage,{recursive:true});
  const work=fs.mkdtempSync(path.join(os.tmpdir(),'agent-context-smoke-'));
  const schemaPath=path.join(work,'answer.schema.json');fs.writeFileSync(schemaPath,JSON.stringify(schema));
  const started=Date.now(), events=[{type:'act',atSec:0,label:'提交固定修复任务',detail:'真实调用本机已登录的 Codex；受限代码修复题，答案只允许选择预定义修复操作。'}];
  const elapsed=()=>Math.round((Date.now()-started)/100)/10;
  let usage=null, answer=null, failed=false;
  try {
    const fixed=options.model?['--model',options.model,'-c',`model_reasoning_effort="${options.effort||'high'}"`]:[];
    const result=await capture(['exec',...fixed,'--ignore-user-config','--ephemeral','--skip-git-repo-check','--sandbox','read-only','--color','never','--json','--output-schema',schemaPath,'-'],{cwd:work,input:options.prompt||prompt,timeout:180000,onEvent:e=>{
      if(e.type==='turn.completed')usage=e.usage;
      if(e.type==='turn.failed'||e.type==='error')failed=true;
      if(e.type==='item.completed'&&e.item?.type==='agent_message')answer=e.item.text;
      if(e.type==='item.completed'&&['command_execution','mcp_tool_call','web_search','file_change'].includes(e.item?.type))events.push({type:'explore',atSec:elapsed(),label:'观察到工具事件',detail:`类型：${e.item.type}；为避免泄露本机数据，不保存参数及输出。`});
      // Reasoning events are deliberately neither retained nor shown.
    }});
    if(result.code!==0||failed)throw new Error('Codex 运行未完成。请检查本机登录状态、网络和可用额度后重试。');
    if(!answer)throw new Error('未收到模型最终答案，不能生成成功记录');
    const patch=JSON.parse(answer);const verification=verifyPatch(patch);
    events.push({type:'act',atSec:elapsed(),label:'收到模型修复选择',detail:`重复校验：${patch.duplicateScope}；容量比较：${patch.capacityOperator}。${patch.explanation}`.slice(0,3000)});
    const passed=verification.results.filter(r=>r.actual===r.expected).length;
    events.push({type:'verify',atSec:elapsed(),label:'独立验收完成',detail:`固定测试 ${passed}/${verification.results.length} 通过。验收由平台本地规则执行，不采用模型自评。`});
    const numeric=v=>Number.isFinite(v)&&v>=0;
    const tokens=usage&&numeric(usage.input_tokens)&&numeric(usage.output_tokens)?usage.input_tokens+usage.output_tokens:null;
    const id=randomUUID();
    const data=validateDataset({version:1,demo:false,source:'local-codex',generatedAt:new Date().toISOString(),tasks:[{id:'real-signup-smoke-v1',scenario:'coding',title:'真实测试：修复活动报名判断',description:'真实 Codex 调用，受限修复题；模型选择修复操作，平台在可信函数上运行 8 条测试。仅验证接入与验收链路，不等于复杂仓库修复或节省算力的证据。',goals:[{id:'capacity',label:'满员与零容量拒绝报名',weight:5,required:true},{id:'duplicate',label:'阻止同一活动重复报名',weight:5,required:true},{id:'regression',label:'跨活动与正常报名不受影响',weight:4,required:true}],runs:[{id,strategy:'Codex 默认配置 · 单次接入测试',model:'Codex CLI 默认模型（事件未提供精确型号）',comparisonGroup:`smoke-v1-${id}`,tokens,durationSec:elapsed(),checks:verification.checks,events,usage:usage||null,patch,verification:verification.results,settings:{ignoreUserConfig:true,sandbox:'read-only',promptVersion:1,modelPinned:false},limitations:['单次受限修复题，不代表真实仓库修复能力','模型未固定，当前记录不用于跨次策略比较','token 是 CLI 报告的输入加输出；缓存输入不重复相加；非硬件算力或账单价格']}]}]});
    const run=data.tasks[0].runs[0];
    if(options.model){run.model=`${options.model} / ${options.effort||'high'}（请求配置；非不可变版本）`;run.settings={...run.settings,modelPinned:true,requestedModel:options.model,reasoningEffort:options.effort||'high'};run.limitations=run.limitations.filter(x=>!x.startsWith('模型未固定'));}
    if(options.persist!==false){fs.writeFileSync(path.join(storage,`${id}.json`),JSON.stringify(data,null,2));fs.writeFileSync(path.join(storage,'latest.json'),JSON.stringify(data,null,2));}
    return data;
  } catch(error) {error.observed={usage,durationSec:elapsed(),events};throw error;
  } finally {const target=path.resolve(work),root=path.resolve(os.tmpdir());if(path.dirname(target)===root&&path.basename(target).startsWith('agent-context-smoke-'))fs.rmSync(target,{recursive:true,force:true});}
}
function latest(){try{return validateDataset(JSON.parse(fs.readFileSync(path.join(storage,'latest.json'),'utf8')));}catch{return null;}}
module.exports={connectionStatus,runExperiment,verifyPatch,latest,prompt,capture};
if(require.main===module)runExperiment().then(data=>console.log(JSON.stringify(data,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
