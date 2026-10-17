import './network-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {scryptSync,randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';
process.umask(0o077);
test('真实启动入口默认仅查询；假上游无需凭据；缺失真实凭据失败关闭',async t=>{
 const root=mkdtempSync(join(tmpdir(),'luckin-startup-')),ownerFile=join(root,'owner.json'),password='SYNTHETIC-STARTUP-LONG-PASSWORD',salt=randomBytes(16).toString('hex');
 writeFileSync(ownerFile,JSON.stringify({version:1,ownerId:'synthetic-owner',username:'owner',salt,hash:scryptSync(password,salt,64).toString('hex')}),{mode:0o600});
 const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const env={PATH:process.env.PATH,HOME:process.env.HOME,PUBLIC_ORIGIN:'https://synthetic.example',DATA_ROOT:root,OWNER_FILE:ownerFile,PORT:String(port),SYNTHETIC_UPSTREAM:'true'};
 const cwd=fileURLToPath(new URL('../',import.meta.url)),child=spawn(process.execPath,['dist/main.js'],{cwd,env,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
 t.after(async()=>{if(child.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}rmSync(root,{recursive:true,force:true});});
 let ready=false;for(let n=0;n<80;n++){try{if((await fetch('http://127.0.0.1:'+port+'/health/ready',{signal:AbortSignal.timeout(100)})).status===200){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,40));}
 assert(ready);assert(output.includes('SYNTHETIC_BRIDGE_READY'));assert(!output.includes(password));
 const metadata=await (await fetch('http://127.0.0.1:'+port+'/.well-known/oauth-authorization-server')).json();assert.deepEqual(metadata.scopes_supported,['luckin:catalog:read']);
 assert.equal((await fetch('http://127.0.0.1:'+port+'/api/luckin/mcp')).status,401);assert.equal((await fetch('http://127.0.0.1:'+port+'/api/luckin/orders/mcp')).status,404);
 child.kill('SIGTERM');assert.equal(await new Promise(r=>child.once('exit',r)),0);
 const missing=spawn(process.execPath,['dist/main.js'],{cwd,env:{...env,SYNTHETIC_UPSTREAM:'false'},stdio:['ignore','pipe','pipe']});let message='';missing.stdout.on('data',b=>message+=b);missing.stderr.on('data',b=>message+=b);
 assert.notEqual(await new Promise(r=>missing.once('exit',r)),0);assert(message.includes('BRIDGE_START_FAILED'));assert(!message.includes(password));
});
