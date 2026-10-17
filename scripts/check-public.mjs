import {readdirSync,lstatSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,relative,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const excluded=new Set(['.git','node_modules','dist','data','secrets','coverage']);
const roots=new Set(['src','test','docs','examples','deploy','scripts','.github']);
const top=new Set(['README.md','LICENSE','SECURITY.md','THIRD_PARTY_NOTICES.md','CONTRIBUTING.md','package.json','package-lock.json','tsconfig.json','.npmrc','.gitignore','.gitattributes','.env.example','AGENTS.md']);
const files=[],errors=[];
function reject(path,reason){errors.push({path,reason});}
function walk(directory){
 for(const entry of readdirSync(directory,{withFileTypes:true})){
  if(directory===root&&excluded.has(entry.name))continue;
  const absolute=join(directory,entry.name),path=relative(root,absolute).replaceAll('\\','/'),s=lstatSync(absolute);
  if(s.isSymbolicLink()){reject(path,'SYMLINK_NOT_ALLOWED');continue;}
  if(directory===root&&!roots.has(entry.name)&&!top.has(entry.name)){reject(path,'UNREVIEWED_ROOT_ENTRY');continue;}
  if(s.isDirectory())walk(absolute);else if(s.isFile())files.push(path);else reject(path,'NOT_REGULAR_FILE');
 }
}
walk(root);
const tracked=spawnSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'});
if(tracked.status===0)for(const path of tracked.stdout.split('\0').filter(Boolean)){
 if(excluded.has(path.split('/')[0])||/\.(?:sqlite(?:-wal|-shm)?|db|log|pem|key|zip|tgz|gz|png|jpe?g)$/i.test(path)||(/(?:^|\/)\.env(?:\.|$)/.test(path)&&path!=='.env.example'))reject(path,'FORBIDDEN_TRACKED_PATH');
}
for(const path of files){
 if(/\.(?:sqlite(?:-wal|-shm)?|db|log|pem|key|zip|tgz|gz|png|jpe?g)$/i.test(path)){reject(path,'RUNTIME_OR_BINARY_FILE');continue;}
 const buffer=readFileSync(join(root,path));
 if(buffer.includes(0)||buffer.length>1024*1024){reject(path,'BINARY_OR_OVERSIZE');continue;}
 const text=buffer.toString('utf8');
 if(text.startsWith('\uFEFF')||text.includes('\r'))reject(path,'EXPECTED_UTF8_WITHOUT_BOM_AND_LF');
 if(/(?:[A-Z]:[\\/](?:Users|Neko)[\\/]|\/home\/[a-zA-Z0-9_-]+\/|\/opt\/kuinest|\/var\/lib\/kuinest)/.test(text))reject(path,'PRIVATE_ABSOLUTE_PATH');
 if(/(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{24,})/.test(text))reject(path,'POSSIBLE_SECRET');
 for(const match of text.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g))if(!['127.0.0.1','0.0.0.0'].includes(match[0]))reject(path,'NON_LOOPBACK_IP_LITERAL');
 if(/https:\/\/[^\s"'<>`]*[?&](?:token|code|nonce|key)=(?!SYNTHETIC|EXAMPLE|\[|<)[A-Za-z0-9_-]{12,}/i.test(text))reject(path,'POSSIBLE_PAYMENT_OR_AUTH_URL');
}
if(errors.length){console.error(JSON.stringify({passed:false,findings:errors},null,2));process.exitCode=1;}
else console.log(JSON.stringify({passed:true,reviewedTextFiles:files.length,privateRuntimeRead:false,privateHistoryIncluded:false}));
