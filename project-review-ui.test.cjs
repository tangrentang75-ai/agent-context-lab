'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),R=require('./project-review.js');
const KEY='acl-project-reviews-v1';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function record(id='original'){return R.createProject({id,projectId:'project-one',title:id,date:'2026-10-14',version:'test',scope:'仅软件测试',reviewer:'测试',owner:'测试角色',limitations:['不是实际项目验收'],goals:[{label:'软件测试目标',kind:'desktop',required:true,versionPolicy:'current',method:'自动检查',doneWhen:'保存测试日志'}]});}
// Minimal DOM doubles for event/state unit tests; this does not automate a browser.
function harness({storage=new Map(),fetcher,confirmAction=()=>false}={}){
  const nodes=new Map(),downloads=[];let serial=0;
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
  const context={window:{ProjectReview:R,ProjectReviewBackup:require('./project-review-backup.js'),EvidenceFileCheck:require('./evidence-file-check.js')},document:{getElementById:get,createElement:tag=>new Element(tag)},localStorage,fetch:fetcher||(()=>Promise.resolve({ok:false,json:async()=>({error:'无本地案例'})})),crypto:{randomUUID:()=>`synthetic-${++serial}`},structuredClone,Date,URL:{createObjectURL:blob=>{downloads.push(blob);return 'blob:test';},revokeObjectURL(){}},Blob,setTimeout,confirm:confirmAction};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'project-review-ui.js'),'utf8'),context,{filename:'project-review-ui.js'});
  return {get,storage,downloads,import:async file=>get('review-file').emit('change',{target:{files:[file],value:'file'}}),restoreBackup:async file=>get('backup-file').emit('change',{target:{files:[file],value:'file'}})};
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
const B=require('./project-review-backup.js');
test('整批恢复保留原记录、去重；后续冲突或损坏项使整批不写入',async()=>{
  const h=harness();await tick();await h.import(file(record('base')));await h.restoreBackup(file(B.create([record('base'),record('new')])));assert.deepEqual(JSON.parse(h.storage.get(KEY)).map(r=>r.id),['base','new']);const before=h.storage.get(KEY);await h.restoreBackup(file(B.create([record('another'),{...record('base'),title:'conflict'}])));assert.equal(h.storage.get(KEY),before);assert.match(h.get('notice').textContent,/不同内容/);await h.restoreBackup(file({schema:'project-review-backup-v1',exportedAt:new Date().toISOString(),records:[record('another'),{id:'broken'}]}));assert.equal(h.storage.get(KEY),before);
});
test('备份只导出已保存记录，不包含仅从本机读取的记录；过期页面拒绝导出',async()=>{
  const storage=new Map([[KEY,JSON.stringify([record('saved')])]]),h=harness({storage,fetcher:async()=>({ok:true,json:async()=>({current:record('local')})})});await tick();await h.get('export-backup').click();assert.deepEqual(JSON.parse(await h.downloads[0].text()).records.map(r=>r.id),['saved']);storage.set(KEY,JSON.stringify([record('newer')]));await h.get('export-backup').click();assert.equal(h.downloads.length,1);assert.match(h.get('notice').textContent,/刷新后备份/);
});
test('恢复备份遇到另一页变更或存储写入失败时，不显示部分新记录',async()=>{
  const storage=new Map([[KEY,JSON.stringify([record('base')])]]),h=harness({storage});await tick();storage.set(KEY,JSON.stringify([record('external')]));await h.restoreBackup(file(B.create([record('new')])));assert.equal(JSON.parse(storage.get(KEY))[0].id,'external');assert.ok(!h.get('record-select').children.some(n=>n.value==='new'));
  const storage2=new Map([[KEY,JSON.stringify([record('base')])]]),g=harness({storage:storage2});await tick();storage2.set=()=>{throw Error('QuotaExceeded');};await g.restoreBackup(file(B.create([record('new')])));assert.equal(JSON.parse(storage2.get(KEY)).length,1);assert.ok(!g.get('record-select').children.some(n=>n.value==='new'));assert.match(g.get('notice').textContent,/QuotaExceeded/);
});
test('迟到备份不覆盖后续选择，超大文件在读取前拒绝，损坏保存区不被重置',async()=>{
  const h=harness();await tick();await h.import(file(record('base')));const slow=deferred(),pending=h.restoreBackup({size:100,text:()=>slow.promise});await h.import(file(record('newer')));slow.resolve(JSON.stringify(B.create([record('late')])));await pending;assert.equal(h.get('record-select').value,'newer');assert.deepEqual(JSON.parse(h.storage.get(KEY)).map(r=>r.id),['base','newer']);let read=false;await h.restoreBackup({size:B.MAX_FILE_BYTES+1,text:()=>{read=true;}});assert.equal(read,false);
  const storage=new Map([[KEY,'broken']]),g=harness({storage});await tick();await g.restoreBackup(file(B.create([record('new')])));assert.equal(storage.get(KEY),'broken');assert.equal(g.get('export-backup').disabled,true);
});
test('清除拒绝过期页面；清除成功后正在读取的导入不能悄悄重新保存',async()=>{
  const storage=new Map([[KEY,JSON.stringify([record('base')])]]),h=harness({storage,confirmAction:()=>true});await tick();storage.set(KEY,JSON.stringify([record('external')]));await h.get('clear-saved').click();assert.equal(JSON.parse(storage.get(KEY))[0].id,'external');assert.match(h.get('notice').textContent,/另一页面/);
  const g=harness({confirmAction:()=>true});await tick();await g.import(file(record('base')));const slow=deferred(),pending=g.restoreBackup({size:100,text:()=>slow.promise});await g.get('clear-saved').click();slow.resolve(JSON.stringify(B.create([record('late')])));await pending;assert.equal(g.storage.get(KEY),undefined);assert.equal(g.get('export-backup').disabled,true);assert.match(g.get('saved-count').textContent,/0 \/ 10/);
});
test('无附带案例是正常状态，首次使用和已有保存记录均不显示红色故障',async()=>{
  for(const storage of [new Map(),new Map([[KEY,JSON.stringify([record('saved')])]])]){const h=harness({storage,fetcher:async()=>({status:404,ok:false})});await tick();assert.equal(h.get('notice').classes.has('error'),false);assert.match(h.get('notice').textContent,/没有附带案例/);if(storage.size)assert.equal(h.get('record-select').value,'saved');else assert.equal(h.get('empty').hidden,false);}
});
test('没有附带案例不掩盖损坏保存区；服务器损坏仍明确显示故障',async()=>{
  const h=harness({storage:new Map([[KEY,'broken']]),fetcher:async()=>({status:404,ok:false})});await tick();assert.equal(h.get('notice').classes.has('error'),true);assert.match(h.get('notice').textContent,/保存区无法读取.*原数据已保留/);assert.equal(h.storage.get(KEY),'broken');
  const g=harness({storage:new Map([[KEY,JSON.stringify([record('saved')])]]),fetcher:async()=>({status:409,ok:false,json:async()=>({error:'案例损坏'})})});await tick();assert.equal(g.get('notice').classes.has('error'),true);assert.match(g.get('notice').textContent,/案例损坏/);assert.equal(g.get('record-select').value,'saved');
});

test('本机读取记录明确标为未保存，单独保存后才进入备份，重复保存不增加记录',async()=>{
  const local=record('local'),h=harness({fetcher:async()=>({ok:true,json:async()=>({current:local})})});await tick();
  assert.match(h.get('record-storage').textContent,/未包含/);assert.equal(h.get('save-current').disabled,false);assert.equal(h.get('remove-current').disabled,true);assert.equal(h.storage.get(KEY),undefined);
  await h.get('save-current').click();assert.deepEqual(JSON.parse(h.storage.get(KEY)),[local]);assert.match(h.get('record-storage').textContent,/已保存在/);assert.equal(h.get('save-current').disabled,true);
  await h.get('save-current').click();await h.get('export-backup').click();assert.deepEqual(JSON.parse(await h.downloads[0].text()).records,[local]);
});

test('移除单份存档需确认，保留其他轮次和本页记录，刷新只恢复剩余存档',async()=>{
  const a=record('first'),b=record('second'),storage=new Map([[KEY,JSON.stringify([a,b])]]);
  const h=harness({storage});await tick();
  await h.get('remove-current').click();assert.equal(JSON.parse(storage.get(KEY)).length,2);assert.match(h.get('remove-description').textContent,/second/);assert.match(h.get('remove-notice').textContent,/其他轮次不受影响/);await h.get('remove-cancel').click();assert.equal(h.get('remove-dialog').open,false);assert.equal(JSON.parse(storage.get(KEY)).length,2);
  await h.get('remove-current').click();await h.get('remove-confirm').click();assert.deepEqual(JSON.parse(storage.get(KEY)),[a]);assert.equal(h.get('record-select').value,'second');assert.equal(h.get('review-title').textContent,'second');assert.match(h.get('record-storage').textContent,/未包含/);assert.equal(h.get('save-current').disabled,false);assert.equal(h.get('remove-current').disabled,true);
  const fresh=harness({storage});await tick();assert.equal(fresh.get('record-select').value,'first');assert.equal(fresh.get('record-select').children.length,1);
  await h.get('save-current').click();assert.deepEqual(JSON.parse(storage.get(KEY)),[a,b]);
});

test('满10份时拒绝额外保存，移除选定存档后可保存新记录且不更改其他内容',async()=>{
  const originals=Array.from({length:10},(_,i)=>record('r'+i)),storage=new Map([[KEY,JSON.stringify(originals)]]),local=record('local');
  const h=harness({storage,confirmAction:()=>true,fetcher:async()=>({ok:true,json:async()=>({current:local})})});await tick();const before=storage.get(KEY);
  await h.get('save-current').click();assert.equal(storage.get(KEY),before);assert.match(h.get('notice').textContent,/10/);assert.match(h.get('record-storage').textContent,/未包含/);
  h.get('record-select').value='r4';await h.get('record-select').emit('change');await h.get('remove-current').click();await h.get('remove-confirm').click();h.get('record-select').value='local';await h.get('record-select').emit('change');await h.get('save-current').click();
  assert.deepEqual(JSON.parse(storage.get(KEY)),[...originals.filter(r=>r.id!=='r4'),local]);assert.match(h.get('saved-count').textContent,/10 \/ 10/);
});

test('单份移除拒绝确认期间另一页的变更，也不将写入失败表现为已移除',async()=>{
  const base=record('base'),storage=new Map([[KEY,JSON.stringify([base])]]),external=JSON.stringify([base,record('external')]);
  const h=harness({storage});await tick();await h.get('remove-current').click();storage.set(KEY,external);await h.get('remove-confirm').click();assert.equal(storage.get(KEY),external);assert.match(h.get('remove-notice').textContent,/另一页面/);assert.equal(h.get('remove-dialog').open,true);assert.match(h.get('record-storage').textContent,/已保存在/);
  const second=new Map([[KEY,JSON.stringify([base])]]),g=harness({storage:second});await tick();second.set=()=>{throw Error('write denied');};await g.get('remove-current').click();await g.get('remove-confirm').click();assert.deepEqual(JSON.parse(second.get(KEY)),[base]);assert.match(g.get('remove-notice').textContent,/没有移除.*write denied/);assert.equal(g.get('remove-current').disabled,false);
});

test('单份移除取消正在读取的导入；全部移除后备份不可用，记录仍可重新保存',async()=>{
  const h=harness();await tick();await h.import(file(record('base')));const slow=deferred(),pending=h.restoreBackup({size:100,text:()=>slow.promise});await h.get('remove-current').click();await h.get('remove-confirm').click();slow.resolve(JSON.stringify(B.create([record('late')])));await pending;
  assert.deepEqual(JSON.parse(h.storage.get(KEY)),[]);assert.equal(h.get('export-backup').disabled,true);assert.equal(h.get('record-select').value,'base');assert.match(h.get('notice').textContent,/已将这一份/);await h.get('save-current').click();assert.equal(JSON.parse(h.storage.get(KEY))[0].id,'base');
});

test('保存区损坏或没有当前记录时不提供单份保存与移除操作',async()=>{
  const local=record('local'),storage=new Map([[KEY,'broken']]),h=harness({storage,fetcher:async()=>({ok:true,json:async()=>({current:local})})});await tick();assert.equal(h.get('save-current').disabled,true);assert.equal(h.get('remove-current').disabled,true);assert.match(h.get('record-storage').textContent,/无法确认/);assert.equal(storage.get(KEY),'broken');
  const empty=harness({fetcher:async()=>({status:404,ok:false})});await tick();assert.equal(empty.get('save-current').disabled,true);assert.equal(empty.get('remove-current').disabled,true);assert.match(empty.get('record-storage').textContent,/选择一份/);
});

test('原记录日期晚于本机日期时仍能打开新轮次窗口，并提示核对而非改写原记录',async()=>{
  const future={...record('future'),date:'9999-12-31'},storage=new Map([[KEY,JSON.stringify([future])]]),h=harness({storage});await tick();await h.get('new-round').click();
  assert.equal(h.get('editor').open,true);assert.equal(h.get('edit-date').value,future.date);assert.match(h.get('editor-notice').textContent,/原记录日期晚于本机今天/);assert.deepEqual(JSON.parse(storage.get(KEY)),[future]);
  h.get('edit-date').value='2026-10-15';h.get('edit-reviewer').value='软件测试';h.get('edit-scope').value='软件测试';await h.get('editor-save').click();assert.equal(h.get('editor').open,true);assert.match(h.get('editor-notice').textContent,/不能早于/);assert.deepEqual(JSON.parse(storage.get(KEY)),[future]);
});

test('损坏保存区可原样下载排查封装，不修复、不覆盖，也不能误当正常备份恢复',async()=>{
  const raw='broken\r\n含节选与未配对字符\ud800',storage=new Map([[KEY,raw]]),h=harness({storage});await tick();assert.equal(h.get('export-storage-recovery').hidden,false);assert.equal(h.get('export-storage-recovery').disabled,false);assert.equal(h.get('export-backup').disabled,true);
  await h.get('export-storage-recovery').click();const recovery=JSON.parse(await h.downloads[0].text());assert.equal(recovery.schema,'project-review-storage-recovery-v1');assert.equal(recovery.storageKey,KEY);assert.equal(recovery.raw,raw);assert.equal(storage.get(KEY),raw);assert.equal(h.get('export-backup').disabled,true);assert.match(h.get('notice').textContent,/不是可直接恢复/);
  await h.restoreBackup(file(recovery));assert.match(h.get('notice').textContent,/需要项目检查备份格式/);assert.equal(storage.get(KEY),raw);
});

test('正常保存区不显示排查入口；损坏快照过期或读取被拒绝时不导出过期内容',async()=>{
  const normal=harness({storage:new Map([[KEY,JSON.stringify([record('base')])]])});await tick();assert.equal(normal.get('export-storage-recovery').hidden,true);await normal.get('export-storage-recovery').click();assert.equal(normal.downloads.length,0);
  const storage=new Map([[KEY,'broken']]),h=harness({storage});await tick();storage.set(KEY,'newer broken');await h.get('export-storage-recovery').click();assert.equal(h.downloads.length,0);assert.match(h.get('notice').textContent,/另一页面/);assert.equal(storage.get(KEY),'newer broken');
  const blocked=new Map();blocked.get=()=>{throw Error('read denied');};const g=harness({storage:blocked});await tick();assert.equal(g.get('export-storage-recovery').hidden,true);assert.equal(g.get('export-storage-recovery').disabled,true);assert.equal(g.get('export-backup').disabled,true);
});

test('数组伪装的状态不能经单份或整批导入写入，坏存档保留原文而不参与判断',async()=>{
  const h=harness();await tick();await h.import(file(record('base')));const original=h.storage.get(KEY),bad=record('malformed');bad.criteria[0].status=['pass'];
  await h.import(file(bad));assert.equal(h.storage.get(KEY),original);assert.match(h.get('notice').textContent,/状态无效/);assert.equal(h.get('record-select').value,'base');
  await h.restoreBackup(file({schema:'project-review-backup-v1',exportedAt:new Date().toISOString(),records:[record('new'),bad]}));assert.equal(h.storage.get(KEY),original);assert.ok(!h.get('record-select').children.some(n=>n.value==='new'));assert.match(h.get('notice').textContent,/状态无效/);
  const raw=JSON.stringify([bad]),g=harness({storage:new Map([[KEY,raw]])});await tick();assert.equal(g.get('result').hidden,true);assert.equal(g.get('export-backup').disabled,true);assert.equal(g.storage.get(KEY),raw);await g.get('export-storage-recovery').click();assert.equal(JSON.parse(await g.downloads[0].text()).raw,raw);
});
