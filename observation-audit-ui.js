'use strict';
(()=>{
  const A=window.ObservationAudit,P=window.ObservationPlan,$=id=>document.getElementById(id),KEY='acl-observation-plans-v1';
  let result=null,csvText=null,csvName='',plans=[],activeId='',savedRaw=null,blocked=false,csvGeneration=0,planGeneration=0;
  const node=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
  const active=()=>plans.find(e=>e.plan.id===activeId);
  const notice=text=>{$('observation-notice').textContent=text;};
  function download(name,text,type){const url=URL.createObjectURL(new Blob([text],{type})),a=node('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function exportPlan(){const e=active();if(e)download(e.plan.id+'.json',JSON.stringify(e,null,2),'application/json');}
  function planOptions(){
    const select=$('observation-plan-select');select.replaceChildren(new Option('未选择独立计划',''));
    for(const e of plans)select.add(new Option(e.plan.title+' · '+e.plan.context.softwareVersion+' · '+e.plan.createdAt,e.plan.id));
    select.value=activeId;const e=active();$('plan-export').disabled=!e;
    $('observation-template').textContent=e?'下载当前计划的空表':'下载未绑定计划的空表';
    $('observation-plan-status').textContent=e?'原定 '+e.plan.rounds.length+' 轮；主要指标：'+e.plan.primaryMeasure+'。固定任务：'+e.plan.task+'。内容校验值：'+e.sha256:'未选计划时只能检查提交的行，不能确认是否遗漏原定轮次。';
  }
  function save(envelope){
    if(blocked)throw Error('浏览器中已有计划无法读取，原内容已保留。请先导出或备份浏览器资料后处理');
    const existing=plans.find(e=>e.plan.id===envelope.plan.id);
    if(existing&&existing.sha256!==envelope.sha256)throw Error('同一计划编号已有不同内容。改变条件后应使用新计划编号');
    const next=existing?plans:[...plans,envelope],text=JSON.stringify(next);
    if(next.length>10||text.length>500000)throw Error('浏览器最多保存10份计划、合计50万字符');
    if(localStorage.getItem(KEY)!==savedRaw)throw Error('另一页面已改变计划，请刷新后重试，避免覆盖');
    localStorage.setItem(KEY,text);savedRaw=text;plans=next;activeId=envelope.plan.id;planOptions();render();
  }
  function table(headers,rows){const t=node('table'),h=node('thead'),hr=node('tr');headers.forEach(v=>{const th=node('th',v);th.scope='col';hr.append(th);});h.append(hr);t.append(h);const b=node('tbody');rows.forEach(values=>{const tr=node('tr');values.forEach(v=>tr.append(node('td',String(v))));b.append(tr);});t.append(b);const wrap=node('div');wrap.className='table-wrap';wrap.append(t);return wrap;}
  function render(){
    if(csvText===null)return;
    try{
      result=A.auditCsv(csvText,{plan:active()?.plan});const pc=result.planCheck,box=$('observation-results');
      box.replaceChildren(node('h3',result.conclusion),node('p','提交 '+result.total+' 轮 · 未记录 '+result.unrecorded+' 轮 · 可汇总广告计数 '+result.measured+' 轮'));
      if(pc.status==='not_provided')box.append(node('p','没有独立计划：无法判断表中是否删掉了原定轮次。'));
      else{
        box.append(node('p','原定 '+pc.plannedTotal+' 轮 · 缺失 '+pc.missing.length+' 轮 · 额外 '+pc.extra.length+' 轮 · 条件改变 '+pc.changed.length+' 轮。主要指标：'+pc.primaryMeasure));
        const list=node('ul');if(pc.missing.length)list.append(node('li','缺失轮次：'+pc.missing.join('、')+'。请核对，不能自动算通过或失败。'));
        if(pc.extra.length)list.append(node('li','额外轮次：'+pc.extra.join('、')+'。不能悄悄纳入原定样本。'));
        pc.changed.forEach(r=>list.append(node('li','第'+r.number+'轮：'+r.issues.join('；'))));if(pc.orderChanged)list.append(node('li','提交顺序与原计划不同'));box.append(list,node('p',pc.limitation));
      }
      if(result.reasons.length){const ul=node('ul');result.reasons.forEach(r=>ul.append(node('li',r)));box.append(ul);}
      box.append(table(['条件','表内计划 / 已记录','有效广告计数轮次','任务完成 / 失败 / 未知','错误页 / 情况未知'],['A','B'].map(mode=>{const g=result.groups[mode];return [mode==='A'?'A · 关闭':'B · 开启',g.planned+' / '+g.recorded,g.measured,g.recorded?g.tasksComplete+' / '+g.tasksFailed+' / '+g.tasksUnknown:'尚未记录',g.recorded?g.anomaly+' / '+g.anomalyUnknown:'未知'];})));
      box.append(node('p','以下计数仅汇总条件已核实且完整观察的轮次。请同时看有效轮次和任务失败情况，不据此计算总体减少率。'));
      box.append(table(['广告分类','A组计数','B组计数'],A.adColumns.map(k=>[k,result.groups.A.ads[k]??'未知',result.groups.B.ads[k]??'未知'])));
      if(result.unassigned.recorded){const g=result.unassigned;box.append(node('p','另有 '+g.recorded+' 轮实际条件未知或属于放行，未纳入A/B广告汇总；其中任务失败 '+g.tasksFailed+' 轮、任务结果未知 '+g.tasksUnknown+' 轮、错误页 '+g.anomaly+' 轮、页面情况未知 '+g.anomalyUnknown+' 轮。'))}
      const details=node('details'),list=node('ul');details.append(node('summary','查看每轮缺项与异常'));result.rows.forEach(r=>list.append(node('li','第'+r.number+'轮：'+(r.warnings.join('；')||'所需字段齐备'))));details.append(list);box.append(details);
      notice('已在浏览器本地读取 '+csvName+'。未上传，也未将结果改写为项目通过。');$('observation-export').disabled=false;
    }catch(e){result=null;$('observation-results').replaceChildren();$('observation-export').disabled=true;notice('未完成检查：'+e.message);}
  }
  $('observation-template').addEventListener('click',()=>{const e=active();download(e?e.plan.id+'-观察空表.csv':'正式广告观察空表.csv',e?A.templateForPlan(e.plan):A.template(),'text/csv;charset=utf-8');});
  $('observation-import').addEventListener('click',()=>$('observation-file').click());
  $('observation-file').addEventListener('change',async event=>{
    const file=event.target.files[0];event.target.value='';if(!file)return;const generation=++csvGeneration;
    try{if(file.size>2000000)throw Error('文件超过2MB');const text=await file.text();if(generation!==csvGeneration)return;csvText=text;csvName=file.name;render();}
    catch(e){if(generation!==csvGeneration)return;csvText=null;result=null;$('observation-results').replaceChildren();$('observation-export').disabled=true;notice('未完成检查：'+e.message);}
  });
  $('observation-export').addEventListener('click',()=>{if(result)download('广告观察表检查.md',A.markdown(result),'text/markdown;charset=utf-8');});
  $('observation-plan-select').addEventListener('change',event=>{planGeneration++;activeId=event.target.value;planOptions();render();});
  $('plan-export').addEventListener('click',exportPlan);
  $('plan-create').addEventListener('click',async()=>{
    const generation=++planGeneration;$('plan-create').disabled=true;
    try{
      const context={softwareVersion:$('plan-software').value,targetAppVersion:$('plan-app').value,deviceAlias:$('plan-device').value,network:$('plan-network').value,taskId:$('plan-task-id').value};
      const envelope=await P.seal({schema:'observation-plan-v1',id:'plan-'+crypto.randomUUID(),title:$('plan-title').value,createdAt:new Date().toISOString(),context,task:$('plan-task').value,primaryMeasure:$('plan-measure').value,durationSeconds:Number($('plan-duration').value),rounds:[...'ABBABAAB'].map((condition,i)=>({number:i+1,condition}))});
      if(generation!==planGeneration)return;save(envelope);exportPlan();notice('计划已保存并导出。请下载对应空表；这一步没有产生实际观察结果。');
    }catch(e){if(generation===planGeneration)notice('计划未保存：'+e.message);}finally{$('plan-create').disabled=false;}
  });
  $('plan-import').addEventListener('click',()=>$('plan-file').click());
  $('plan-file').addEventListener('change',async event=>{
    const file=event.target.files[0];event.target.value='';if(!file)return;const generation=++planGeneration;
    try{if(file.size>500000)throw Error('计划文件超过500KB');const envelope=await P.verify(JSON.parse(await file.text()));if(generation!==planGeneration)return;save(envelope);notice('计划内容校验通过并已导入。校验不证明实际记录或建立时间真实。');}
    catch(e){if(generation===planGeneration)notice('计划未导入，当前计划保持不变：'+e.message);}
  });
  (async()=>{
    $('plan-create').disabled=true;$('plan-import').disabled=true;
    try{savedRaw=localStorage.getItem(KEY);if(savedRaw!==null){if(savedRaw.length>500000)throw Error('保存的计划超出上限');const parsed=JSON.parse(savedRaw);if(!Array.isArray(parsed)||parsed.length>10)throw Error('计划列表格式无效');plans=await Promise.all(parsed.map(P.verify));if(new Set(plans.map(e=>e.plan.id)).size!==plans.length)throw Error('计划编号重复');}planOptions();}
    catch(e){plans=[];blocked=true;notice('已有计划未能载入，原内容已保留：'+e.message);}
    finally{$('plan-create').disabled=false;$('plan-import').disabled=false;}
  })();
})();
