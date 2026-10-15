'use strict';
const fs=require('node:fs'),{createHash}=require('node:crypto');
const version=require('./package.json').version;
function localIdentity(){
  let root=fs.realpathSync(__dirname);if(process.platform==='win32')root=root.toLowerCase();
  return {schema:'acl-local-info-v1',app:'agent-context-lab',version,workspaceId:createHash('sha256').update(root).digest('hex')};
}
module.exports={localIdentity};
