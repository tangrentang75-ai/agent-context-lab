'use strict';
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./project-review.js'));else root.ProjectReviewBackup=factory(root.ProjectReview);})(globalThis,function(R){
  const MAX_RECORDS=10,MAX_CHARS=4000000,MAX_FILE_CHARS=4100000,MAX_FILE_BYTES=13000000;
  function records(input){
    if(!Array.isArray(input)||input.length>MAX_RECORDS)throw Error('保存区最多容纳10份检查记录。');
    const clean=input.map(R.validate),ids=new Set();
    for(const r of clean){if(ids.has(r.id))throw Error('备份中检查编号重复：'+r.id);ids.add(r.id);}
    if(JSON.stringify(clean).length>MAX_CHARS)throw Error('检查记录总量超过保存区限制。');
    return clean;
  }
  function create(input,exportedAt=new Date().toISOString()){
    if(typeof exportedAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(exportedAt)||!Number.isFinite(Date.parse(exportedAt))||new Date(exportedAt).toISOString()!==exportedAt)throw Error('备份导出时间无效。');
    return {schema:'project-review-backup-v1',exportedAt,records:records(input)};
  }
  function validate(input){if(!input||input.schema!=='project-review-backup-v1')throw Error('需要项目检查备份格式 project-review-backup-v1。');if(typeof input.exportedAt!=='string')throw Error('备份缺少导出时间。');return create(input.records,input.exportedAt);}
  function parse(text){if(typeof text!=='string'||text.length>MAX_FILE_CHARS)throw Error('备份文件文字量超过限制。');return validate(JSON.parse(text));}
  function merge(existing,incoming){
    const next=records(existing),additions=records(incoming);
    for(const r of additions){const old=next.find(x=>x.id===r.id);if(old&&JSON.stringify(old)!==JSON.stringify(r))throw Error('相同编号已有不同内容：'+r.id+'。未覆盖原记录。');if(!old)next.push(r);}
    return records(next);
  }
  return {MAX_RECORDS,MAX_CHARS,MAX_FILE_CHARS,MAX_FILE_BYTES,records,create,validate,parse,merge};
});
