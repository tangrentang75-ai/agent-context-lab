'use strict';
(()=>{
  const A=window.ObservationAudit,$=id=>document.getElementById(id);let result=null;
  const node=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
  function download(name,text,type){const url=URL.createObjectURL(new Blob([text],{type})),a=node('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  $('observation-template').addEventListener('click',()=>download('正式广告观察空表.csv',A.template(),'text/csv;charset=utf-8'));
  $('observation-import').addEventListener('click',()=>$('observation-file').click());
  $('observation-file').addEventListener('change',async event=>{
    const file=event.target.files[0];event.target.value='';if(!file)return;
    try{
      if(file.size>2000000)throw Error('文件超过2MB');result=A.auditCsv(await file.text());
      const box=$('observation-results');box.replaceChildren(node('h3',result.conclusion),node('p','计划 '+result.total+' 轮 · 未记录 '+result.unrecorded+' 轮 · 可汇总广告计数 '+result.measured+' 轮'));
      if(result.reasons.length){const ul=node('ul');result.reasons.forEach(r=>ul.append(node('li',r)));box.append(ul);}
      const table=node('table'),thead=node('thead'),tr=node('tr');for(const title of ['条件','计划 / 已记录','有效广告计数轮次','任务完成 / 失败 / 未知','空白或错误页']){const th=node('th',title);th.scope='col';tr.append(th);}thead.append(tr);table.append(thead);const body=node('tbody');
      for(const mode of ['A','B']){const g=result.groups[mode],row=node('tr');for(const value of [mode==='A'?'A · 关闭':'B · 开启',g.planned+' / '+g.recorded,g.measured,g.recorded?g.tasksComplete+' / '+g.tasksFailed+' / '+g.tasksUnknown:'尚未记录',g.recorded?g.anomaly:'未知'])row.append(node('td',String(value)));body.append(row);}table.append(body);const wrap=node('div');wrap.className='table-wrap';wrap.append(table);box.append(wrap);
      const details=node('details'),summary=node('summary','查看每轮缺项与异常');details.append(summary);const list=node('ul');result.rows.forEach(r=>list.append(node('li','第'+r.number+'轮：'+(r.warnings.join('；')||'所需字段齐备'))));details.append(list);box.append(details);
      $('observation-notice').textContent='已在浏览器本地读取 '+file.name+'。未上传、未执行手机操作，也未将结果改写为项目通过。';$('observation-export').disabled=false;
    }catch(e){result=null;$('observation-results').replaceChildren();$('observation-export').disabled=true;$('observation-notice').textContent='未完成检查：'+e.message;}
  });
  $('observation-export').addEventListener('click',()=>{if(result)download('广告观察表检查.md',A.markdown(result),'text/markdown;charset=utf-8');});
})();
