(function(root){
  'use strict';
  const contextFields={softwareVersion:'银龄净网版本',targetAppVersion:'被测软件版本',deviceAlias:'手机代号',network:'网络',taskId:'任务编号'};
  const measures=['开屏广告次数','遮挡弹窗次数','诱导跳转次数','内容广告次数'];
  function validate(input){
    const text=(v,label,max=200)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw Error(label+'需要1—'+max+'字符');return v.trim();};
    if(!input||input.schema!=='observation-plan-v1')throw Error('观察计划格式应为observation-plan-v1');
    const id=text(input.id,'计划编号',100);if(!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id))throw Error('计划编号只能使用字母、数字、短横线和下划线');
    const createdAt=text(input.createdAt,'计划建立时间',40),date=createdAt.slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(createdAt)||!Number.isFinite(Date.parse(createdAt))||new Date(date).toISOString().slice(0,10)!==date)throw Error('计划建立时间需要有效的日期和时区');
    if(!measures.includes(input.primaryMeasure))throw Error('需要指定一个主要广告观察指标');
    if(!Number.isInteger(input.durationSeconds)||input.durationSeconds<1||input.durationSeconds>3600)throw Error('每轮预定观察时长应为1—3600秒的整数');
    const context={};for(const [k,label] of Object.entries(contextFields)){
      context[k]=text(input.context?.[k],label,120);if(/^(未知|待填|待填写|unknown)$/i.test(context[k]))throw Error(label+'尚未确定，暂不能建立正式计划');
      if(/^[=+@-]/.test(context[k]))throw Error(label+'不能以电子表格公式符号开头，请使用文字名称');
    }
    if(!Array.isArray(input.rounds)||input.rounds.length<2||input.rounds.length>200)throw Error('计划应有2—200轮');
    const rounds=input.rounds.map((r,i)=>{if(!r||r.number!==i+1||!['A','B'].includes(r.condition))throw Error('计划轮次须从1连续编号，条件为A或B');return {number:r.number,condition:r.condition};});
    if(!rounds.some(r=>r.condition==='A')||!rounds.some(r=>r.condition==='B'))throw Error('计划需要同时包含关闭A与开启B条件');
    return {schema:'observation-plan-v1',id,title:text(input.title,'计划名称'),createdAt,context,task:text(input.task,'固定任务与成功条件',1500),primaryMeasure:input.primaryMeasure,durationSeconds:input.durationSeconds,rounds};
  }
  async function digest(plan){
    const cryptoApi=root.crypto?.subtle?root.crypto:(typeof require==='function'?require('node:crypto').webcrypto:null);
    if(!cryptoApi?.subtle)throw Error('当前环境不支持校验值计算，计划未保存');
    const bytes=new TextEncoder().encode(JSON.stringify(validate(plan)));
    return Array.from(new Uint8Array(await cryptoApi.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
  }
  async function seal(plan){const valid=validate(plan);return {schema:'observation-plan-envelope-v1',plan:valid,sha256:await digest(valid)};}
  async function verify(envelope){
    if(!envelope||envelope.schema!=='observation-plan-envelope-v1'||!/^[a-f0-9]{64}$/.test(envelope.sha256||''))throw Error('观察计划封装或校验值无效');
    const plan=validate(envelope.plan),hash=await digest(plan);if(hash!==envelope.sha256)throw Error('计划内容与保存的校验值不一致，不能继续使用这份计划');
    return {schema:'observation-plan-envelope-v1',plan,sha256:hash};
  }
  function match(input,rows){
    const plan=validate(input),byId=new Map(rows.map(r=>[r.number,r])),expected=new Set(plan.rounds.map(r=>r.number));
    const missing=plan.rounds.filter(r=>!byId.has(r.number)).map(r=>r.number),extra=rows.filter(r=>!expected.has(r.number)).map(r=>r.number),changed=[];
    for(const scheduled of plan.rounds){
      const row=byId.get(scheduled.number);if(!row)continue;const issues=[];
      if(row.planned!==scheduled.condition)issues.push('表内计划条件被改变');
      if(['A','B','放行'].includes(row.actual)&&row.actual!==scheduled.condition)issues.push('实际条件与独立计划不同');
      if(row.plannedSec!==plan.durationSeconds)issues.push('预定观察时长与独立计划不同');
      for(const [field,column] of Object.entries(contextFields))if(row.raw[column]!==plan.context[field])issues.push(column+'与独立计划不同');
      if(row.startedAt!==null&&row.startedAt<Date.parse(plan.createdAt))issues.push('实际记录早于计划声明的建立时间，只能视为回顾分析');
      if(issues.length)changed.push({number:row.number,issues});
    }
    const submittedKnown=rows.filter(r=>expected.has(r.number)).map(r=>r.number),expectedPresent=plan.rounds.filter(r=>byId.has(r.number)).map(r=>r.number);
    const orderChanged=JSON.stringify(submittedKnown)!==JSON.stringify(expectedPresent);
    return {status:missing.length||extra.length||changed.length||orderChanged?'deviations':'matches',planId:plan.id,plannedTotal:plan.rounds.length,submittedTotal:rows.length,missing,extra,changed,orderChanged,
      primaryMeasure:plan.primaryMeasure,createdAt:plan.createdAt,task:plan.task,context:plan.context,durationSeconds:plan.durationSeconds,chronologyIndependentlyVerified:false,
      limitation:'校验值用于发现内容不一致，不是数字签名，也不能证明计划在试验前建立。记录真实性仍需人工核对。'};
  }
  const api={contextFields,measures,validate,digest,seal,verify,match};if(typeof module==='object'&&module.exports)module.exports=api;root.ObservationPlan=api;
})(typeof globalThis!=='undefined'?globalThis:this);
