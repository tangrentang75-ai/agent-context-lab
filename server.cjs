const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const bridge = require('./codex-bridge.cjs');
const {latestStudy} = require('./context-study.cjs');
const {latestRetrieval} = require('./retrieval-study.cjs');
const {latestEvidence} = require('./evidence-study.cjs');
const {latestValidation} = require('./validation-study.cjs');
const {latestScaling} = require('./scaling-study.cjs');
const {latestQuality} = require('./quality-study.cjs');
const {latestReview} = require('./review-study.cjs');
const {preflight,latestPassageStudy} = require('./passage-study.cjs');
const {latestBundleStudy} = require('./bundle-study.cjs');
const taskExecution = require('./task-executor.cjs');
const {readReview} = require('./project-review-store.cjs');
const {localIdentity}=require('./local-identity.cjs');
const allowed = {'/':'index.html','/index.html':'index.html','/styles.css':'styles.css','/app.js':'app.js','/evaluation.js':'evaluation.js','/sample-data.js':'sample-data.js','/cost-model.js':'cost-model.js','/cost-ui.js':'cost-ui.js','/review.html':'review.html','/review-planner.js':'review-planner.js','/review-ui.js':'review-ui.js','/review-passages.js':'review-passages.js','/review-results-ui.js':'review-results-ui.js','/passage-results-ui.js':'passage-results-ui.js','/review-bundles.js':'review-bundles.js','/bundle-results-ui.js':'bundle-results-ui.js','/decision.html':'decision.html','/decision.css':'decision.css','/resource-decision.js':'resource-decision.js','/decision-ui.js':'decision-ui.js','/ledger.html':'ledger.html','/task-ledger.js':'task-ledger.js','/ledger-ui.js':'ledger-ui.js','/execution-results-ui.js':'execution-results-ui.js'};
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
Object.assign(allowed, {'/project-review.html':'project-review.html','/project-review.js':'project-review.js','/project-review-ui.js':'project-review-ui.js','/project-review.css':'project-review.css'});
Object.assign(allowed, {'/observation-audit.js':'observation-audit.js','/observation-audit-ui.js':'observation-audit-ui.js'});
Object.assign(allowed, {'/observation-plan.js':'observation-plan.js'});
Object.assign(allowed, {'/evidence-file-check.js':'evidence-file-check.js'});
Object.assign(allowed, {'/project-review-backup.js':'project-review-backup.js'});
Object.assign(allowed, {'/report-comparison.html':'report-comparison.html','/report-comparison.css':'report-comparison.css','/report-comparison.js':'report-comparison.js','/report-comparison-presentation.js':'report-comparison-presentation.js','/report-comparison-markdown.js':'report-comparison-markdown.js','/report-comparison-ui.js':'report-comparison-ui.js','/report-comparison-example.json':'report-comparison-example.json'});
types['.json']='application/json; charset=utf-8';
Object.assign(allowed, {'/record-evaluation.js':'record-evaluation.js'});
Object.assign(allowed, Object.fromEntries(['start.html','start.css','start-ui.js','file-guide.js','record-entry.html','record-entry.css','record-entry-core.js','record-entry-draft.js','record-entry.js'].map(file => ['/' + file, file])));
const port = Number(process.env.PORT || 4173);
function createServer(executor=bridge,{passageReader=latestPassageStudy,taskExecutor=taskExecution,projectReviewReader=readReview}={}) {
let running=false;
return http.createServer(async (req,res)=>{
  const json=(code,body)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));};
  const host=`127.0.0.1:${req.socket.localPort}`;
  if(req.headers.host!==host){json(403,{error:'仅允许本机访问'});return;}
  let pathname;try{pathname=new URL(req.url,`http://${host}`).pathname;}catch{res.writeHead(400);res.end();return;}
  if(pathname.startsWith('/api/')) {
    if(req.headers.origin && req.headers.origin!==`http://${host}`){json(403,{error:'不允许跨站调用'});return;}
    if(req.method==='GET'&&pathname==='/api/local-info'){json(200,localIdentity());return;}
    if(req.method==='GET'&&pathname==='/api/project-review'){try{const data=projectReviewReader();json(data?200:404,data||{error:'本机尚无项目检查记录'});}catch{json(409,{error:'本机项目检查记录损坏或格式不符，请检查原文件；未执行任何测试'});}return;}
    if(req.method==='GET'&&pathname==='/api/status'){json(200,{...await executor.connectionStatus(),running,hasLatest:!!executor.latest()});return;}
    if(req.method==='GET'&&pathname==='/api/latest'){const data=executor.latest();json(data?200:404,data||{error:'尚无真实记录'});return;}
    if(req.method==='GET'&&pathname==='/api/study'){const data=latestStudy();json(data?200:404,data||{error:'尚无对照实验记录'});return;}
    if(req.method==='GET'&&pathname==='/api/retrieval'){const data=latestRetrieval();json(data?200:404,data||{error:'尚无检索实验记录'});return;}
    if(req.method==='GET'&&pathname==='/api/evidence'){const data=latestEvidence();json(data?200:404,data||{error:'尚无证据补读实验记录'});return;}
    if(req.method==='GET'&&pathname==='/api/validation'){const data=latestValidation();json(data?200:404,data||{error:'尚无新任务检查记录'});return;}
    if(req.method==='GET'&&pathname==='/api/scaling'){const data=latestScaling();json(data?200:404,data||{error:'尚无长度与标签对照记录；请先运行 node scaling-study.cjs'});return;}
    if(req.method==='GET'&&pathname==='/api/quality'){const data=latestQuality();json(data?200:404,data||{error:'尚无质量反例记录；请先运行 node quality-study.cjs'});return;}
    if(req.method==='GET'&&pathname==='/api/review-study'){const data=latestReview();json(data?200:404,data||{error:'尚无覆盖核验实测记录；请先运行 node review-study.cjs'});return;}
    if(req.method==='GET'&&pathname==='/api/passage-plan'){try{json(200,preflight());}catch(e){json(409,{error:e.message});}return;}
    if(req.method==='GET'&&pathname==='/api/passage-study'){const data=passageReader();json(data?200:404,data||{error:'尚无 v2 新任务实验记录；协议已准备，真实实验尚未启动。'});return;}
    if(req.method==='GET'&&pathname==='/api/execution-study'){try{const file=path.join(__dirname,'runs','execution-study-latest.json');json(200,JSON.parse(fs.readFileSync(file,'utf8')));}catch{json(404,{error:'尚无执行链路检查记录'});}return;}
    if(req.method==='GET'&&pathname==='/api/bundle-study'){const data=latestBundleStudy();json(data?200:404,data||{error:'尚无 v3 分批记录'});return;}
    if(req.method==='GET'&&pathname.startsWith('/api/task-execution/')){try{const data=taskExecutor.read(pathname.slice('/api/task-execution/'.length));json(data?200:404,data||{error:'没有此编号的本机回执'});}catch(e){json(400,{error:e.message});}return;}
    if(req.method==='POST'&&pathname==='/api/task-execution'){
      if(req.headers['x-agent-context']!=='local-task-run'||req.headers.origin!==`http://${host}`){json(403,{error:'请从本机任务台账页面执行'});return;}
      if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||'')){json(415,{error:'需要 JSON 请求'});return;}
      let body;try{let bytes=0;const parts=[];for await(const part of req){bytes+=part.length;if(bytes>1500000)throw Error('资料请求超过大小上限');parts.push(part);}body=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{json(400,{error:'请求格式不正确或资料超过大小上限'});return;}
      if(running){json(409,{error:'已有执行进行中；可通过执行编号恢复读取，不要重复启动'});return;}
      running=true;try{json(200,await taskExecutor.run(body));}catch(e){json(409,{error:e.message});}finally{running=false;}return;
    }
    if(req.method==='POST'&&pathname==='/api/run') {
      if(req.headers['x-agent-context']!=='local-run'||req.headers.origin!==`http://${host}`){json(403,{error:'请从本机页面运行测试'});return;}
      if(running){json(409,{error:'已有任务运行中，请稍后查看最近结果'});return;}
      running=true;
      try{json(200,await executor.runExperiment());}catch(e){json(502,{error:e.message});}finally{running=false;}
      return;
    }
    json(404,{error:'接口不存在'});return;
  }
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':'GET, HEAD'});res.end();return;}
  const file=Object.hasOwn(allowed,pathname)?allowed[pathname]:null;
  if(!file){res.writeHead(404);res.end('Not found');return;}
  fs.readFile(path.join(__dirname,file),(error,data)=>{if(error){res.writeHead(500);res.end('Unable to read asset');return;}res.writeHead(200,{'Content-Type':types[path.extname(file)],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:data);});
});
}
module.exports={createServer};
if(require.main===module)createServer().listen(port,'127.0.0.1',()=>console.log(`Agent Context Lab: http://127.0.0.1:${port}`));
