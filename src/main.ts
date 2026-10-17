import {loadRuntimeConfig} from './config.js';
import {localOwnerIdentity} from './identity.js';
import {luckinCredential} from './secrets.js';
import {LuckinMcpClient} from './mcp/luckin-client.js';
import {createBridge} from './app.js';
import {syntheticTransport} from './synthetic.js';
async function main(){
 process.umask(0o077);
 const config=loadRuntimeConfig(process.env);
 const identity=localOwnerIdentity({file:config.ownerFile,publicOrigin:config.publicOrigin});
 const token=config.synthetic?'SYNTHETIC-DEMONSTRATION-NEVER-A-REAL-TOKEN':luckinCredential(config.credentialFile!);
 const transport=config.synthetic?{transport:syntheticTransport()}:{};
 const client=(mode:'catalog'|'preview'|'orders')=>new LuckinMcpClient({token,mode,...transport});
 const app=createBridge({root:config.root,publicOrigin:config.publicOrigin,identity,catalog:client('catalog'),...(config.previewEnabled?{preview:client('preview')}:{}),...(config.ordersEnabled?{orders:client('orders')}:{}),createEnabled:config.createEnabled});
 let stopping=false;
 const stop=async()=>{if(stopping)return;stopping=true;const timer=setTimeout(()=>process.exit(1),30000);timer.unref();try{await app.close();}finally{clearTimeout(timer);}};
 process.once('SIGTERM',()=>{void stop();});process.once('SIGINT',()=>{void stop();});
 await app.listen({host:'127.0.0.1',port:config.port});
 process.stdout.write(config.synthetic?'SYNTHETIC_BRIDGE_READY — 仅演示，无真实账户或支付\n':'LUCKIN_BRIDGE_READY\n');
}
main().catch(()=>{process.stderr.write('BRIDGE_START_FAILED — 请检查版本、配置与私有文件权限；错误内容不包含凭据。\n');process.exitCode=1;});
