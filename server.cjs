const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const allowed = {'/':'index.html','/index.html':'index.html','/styles.css':'styles.css','/app.js':'app.js','/evaluation.js':'evaluation.js','/sample-data.js':'sample-data.js'};
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const port = Number(process.env.PORT || 4173);
http.createServer((req,res)=>{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':'GET, HEAD'});res.end();return;}
  let pathname;try{pathname=new URL(req.url,'http://localhost').pathname;}catch{res.writeHead(400);res.end();return;}
  const file=Object.hasOwn(allowed,pathname)?allowed[pathname]:null;
  if(!file){res.writeHead(404);res.end('Not found');return;}
  fs.readFile(path.join(__dirname,file),(error,data)=>{if(error){res.writeHead(500);res.end('Unable to read asset');return;}res.writeHead(200,{'Content-Type':types[path.extname(file)],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:data);});
}).listen(port,'127.0.0.1',()=>console.log(`Agent Context Lab: http://127.0.0.1:${port}`));
