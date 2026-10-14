'use strict';
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.EvidenceFileCheck=api;})(globalThis,function(root){
  const MAX_BYTES=20*1024*1024;
  const limitation='只核对所选文件与预留校验值是否一致，不证明来源真实、引文来自该文件或结论成立。';
  async function compare(expected,bytes){
    if(typeof expected!=='string'||!/^[a-f0-9]{64}$/.test(expected))throw Error('需要记录中预先保存的 SHA-256 校验值。');
    let view;
    if(bytes instanceof ArrayBuffer)view=new Uint8Array(bytes);
    else if(ArrayBuffer.isView(bytes))view=new Uint8Array(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    else throw Error('需要文件的原始字节。');
    if(view.byteLength>MAX_BYTES)throw Error('文件超过20MiB，未进行核对。');
    const crypto=root.crypto?.subtle?root.crypto:(typeof require==='function'?require('node:crypto').webcrypto:null);
    if(!crypto?.subtle)throw Error('当前浏览器不支持本地校验，请使用本机 localhost 页面。');
    const digest=await crypto.subtle.digest('SHA-256',view);
    const actual=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
    return {status:actual===expected?'match':'mismatch',expected,actual,bytes:view.byteLength,authenticityVerified:false,quoteVerified:false,limitation};
  }
  return {MAX_BYTES,compare,limitation};
});
