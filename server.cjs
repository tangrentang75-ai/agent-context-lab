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
const allowed = {'/':'index.html','/index.html':'index.html','/styles.css':'styles.css','/app.js':'app.js','/evaluation.js':'evaluation.js','/sample-data.js':'sample-data.js','/cost-model.js':'cost-model.js','/cost-ui.js':'cost-ui.js','/review.html':'review.html','/review-planner.js':'review-planner.js','/review-ui.js':'review-ui.js','/review-passages.js':'review-passages.js','/review-results-ui.js':'review-results-ui.js','/passage-results-ui.js':'passage-results-ui.js'};
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const port = Number(process.env.PORT || 4173);
function createServer(executor=bridge,{passageReader=latestPassageStudy}={}) {
let running=false;
return http.createServer(async (req,res)=>{
  const json=(code,body)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));};
  const host=`127.0.0.1:${req.socket.localPort}`;
  if(req.headers.host!==host){json(403,{error:'仅允许本机访问'});return;}
  let pathname;try{pathname=new URL(req.url,`http://${host}`).pathname;}catch{res.writeHead(400);res.end();return;}
  if(pathname.startsWith('/api/')) {
    if(req.headers.origin && req.headers.origin!==`http://${host}`){json(403,{error:'不允许跨站调用'});return;}
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
