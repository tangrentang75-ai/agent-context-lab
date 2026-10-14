'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),F=require('./evidence-file-check.js');
const sha=b=>createHash('sha256').update(b).digest('hex');
test('原字节相同才匹配，匹配不代表来源和引文已验证',async()=>{const b=Buffer.from('实际记录\r\n');const r=await F.compare(sha(b),b);assert.equal(r.status,'match');assert.equal(r.bytes,b.length);assert.equal(r.authenticityVerified,false);assert.equal(r.quoteVerified,false);});
test('不规范化换行或字节顺序标记',async()=>{const b=Buffer.from('record\r\n');for(const changed of [Buffer.from('record\n'),Buffer.concat([Buffer.from([239,187,191]),b])])assert.equal((await F.compare(sha(b),changed)).status,'mismatch');});
test('只核对视图范围，不包含底层缓冲区其他字节',async()=>{const b=Uint8Array.from([99,1,2,3,88]);for(const view of [b.subarray(1,4),new DataView(b.buffer,1,3)])assert.equal((await F.compare(sha(Buffer.from([1,2,3])),view)).status,'match');});
test('空文件及二进制文件只计算校验值，不解析内容',async()=>{for(const b of [new Uint8Array(),Uint8Array.from([0,255,128,1])])assert.equal((await F.compare(sha(b),b.buffer)).status,'match');});
test('拒绝缺失校验值、非字节输入和超限文件',async()=>{await assert.rejects(F.compare('',new Uint8Array()),/预先保存/);await assert.rejects(F.compare('a'.repeat(64),'text'),/原始字节/);await assert.rejects(F.compare('a'.repeat(64),new Uint8Array(F.MAX_BYTES+1)),/20MiB/);});
