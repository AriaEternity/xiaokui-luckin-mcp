import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync,mkdirSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {Writable} from 'node:stream';
import {createServer} from 'node:net';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import './network-guard.mjs';
import {createBridge} from '../dist/app.js';
import {LuckinOrdersService,yuanMinor,paymentQr} from '../dist/luckin/orders.js';
import {LuckinMcpClient} from '../dist/mcp/luckin-client.js';
import {loadRuntimeConfig} from '../dist/config.js';
process.umask(0o077);
const origin='https://synthetic.example',base='/oauth',callback='https://chatgpt.com/connector_platform_oauth_redirect';
const catalog={path:'/api/luckin/mcp',scope:'luckin:catalog:read',client:'xiaokui-chatgpt-luckin'};
const preview={path:'/api/luckin/preview/mcp',scope:'luckin:checkout:preview',client:'xiaokui-chatgpt-luckin-preview'};
const orders={path:'/api/luckin/orders/mcp',scope:'luckin:orders:create',client:'xiaokui-chatgpt-luckin-orders'};
const secret='SYNTHETIC-CHECKOUT-CREDENTIAL-NOT-REAL',ownerHeaders={cookie:'synthetic-owner=session',origin,'x-csrf-token':'synthetic-csrf'};
const draft={deptId:91001,productList:[{productId:91002,skuCode:'SYNTHETIC-COLD',amount:1}]};
const binding={ownerId:'synthetic-owner',clientId:orders.client,grantId:'synthetic-grant',resource:origin+orders.path};
const quoted=()=>({shopInfo:{deptId:91001,deptName:'合成测试店',address:'合成地址，不是真实地址',longitude:110.1,latitude:30.1},productInfoList:[{productId:91002,skuCode:'SYNTHETIC-COLD',amount:1,name:'合成咖啡',additionDesc:'合成大杯/冷/无糖',initPrice:29.9,estimatePrice:9.9,estimateTotalPrice:9.9}],totalInitialPrice:29.9,privilegeMoney:20,discountPrice:9.9,couponCodeList:['SYNTHETIC-COUPON-A']});
const success=data=>({content:[{type:'text',text:JSON.stringify({code:0,msg:'success',data,success:true})}],isError:false});
async function harness(t,options={}){
 const root=mkdtempSync(join(tmpdir(),'luckin-checkout-')),calls=[];let logs='',now=Date.now(),previewCount=0,status=10;
 const transport=async(url,init)=>{
  assert.equal(String(url),'https://gwmcp.lkcoffee.com/order/user/mcp');assert.equal(new Headers(init.headers).get('authorization'),'Bearer '+secret);
  if(init.method==='GET')return new Response(null,{status:405});const body=JSON.parse(init.body);
  if(body.method==='initialize')return Response.json({jsonrpc:'2.0',id:body.id,result:{protocolVersion:'2025-06-18',serverInfo:{name:'synthetic',version:'1'},capabilities:{tools:{}}}});
  if(body.method==='notifications/initialized')return new Response(null,{status:202});assert.equal(body.method,'tools/call');calls.push(structuredClone(body.params));
  const {name,arguments:args}=body.params;assert(!['cancelOrder','payOrder','payment'].includes(name));let data;
  if(name==='previewOrder'){previewCount++;data=options.quote?await options.quote(previewCount,args):quoted();}
  else if(name==='createOrder'){
   assert(readdirSync(join(root,'luckin-orders')).filter(n=>n.endsWith('.json')).some(n=>JSON.parse(readFileSync(join(root,'luckin-orders',n),'utf8')).state==='SUBMITTING'));
   if(options.createFailure==='hang')return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Error('SYNTHETIC_ABORTED')), {once:true}));
   if(options.createFailure)throw Error('SYNTHETIC_UNKNOWN_AFTER_SEND '+secret);
   data={orderId:9000000000000000000,orderIdStr:'9000000000000000001',payOrderUrl:'weixin://must-never-return',payOrderQrCodeUrl:'https://opentest03.lkcoffee.com/transfer/qrcode?token=SYNTHETIC-PAYMENT',discountPrice:9.9,needPay:true,...options.created};
  }else if(name==='queryOrderDetailInfo'){data={orderId:'9000000000000000001',orderStatus:status,orderStatusName:'不应直接透传',aboutTime:1900000000000,takeMealCodeInfo:{code:'SYNTHETIC-PICKUP'},dispatchInfo:{dispatcherMobile:'SYNTHETIC-PRIVATE-PHONE'},...options.statusResult};}
  else data={items:[]};
  const envelope={jsonrpc:'2.0',id:body.id,result:success(data)};
  return options.upstreamSse?new Response('data: '+JSON.stringify(envelope)+'\n\n',{headers:{'content-type':'text/event-stream'}}):Response.json(envelope);
 };
 const sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const inspectSession=async cookie=>cookie==='synthetic-owner=session'?{ownerId:'synthetic-owner',csrfToken:'synthetic-csrf'}:cookie==='synthetic-other=session'?{ownerId:'synthetic-other',csrfToken:'synthetic-csrf'}:undefined;
 const start=async()=>{
  const reader=mode=>new LuckinMcpClient({token:secret,transport,mode,...(options.timeoutMs?{timeoutMs:options.timeoutMs}:{})});
  const app=createBridge({root,publicOrigin:origin,identity:{ownerId:'synthetic-owner',inspectSession,register(){}},catalog:reader('catalog'),preview:reader('preview'),...(options.enabled!==false?{orders:reader('orders')}:{ }),createEnabled:options.enabled!==false&&options.createEnabled!==false,now:()=>now,...(options.downstreamSse?{responseMode:'sse'}:{})});
  await app.listen({host:'127.0.0.1',port});return app;
 };
 let app=await start();t.after(async()=>{await app.close();rmSync(root,{recursive:true,force:true});});
 const inject=opt=>app.inject(opt);
 const form=async(data)=>{const r=await fetch('http://127.0.0.1:'+port+base+'/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',connection:'close'},body:new URLSearchParams(data)});return {status:r.status,body:await r.json()};};
 const grant=async(kind=orders)=>{
  const verifier='p'.repeat(48),challenge=createHash('sha256').update(verifier).digest('base64url');
  const a=await inject({url:base+'/authorize?'+new URLSearchParams({client_id:kind.client,redirect_uri:callback,response_type:'code',scope:kind.scope,resource:origin+kind.path,state:'synthetic-state',code_challenge:challenge,code_challenge_method:'S256'})});assert.equal(a.statusCode,303);
  const request=new URL(a.headers.location).searchParams.get('request');const c=await inject({method:'POST',url:base+'/consent',headers:ownerHeaders,payload:{request,decision:'allow'}});assert.equal(c.statusCode,200);
  const code=new URL(c.json().redirectUrl).searchParams.get('code');const result=await form({grant_type:'authorization_code',client_id:kind.client,redirect_uri:callback,resource:origin+kind.path,code,code_verifier:verifier});assert.equal(result.status,200);return result.body;
 };
 const rpc=(token,name,args,kind=orders)=>inject({method:'POST',url:kind.path,headers:{authorization:'Bearer '+token,accept:'application/json, text/event-stream','content-type':'application/json','mcp-protocol-version':'2025-06-18'},payload:{jsonrpc:'2.0',id:1,method:name==='tools/list'?'tools/list':'tools/call',...(name==='tools/list'?{}:{params:{name,arguments:args}})}});
 const call=async(token,name,args,kind=orders)=>{const r=await rpc(token,name,args,kind);assert.equal(r.statusCode,200);return r.json().result;};
 const prepare=async(token)=>{const r=await call(token,'previewOrder',draft);assert.equal(r.isError,false);return r.structuredContent;};
 const confirm=async(id,headers=ownerHeaders)=>{const d=await inject({url:'/api/luckin/orders/confirm/'+id+'/details',headers});assert.equal(d.statusCode,200);return inject({method:'POST',url:'/api/luckin/orders/confirm/'+id+'/approve',headers,payload:{nonce:d.json().nonce}});};
 const read=id=>JSON.parse(readFileSync(join(root,'luckin-orders',id+'.json'),'utf8'));
 return {root,port,calls,inject,grant,form,rpc,call,prepare,confirm,read,logs:()=>logs,advance:ms=>{now+=ms;},status:s=>{status=s;},close:()=>app.close(),restart:async()=>{await app.close();app=await start();}};
}
test('独立三个resource/client/scope隔离；OAuth不扩大catalog能力',async t=>{
 const h=await harness(t),kinds=[catalog,preview,orders],tokens=[];for(const k of kinds)tokens.push(await h.grant(k));
 for(let i=0;i<3;i++)for(let j=0;j<3;j++)assert.equal((await h.rpc(tokens[i].access_token,'tools/list',undefined,kinds[j])).statusCode,i===j?200:401);
 for(const [i,n] of [[0,3],[1,5],[2,7]])assert.equal((await h.rpc(tokens[i].access_token,'tools/list',undefined,kinds[i])).json().result.tools.length,n);
 for(const i of [0,1])assert.equal((await h.rpc(tokens[i].access_token,'createOrder',{intentId:randomBytes(16).toString('hex')},kinds[i])).json().error.code,-32602);
 assert.equal(h.calls.length,0);
});
test('默认配置仅catalog，订单与真实创建分别启用',async t=>{
 const h=await harness(t,{enabled:false});assert.equal((await h.inject({url:orders.path})).statusCode,404);
 assert(!(await h.inject({url:'/.well-known/oauth-authorization-server'})).json().scopes_supported.includes(orders.scope));
 const c=loadRuntimeConfig({PUBLIC_ORIGIN:origin,SYNTHETIC_UPSTREAM:'true'});assert.equal(c.ordersEnabled,false);assert.equal(c.previewEnabled,false);assert.equal(c.createEnabled,false);
 assert.throws(()=>loadRuntimeConfig({PUBLIC_ORIGIN:origin,SYNTHETIC_UPSTREAM:'true',ENABLE_ORDER_CREATE:'true'}));
});
for(const sse of [false,true])test('SDK完整点单合成：预览→本人确认→创建一次→二维码→付款状态，JSON/SSE '+sse,async t=>{
 const h=await harness(t,{upstreamSse:sse,downstreamSse:sse}),token=await h.grant(),client=new Client({name:'synthetic-checkout',version:'1'},{capabilities:{}});
 try{
  await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+h.port+orders.path),{requestInit:{headers:{authorization:'Bearer '+token.access_token}}}));
  assert.equal((await client.listTools()).tools.length,7);const p=(await client.callTool({name:'previewOrder',arguments:draft})).structuredContent;
  assert.equal(p.payable,9.9);assert.equal(p.couponCount,1);assert(!JSON.stringify(p).includes('SYNTHETIC-COUPON-A'));assert(!Object.hasOwn(p,'nonce'));
  const before=await client.callTool({name:'createOrder',arguments:{intentId:p.intentId}});assert(before.isError);assert.equal(h.calls.filter(c=>c.name==='createOrder').length,0);
  assert.equal((await h.confirm(p.intentId)).statusCode,200);const created=await client.callTool({name:'createOrder',arguments:{intentId:p.intentId}});
  assert.equal(created.isError,false);assert.equal(created.structuredContent.orderId,'9000000000000000001');assert.equal(created.structuredContent.payOrderQrCodeUrl,'https://opentest03.lkcoffee.com/transfer/qrcode?token=SYNTHETIC-PAYMENT');assert(!JSON.stringify(created).includes('weixin://'));
  const c=h.calls.find(c=>c.name==='createOrder');assert.deepEqual(c.arguments,{...draft,longitude:110.1,latitude:30.1,couponCodeList:['SYNTHETIC-COUPON-A']});
  let q=(await client.callTool({name:'queryOrderDetailInfo',arguments:{intentId:p.intentId}})).structuredContent;assert.equal(q.paymentStatus,'pending');assert.equal(q.takeMealCode,undefined);assert.equal(q.aboutTime,undefined);
  h.status(60);q=(await client.callTool({name:'queryOrderDetailInfo',arguments:{intentId:p.intentId}})).structuredContent;assert.equal(q.paymentStatus,'confirmed');assert.equal(q.takeMealCode,'SYNTHETIC-PICKUP');assert(!JSON.stringify(q).includes('SYNTHETIC-PRIVATE-PHONE'));
  const count=h.calls.length;await client.callTool({name:'createOrder',arguments:{intentId:p.intentId}});assert.equal(h.calls.length,count);
  assert.equal(h.calls.filter(c=>c.name==='createOrder').length,1);assert(!h.logs().includes(secret)&&!h.logs().includes(token.access_token)&&!h.logs().includes(token.refresh_token));
 }finally{await client.close();}
});
test('确认链接预取/GET不批准；必须本人Cookie、Origin、CSRF及一次性nonce',async t=>{
 const h=await harness(t),token=await h.grant(),p=await h.prepare(token.access_token),url='/api/luckin/orders/confirm/'+p.intentId;
 const shell=await h.inject({url});assert.equal(shell.statusCode,200);assert(shell.headers['content-security-policy'].includes("frame-ancestors 'none'"));assert(!shell.body.includes('合成测试店'));assert.equal(h.read(p.intentId).state,'PREVIEWED');
 assert.equal((await h.inject({url:url+'/details'})).statusCode,403);assert.equal((await h.inject({url:url+'/details',headers:{cookie:'synthetic-other=session'}})).statusCode,404);
 const d=(await h.inject({url:url+'/details',headers:ownerHeaders})).json();
 for(const headers of [{...ownerHeaders,origin:'https://attacker.invalid'},{...ownerHeaders,'x-csrf-token':'bad'},{...ownerHeaders,cookie:'synthetic-other=session'}])assert((await h.inject({method:'POST',url:url+'/approve',headers,payload:{nonce:d.nonce}})).statusCode>=400);
 assert.equal((await h.inject({method:'POST',url:url+'/approve',headers:ownerHeaders,payload:{nonce:'bad'}})).statusCode,409);
 assert.equal((await h.confirm(p.intentId)).statusCode,200);assert.equal((await h.inject({method:'POST',url:url+'/approve',headers:ownerHeaders,payload:{nonce:d.nonce}})).statusCode,409);assert.equal(h.calls.filter(c=>c.name==='createOrder').length,0);
});
test('禁止confirmed/任意orderId/创建参数替换/取消支付；拒绝时没有上游请求',async t=>{
 const h=await harness(t),token=await h.grant(),p=await h.prepare(token.access_token),n=h.calls.length;
 for(const [name,args] of [['createOrder',{intentId:p.intentId,confirmed:true}],['createOrder',draft],['createOrder',{intentId:p.intentId,productList:draft.productList}],['queryOrderDetailInfo',{orderId:'123'}],['cancelOrder',{}],['payOrder',{}],['approveOrder',{}]])assert.equal((await h.rpc(token.access_token,name,args)).json().error.code,-32602);
 assert.equal(h.calls.length,n);
});
test('create总开关关闭时，即使本人批准也不创建',async t=>{
 const h=await harness(t,{createEnabled:false}),token=await h.grant(),p=await h.prepare(token.access_token);await h.confirm(p.intentId);
 const r=await h.call(token.access_token,'createOrder',{intentId:p.intentId});assert(r.content[0].text.includes('ORDER_CREATE_DISABLED'));assert.equal(h.calls.filter(c=>c.name==='createOrder').length,0);
});
for(const change of ['price','coupon','spec'])test('提交前 '+change+' 变化要求重新确认，创建数为0',async t=>{
 const h=await harness(t,{quote:n=>{const d=quoted();if(n>1){if(change==='price'){d.discountPrice=10;d.privilegeMoney=19.9;}if(change==='coupon')d.couponCodeList=['SYNTHETIC-OTHER'];if(change==='spec')d.productInfoList[0].additionDesc='合成规格变化';}return d;}}),token=await h.grant(),p=await h.prepare(token.access_token);await h.confirm(p.intentId);
 const r=await h.call(token.access_token,'createOrder',{intentId:p.intentId});assert(r.content[0].text.includes('ORDER_QUOTE_CHANGED_RECONFIRM'));assert.equal(h.read(p.intentId).state,'REQUOTE_REQUIRED');assert.equal(h.calls.filter(c=>c.name==='createOrder').length,0);
});
test('商品数量或SKU与预览不符时不生成可确认intent',async t=>{
 const h=await harness(t,{quote:()=>{const q=quoted();q.productInfoList[0].skuCode='SYNTHETIC-WRONG';return q;}}),token=await h.grant();const r=await h.call(token.access_token,'previewOrder',draft);assert(r.isError);assert(r.content[0].text.includes('ORDER_PRODUCTS_MISMATCH'));assert.equal(h.calls.filter(c=>c.name==='createOrder').length,0);
});
test('批准过期不提交，另一个同主人OAuth授权链也不能消费该批准',async t=>{
 const h=await harness(t),a=await h.grant(),b=await h.grant(),p=await h.prepare(a.access_token);await h.confirm(p.intentId);
 assert((await h.call(b.access_token,'createOrder',{intentId:p.intentId})).isError);h.advance(120001);assert((await h.call(a.access_token,'createOrder',{intentId:p.intentId})).isError);assert.equal(h.calls.filter(c=>c.name==='createOrder').length,0);
});
test('refresh保持绑定，重启后已批准intent可恢复；并发与重放最多一次创建',async t=>{
 const h=await harness(t),a=await h.grant(),p=await h.prepare(a.access_token);await h.confirm(p.intentId);
 const refresh=await h.form({grant_type:'refresh_token',client_id:orders.client,refresh_token:a.refresh_token});assert.equal(refresh.status,200);await h.restart();
 await Promise.all([h.call(refresh.body.access_token,'createOrder',{intentId:p.intentId}),h.call(refresh.body.access_token,'createOrder',{intentId:p.intentId})]);assert.equal(h.calls.filter(c=>c.name==='createOrder').length,1);
 await h.restart();const r=await h.call(refresh.body.access_token,'createOrder',{intentId:p.intentId});assert.equal(r.structuredContent.orderId,'9000000000000000001');assert.equal(h.calls.filter(c=>c.name==='createOrder').length,1);
});
test('撤销订单授权使待确认链接失效，catalog授权保持',async t=>{
 const h=await harness(t),a=await h.grant(),c=await h.grant(catalog),p=await h.prepare(a.access_token);
 assert.equal((await h.inject({method:'POST',url:base+'/revoke-orders',headers:ownerHeaders,payload:{}})).statusCode,200);
 assert.equal((await h.inject({url:'/api/luckin/orders/confirm/'+p.intentId+'/details',headers:ownerHeaders})).statusCode,404);
 assert.equal((await h.rpc(a.access_token,'createOrder',{intentId:p.intentId})).statusCode,401);
 for(const [token,kind] of [[c,catalog]])assert.equal((await h.rpc(token.access_token,'tools/list',undefined,kind)).statusCode,200);
});
test('发送后异常记录UNKNOWN，重启与重试不再发送create或preview',async t=>{
 const h=await harness(t,{createFailure:true}),a=await h.grant(),p=await h.prepare(a.access_token);await h.confirm(p.intentId);
 assert((await h.call(a.access_token,'createOrder',{intentId:p.intentId})).isError);assert.equal(h.read(p.intentId).state,'UNKNOWN');const n=h.calls.length;await h.restart();
 const r=await h.call(a.access_token,'createOrder',{intentId:p.intentId});assert(r.content[0].text.includes('ORDER_RESULT_UNKNOWN_DO_NOT_RETRY'));assert.equal(h.calls.length,n);assert.equal(h.calls.filter(c=>c.name==='createOrder').length,1);
});
test('持久SUBMITTING或遗留锁一律不重发',async t=>{
 const h=await harness(t),a=await h.grant(),p=await h.prepare(a.access_token);await h.confirm(p.intentId);const v=h.read(p.intentId);v.state='SUBMITTING';delete v.approvedUntil;writeFileSync(join(h.root,'luckin-orders',p.intentId+'.json'),JSON.stringify(v),{mode:0o600});const n=h.calls.length;
 assert((await h.call(a.access_token,'createOrder',{intentId:p.intentId})).isError);writeFileSync(join(h.root,'luckin-orders',p.intentId+'.lock'),'synthetic orphan',{mode:0o600});assert((await h.call(a.access_token,'createOrder',{intentId:p.intentId})).isError);assert.equal(h.calls.length,n);
});
test('订单号精度不安全且缺orderIdStr时失败关闭，不能查询错单或重建',async t=>{
 const h=await harness(t,{created:{orderIdStr:undefined}}),a=await h.grant(),p=await h.prepare(a.access_token);await h.confirm(p.intentId);assert((await h.call(a.access_token,'createOrder',{intentId:p.intentId})).isError);assert.equal(h.read(p.intentId).state,'UNKNOWN');assert.equal(h.calls.filter(c=>c.name==='createOrder').length,1);
});
test('二维码域名不合法时保留已创建订单，不返回危险URL或重复创建',async t=>{
 const h=await harness(t,{created:{payOrderQrCodeUrl:'https://attacker.invalid/payment'}}),a=await h.grant(),p=await h.prepare(a.access_token);await h.confirm(p.intentId);
 const r=await h.call(a.access_token,'createOrder',{intentId:p.intentId});assert.equal(r.structuredContent.state,'CREATED');assert.equal(r.structuredContent.qrUnavailable,true);assert.equal(r.structuredContent.payOrderQrCodeUrl,undefined);await h.call(a.access_token,'createOrder',{intentId:p.intentId});assert.equal(h.calls.filter(c=>c.name==='createOrder').length,1);
});
test('非已知支付状态隐藏取餐信息；查询只使用服务端订单号',async t=>{
 const h=await harness(t),a=await h.grant(),p=await h.prepare(a.access_token);await h.confirm(p.intentId);await h.call(a.access_token,'createOrder',{intentId:p.intentId});h.status(999);
 const r=await h.call(a.access_token,'queryOrderDetailInfo',{intentId:p.intentId});assert.equal(r.structuredContent.paymentStatus,'unknown');assert.equal(r.structuredContent.takeMealCode,undefined);assert.deepEqual(h.calls.at(-1).arguments,{orderId:'9000000000000000001'});
});
test('fsync持久提交标记失败时，绝不发出create请求',async t=>{
 const root=mkdtempSync(join(tmpdir(),'intent-fsync-'));t.after(()=>rmSync(root,{recursive:true,force:true}));let creates=0;
 const service=new LuckinOrdersService({root,publicOrigin:origin,createEnabled:true,active:()=>true,reader:{call:async name=>{if(name==='createOrder')creates++;return success(quoted());}}});
 const p=(await service.call(binding,'previewOrder',draft)).structuredContent;const review=service.review(p.intentId,binding.ownerId);await service.approve(p.intentId,binding.ownerId,review.nonce);
 const put=service.store.put.bind(service.store);service.store.put=v=>{if(v.state==='SUBMITTING')throw Error('SYNTHETIC_FSYNC_FAILED');put(v);};assert((await service.call(binding,'createOrder',{intentId:p.intentId})).isError);assert.equal(creates,0);
});
test('金额小数精确校验；二维码只接受官方HTTPS，选中码只允许3',async()=>{
 assert.equal(yuanMinor(9.9),990);assert.equal(yuanMinor('0.29'),29);for(const v of [-1,NaN,Infinity,'1.001','1e3'])assert.throws(()=>yuanMinor(v));
 for(const v of ['http://opentest03.lkcoffee.com/x','https://lkcoffee.com.attacker.invalid/x','https://u@lkcoffee.com/x','javascript:alert(1)'])assert.equal(paymentQr(v),undefined);
 let n=0;const reader=new LuckinMcpClient({token:secret,mode:'orders',transport:async()=>{n++;throw Error('DENIED');}});
 for(const operation of [0,1,2,17])await assert.rejects(reader.call('switchProduct',{deptId:91001,productId:91002,skuCode:'SYNTHETIC',amount:1,attrOperationParam:{attributeId:1,subAttr:{attributeId:2,operation}}}));assert.equal(n,0);
});

test('真实凭据被上游回显到二维码也不能成为支付链接',async t=>{
 const h=await harness(t,{created:{payOrderQrCodeUrl:'https://opentest03.lkcoffee.com/transfer/qrcode?token='+secret}}),a=await h.grant(),p=await h.prepare(a.access_token);await h.confirm(p.intentId);
 const r=await h.call(a.access_token,'createOrder',{intentId:p.intentId});assert.equal(r.structuredContent.qrUnavailable,true);assert.equal(r.structuredContent.payOrderQrCodeUrl,undefined);assert(!JSON.stringify(r).includes(secret));assert(!h.logs().includes(secret));
});
for(const kind of ['negative','mismatch','coupon','shop'])test('报价异常失败关闭：'+kind,async t=>{
 const h=await harness(t,{quote:()=>{const q=quoted();if(kind==='negative')q.discountPrice=-1;if(kind==='mismatch')q.discountPrice=1;if(kind==='coupon')q.couponCodeList=['[REDACTED]'];if(kind==='shop')q.shopInfo.deptId=91003;return q;}}),a=await h.grant();
 assert((await h.call(a.access_token,'previewOrder',draft)).isError);assert.equal(h.calls.filter(c=>c.name==='createOrder').length,0);
});
for(const race of ['revoked','expired'])test('复核报价期间授权或批准失效不得提交：'+race,async t=>{
 let h;h=await harness(t,{quote:async n=>{if(n>1){if(race==='expired')h.advance(120001);else await h.inject({method:'POST',url:base+'/revoke-orders',headers:ownerHeaders,payload:{}});}return quoted();}});
 const a=await h.grant(),p=await h.prepare(a.access_token);await h.confirm(p.intentId);assert((await h.call(a.access_token,'createOrder',{intentId:p.intentId})).isError);assert.equal(h.calls.filter(c=>c.name==='createOrder').length,0);
});

test('创建上游真正超时后记录UNKNOWN，不自动重复创建',async t=>{
 const h=await harness(t,{createFailure:'hang',timeoutMs:200}),a=await h.grant(),p=await h.prepare(a.access_token);await h.confirm(p.intentId);
 const r=await h.call(a.access_token,'createOrder',{intentId:p.intentId});assert(r.isError);assert.equal(h.read(p.intentId).state,'UNKNOWN');const n=h.calls.length;
 await h.call(a.access_token,'createOrder',{intentId:p.intentId});assert.equal(h.calls.length,n);assert.equal(h.calls.filter(c=>c.name==='createOrder').length,1);
});

test('官方返回无需付款时不要求扫码，也不重复创建',async t=>{
 const h=await harness(t,{quote:()=>({...quoted(),privilegeMoney:29.9,discountPrice:0}),created:{needPay:false,discountPrice:0,payOrderQrCodeUrl:undefined}}),a=await h.grant(),p=await h.prepare(a.access_token);await h.confirm(p.intentId);
 const r=await h.call(a.access_token,'createOrder',{intentId:p.intentId});assert.equal(r.structuredContent.needPay,false);assert.equal(r.structuredContent.qrUnavailable,false);assert.equal(r.structuredContent.payOrderQrCodeUrl,undefined);assert(r.structuredContent.notice.includes('无需支付'));assert.equal(h.calls.filter(c=>c.name==='createOrder').length,1);
});
test('下单成功状态20不直接断言已支付或泄露取餐码',async t=>{
 const h=await harness(t),a=await h.grant(),p=await h.prepare(a.access_token);await h.confirm(p.intentId);await h.call(a.access_token,'createOrder',{intentId:p.intentId});h.status(20);
 const r=await h.call(a.access_token,'queryOrderDetailInfo',{intentId:p.intentId});assert.equal(r.structuredContent.orderStatusName,'下单成功');assert.equal(r.structuredContent.paymentStatus,'unknown');assert.equal(r.structuredContent.takeMealCode,undefined);
});
