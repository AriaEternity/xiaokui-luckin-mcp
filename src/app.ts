import Fastify from 'fastify';
import {mkdirSync,lstatSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {luckinMcp,luckinPreviewMcp,luckinOrdersMcp} from './contracts/index.js';
import {createOAuth,type ResourceProfile} from './oauth/server.js';
import type {OwnerIdentity} from './identity.js';
import type {LuckinReader} from './mcp/luckin-policy.js';
import {LuckinOrdersService} from './luckin/orders.js';
import {registerLuckinMcp,registerLuckinPreviewMcp,registerLuckinOrdersMcp} from './http/routes/luckin-mcp.js';
import {registerLuckinOrderConfirmation} from './http/routes/luckin-order-confirm.js';
export function createBridge(options:{root:string;publicOrigin:string;identity:OwnerIdentity;catalog:LuckinReader;preview?:LuckinReader;orders?:LuckinReader;createEnabled?:boolean;responseMode?:'json'|'sse';redirectUri?:string;now?:()=>number}) {
 if(!isAbsolute(options.root))throw Error('DATA_ROOT_ABSOLUTE_REQUIRED');
 mkdirSync(options.root,{recursive:true,mode:0o700});
 const info=lstatSync(options.root);
 if(!info.isDirectory()||info.isSymbolicLink()||(process.platform!=='win32'&&((info.mode&0o077)!==0||info.uid!==process.getuid?.())))throw Error('DATA_ROOT_PRIVATE_REQUIRED');
 if(options.createEnabled&&!options.orders)throw Error('CREATE_REQUIRES_ORDERS');
 const profiles:ResourceProfile[]=[{...luckinMcp,name:'小葵 · 瑞幸查询'},...(options.preview?[{...luckinPreviewMcp,name:'小葵 · 瑞幸规格与预览'}]:[]),...(options.orders?[{...luckinOrdersMcp,name:'小葵 · 瑞幸点单（本人逐笔确认）'}]:[])];
 // 默认不记录HTTP请求/响应，防止OAuth参数、会话、意图和支付URL进入日志。
 const app=Fastify({logger:false,bodyLimit:8192,requestTimeout:30000,connectionTimeout:30000});
 app.setErrorHandler((error,_request,reply)=>{
  const status=typeof error==='object'&&error!==null&&'statusCode' in error?error.statusCode:500;
  const code=typeof status==='number'&&[400,413,415,429].includes(status)?status:500;
  return reply.code(code).send({error:code===429?'rate_limited':code===500?'service_unavailable':'invalid_request'});
 });
 options.identity.register(app);
 const oauth=createOAuth({root:join(options.root,'oauth'),publicOrigin:options.publicOrigin,identity:options.identity,profiles,...(options.redirectUri?{redirectUri:options.redirectUri}:{}),...(options.now?{now:options.now}:{})});
 oauth.register(app);
 const config={publicOrigin:options.publicOrigin};
 const mode=options.responseMode?{responseMode:options.responseMode}:{};
 registerLuckinMcp(app,config,{reader:options.catalog,authorization:oauth.authorization(profiles[0]!),...mode});
 if(options.preview)registerLuckinPreviewMcp(app,config,{reader:options.preview,authorization:oauth.authorization(profiles.find(p=>p.path===luckinPreviewMcp.path)!),...mode});
 if(options.orders){
  const auth=oauth.authorization(profiles.find(p=>p.path===luckinOrdersMcp.path)!);
  const service=new LuckinOrdersService({root:join(options.root,'luckin-orders'),publicOrigin:options.publicOrigin,reader:options.orders,active:auth.active,createEnabled:options.createEnabled===true,...(options.now?{now:options.now}:{})});
  registerLuckinOrdersMcp(app,config,{authorization:auth,readerForRequest:async header=>{const binding=auth.identify(header);return {call:(name,args,signal)=>service.call(binding,name,args,signal)};},...mode});
  registerLuckinOrderConfirmation(app,{publicOrigin:options.publicOrigin,service,inspectSession:options.identity.inspectSession});
 }
 app.get('/health/ready',async()=>({status:'ready'}));
 return app;
}
