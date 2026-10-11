'use strict';
(() => {
  const R=window.ProjectReview,$=id=>document.getElementById(id),KEY='acl-project-reviews-v1';
  let records=[],selected='',baseline=null,saved=[],savedRaw=null,storageBlocked=false;
  function node(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
  function notice(message,error=false){$('notice').textContent=message;$('notice').classList.toggle('error',error);}
  function option(value,label){const el=node('option',label);el.value=value;return el;}
  function current(){return records.find(r=>r.id===selected);}
  function download(name,text,type){const url=URL.createObjectURL(new Blob([text],{type}));const a=node('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}
  function addRecords(incoming){
    const next=[...records];
    for(const raw of incoming){const r=R.validate(raw),existing=next.find(x=>x.id===r.id);if(existing&&!same(existing,r))throw Error('编号 '+r.id+' 已存在且内容不同。请保留旧记录，为修订记录使用新的编号。');if(!existing)next.push(r);}
    records=next;
  }
  function restore(){
    try{savedRaw=localStorage.getItem(KEY);if(savedRaw!==null){if(savedRaw.length>4000000)throw Error('保存的数据过大');const parsed=JSON.parse(savedRaw);if(!Array.isArray(parsed)||parsed.length>10)throw Error('保存格式错误');saved=parsed.map(R.validate);addRecords(saved);}}
    catch(e){storageBlocked=true;notice('已保存的导入记录无法读取；不会覆盖原数据。可先导出其他记录，或使用底部清除按钮。'+e.message,true);}
  }
  function persist(record){
    if(storageBlocked)throw Error('本页保存区暂不可写，请先处理底部的损坏记录提示。');
    const next=saved.some(r=>r.id===record.id)?saved:[...saved,record];
    if(next.length>10)throw Error('已保存10份导入记录。请先导出备份，再清除本页保存区。');
    if(localStorage.getItem(KEY)!==savedRaw)throw Error('另一页面改变了保存记录，请刷新后重试，避免覆盖。');
    const value=JSON.stringify(next);if(value.length>4000000)throw Error('导入记录总量过大，请先导出备份。');
    localStorage.setItem(KEY,value);saved=next;savedRaw=value;
  }
  function fillSelectors(){
    const label=r=>r.date+' · '+r.version+' · '+r.title+'（'+r.reviewer+'）';
    const el=$('record-select');el.replaceChildren(...records.map(r=>option(r.id,label(r))));el.disabled=!records.length;el.value=selected;
    const c=current(),choices=c?records.filter(r=>r.projectId===c.projectId&&r.id!==c.id&&r.date<=c.date):[];
    if(baseline===null || (baseline!==''&&!choices.some(r=>r.id===baseline)))baseline=choices.at(-1)?.id||'';
    $('baseline-select').replaceChildren(option('','不比较'),...choices.map(r=>option(r.id,r.date+' · '+r.version+'（'+r.reviewer+'）')));$('baseline-select').value=baseline;
  }
  function render(){
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
      for(const ref of r.refs){const box=node('div',undefined,'source'),e=ref.evidence;box.append(node('strong',e.title),node('p',R.kinds[e.kind]+' · '+e.date+' · '+e.version),node('p','来源位置：'+e.locator),node('blockquote',ref.quote));if(e.sha256)box.append(node('p','原文件 SHA-256（提交者提供，网页未重新读取原文件）'),node('code',e.sha256));if(!ref.valid)box.append(node('p',ref.issues.join('；'),'problem'));d.append(box);}
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
    $('load-local').disabled=true;
    try{const response=await fetch('/api/project-review',{cache:'no-store'});if(!response.ok){let message='读取失败';try{message=(await response.json()).error||message;}catch{}throw Error(message);}const data=await response.json();addRecords([...(data.baseline?[data.baseline]:[]),data.current]);selected=data.current.id;baseline=data.baseline?.id||'';render();notice('已读取本机保存的审阅结果。没有发起模型调用或设备测试。'+(storageBlocked?' 导入保存区不可写，需单独处理。':''));}
    catch(e){if(!selected)selected=records.at(-1)?.id||'';render();notice(e.message+'。可导入已导出的检查数据。',true);}finally{$('load-local').disabled=false;}
  }
  $('load-local').addEventListener('click',load);
  $('record-select').addEventListener('change',()=>{selected=$('record-select').value;render();});
  $('baseline-select').addEventListener('change',()=>{baseline=$('baseline-select').value;render();});
  $('status-filter').addEventListener('change',render);$('review-search').addEventListener('input',render);
  $('import-review').addEventListener('click',()=>$('review-file').click());
  $('review-file').addEventListener('change',async event=>{
    const file=event.target.files[0];event.target.value='';if(!file)return;
    try{if(file.size>2000000)throw Error('文件超过2MB');const record=R.validate(JSON.parse(await file.text()));const existing=records.find(r=>r.id===record.id);if(existing&&!same(existing,record))throw Error('相同编号已有不同内容，请给修订记录设置新编号。');persist(record);addRecords([record]);selected=record.id;render();notice('导入成功，已保存在当前浏览器。内容来自导入者，未独立验证原始记录。');}catch(e){notice('导入未完成：'+e.message,true);}
  });
  $('export-report').addEventListener('click',()=>download(current().id+'.md',R.markdown(current()),'text/markdown;charset=utf-8'));
  $('export-review').addEventListener('click',()=>download(current().id+'.json',JSON.stringify(current(),null,2),'application/json'));
  $('export-dataset').addEventListener('click',()=>download(current().id+'-验收导入.json',JSON.stringify(R.toDataset(current()),null,2),'application/json'));
  let draft=null,editedId='';
  const sourceInputs=['title','date','version','locator','text','quote'];
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
    draft=R.newRound(current(),{id:'review-'+crypto.randomUUID(),date:new Date().toLocaleDateString('sv-SE')});editedId=draft.criteria[0].id;
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
    commitCriterion();if(draft.date<current().date)throw Error('新一轮日期不能早于原检查记录。');
    const referenced=new Set(draft.criteria.flatMap(c=>c.refs.map(r=>r.evidenceId)));
    draft.evidence=draft.evidence.filter(e=>referenced.has(e.id));draft=R.validate(draft);
    persist(draft);const previous=selected;addRecords([draft]);selected=draft.id;baseline=previous;$('editor').close();render();notice('新一轮记录已保存到当前浏览器，旧记录保留。请导出检查数据留作备份。');
  }catch(e){$('editor-notice').textContent='没有保存：'+e.message;}});
  $('clear-saved').addEventListener('click',()=>{if(!confirm('只清除本页在浏览器保存的导入记录。请先导出需要保留的数据；不会删除电脑源文件。'))return;try{localStorage.removeItem(KEY);saved=[];savedRaw=null;storageBlocked=false;notice('浏览器保存区已清除。当前已打开的记录仍可查看和导出，刷新后不再恢复。');}catch(e){notice('清除失败：'+e.message,true);}});
  $('template').addEventListener('click',()=>{
    const date=new Date().toLocaleDateString('sv-SE');
    const template={schema:'project-review-v1',id:'my-review-001',projectId:'my-project',title:'待填写的项目名称',date,version:'待填写版本',scope:'填写本次真正检查的范围',reviewer:'填写实际审阅人或方式',limitations:['空白模板，没有真实检查结果'],evidence:[],criteria:[{id:'goal-1',label:'填写可观察的目标',required:true,kinds:['device'],versionPolicy:'current',status:'unknown',summary:'尚未取得证据',refs:[],next:{action:'填写下一步动作',owner:'填写负责角色',method:'填写测试方法',doneWhen:'填写完成所需证据',priority:'now'}}]};download('项目检查空白模板.json',JSON.stringify(template,null,2),'application/json');
  });
  restore();load();
})();
