'use strict';
const fs=require('node:fs'),path=require('node:path'),study=require('./execution-study.cjs');
function report({outputDir=path.join(__dirname,'runs'),target=path.join(__dirname,'execution-study-report.md')}={}){
const data=JSON.parse(fs.readFileSync(path.join(outputDir,'execution-study-latest.json'),'utf8')),folder=path.join(outputDir,data.protocol.id),plan=study.prepare();study.audit(data,folder,plan);const summary=study.summary(data.rows);if(JSON.stringify(summary)!==JSON.stringify(data.summary))throw Error('汇总不一致');
const calls=data.rows.reduce((n,r)=>n+r.receipt.modelCalls,0),known=data.rows.reduce((n,r)=>n+r.receipt.knownTokens,0),unknown=data.rows.filter(r=>r.receipt.tokens===null).length;
if(calls!==data.cost.modelCalls||known!==data.cost.knownTokens||unknown!==data.cost.unknownUsage||data.unrun!==plan.schedule.length-data.rows.length)throw Error('费用或未运行数不一致');
let out='# v0.18 执行链路开发检查记录\n\n生成于 '+new Date().toISOString()+'。协议 `'+data.protocol.id+'`，状态 **'+data.status+'**，'+data.rows.length+'/'+plan.schedule.length+' 格落盘，'+data.unrun+' 格未运行。'+(data.stopReason?'停止原因：'+data.stopReason+'。':'仍进行中；统计不含当前在途调用。')+'\n\n';
out+='已尝试 '+calls+' 次模型调用，已知 '+known.toLocaleString('en-US')+' tokens，'+unknown+' 次用量不完整。未知用量不记零，已知部分保留。最终用户验收数 **0**。\n\n';
out+='| 路径 | 已记录 | 已评分 | 候选通过 | 已知 tokens | 未知用量 | 最终验收 |\n|---|---:|---:|---:|---:|---:|---:|\n';for(const s of summary)out+=`| ${s.action} | ${s.rows} | ${s.assessed} | ${s.candidatePasses} | ${s.knownTokens} | ${s.unknownUsage} | 0 |\n`;
out+='\n8个开发者人工题，主题与前期任务重叠，是接入与候选检查集。四次重复预定日程中途停止时分母和题目覆盖可能不齐，不能视为均衡对照或推断效率、泛化和自然遗漏概率。候选响应通过不代表用户任务完成；tokens不是硬件算力。\n\n';
out+='**执行中发现验收口径不足：**value只要求字符串或null，没有明确禁止单位；冻结标准却要求纯数字，例如回答“31 天”“2.5 秒”“4 submissions per day”会被判字符串不匹配。这类不通过不能直接解释为语义错误。保留原评分，不事后改口径或重算通过率；下轮需要把输出格式与单位约定明确写入任务。\n\n';
out+='| 配置格 | 执行 | 评分 | tokens | 引文警告 |\n|---|---|---|---:|---|\n';for(const r of data.rows)out+=`| ${r.entryId} | ${r.receipt.status} | ${r.grade.candidatePassed===null?'未评分':r.grade.candidatePassed?'通过':'未通过'} | ${r.receipt.tokens??'未知'} | ${r.receipt.warnings.length} |\n`;
out+='\n审核当前与存档源码哈希、日程前缀、原始回执副本和重新评分、费用累计、未运行格数通过。未修改旧v3停止协议。完整输入/源码/回执只保存在本机，未上传。规则见 [执行前协议](execution-study-plan.md)。\n';
fs.writeFileSync(target,out);return {protocol:data.protocol.id,status:data.status,rows:data.rows.length,unrun:data.unrun,calls,knownTokens:known,unknownUsage:unknown,summary};}
module.exports={report};if(require.main===module)console.log(JSON.stringify(report(),null,2));
