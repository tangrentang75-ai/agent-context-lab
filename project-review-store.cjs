'use strict';
const fs=require('node:fs'),path=require('node:path');
const R=require('./project-review.js');
function readReview(file=path.join(__dirname,'data/private/silver-review-latest.json')) {
  let bytes;
  try { const stat=fs.statSync(file); if(stat.size>2000000)throw Error('项目检查记录超过大小上限'); bytes=fs.readFileSync(file,'utf8'); }
  catch(e){if(e.code==='ENOENT')return null;throw e;}
  const data=JSON.parse(bytes);
  const current=R.validate(data.current),baseline=data.baseline?R.validate(data.baseline):null;
  if(baseline)R.compare(baseline,current);
  return {current,baseline};
}
module.exports={readReview};
