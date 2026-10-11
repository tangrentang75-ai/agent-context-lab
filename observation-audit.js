(function(root){
  'use strict';
  const columns=['轮次','计划条件','实际条件','过滤状态已核实','银龄净网版本','被测软件版本','手机代号','网络','任务编号','开始时间','预定观察秒数','实际观察秒数','完整观察','开屏广告次数','遮挡弹窗次数','诱导跳转次数','内容广告次数','空白或错误页','正常任务完成','等待秒数','恢复动作','恢复结果','证据编号','偏差及缺失原因'];
  const adColumns=columns.slice(13,17),contextColumns=columns.slice(4,9);
  function parseCsv(text){
    if(typeof text!=='string'||text.length>2000000)throw Error('观察表需要不超过200万字符的CSV文本');
    text=text.replace(/^\uFEFF/,'');const rows=[];let row=[],cell='',quoted=false,closed=false;
    const endCell=()=>{row.push(cell);cell='';closed=false;};
    const endRow=()=>{endCell();rows.push(row);row=[];if(rows.length>201)throw Error('最多支持200轮观察');};
    for(let i=0;i<text.length;i++){
      const c=text[i];
      if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
      if(c===','){endCell();continue;}
      if(c==='\r'||c==='\n'){if(c==='\r'&&text[i+1]==='\n')i++;endRow();continue;}
      if(closed)throw Error('带引号的单元格后出现多余字符');
      if(c==='"'){if(cell)throw Error('单元格引号位置错误');quoted=true;}else cell+=c;
    }
    if(quoted)throw Error('CSV引号未闭合');
    if(cell||row.length||closed)endRow();
    if(!rows.length)throw Error('观察表为空');
    const header=rows.shift();
    if(header.length!==columns.length||header.some((v,i)=>v.trim()!==columns[i]))throw Error('列名或顺序不符合正式广告观察表，请先下载空白模板');
    while(rows.length&&rows.at(-1).every(v=>!v.trim()))rows.pop();
    if(!rows.length)throw Error('观察表没有轮次');
    return rows.map((cells,i)=>{if(cells.length!==columns.length)throw Error('第'+(i+2)+'行列数不符');return Object.fromEntries(columns.map((key,j)=>[key,cells[j].trim()]));});
  }
  function auditCsv(text){
    const raw=parseCsv(text),seen=new Set();
    const enumValue=(value,choices,label,line)=>{if(value&&!choices.includes(value))throw Error('第'+line+'行“'+label+'”应为'+choices.join('/')+'或留空');return value;};
    const number=(value,label,line,integer=false)=>{if(value==='')return null;if(!/^\d+(?:\.\d+)?$/.test(value))throw Error('第'+line+'行“'+label+'”需要非负数，未测请留空');const n=Number(value);if(!Number.isFinite(n)||n>10000000||(integer&&!Number.isSafeInteger(n)))throw Error('第'+line+'行“'+label+'”数值无效');return n;};
    const rows=raw.map((r,i)=>{
      const line=i+2;if(!/^\d+$/.test(r['轮次'])||Number(r['轮次'])<1||seen.has(Number(r['轮次'])))throw Error('轮次必须为不同的正整数');seen.add(Number(r['轮次']));
      enumValue(r['计划条件'],['A','B'],'计划条件',line);if(!r['计划条件'])throw Error('第'+line+'行缺少计划条件');
      enumValue(r['实际条件'],['A','B','放行','未知'],'实际条件',line);
      for(const key of ['过滤状态已核实','完整观察','空白或错误页','正常任务完成'])enumValue(r[key],['是','否','未知'],key,line);
      const plannedSec=number(r['预定观察秒数'],'预定观察秒数',line),observedSec=number(r['实际观察秒数'],'实际观察秒数',line),waitSec=number(r['等待秒数'],'等待秒数',line);
      const ads=Object.fromEntries(adColumns.map(k=>[k,number(r[k],k,line,true)])),warnings=[];
      const observedKeys=['实际条件','过滤状态已核实','开始时间','实际观察秒数','完整观察',...adColumns,'空白或错误页','正常任务完成','等待秒数','恢复动作','恢复结果'];
      const hasData=observedKeys.some(k=>r[k]!==''),contextKnown=contextColumns.every(k=>r[k]&&!/^(未知|待填|待填写|unknown)$/i.test(r[k]));
      const time=r['开始时间'],datePart=time.slice(0,10),validDate=/^\d{4}-\d{2}-\d{2}$/.test(datePart)&&!Number.isNaN(Date.parse(datePart))&&new Date(datePart).toISOString().slice(0,10)===datePart;
      const startedAt=validDate&&/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:Z|[+-]\d{2}:\d{2})$/.test(time)?Date.parse(time):NaN;
      if(!hasData)warnings.push('尚未记录');
      else{
        if(!['A','B'].includes(r['实际条件']))warnings.push('实际过滤条件不明或属于软件放行');
        if(['A','B','放行'].includes(r['实际条件'])&&r['实际条件']!==r['计划条件'])warnings.push('实际顺序偏离计划');
        if(r['过滤状态已核实']!=='是')warnings.push('没有核实实际过滤状态');
        if(!contextKnown)warnings.push('设备、网络、任务或版本资料不完整');
        if(r['完整观察']!=='是'||!plannedSec||observedSec===null||observedSec<plannedSec)warnings.push('观察时段不完整，未见广告不能当作零次');
        if(adColumns.some(k=>ads[k]===null))warnings.push('有广告分类未记录');
        if(!['是','否'].includes(r['正常任务完成']))warnings.push('正常任务结果未知');
        if(!['是','否'].includes(r['空白或错误页']))warnings.push('空白或错误页情况未知');
        if(r['空白或错误页']==='是')warnings.push('出现空白或错误页，不能直接算收益');
        if(!r['证据编号'])warnings.push('缺少原始证据位置');
        if(!Number.isFinite(startedAt))warnings.push('开始时间缺失或格式无效，需要如2026-10-11T09:00:00+08:00');
        if((r['实际条件']!==r['计划条件']||r['完整观察']!=='是')&&!r['偏差及缺失原因'])warnings.push('缺少偏差或缺测原因');
      }
      const full=hasData&&r['完整观察']==='是'&&plannedSec>0&&observedSec!==null&&observedSec>=plannedSec&&adColumns.every(k=>ads[k]!==null);
      const measured=full&&['A','B'].includes(r['实际条件'])&&r['过滤状态已核实']==='是'&&contextKnown&&!!r['证据编号']&&Number.isFinite(startedAt);
      return {number:Number(r['轮次']),planned:r['计划条件'],actual:r['实际条件']||'未知',hasData,measured,plannedSec,observedSec,waitSec,ads,
        taskResult:r['正常任务完成']||'未知',anomaly:r['空白或错误页']||'未知',startedAt:Number.isFinite(startedAt)?startedAt:null,context:contextColumns.map(k=>r[k]),warnings,raw:r};
    });
    const groups=Object.fromEntries(['A','B'].map(mode=>{
      const actual=rows.filter(r=>r.actual===mode),measured=actual.filter(r=>r.measured);
      return [mode,{planned:rows.filter(r=>r.planned===mode).length,recorded:actual.length,measured:measured.length,
        tasksComplete:actual.filter(r=>r.taskResult==='是').length,tasksFailed:actual.filter(r=>r.taskResult==='否').length,tasksUnknown:actual.filter(r=>r.taskResult==='未知').length,
        anomaly:actual.filter(r=>r.anomaly==='是').length,anomalyUnknown:actual.filter(r=>r.anomaly==='未知').length,
        ads:Object.fromEntries(adColumns.map(k=>[k,measured.length?measured.reduce((n,r)=>n+r.ads[k],0):null]))}];
    }));
    const contexts=new Set(rows.filter(r=>r.measured).map(r=>JSON.stringify([...r.context,r.plannedSec])));
    const reasons=[];
    if(rows.some(r=>!r.hasData))reasons.push('存在尚未执行的计划轮次');
    if(rows.some(r=>!r.measured))reasons.push('部分轮次缺少完整观察、条件核实或原始依据');
    if(contexts.size===0)reasons.push('尚无条件完整的可比记录');
    if(contexts.size>1)reasons.push('两组版本、设备、网络、任务或观察时长不能直接对应');
    if(!groups.A.measured||!groups.B.measured)reasons.push('缺少任一条件的有效记录');
    if(rows.some(r=>r.hasData&&r.actual!=='未知'&&r.actual!==r.planned))reasons.push('实际条件偏离计划，需人工说明');
    if(rows.some(r=>r.hasData&&r.observedSec!==null&&r.plannedSec!==null&&r.observedSec!==r.plannedSec))reasons.push('实际观察时长偏离计划，需核对计数对应的完整时段');
    if(rows.some((r,i)=>i>0&&(r.number<=rows[i-1].number||(r.startedAt!==null&&rows[i-1].startedAt!==null&&r.startedAt<=rows[i-1].startedAt))))reasons.push('轮次或开始时间顺序不一致，需人工核对');
    if(rows.some(r=>r.taskResult==='未知'||r.anomaly==='未知'))reasons.push('缺少正常任务或页面异常结果');
    return {total:rows.length,unrecorded:rows.filter(r=>!r.hasData).length,measured:rows.filter(r=>r.measured).length,groups,rows,
      comparable:reasons.length===0,reasons,benefitEstablished:false,
      conclusion:reasons.length?'目前只整理逐轮记录，不比较广告效果。':'可整理两组的描述性记录；仍不能自动推出广告收益或因果效果。'};
  }
  function template(){return '\uFEFF'+columns.join(',')+'\r\n'+[...'ABBABAAB'].map((mode,i)=>[i+1,mode,...Array(columns.length-2).fill('')].join(',')).join('\r\n')+'\r\n';}
  function markdown(result){
    const safe=v=>String(v).replace(/[\r\n]/g,' ').replace(/[<>]/g,'').replace(/([\\`*_[\]#|])/g,'\\$1');
    let out='# 广告观察表检查\n\n'+result.conclusion+'\n\n计划 '+result.total+' 轮；尚未记录 '+result.unrecorded+' 轮；可汇总广告计数 '+result.measured+' 轮。未测字段保留未知，不填0。\n\n';
    if(result.reasons.length)out+='暂不比较的原因：\n\n'+result.reasons.map(v=>'- '+v).join('\n')+'\n\n';
    out+='|条件|有效计数轮次|正常任务完成|任务失败|任务结果未知|空白或错误页|\n|---|---:|---:|---:|---:|---:|\n';
    for(const mode of ['A','B']){const g=result.groups[mode];out+='|'+[mode,g.measured,g.tasksComplete,g.tasksFailed,g.tasksUnknown,g.anomaly].join('|')+'|\n';}
    out+='\n各组计数只对应实际声明条件，未核实的条件与不完整轮次不能进入广告汇总。记录是否真实仍需人工核对。\n\n';
    for(const r of result.rows)out+='- 第'+r.number+'轮（计划'+r.planned+'，实际'+safe(r.actual)+'）：'+(r.warnings.length?r.warnings.map(safe).join('；'):'所需字段齐备')+'。\n';
    return out;
  }
  const api={columns,adColumns,auditCsv,parseCsv,template,markdown};if(typeof module==='object'&&module.exports)module.exports=api;root.ObservationAudit=api;
})(typeof globalThis!=='undefined'?globalThis:this);
