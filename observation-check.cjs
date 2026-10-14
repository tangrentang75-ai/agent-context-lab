'use strict';
// Offline checker: imports only pure parsers. It never starts the server or a model.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const A=require('./observation-audit.js'),P=require('./observation-plan.js');
const sources=['observation-check.cjs','observation-audit.js','observation-plan.js','package.json'];
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
function readLimited(file,limit){
  if(!fs.lstatSync(file).isFile())throw Error('只接受普通文件：'+path.basename(file));
  const fd=fs.openSync(file,'r');try{const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size>limit)throw Error('文件超过上限或不是普通文件：'+path.basename(file));const b=Buffer.alloc(limit+1);let n=0,got;while(n<b.length&&(got=fs.readSync(fd,b,n,b.length-n,null))>0)n+=got;if(n>limit)throw Error('文件超过上限：'+path.basename(file));return b.subarray(0,n);}finally{fs.closeSync(fd);}
}
function text(bytes){try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw Error('输入文件需要UTF-8编码');}}
function sourceManifest(){return Object.fromEntries(sources.map(name=>[name,sha(readLimited(path.join(__dirname,name),1000000))]));}
async function analyze(csvBytes,planBytes){const envelope=planBytes?await P.verify(JSON.parse(text(planBytes))):null;return {envelope,audit:A.auditCsv(text(csvBytes),{plan:envelope?.plan})};}
function report(audit,receipt){
  let out=A.markdown(audit)+'\n## 本次软件检查信息\n\n生成时间：'+receipt.generatedAt+'。程序版本：'+receipt.appVersion+'。\n\n';
  out+='原始CSV的SHA-256：`'+receipt.inputs.csv.sha256+'`。\n\n';
  if(receipt.inputs.plan)out+='原始计划文件的SHA-256：`'+receipt.inputs.plan.sha256+'`。\n\n规范化计划校验值：`'+receipt.inputs.plan.canonicalSha256+'`。\n\n';
  out+='输入副本、结构化结果和校验清单保存在同一目录。运行 `node observation-check.cjs --verify 报告目录` 可重新核对。\n\n';
  out+='校验通过只说明当前文件相互对应且可以复算，不证明记录真实、计划事先登记或产品有效。生成时间来自本机时钟。软件退出码0也不表示项目验收通过。\n';return out;
}
async function createPackage({csv,plan,out}){
  const before=sourceManifest(),csvBytes=readLimited(csv,2000000),planBytes=plan?readLimited(plan,500000):null;
  const {audit,envelope}=await analyze(csvBytes,planBytes);
  const receipt={schema:'observation-check-receipt-v1',generatedAt:new Date().toISOString(),appVersion:JSON.parse(fs.readFileSync(path.join(__dirname,'package.json'),'utf8')).version,
    inputs:{csv:{file:'input.csv',sha256:sha(csvBytes),bytes:csvBytes.length},plan:planBytes?{file:'plan.json',sha256:sha(planBytes),bytes:planBytes.length,canonicalSha256:envelope.sha256}:null},
    sourceSha256:before,files:{},readyForPlannedComparison:audit.readyForPlannedComparison,benefitEstablished:false,independentlyVerified:false};
  const files={'input.csv':csvBytes,'audit.json':Buffer.from(json(audit))};if(planBytes)files['plan.json']=planBytes;
  files['report.md']=Buffer.from(report(audit,receipt));for(const [name,bytes]of Object.entries(files))receipt.files[name]={sha256:sha(bytes),bytes:bytes.length};
  if(JSON.stringify(sourceManifest())!==JSON.stringify(before))throw Error('检查期间程序文件发生变化，请重新运行');
  // Exclusive directory creation avoids overwriting previous evidence or input files.
  fs.mkdirSync(out);try{for(const [name,bytes]of Object.entries(files))fs.writeFileSync(path.join(out,name),bytes,{flag:'wx'});fs.writeFileSync(path.join(out,'receipt.json'),json(receipt),{flag:'wx'});}catch(e){throw Error('报告包未完整写入，请保留现场并使用新的输出目录重试：'+e.message);}
  return {audit,receipt,out:path.resolve(out)};
}
async function verifyPackage(directory){
  const receipt=JSON.parse(text(readLimited(path.join(directory,'receipt.json'),50000)));
  if(receipt?.schema!=='observation-check-receipt-v1'||!receipt.inputs?.csv||!receipt.files||!receipt.sourceSha256)throw Error('报告清单格式无效');
  if(typeof receipt.generatedAt!=='string'||!Number.isFinite(Date.parse(receipt.generatedAt)))throw Error('生成时间无效');
  const expected=['input.csv','audit.json','report.md',...(receipt.inputs.plan?['plan.json']:[])].sort();
  if(JSON.stringify(Object.keys(receipt.files).sort())!==JSON.stringify(expected))throw Error('报告文件清单不符合约定');
  const before=sourceManifest();if(JSON.stringify(receipt.sourceSha256)!==JSON.stringify(before))throw Error('当前程序与生成报告的程序不同，请使用对应源码版本复核');
  if(receipt.appVersion!==JSON.parse(fs.readFileSync(path.join(__dirname,'package.json'),'utf8')).version)throw Error('程序版本标记不一致');
  const files={};for(const name of expected){const bytes=readLimited(path.join(directory,name),name==='input.csv'?2000000:name==='plan.json'?500000:10000000),entry=receipt.files[name];if(!entry||entry.bytes!==bytes.length||entry.sha256!==sha(bytes))throw Error('文件内容与清单不一致：'+name);files[name]=bytes;}
  const {audit,envelope}=await analyze(files['input.csv'],files['plan.json']);
  const csv=receipt.inputs.csv,p=receipt.inputs.plan;
  if(csv.file!=='input.csv'||csv.bytes!==files['input.csv'].length||csv.sha256!==sha(files['input.csv']))throw Error('CSV来源清单不一致');
  if(p&&(p.file!=='plan.json'||p.bytes!==files['plan.json'].length||p.sha256!==sha(files['plan.json'])||p.canonicalSha256!==envelope.sha256))throw Error('计划来源清单不一致');
  if(!files['audit.json'].equals(Buffer.from(json(audit))))throw Error('保存结果与重新检查结果不同');
  if(!files['report.md'].equals(Buffer.from(report(audit,receipt))))throw Error('报告内容与重新检查结果不同');
  if(receipt.readyForPlannedComparison!==audit.readyForPlannedComparison||receipt.benefitEstablished!==false||receipt.independentlyVerified!==false)throw Error('清单的结论标记不一致');
  if(JSON.stringify(sourceManifest())!==JSON.stringify(before))throw Error('复核期间程序文件发生变化，请重新运行');
  return {audit,receipt,out:path.resolve(directory)};
}
function args(argv){
  if(argv.length===0||argv.length===1&&argv[0]==='--help')return {help:true};
  const o={};for(let i=0;i<argv.length;i+=2){const key=argv[i];if(!['--csv','--plan','--out','--verify'].includes(key)||!argv[i+1]||argv[i+1].startsWith('--')||o[key.slice(2)])throw Error('参数不正确，请使用 --help');o[key.slice(2)]=argv[i+1];}
  if(o.verify){if(Object.keys(o).length!==1)throw Error('--verify不能与其他参数一起使用');}else if(!o.csv||!o.out)throw Error('需要指定 --csv 和 --out；--plan可选');return o;
}
async function main(argv){
  try{const o=args(argv);if(o.help){console.log('本地观察记录检查（不调用模型）\n生成：node observation-check.cjs --csv 记录.csv --plan 计划.json --out 新报告目录\n复核：node observation-check.cjs --verify 报告目录\n输出目录必须尚不存在；不提供计划时无法确认是否漏掉原定轮次。\n退出码：0=结构对应（不代表效果）；3=记录待补或计划有偏差；2=输入/读写/校验错误。');return 0;}
    const r=o.verify?await verifyPackage(o.verify):await createPackage(o);console.log((o.verify?'报告包复算一致：':'报告包已生成：')+r.out+'\n'+r.audit.conclusion+'\n提交'+r.audit.total+'轮；可汇总'+r.audit.measured+'轮；产品收益未验证。');return r.audit.readyForPlannedComparison?0:3;
  }catch(e){console.error('检查未完成：'+e.message);return 2;}
}
if(require.main===module)main(process.argv.slice(2)).then(code=>{process.exitCode=code;});
module.exports={analyze,createPackage,verifyPackage,args,main};
