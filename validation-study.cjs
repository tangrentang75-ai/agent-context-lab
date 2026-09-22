'use strict';
const fs=require('node:fs'),path=require('node:path');
const {runStudy}=require('./evidence-study.cjs');
const {validateDataset}=require('./evaluation.js');
const runValidation=options=>runStudy({...options,fixtureFile:'validation-fixtures.json',strictSources:true,studyName:'validation',maxCalls:6,maxTokens:120000});
function latestValidation(){try{return validateDataset(JSON.parse(fs.readFileSync(path.join(__dirname,'runs','validation-latest.json'),'utf8')));}catch{return null;}}
module.exports={runValidation,latestValidation};
if(require.main===module)runValidation().then(d=>console.log(JSON.stringify(d.retrievalStudy,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
