'use strict';
const fs=require('node:fs'),path=require('node:path');
const {runStudy}=require('./evidence-study.cjs');
const {verify}=require('./retrieval-study.cjs');
const {validateDataset}=require('./evaluation.js');
const promptSuffix='引用必须对应所问配置，不能用其他参数替代。若本轮给定资料没有依据，或同一配置存在冲突且没有明确优先级或替代关系，则该字段的 value、sourceId、quote 全部返回 null。留空表示暂不能确定，不等于配置为零。';
function verifyQuality(spec,answer,documents){
  return Object.fromEntries(spec.goals.map(g=>{
    const a=answer?.[g.id];
    if(!a||typeof a!=='object'||!['value','sourceId','quote'].every(k=>Object.hasOwn(a,k)))return [g.id,{status:'unknown',judgment:'unassessed',evidence:'字段不完整，无法确认模型给出了答案还是按约定留空。'}];
    const abstained=['value','sourceId','quote'].every(k=>a[k]===null);
    if(g.expected===null)return [g.id,abstained?
      {status:'pass',judgment:'correct_abstention',evidence:'按约定全部留空；'+g.abstainReason+' 仅表示安全响应验收通过，未恢复配置。'}:
      {status:'fail',judgment:'unsupported_assertion',evidence:'应全部留空却提交了不满足约定的字段：'+JSON.stringify(a).slice(0,900)+'；'+g.abstainReason}];
    if(abstained)return [g.id,{status:'fail',judgment:'unnecessary_abstention',evidence:'完整资料中存在可确定的配置依据，最终全部留空未达到本题响应约定。应核对资料 '+g.sourceId+'：'+g.sentence}];
    if(['value','sourceId','quote'].some(k=>a[k]===null))return [g.id,{status:'fail',judgment:'incorrect_answer',evidence:'响应仅部分字段留空；应提供完整配置与依据，或按约定三个字段全部留空。'}];
    const check=verify({goals:[g]},answer,documents)[g.id];
    return [g.id,{...check,judgment:check.status==='pass'?'correct_answer':'incorrect_answer'}];
  }));
}
const runQuality=options=>runStudy({...options,fixtureFile:'quality-fixtures.json',studyName:'quality',strictSources:true,promptSuffix,finalVerifier:verifyQuality,extraSourceFiles:['quality-study.cjs'],maxCalls:9,maxTokens:150000});
function latestQuality(){try{return validateDataset(JSON.parse(fs.readFileSync(path.join(__dirname,'runs','quality-latest.json'),'utf8')));}catch{return null;}}
module.exports={promptSuffix,verifyQuality,runQuality,latestQuality};
if(require.main===module)runQuality().then(d=>console.log(JSON.stringify(d.retrievalStudy,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
