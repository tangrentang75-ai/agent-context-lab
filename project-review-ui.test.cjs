'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),R=require('./project-review.js');
const KEY='acl-project-reviews-v1';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function record(id='original'){return R.createProject({id,projectId:'project-one',title:id,date:'2026-10-14',version:'test',scope:'仅软件测试',reviewer:'测试',owner:'测试角色',limitations:['不是实际项目验收'],goals:[{label:'软件测试目标',kind:'desktop',required:true,versionPolicy:'current',method:'自动检查',doneWhen:'保存测试日志'}]});}
// Minimal DOM doubles for event/state unit tests; this does not automate a browser.
function harness({storage=new Map(),fetcher}={}){
  const nodes=new Map();let serial=0;
  class Element{
    constructor(tag='div'){this.tagName=tag;this.children=[];this.listeners={};this.value='';this.disabled=false;this.hidden=false;this.open=false;this._text='';this.classes=new Set();this.classList={toggle:(name,on)=>on?this.classes.add(name):this.classes.delete(name)};}
    set id(v){this._id=v;nodes.set(v,this);}get id(){return this._id;}
    set textContent(v){this._text=String(v);this.children=[];}get textContent(){return this._text+this.children.map(c=>c.textContent||'').join('');}
    append(...children){this.children.push(...children);children.forEach(c=>c.parent=this);if(this.tagName==='select'&&!this.value&&children.length)this.value=children[0].value;}
    replaceChildren(...children){this._text='';this.children=[];this.append(...children);}
    addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
    setAttribute(name,value){this[name]=value;}
    async emit(type,event={target:this}){for(const fn of this.listeners[type]||[])await fn(event);}
    click(){return this.emit('click');}showModal(){this.open=true;}close(){this.open=false;}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);}
  }
  const html=fs.readFileSync(path.join(__dirname,'project-review.html'),'utf8');for(const m of html.matchAll(/<(\w+)[^>]*\bid="([^"]+)"/g)){const e=new Element(m[1]);e.id=m[2];}
  nodes.get('status-filter').value='all';
  const get=id=>{const e=nodes.get(id);if(!e)throw Error('Missing DOM id '+id);return e;};
  const localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
  const context={window:{ProjectReview:R,EvidenceFileCheck:require('./evidence-file-check.js')},document:{getElementById:get,createElement:tag=>new Element(tag)},localStorage,fetch:fetcher||(()=>Promise.resolve({ok:false,json:async()=>({error:'无本地案例'})})),crypto:{randomUUID:()=>`synthetic-${++serial}`},structuredClone,Date,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},Blob,setTimeout,confirm:()=>false};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'project-review-ui.js'),'utf8'),context,{filename:'project-review-ui.js'});
  return {get,storage,import:async file=>get('review-file').emit('change',{target:{files:[file],value:'file'}})};
}
const file=r=>({size:100,text:async()=>JSON.stringify(r)});
test('后选择的导入先完成时，迟到旧文件不改变选择或写入保存区',async()=>{
  const h=harness();await tick();const slow=deferred(),pending=h.import({size:100,text:()=>slow.promise});await h.import(file(record('newer')));slow.resolve(JSON.stringify(record('older')));await pending;
  assert.equal(h.get('record-select').value,'newer');assert.deepEqual(JSON.parse(h.storage.get(KEY)).map(r=>r.id),['newer']);
});
test('用户切换已保存记录后，迟到导入不覆盖选择和成功消息',async()=>{
  const h=harness({storage:new Map([[KEY,JSON.stringify([record('existing')])]])});await tick();const slow=deferred(),pending=h.import({size:100,text:()=>slow.promise});h.get('record-select').value='existing';await h.get('record-select').emit('change');const message=h.get('notice').textContent;slow.reject(Error('旧文件读取失败'));await pending;
  assert.equal(h.get('record-select').value,'existing');assert.equal(h.get('notice').textContent,message);assert.equal(JSON.parse(h.storage.get(KEY)).length,1);
});
test('后台本地读取失败不得覆盖更晚导入成功的消息',async()=>{
  const slow=deferred(),h=harness({fetcher:()=>slow.promise});await h.import(file(record('imported')));const message=h.get('notice').textContent;slow.reject(Error('late network error'));await tick();assert.equal(h.get('notice').textContent,message);assert.equal(h.get('record-select').value,'imported');
});
test('两个页面同时保存时拒绝旧快照覆盖，保留另一页的新记录',async()=>{
  const shared=new Map([[KEY,JSON.stringify([record('base')])]]),a=harness({storage:shared}),b=harness({storage:shared});await tick();await a.import(file(record('from-a')));await b.import(file(record('from-b')));
  assert.deepEqual(JSON.parse(shared.get(KEY)).map(r=>r.id),['base','from-a']);assert.match(b.get('notice').textContent,/另一页面/);assert.notEqual(b.get('record-select').value,'from-b');
});
test('损坏保存区不会被一次导入静默重置',async()=>{const storage=new Map([[KEY,'{broken']]),h=harness({storage});await tick();await h.import(file(record('new')));assert.equal(storage.get(KEY),'{broken');assert.match(h.get('notice').textContent,/不可写/);});
test('重复编号不同内容拒绝，原内容与当前记录保持不变',async()=>{const h=harness();await tick();await h.import(file(record('same')));const changed=record('same');changed.title='changed';await h.import(file(changed));assert.equal(JSON.parse(h.storage.get(KEY))[0].title,'same');assert.equal(h.get('review-title').textContent,'same');assert.match(h.get('notice').textContent,/不同内容/);});
test('开始编辑之后，先前尚未完成的导入不能写入或换掉编辑基线',async()=>{const h=harness();await tick();await h.import(file(record('base')));const slow=deferred(),pending=h.import({size:100,text:()=>slow.promise});await h.get('new-round').click();slow.resolve(JSON.stringify(record('late')));await pending;assert.equal(h.get('editor').open,true);assert.equal(h.get('record-select').value,'base');assert.deepEqual(JSON.parse(h.storage.get(KEY)).map(r=>r.id),['base']);});
function evidenceRecord(){const r=record('with-source');r.evidence=[{id:'e1',title:'软件测试原文',kind:'desktop',date:r.date,version:r.version,locator:'synthetic.txt',text:'synthetic source',sha256:require('node:crypto').createHash('sha256').update('synthetic source').digest('hex')}];r.criteria[0].refs=[{evidenceId:'e1',quote:'synthetic source'}];return r;}
function descendants(el){return [el,...el.children.flatMap(descendants)];}
function sourceButton(h){return descendants(h.get('criteria')).find(n=>n.tagName==='button');}
function sourceFile(text){const b=Buffer.from(text);return {name:'synthetic.txt',size:b.length,arrayBuffer:async()=>b};}
async function checkFile(h,file){await sourceButton(h).click();return h.get('evidence-file').emit('change',{target:{files:[file],value:'file'}});}
test('文件匹配不改检查结论和保存记录，重渲染保留本页状态但刷新不继承',async()=>{
  const h=harness();await tick();await h.import(file(evidenceRecord()));const before=h.storage.get(KEY);const card=h.get('criteria').children[0];card.open=true;await checkFile(h,sourceFile('synthetic source'));
  assert.match(h.get('criteria').textContent,/校验值一致/);assert.match(h.get('criteria').textContent,/不证明来源真实/);assert.equal(card.open,true);assert.equal(h.storage.get(KEY),before);assert.match(h.get('metrics').textContent,/1证据待补/);
  await h.get('status-filter').emit('change');assert.match(h.get('criteria').textContent,/校验值一致/);
  const fresh=harness({storage:h.storage});await tick();assert.match(fresh.get('criteria').textContent,/尚未核对/);
});
test('同一证据后选文件优先，迟到匹配不能覆盖较新的不匹配',async()=>{
  const h=harness();await tick();await h.import(file(evidenceRecord()));const slow=deferred(),pending=checkFile(h,{name:'old',size:16,arrayBuffer:()=>slow.promise});await tick();await checkFile(h,sourceFile('changed'));slow.resolve(Buffer.from('synthetic source'));await pending;assert.match(h.get('criteria').textContent,/校验值不一致/);assert.ok(!h.get('criteria').textContent.includes('校验值一致'));
});
test('超限文件在读取前拒绝，读取失败不保留先前匹配状态',async()=>{
  const h=harness();await tick();await h.import(file(evidenceRecord()));await checkFile(h,sourceFile('synthetic source'));let read=false;await checkFile(h,{name:'large',size:20*1024*1024+1,arrayBuffer:()=>{read=true;}});assert.equal(read,false);assert.match(h.get('criteria').textContent,/超过20MiB/);assert.ok(!h.get('criteria').textContent.includes('校验值一致'));
  await checkFile(h,{name:'unreadable',size:1,arrayBuffer:async()=>{throw Error('read failed');}});assert.match(h.get('criteria').textContent,/核对未完成.*read failed/);
});
async function prepareNewEvidence(h,sha){await h.get('new-round').click();h.get('edit-date').value='2026-10-14';h.get('edit-reviewer').value='软件测试';h.get('edit-scope').value='仅验证填写和保存';for(const [k,v] of Object.entries({title:'新测试来源',date:'2026-10-14',version:'test',locator:'synthetic.txt',text:'synthetic source',quote:'synthetic source',sha256:sha}))h.get('edit-source-'+k).value=v;}
test('新增证据可保存既有校验值，规范化大小写与外侧空格，旧轮次不变',async()=>{
  const h=harness();await tick();await h.import(file(record('base')));const before=JSON.parse(h.storage.get(KEY))[0];await prepareNewEvidence(h,' A'+'B'.repeat(63)+' ');await h.get('editor-save').click();const saved=JSON.parse(h.storage.get(KEY));assert.equal(saved.length,2);assert.deepEqual(saved[0],before);assert.equal(saved[1].evidence[0].sha256,'a'+'b'.repeat(63));assert.equal(saved[1].criteria[0].status,'unknown');assert.match(h.get('criteria').textContent,/尚未核对/);
});
test('无校验值仍可保存来源；错误值不保存且保留可修改草稿',async()=>{
  const h=harness();await tick();await h.import(file(record('base')));await prepareNewEvidence(h,'invalid hash');await h.get('editor-save').click();assert.equal(JSON.parse(h.storage.get(KEY)).length,1);assert.equal(h.get('editor').open,true);assert.match(h.get('editor-notice').textContent,/64位/);assert.equal(h.get('edit-source-text').value,'synthetic source');h.get('edit-source-sha256').value='';await h.get('editor-save').click();const saved=JSON.parse(h.storage.get(KEY));assert.equal(saved.length,2);assert.equal(saved[1].evidence[0].sha256,undefined);assert.ok(!h.get('criteria').textContent.includes('选择原文件核对'));
});
test('同一来源多条引文只显示一次来源按钮，同时保留每条引文和无效提示',async()=>{
  const r=evidenceRecord();r.criteria[0].status='pass';r.criteria[0].refs=[{evidenceId:'e1',quote:'synthetic'},{evidenceId:'e1',quote:'source'},{evidenceId:'e1',quote:'missing quote'}];const h=harness();await tick();await h.import(file(r));const nodes=descendants(h.get('criteria'));assert.equal(nodes.filter(n=>n.tagName==='button').length,1);assert.deepEqual(nodes.filter(n=>n.tagName==='blockquote').map(n=>n.textContent),['synthetic','source','missing quote']);assert.match(h.get('criteria').textContent,/不一致/);assert.match(h.get('metrics').textContent,/1证据待补/);await checkFile(h,sourceFile('synthetic source'));assert.match(h.get('criteria').textContent,/校验值一致/);assert.match(h.get('criteria').textContent,/不一致/);assert.match(h.get('metrics').textContent,/1证据待补/);
});
