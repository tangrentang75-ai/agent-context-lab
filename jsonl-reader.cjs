'use strict';
const {StringDecoder}=require('node:string_decoder');
function jsonlReader(onEvent){
  const decoder=new StringDecoder('utf8');let pending='';
  const line=text=>{if(!text.trim())return;let value;try{value=JSON.parse(text);}catch{return;}onEvent?.(value);};
  function consume(text){pending+=text;let i;while((i=pending.indexOf('\n'))>=0){line(pending.slice(0,i));pending=pending.slice(i+1);}}
  return {push:chunk=>consume(decoder.write(chunk)),end:()=>{consume(decoder.end());line(pending);pending='';}};
}
module.exports={jsonlReader};
