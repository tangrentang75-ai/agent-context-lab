'use strict';
const http=require('node:http'),path=require('node:path'),{spawn}=require('node:child_process');
const {localIdentity}=require('./local-identity.cjs');
const url='http://127.0.0.1:4173/project-review.html';
function classify(data,expected){
  if(!data||data.schema!=='acl-local-info-v1'||data.app!=='agent-context-lab'||typeof data.version!=='string'||!/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(data.version)||typeof data.workspaceId!=='string'||!/^[a-f0-9]{64}$/.test(data.workspaceId))return {kind:'unrecognized'};
  if(data.workspaceId!==expected.workspaceId)return {kind:'different-directory'};
  if(data.version!==expected.version)return {kind:'different-version',version:data.version};
  return {kind:'ready'};
}
function probe({port=4173,timeoutMs=2500,expected=localIdentity()}={}){
  return new Promise(resolve=>{
    let settled=false,timer,req;
    const done=result=>{if(settled)return;settled=true;clearTimeout(timer);resolve(result);};
    try{
      req=http.get({hostname:'127.0.0.1',port,path:'/api/local-info'},res=>{
        if(res.statusCode!==200||!/^application\/json\b/i.test(res.headers['content-type']||'')){done({kind:'unrecognized'});res.destroy();return;}
        let size=0;const chunks=[];
        res.on('data',chunk=>{size+=chunk.length;if(size>32768){done({kind:'unrecognized'});res.destroy();return;}chunks.push(chunk);});
        res.on('end',()=>{try{done(classify(JSON.parse(Buffer.concat(chunks).toString('utf8')),expected));}catch{done({kind:'unrecognized'});}});
        res.on('aborted',()=>done({kind:'error',reason:'本地服务中断了响应'}));res.on('error',()=>done({kind:'error',reason:'本地响应读取失败'}));
      });
      req.on('error',e=>done(e.code==='ECONNREFUSED'?{kind:'absent'}:{kind:'error',reason:'无法读取本地服务，请检查启动窗口'}));
      timer=setTimeout(()=>{done({kind:'error',reason:'本地服务响应超时'});req.destroy();},timeoutMs);
    }catch{done({kind:'error',reason:'本地服务检查失败'});}
  });
}
async function run({probeFn=probe,spawnFn=spawn,log=console.log,error=console.error}={}){
  const state=await probeFn();
  if(state.kind==='ready'){log('当前目录的任务罗盘 '+localIdentity().version+' 已经运行：'+url);return 0;}
  if(state.kind!=='absent'){
    const messages={'different-directory':'4173端口正在运行另一个目录中的任务罗盘。请确认原启动窗口，结束原服务后再启动当前目录。','different-version':'4173端口正在运行当前目录的另一版本。请确认原启动窗口，结束原服务后再启动新版。','unrecognized':'4173端口已有其他服务，或是不提供版本识别的旧版任务罗盘。请先确认服务来源。'};
    error(messages[state.kind]||state.reason||'无法确认本地服务状态。');error('未关闭已有进程，也未启动第二个服务。');return 1;
  }
  log('正在启动任务罗盘。看到服务器地址后，在浏览器打开：'+url+'\n使用期间请保留此终端窗口。');
  return new Promise(resolve=>{
    let child;try{child=spawnFn(process.execPath,[path.join(__dirname,'server.cjs')],{cwd:__dirname,stdio:'inherit',env:{...process.env,PORT:'4173'}});}catch{error('启动失败，请检查Node.js和当前项目文件。');resolve(1);return;}
    child.once('error',()=>{error('启动失败，请检查Node.js和当前项目文件。');resolve(1);});
    child.once('exit',code=>resolve(Number.isInteger(code)?code:1));
  });
}
if(require.main===module)run().then(code=>{process.exitCode=code;}).catch(()=>{console.error('启动检查失败，请保留此窗口中的错误。');process.exitCode=1;});
module.exports={classify,probe,run};
