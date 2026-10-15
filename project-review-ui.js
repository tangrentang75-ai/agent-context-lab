'use strict';
(() => {
  const R=window.ProjectReview,B=window.ProjectReviewBackup,$=id=>document.getElementById(id),KEY='acl-project-reviews-v1';
  let records=[],selected='',baseline=null,saved=[],savedRaw=null,storageBlocked=false,storageProblem='',selectionEpoch=0;
  const fileChecks=new Map(),fileCheckNodes=new Map(),fileCheckEpochs=new Map();let requestedFileCheck=null;
  function showFileCheck(key){for(const el of fileCheckNodes.get(key)||[])el.textContent=fileChecks.get(key)||'本页尚未核对原文件。最大20MiB，仅在本机计算，不上传文件。';}
  function node(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
  function notice(message,error=false){$('notice').textContent=message;$('notice').classList.toggle('error',error);}
  function option(value,label){const el=node('option',label);el.value=value;return el;}
  function current(){return records.find(r=>r.id===selected);}
  function download(name,text,type){const url=URL.createObjectURL(new Blob([text],{type}));const a=node('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}
  function storageInfo(){
    $('saved-count').textContent=storageBlocked?'保存区无法完整读取，已保留原数据。请先处理读取问题。':'当前浏览器已保存 '+saved.length+' / 10份检查记录。备份只生成本机下载文件，不自动上传。';
    $('export-backup').disabled=storageBlocked||!saved.length;
  }
  function addRecords(incoming){
    const next=[...records];
    for(const raw of incoming){const r=R.validate(raw),existing=next.find(x=>x.id===r.id);if(existing&&!same(existing,r))throw Error('编号 '+r.id+' 已存在且内容不同。请保留旧记录，为修订记录使用新的编号。');if(!existing)next.push(r);}
    records=next;
  }
  function restore(){
    try{savedRaw=localStorage.getItem(KEY);if(savedRaw!==null){if(savedRaw.length>B.MAX_CHARS)throw Error('保存的数据过大');saved=B.records(JSON.parse(savedRaw));addRecords(saved);}}
    catch(e){storageBlocked=true;storageProblem=e.message;notice('已保存的导入记录无法读取；不会覆盖原数据。可先导出其他记录，或使用底部清除按钮。'+e.message,true);}
  }
  function persist(record){persistBatch([record]);}
  function persistBatch(incoming){
    if(storageBlocked)throw Error('本页保存区暂不可写，请先处理底部的损坏记录提示。');
    for(const r of incoming){const old=records.find(x=>x.id===r.id);if(old&&!same(old,r))throw Error('相同编号已有不同内容：'+r.id+'。未覆盖原记录。');}
    const next=B.merge(saved,incoming);
    if(localStorage.getItem(KEY)!==savedRaw)throw Error('另一页面改变了保存记录，请刷新后重试，避免覆盖。');
    const value=JSON.stringify(next);if(value.length>4000000)throw Error('导入记录总量过大，请先导出备份。');
    localStorage.setItem(KEY,value);saved=next;savedRaw=value;storageInfo();
  }
  function fillSelectors(){
    const label=r=>r.date+' · '+r.version+' · '+r.title+'（'+r.reviewer+'）';
    const el=$('record-select');el.replaceChildren(...records.map(r=>option(r.id,label(r))));el.disabled=!records.length;el.value=selected;
    const c=current(),choices=c?records.filter(r=>r.projectId===c.projectId&&r.id!==c.id&&r.date<=c.date):[];
    if(baseline===null || (baseline!==''&&!choices.some(r=>r.id===baseline)))baseline=choices.at(-1)?.id||'';
    $('baseline-select').replaceChildren(option('','不比较'),...choices.map(r=>option(r.id,r.date+' · '+r.version+'（'+r.reviewer+'）')));$('baseline-select').value=baseline;
  }
  function render(){
    storageInfo();
    fileCheckNodes.clear();
    fillSelectors();const c=current();$('result').hidden=!c;$('empty').hidden=!!c;
    for(const id of ['new-round','export-report','export-review','export-dataset'])$(id).disabled=!c;
    if(!c)return;
    const assessed=R.assess(c);
    $('review-date').textContent=c.date+' · '+c.version;$('review-title').textContent=c.title;$('review-scope').textContent=c.scope;$('verdict').textContent=assessed.status;
    $('review-origin').textContent='审阅方式：'+c.reviewer+'。用量与耗时未记录，不参与低成本排名。';
    $('metrics').replaceChildren(...Object.entries(assessed.counts).map(([status,count])=>{const box=node('div',undefined,'metric '+status);box.append(node('strong',String(count)),node('span',R.statuses[status]));return box;}));
    $('next-actions').replaceChildren(...assessed.next.map((r,i)=>{const n=node('article',undefined,'next-card');n.append(node('span',(i+1)+' · '+(r.next.priority==='now'?'优先处理':r.next.priority==='next'?'随后验证':'条件具备后开展'),'pill'),node('h3',r.next.action),node('p','负责角色：'+r.next.owner),node('p',r.next.method),node('p','完成证据：'+r.next.doneWhen,'done'));return n;}));
    if(!assessed.next.length)$('next-actions').append(node('p','清单没有待补项。仍需人工确认原始记录和每项结论，页面不会自动批准上线。'));
    const query=$('review-search').value.trim().toLowerCase(),filter=$('status-filter').value;
    const visible=assessed.rows.filter(r=>(filter==='all'||r.status===filter)&&(!query||(r.label+' '+r.summary+' '+r.next.action).toLowerCase().includes(query)));
    $('filter-count').textContent='显示 '+visible.length+' / '+assessed.rows.length+' 项';
    $('criteria').replaceChildren(...visible.map(r=>{
      const d=node('details',undefined,'criteria-card'),s=node('summary');s.append(node('span',r.label),node('span',R.statuses[r.status],'pill '+r.status));d.append(s,node('p',r.summary),node('p',(r.required?'必需项':'补充项')+' · 接受 '+r.kinds.map(k=>R.kinds[k]).join(' / ')+' · '+(r.versionPolicy==='current'?'需要当前版本证据':'允许跨版本材料'),'fine'));
      if(r.issues.length)d.append(node('p','暂不采纳原判断：'+r.issues.join('；'),'problem'));
      if(!r.refs.length)d.append(node('p','尚无引用。补齐对应类型的实际证据后，再重新审阅。','fine'));
      const sources=new Map();
      for(const ref of r.refs){const id=ref.evidence.id;if(!sources.has(id))sources.set(id,[]);sources.get(id).push(ref);}
      for(const refs of sources.values()){
        const box=node('div',undefined,'source'),e=refs[0].evidence;
        box.append(node('strong',e.title),node('p',R.kinds[e.kind]+' · '+e.date+' · '+e.version),node('p','来源位置：'+e.locator));
        for(const ref of refs){box.append(node('blockquote',ref.quote));if(!ref.valid)box.append(node('p',ref.issues.join('；'),'problem'));}
        if(e.sha256){
          const key=JSON.stringify([c.id,e.id,e.sha256]),button=node('button','选择原文件核对 · '+e.title,'quiet'),status=node('p',undefined,'fine');
          button.type='button';status.setAttribute('role','status');
          button.addEventListener('click',()=>{requestedFileCheck={key,expected:e.sha256};$('evidence-file').click();});
          fileCheckNodes.set(key,[...(fileCheckNodes.get(key)||[]),status]);showFileCheck(key);
          box.append(node('p','原文件 SHA-256（提交者预留）'),node('code',e.sha256),button,status);
        }
        d.append(box);
      }
      return d;
    }));
    if(!visible.length)$('criteria').append(node('p','没有符合筛选条件的项目。'));
    $('limitations').replaceChildren(...c.limitations.map(l=>node('li',l)));
    const comp=$('comparison');comp.replaceChildren();
    if(!baseline){comp.append(node('p','导入同一项目较早的记录后，可以在这里对照变化。'));return;}
    const changes=R.compare(records.find(r=>r.id===baseline),c);comp.append(node('p',changes.warning,'fine'));
    const wrap=node('div',undefined,'table-wrap'),table=node('table'),head=node('thead'),hr=node('tr');
    for(const label of ['检查项','上次','本次','变化']){const th=node('th',label);th.scope='col';hr.append(th);}head.append(hr);const body=node('tbody');
    for(const row of changes.rows){const tr=node('tr');for(const value of [row.label,R.statuses[row.before]||'—',R.statuses[row.after]||'—',row.change])tr.append(node('td',value));body.append(tr);}table.append(head,body);wrap.append(table);comp.append(wrap);
  }
  async function load(){
    const generation=++selectionEpoch;
    $('load-local').disabled=true;
    const localNotice=(message,error=false)=>{if(generation===selectionEpoch)notice(message+(storageBlocked?' 浏览器保存区无法读取，原数据已保留：'+storageProblem:''),error||storageBlocked);};
    try{
      const response=await fetch('/api/project-review',{cache:'no-store'});
      if(response.status===404){if(!selected)selected=records.at(-1)?.id||'';render();localNotice('本机没有附带案例。可以查看已保存的检查、新建项目，或导入检查数据及备份。');return;}
      if(!response.ok){let message='读取失败';try{message=(await response.json()).error||message;}catch{}throw Error(message);}
      const data=await response.json();addRecords([...(data.baseline?[data.baseline]:[]),data.current]);
      if(generation===selectionEpoch){selected=data.current.id;baseline=data.baseline?.id||'';localNotice('已读取本机保存的审阅结果。没有发起模型调用或设备测试。');}render();
    }catch(e){if(!selected)selected=records.at(-1)?.id||'';render();localNotice(e.message+'。当前可读记录仍可查看；请检查本机服务或原文件。',true);}finally{$('load-local').disabled=false;}
  }
  $('load-local').addEventListener('click',load);
  $('evidence-file').addEventListener('change',async event=>{
    const file=event.target.files[0],request=requestedFileCheck;event.target.value='';requestedFileCheck=null;
    if(!file||!request)return;
    const {key,expected}=request,epoch=(fileCheckEpochs.get(key)||0)+1;fileCheckEpochs.set(key,epoch);
    const update=message=>{if(fileCheckEpochs.get(key)===epoch){fileChecks.set(key,message);showFileCheck(key);}};
    update('正在本机核对所选文件……');
    try{
      const F=window.EvidenceFileCheck;if(!F)throw Error('校验模块未加载，请刷新重试。');
      if(file.size>F.MAX_BYTES)throw Error('文件超过20MiB，未进行核对。');
      const bytes=await file.arrayBuffer();if(fileCheckEpochs.get(key)!==epoch)return;
      const result=await F.compare(expected,bytes);
      update((result.status==='match'?'校验值一致':'校验值不一致')+' · '+file.name+' · '+result.bytes+' 字节。'+(result.status==='mismatch'?'所选文件 SHA-256：'+result.actual+'。':'')+result.limitation+' 本次核对仅在当前页面保留，不改变检查结论或导出记录。');
    }catch(e){update('核对未完成：'+e.message+' 本项原文件仍未核实。');}
  });
  $('record-select').addEventListener('change',()=>{selectionEpoch++;selected=$('record-select').value;render();});
  $('baseline-select').addEventListener('change',()=>{baseline=$('baseline-select').value;render();});
  $('status-filter').addEventListener('change',render);$('review-search').addEventListener('input',render);
  $('import-review').addEventListener('click',()=>$('review-file').click());
  $('review-file').addEventListener('change',async event=>{
    const file=event.target.files[0];event.target.value='';if(!file)return;const generation=++selectionEpoch;
    try{if(file.size>2000000)throw Error('文件超过2MB');const text=await file.text();if(generation!==selectionEpoch)return;const record=R.validate(JSON.parse(text));const existing=records.find(r=>r.id===record.id);if(existing&&!same(existing,record))throw Error('相同编号已有不同内容，请给修订记录设置新编号。');persist(record);addRecords([record]);selected=record.id;render();notice('导入成功，已保存在当前浏览器。内容来自导入者，未独立验证原始记录。');}catch(e){if(generation===selectionEpoch)notice('导入未完成：'+e.message,true);}
  });
  $('export-report').addEventListener('click',()=>download(current().id+'.md',R.markdown(current()),'text/markdown;charset=utf-8'));
  $('export-review').addEventListener('click',()=>download(current().id+'.json',JSON.stringify(current(),null,2),'application/json'));
  $('export-dataset').addEventListener('click',()=>download(current().id+'-验收导入.json',JSON.stringify(R.toDataset(current()),null,2),'application/json'));
  $('export-backup').addEventListener('click',()=>{try{
    if(storageBlocked||!saved.length)throw Error('没有可完整备份的已保存记录。');
    if(localStorage.getItem(KEY)!==savedRaw)throw Error('另一页面改变了保存记录，请刷新后备份。');
    const backup=B.create(saved);download('项目检查备份-'+backup.exportedAt.replace(/[:.]/g,'-')+'.json',JSON.stringify(backup),'application/json');
    notice('已生成 '+saved.length+' 份已保存检查的备份下载。请确认文件下载完成并妥善保存；未上传资料。');
  }catch(e){notice('备份未完成：'+e.message,true);}});
  $('import-backup').addEventListener('click',()=>$('backup-file').click());
  $('backup-file').addEventListener('change',async event=>{
    const file=event.target.files[0];event.target.value='';if(!file)return;const generation=++selectionEpoch;
    try{
      if(file.size>B.MAX_FILE_BYTES)throw Error('备份文件超过13MB。');
      const text=await file.text();if(generation!==selectionEpoch)return;
      const backup=B.parse(text),before=saved.length;persistBatch(backup.records);addRecords(backup.records);
      if(!selected&&backup.records.length)selected=backup.records.at(-1).id;
      render();notice('备份恢复完成：新增 '+(saved.length-before)+' 份，已有相同记录 '+(backup.records.length-(saved.length-before))+' 份。原记录保留，未独立验证材料真实性。');
    }catch(e){if(generation===selectionEpoch)notice('备份未恢复：'+e.message+' 原保存区未改动。',true);}
  });
  let draft=null,editedId='',draftBase=null;
  const sourceInputs=['title','date','version','locator','text','quote','sha256'];
  function showCriterion(){
    const c=draft.criteria.find(c=>c.id===editedId);
    $('edit-status').value=c.status;$('edit-summary').value=c.summary;
    $('edit-requirements').textContent='本项接受 '+c.kinds.map(k=>R.kinds[k]).join(' / ')+'；'+(c.versionPolicy==='current'?'要求与本轮版本一致':'允许跨版本材料')+'。现有引用 '+c.refs.length+' 条。';
    for(const [field,key] of [['action','action'],['owner','owner'],['method','method'],['done','doneWhen'],['priority','priority']])$('edit-next-'+field).value=c.next[key];
    sourceInputs.forEach(k=>$('edit-source-'+k).value='');$('edit-source-kind').value=c.kinds[0];$('edit-source-box').open=false;
  }
  function commitCriterion(){
    syncVersion();
    const c=draft.criteria.find(c=>c.id===editedId),updated=structuredClone(c);
    updated.status=$('edit-status').value;updated.summary=$('edit-summary').value;
    for(const [field,key] of [['action','action'],['owner','owner'],['method','method'],['done','doneWhen'],['priority','priority']])updated.next[key]=$('edit-next-'+field).value;
    const newEvidence=sourceInputs.some(k=>$('edit-source-'+k).value.trim());
    let added;
    if(newEvidence){
      added={id:'source-'+crypto.randomUUID(),title:$('edit-source-title').value,kind:$('edit-source-kind').value,date:$('edit-source-date').value,version:$('edit-source-version').value,locator:$('edit-source-locator').value,text:$('edit-source-text').value};
      const sha=$('edit-source-sha256').value.trim().toLowerCase();if(sha){if(!/^[a-f0-9]{64}$/.test(sha))throw Error('原文件校验值应为64位十六进制字符；没有已有校验值时可留空。');added.sha256=sha;}
      const quote=$('edit-source-quote').value;
      if(!quote.trim()||!added.text.includes(quote))throw Error('支持本项的原句必须完整出现在原文节选中。');
      updated.refs=[{evidenceId:added.id,quote}];
    }
    const candidate={...draft,date:$('edit-date').value,version:$('edit-version').value,reviewer:$('edit-reviewer').value,scope:$('edit-scope').value,
      evidence:added?[...draft.evidence,added]:draft.evidence,criteria:draft.criteria.map(x=>x.id===editedId?updated:x)};
    const clean=R.validate(candidate),row=R.assess(clean).rows.find(x=>x.id===editedId);
    if(updated.status!=='unknown'&&row.downgraded)throw Error('本项还不能保存为已判定：'+row.issues.join('；')+'。请补正确证据，或改为“证据待补”。');
    draft=clean;
    sourceInputs.forEach(k=>$('edit-source-'+k).value='');
  }
  $('new-round').addEventListener('click',()=>{
    selectionEpoch++;
    draftBase=current();draft=R.newRound(draftBase,{id:'review-'+crypto.randomUUID(),date:new Date().toLocaleDateString('sv-SE')});editedId=draft.criteria[0].id;
    $('edit-date').value=draft.date;$('edit-version').value=draft.version;$('edit-reviewer').value='';$('edit-scope').value='';
    $('edit-criterion').replaceChildren(...draft.criteria.map(c=>option(c.id,c.label)));$('edit-criterion').value=editedId;
    $('editor-notice').textContent='请先填写本轮日期、版本、实际审阅方式和检查范围，再逐项更新。';showCriterion();$('editor').showModal();
  });
  $('editor-close').addEventListener('click',()=>$('editor').close());
  $('edit-criterion').addEventListener('change',()=>{const next=$('edit-criterion').value;try{commitCriterion();editedId=next;showCriterion();$('editor-notice').textContent='上一项已暂存到草稿，尚未写入浏览器。';}catch(e){$('edit-criterion').value=editedId;$('editor-notice').textContent=e.message;}});
  function syncVersion(){if(!draft||draft.version===$('edit-version').value)return;draft.criteria.forEach(c=>{if(c.versionPolicy==='current')c.status='unknown';});draft.version=$('edit-version').value;if(draft.criteria.find(c=>c.id===editedId).versionPolicy==='current')$('edit-status').value='unknown';$('editor-notice').textContent='版本已改变。需要当前版本证据的项目已退回待补；旧来源仍保留供参考，请逐项更新。';}
  $('edit-version').addEventListener('input',syncVersion);
  $('edit-version').addEventListener('change',syncVersion);
  $('editor-save').addEventListener('click',()=>{try{
    commitCriterion();if(draft.date<draftBase.date)throw Error('新一轮日期不能早于原检查记录。');
    const referenced=new Set(draft.criteria.flatMap(c=>c.refs.map(r=>r.evidenceId)));
    draft.evidence=draft.evidence.filter(e=>referenced.has(e.id));draft=R.validate(draft);
    persist(draft);selectionEpoch++;addRecords([draft]);selected=draft.id;baseline=draftBase.id;$('editor').close();render();notice('新一轮记录已保存到当前浏览器，旧记录保留。请导出检查数据留作备份。');
  }catch(e){$('editor-notice').textContent='没有保存：'+e.message;}});
  let goalRows=[],goalCounter=0;
  function goalCount(){
    $('builder-count').textContent=goalRows.length+' / 20项';$('builder-add').disabled=goalRows.length>=20;
    goalRows.forEach(row=>row.remove.disabled=goalRows.length<=1);
  }
  function addGoal(){
    if(goalRows.length>=20)return;const n=++goalCounter,box=node('fieldset'),legend=node('legend','检查项 '+n),grid=node('div',undefined,'edit-grid'),fields={};
    function input(key,label,tag='input',max=200){const lab=node('label',label+' · 第'+n+'项'),el=node(tag);el.id='new-goal-'+n+'-'+key;if(tag==='textarea'){el.rows=2;el.maxLength=max;}else if(tag==='input')el.maxLength=max;lab.append(el);grid.append(lab);fields[key]=el;return el;}
    input('label','希望做到什么').placeholder='例如：提交招领信息后能在列表中找到';
    const kind=input('kind','需要哪类证据','select');Object.entries(R.kinds).forEach(([value,label])=>kind.append(option(value,label)));kind.value='desktop';
    const version=input('versionPolicy','证据的版本要求','select');version.append(option('current','需要当前版本证据'),option('any','允许跨版本材料'));
    const required=input('required','是否必须做到','select');required.append(option('true','必需项'),option('false','补充项'));
    input('method','准备怎么验证','textarea',1500);input('doneWhen','要留下什么结果才能判断','textarea',1500);
    const remove=node('button','移除第'+n+'项');remove.type='button';const row={box,fields,remove};remove.addEventListener('click',()=>{if(goalRows.length<=1)return;goalRows=goalRows.filter(r=>r!==row);box.remove();goalCount();});
    box.append(legend,grid,remove);$('builder-goals').append(box);goalRows.push(row);goalCount();
  }
  $('create-project').addEventListener('click',()=>{
    selectionEpoch++;
    for(const id of ['name','version','reviewer','scope','owner'])$('builder-'+id).value='';
    $('builder-date').value=new Date().toLocaleDateString('sv-SE');$('builder-limitations').value='尚未取得检查证据；建立清单不等于验收通过。';
    goalRows=[];goalCounter=0;$('builder-goals').replaceChildren();addGoal();$('builder-notice').textContent='先填写项目和具体检查项。关闭窗口不保存未提交内容。';$('project-builder').showModal();
  });
  $('builder-add').addEventListener('click',addGoal);$('builder-close').addEventListener('click',()=>$('project-builder').close());
  $('builder-save').addEventListener('click',()=>{try{
    const record=R.createProject({id:'review-'+crypto.randomUUID(),projectId:'project-'+crypto.randomUUID(),title:$('builder-name').value,date:$('builder-date').value,version:$('builder-version').value,reviewer:$('builder-reviewer').value,scope:$('builder-scope').value,owner:$('builder-owner').value,limitations:$('builder-limitations').value.split(/\r?\n/).map(v=>v.trim()).filter(Boolean),goals:goalRows.map(({fields:f})=>({label:f.label.value,kind:f.kind.value,required:f.required.value==='true',versionPolicy:f.versionPolicy.value,method:f.method.value,doneWhen:f.doneWhen.value}))});
    persist(record);addRecords([record]);selectionEpoch++;selected=record.id;baseline='';$('status-filter').value='all';$('review-search').value='';$('project-builder').close();render();notice('新项目清单已保存，所有检查项均为证据待补。请导出检查数据备份，取得实际记录后再新增一轮检查。');
  }catch(e){$('builder-notice').textContent='没有建立清单：'+e.message;}});
  $('clear-saved').addEventListener('click',()=>{if(!confirm('只清除本页在浏览器保存的导入记录。请先导出需要保留的数据；不会删除电脑源文件。'))return;try{if(localStorage.getItem(KEY)!==savedRaw)throw Error('另一页面改变了保存记录，请刷新后再决定是否清除。');localStorage.removeItem(KEY);selectionEpoch++;saved=[];savedRaw=null;storageBlocked=false;storageInfo();notice('浏览器保存区已清除。当前已打开的记录仍可查看和导出，刷新后不再恢复。');}catch(e){notice('清除失败：'+e.message,true);}});
  $('template').addEventListener('click',()=>{
    const date=new Date().toLocaleDateString('sv-SE');
    const template={schema:'project-review-v1',id:'my-review-001',projectId:'my-project',title:'待填写的项目名称',date,version:'待填写版本',scope:'填写本次真正检查的范围',reviewer:'填写实际审阅人或方式',limitations:['空白模板，没有真实检查结果'],evidence:[],criteria:[{id:'goal-1',label:'填写可观察的目标',required:true,kinds:['device'],versionPolicy:'current',status:'unknown',summary:'尚未取得证据',refs:[],next:{action:'填写下一步动作',owner:'填写负责角色',method:'填写测试方法',doneWhen:'填写完成所需证据',priority:'now'}}]};download('项目检查空白模板.json',JSON.stringify(template,null,2),'application/json');
  });
  restore();load();
})();
