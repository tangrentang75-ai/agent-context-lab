'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),{EventEmitter}=require('node:events');
const {probe,classify,run}=require('./start-local.cjs'),{localIdentity}=require('./local-identity.cjs'),{createServer}=require('./server.cjs');
async function serve(t,handler){const server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();return new Promise(r=>server.close(r));});return server.address().port;}
test('启动识别要求项目、版本和真实目录标识均一致',()=>{const expected=localIdentity();assert.equal(classify(expected,expected).kind,'ready');assert.equal(classify({...expected,version:'0.0.1'},expected).kind,'different-version');assert.equal(classify({...expected,workspaceId:'0'.repeat(64)},expected).kind,'different-directory');for(const bad of [null,{title:'项目体检 · 任务罗盘'},{...expected,app:'other'},{...expected,version:'unsafe\ntext'},{...expected,workspaceId:undefined}])assert.equal(classify(bad,expected).kind,'unrecognized');assert.ok(!JSON.stringify(expected).includes(__dirname));});
test('真实本机识别接口不读取案例、不调用模型，拒绝跨站与写入',async t=>{
  let calls=0;const server=createServer({connectionStatus(){calls++;}},{projectReviewReader(){calls++;},taskExecutor:{run(){calls++;}}});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();return new Promise(r=>server.close(r));});const port=server.address().port,url='http://127.0.0.1:'+port+'/api/local-info';assert.equal((await probe({port})).kind,'ready');const response=await fetch(url);assert.deepEqual(await response.json(),localIdentity());assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await fetch(url,{headers:{origin:'https://outside.test'}})).status,403);assert.equal((await fetch(url,{method:'POST'})).status,404);assert.equal(calls,0);
});
test('相同网页标题、坏JSON和过大响应都不能冒充当前项目',async t=>{
  const cases=[{type:'text/html',body:'项目体检 · 任务罗盘'},{type:'application/json',body:'{broken'},{type:'application/json',body:JSON.stringify({...localIdentity(),padding:'x'.repeat(33000)})}];for(const c of cases){const port=await serve(t,(_,res)=>{res.writeHead(200,{'Content-Type':c.type});res.end(c.body);});assert.equal((await probe({port})).kind,'unrecognized');}
});
test('总响应超时会停止读取，即使对方持续传输零碎内容',async t=>{const port=await serve(t,(_,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.write('{');const interval=setInterval(()=>res.write(' '),5);res.on('close',()=>clearInterval(interval));});const result=await probe({port,timeoutMs:80});assert.equal(result.kind,'error');assert.match(result.reason,/超时/);});
test('中途断开的响应不当成空闲端口',async t=>{const port=await serve(t,(_,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.write('{');setImmediate(()=>res.destroy());});assert.equal((await probe({port})).kind,'error');});
test('连接被拒绝才报告无服务，其他识别状态绝不启动进程',async()=>{
  const server=http.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));assert.equal((await probe({port})).kind,'absent');
  for(const kind of ['ready','different-directory','different-version','unrecognized','error']){let spawned=false;const code=await run({probeFn:async()=>({kind}),spawnFn:()=>{spawned=true;},log(){},error(){}});assert.equal(spawned,false);assert.equal(code,kind==='ready'?0:1);}
});
test('仅空闲端口启动当前目录，信号结束和启动错误不会伪装成功',async()=>{
  for(const code of [0,2,null]){let args;const actual=await run({probeFn:async()=>({kind:'absent'}),spawnFn:(...values)=>{args=values;const child=new EventEmitter();queueMicrotask(()=>child.emit('exit',code));return child;},log(){},error(){}});assert.equal(actual,code===null?1:code);assert.equal(args[0],process.execPath);assert.equal(args[2].cwd,__dirname);assert.equal(args[2].env.PORT,'4173');}
  assert.equal(await run({probeFn:async()=>({kind:'absent'}),spawnFn:()=>{throw Error('spawn failed');},log(){},error(){}}),1);
});
