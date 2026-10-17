import {mkdirSync,writeFileSync,lstatSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {randomBytes,randomUUID,scryptSync} from 'node:crypto';

function hidden(prompt){
 if(!process.stdin.isTTY)throw Error('LOCAL_TERMINAL_REQUIRED');
 process.stdout.write(prompt);process.stdin.setRawMode(true);process.stdin.resume();
 return new Promise((resolve,reject)=>{
  let value='';
  function done(error){process.stdin.off('data',onData);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');error?reject(error):resolve(value);}
  function onData(chunk){for(const char of chunk.toString('utf8')){
   if(char==='\u0003'){done(Error('CANCELLED'));return;}
   if(char==='\r'||char==='\n'){done();return;}
   if(char==='\u007f'||char==='\b'){value=value.slice(0,-1);continue;}
   if(value.length>=512){done(Error('PASSWORD_TOO_LONG'));return;}
   if(char>=' ')value+=char;
  }}
  process.stdin.on('data',onData);
 });
}
try{
 process.umask(0o077);
 const username=process.env.OWNER_USERNAME??'owner';
 if(!username||username.length>128)throw Error('USERNAME_INVALID');
 const file=resolve(process.env.OWNER_FILE??resolve(process.env.DATA_ROOT??'./data','owner.json'));
 const password=await hidden('在本机输入主人口令（不显示，至少16字符）：');
 if(password.length<16||password!==await hidden('再次输入口令：'))throw Error('PASSWORD_CONFIRMATION_FAILED');
 mkdirSync(dirname(file),{recursive:true,mode:0o700});
 const info=lstatSync(dirname(file));if(!info.isDirectory()||info.isSymbolicLink()||(process.platform!=='win32'&&(info.mode&0o077)!==0))throw Error('OWNER_DIRECTORY_PRIVATE_REQUIRED');
 const salt=randomBytes(16).toString('hex');
 writeFileSync(file,JSON.stringify({version:1,ownerId:randomUUID(),username,salt,hash:scryptSync(password,salt,64).toString('hex')}),{flag:'wx',mode:0o600});
 process.stdout.write('主人配置已创建；口令未写入配置。请单独保存口令，勿提交配置文件。\n');
}catch{process.stderr.write('初始化未完成：需本机交互终端、私有目录、匹配的长口令，且目标文件必须不存在。\n');process.exitCode=1;}
