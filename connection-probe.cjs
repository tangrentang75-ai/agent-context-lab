'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const {capture}=require('./codex-bridge.cjs'),{infer,buildPrompt}=require('./retrieval-study.cjs');
async function probe(){
  const id='probe-'+randomUUID(),folder=path.join(__dirname,'runs',id);fs.mkdirSync(folder,{recursive:true});
  const task={id:'connection-check',title:'连接配置核对',goals:[{id:'minutes',label:'连接等待时间（分钟）'}],documents:[{id:'01',tags:['minutes'],text:'连接等待时间为 37 分钟。'}]};
  const prompt=buildPrompt(task,task.documents)+'\nsourceId 只允许使用裸编号 01 或 null。';
  const files=['connection-probe.cjs','codex-bridge.cjs','retrieval-study.cjs','codex-response.cjs','jsonl-reader.cjs'];
  const protocol={id,createdAt:new Date().toISOString(),maxCalls:1,model:'gpt-6-astra',effort:'high',cliVersion:(await capture(['--version'])).output.trim(),purpose:'单次诊断连接，不属于质量策略对照，不自动重试',sourceHashes:Object.fromEntries(files.map(n=>[n,createHash('sha256').update(fs.readFileSync(path.join(__dirname,n))).digest('hex')]))};
  for(const name of files)fs.copyFileSync(path.join(__dirname,name),path.join(folder,name));
  fs.writeFileSync(path.join(folder,'protocol.json'),JSON.stringify(protocol,null,2));fs.writeFileSync(path.join(folder,'input.json'),JSON.stringify({task,prompt},null,2));
  const start=Date.now();let result;
  try{const r=await infer(task,prompt,()=>{},{allowedSourceIds:['01']});const a=r.answer?.minutes;result={status:'complete',...r,verified:a?.value==='37'&&a?.sourceId==='01'&&a?.quote?.includes('连接等待时间为 37 分钟。')};}
  catch(e){result={status:'failed',error:e.message,usage:e.usage||null,diagnostics:e.diagnostics||null};}
  result.durationSec=(Date.now()-start)/1000;result.protocol=protocol;
  fs.writeFileSync(path.join(folder,'result.json'),JSON.stringify(result,null,2));fs.writeFileSync(path.join(__dirname,'runs','probe-latest.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));return result;
}
module.exports={probe};if(require.main===module)probe().catch(e=>{console.error(e.message);process.exitCode=1;});
