'use strict';
// A small local launcher: reuse this project's preview, otherwise run it in this terminal.
const http=require('node:http'),path=require('node:path'),{spawn}=require('node:child_process');
const url='http://127.0.0.1:4173/project-review.html';
const req=http.get(url,{timeout:2500},res=>{
  let body='';res.setEncoding('utf8');res.on('data',chunk=>{body+=chunk;if(body.length>100000)req.destroy(Error('Unexpected response size'));});
  res.on('end',()=>{if(res.statusCode===200&&body.includes('项目体检 · 任务罗盘'))console.log('任务罗盘已经运行：'+url);else{console.error('4173端口已有其他服务或旧版任务罗盘。请先确认该服务，再启动当前版本。');process.exitCode=1;}});
});
req.on('timeout',()=>req.destroy(Error('Local preview timed out')));
req.on('error',error=>{
  if(error.code!=='ECONNREFUSED'){console.error('无法确认本地服务状态：'+error.message);process.exitCode=1;return;}
  console.log('正在启动任务罗盘。看到服务器地址后，在浏览器打开：'+url+'\n使用期间请保留此终端窗口。');
  const child=spawn(process.execPath,[path.join(__dirname,'server.cjs')],{cwd:__dirname,stdio:'inherit',env:{...process.env,PORT:'4173'}});
  child.on('error',e=>{console.error('启动失败：'+e.message);process.exitCode=1;});child.on('exit',code=>{process.exitCode=code||0;});
});
