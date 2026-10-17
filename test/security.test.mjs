import './network-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,readdirSync,rmSync,chmodSync,symlinkSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {scryptSync,randomBytes,createHash} from 'node:crypto';
import {LuckinMcpClient} from '../dist/mcp/luckin-client.js';
import {createBridge} from '../dist/app.js';
import {localOwnerIdentity} from '../dist/identity.js';
import {readPrivateFile,luckinCredential} from '../dist/secrets.js';
import {loadRuntimeConfig} from '../dist/config.js';
import {OAuthStore} from '../dist/oauth/store.js';
process.umask(0o077);
const token='SYNTHETIC-SECRET-NOT-A-REAL-CREDENTIAL',origin='https://synthetic.example';
const args={longitude:0,latitude:0};
function upstream(result,{status=200,sse=false,hang=false}={}) {
 let calls=0;
 const transport=async(_url,init)=>{
  assert.equal(String(_url),'https://gwmcp.lkcoffee.com/order/user/mcp');
  assert.equal(init.redirect,'error');assert.equal(new Headers(init.headers).get('authorization'),'Bearer '+token);
  if(init.method==='GET')return new Response(null,{status:405});
  const request=JSON.parse(init.body);
  if(request.method==='initialize')return Response.json({jsonrpc:'2.0',id:request.id,result:{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'synthetic',version:'1'}}});
  if(request.method==='notifications/initialized')return new Response(null,{status:202});
  calls++;
  if(hang)return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Error('SYNTHETIC_ABORT')),{once:true}));
  if(status!==200)return new Response(null,{status});
  const body={jsonrpc:'2.0',id:request.id,result};
  return sse?new Response('data: '+JSON.stringify(body)+'\n\n',{headers:{'content-type':'text/event-stream'}}):Response.json(body);
 };
 return {transport,calls:()=>calls};
}
const success=value=>({isError:false,content:[{type:'text',text:JSON.stringify({code:0,data:value})}]});
const redactionCases={
 nested:{deep:{text:token,authorization:'Bearer '+token,normal:'保留商品名'}},
 arrays:[{secret:token},token,{inner:[token]}],
 textJson:JSON.stringify({text:token,array:[JSON.stringify({text:token})]}),
 keyName:{['prefix-'+token+'-suffix']:'removed',normal:'正常字段'},
 escaped:'\\u'+token.charCodeAt(0).toString(16).padStart(4,'0')+token.slice(1),
};
for(const [name,value] of Object.entries(redactionCases))test('脱敏：'+name,async()=>{
 const fake=upstream(success(value)),client=new LuckinMcpClient({token,transport:fake.transport});
 const result=await client.call('queryShopList',args);assert(!JSON.stringify(result).includes(token));
 if(name==='escaped')assert(result.isError); // 无法确认编码后的凭据已清理时失败关闭。
});
test('structuredContent及其键名同样脱敏',async()=>{
 const fake=upstream({isError:false,content:[{type:'text',text:'合成商品'}],structuredContent:{normal:'保留',nested:{[token]:'remove',text:token},cookie:'remove'}});
 const result=await new LuckinMcpClient({token,transport:fake.transport}).call('queryShopList',args);
 assert.equal(result.isError,false);assert(!JSON.stringify(result).includes(token));assert.equal(result.structuredContent.normal,'保留');assert(!Object.hasOwn(result.structuredContent,'cookie'));
});
test('嵌套过深或超过结果限额时失败关闭',async()=>{
 let deep=token;for(let n=0;n<24;n++)deep={next:deep};
 for(const value of [deep,'x'.repeat(70000)]){
  const fake=upstream(success(value));const result=await new LuckinMcpClient({token,transport:fake.transport}).call('queryShopList',args);
  assert(result.isError);assert(!JSON.stringify(result).includes(token));
 }
});
for(const mode of ['catalog','preview','orders'])test('取消/支付/未知工具在'+mode+'模式请求上游前被拒绝',async()=>{
 const fake=upstream(success({})),client=new LuckinMcpClient({token,mode,transport:fake.transport});
 for(const name of ['cancelOrder','payOrder','deleteAccount','approveOrder'])await assert.rejects(client.call(name,{}));
 if(mode!=='orders')await assert.rejects(client.call('createOrder',{}));
 assert.equal(fake.calls(),0);
});
for(const [status,code] of [[401,'AUTH_FAILED'],[403,'AUTH_FAILED'],[429,'RATE_LIMITED'],[500,'UNAVAILABLE'],[302,'UNAVAILABLE']])test('HTTP错误与重定向不泄露上游内容：'+status,async()=>{
 const fake=upstream(success({}),{status}),result=await new LuckinMcpClient({token,transport:fake.transport}).call('queryShopList',args);
 assert(result.isError);assert(result.content[0].text.includes(code));assert(!JSON.stringify(result).includes(token));
});
test('业务错误与MCP错误返回有界失败',async()=>{
 for(const value of [{isError:true,content:[{type:'text',text:token}]},success({code:91,msg:token,success:false})]){
  const fake=upstream(value);const result=await new LuckinMcpClient({token,transport:fake.transport}).call('queryShopList',args);assert(result.isError);assert(!JSON.stringify(result).includes(token));
 }
});
test('JSON/SSE上游均使用完整初始化生命周期',async()=>{
 for(const sse of [false,true]){const fake=upstream(success({items:[]}),{sse}),result=await new LuckinMcpClient({token,transport:fake.transport}).call('queryShopList',args);assert.equal(result.isError,false);assert.equal(fake.calls(),1);}
});
test('超时及并发限额会释放请求',async()=>{
 const fake=upstream(success({}),{hang:true}),client=new LuckinMcpClient({token,transport:fake.transport,timeoutMs:60});
 const a=client.call('queryShopList',args),b=client.call('queryShopList',args),busy=await client.call('queryShopList',args);
 assert(busy.content[0].text.includes('LUCKIN_BUSY'));for(const value of await Promise.all([a,b]))assert(value.content[0].text.includes('LUCKIN_TIMEOUT'));
 const abort=new AbortController(),pending=client.call('queryShopList',args,abort.signal);abort.abort();assert((await pending).content[0].text.includes('LUCKIN_CANCELLED'));
});
test('凭据只接受私有常规文件，拒绝链接及宽权限',t=>{
 const root=mkdtempSync(join(tmpdir(),'luckin-secrets-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const file=join(root,'synthetic-token');writeFileSync(file,token+'\n',{mode:0o400});assert.equal(luckinCredential(file),token);
 const link=join(root,'synthetic-link');symlinkSync(file,link);assert.throws(()=>readPrivateFile(link));
 chmodSync(file,0o644);assert.throws(()=>readPrivateFile(file));chmodSync(file,0o400);
 writeFileSync(join(root,'invalid'),'bad token',{mode:0o400});assert.throws(()=>luckinCredential(join(root,'invalid')));
});
test('配置拒绝HTTP公网、非法开关、相对凭据和无意启用创建',()=>{
 for(const env of [{PUBLIC_ORIGIN:'http://synthetic.example'},{PUBLIC_ORIGIN:origin,ENABLE_ORDERS:'yes'},{PUBLIC_ORIGIN:origin,LUCKIN_TOKEN_FILE:'./token'},{PUBLIC_ORIGIN:origin,ENABLE_ORDER_CREATE:'true',SYNTHETIC_UPSTREAM:'true'}])assert.throws(()=>loadRuntimeConfig(env));
});
async function ownerApp(t){
 const root=mkdtempSync(join(tmpdir(),'luckin-owner-'));const salt=randomBytes(16).toString('hex'),password='SYNTHETIC-LONG-OWNER-PASSWORD';
 const ownerFile=join(root,'owner.json');writeFileSync(ownerFile,JSON.stringify({version:1,ownerId:'synthetic-owner',username:'owner',salt,hash:scryptSync(password,salt,64).toString('hex')}),{mode:0o600});
 const identity=localOwnerIdentity({file:ownerFile,publicOrigin:origin});
 const app=createBridge({root,publicOrigin:origin,identity,catalog:{call(){throw Error('TEST_UNEXPECTED_UPSTREAM');}}});
 await app.listen({host:'127.0.0.1',port:0});t.after(async()=>{await app.close();rmSync(root,{recursive:true,force:true});});
 const inject=options=>app.inject(options);
 const login=()=>inject({method:'POST',url:'/auth/login',headers:{origin},payload:{username:'owner',password}});
 return {root,app,inject,login,password};
}
test('独立身份登录、Secure Cookie、CSRF、OAuth同意与PKCE真实本机换码',async t=>{
 const h=await ownerApp(t);assert.equal((await h.inject({url:'/auth/session'})).statusCode,401);
 assert.equal((await h.inject({method:'POST',url:'/auth/login',headers:{origin:'https://invalid.example'},payload:{username:'owner',password:h.password}})).statusCode,403);
 const logged=await h.login();assert.equal(logged.statusCode,200);const set=logged.headers['set-cookie'];assert(set.includes('Secure')&&set.includes('HttpOnly')&&set.includes('SameSite=Lax'));assert(!set.includes('Domain='));
 const cookie=set.split(';')[0],session=await h.inject({url:'/auth/session',headers:{cookie}});assert.equal(session.statusCode,200);const csrf=session.json().csrfToken;
 const verifier='s'.repeat(48),challenge=createHash('sha256').update(verifier).digest('base64url'),client='xiaokui-chatgpt-luckin',resource=origin+'/api/luckin/mcp',callback='https://chatgpt.com/connector_platform_oauth_redirect';
 for(const wrong of [{resource:origin+'/api/luckin/orders/mcp',scope:'luckin:catalog:read',error:'invalid_target'},{resource,scope:'luckin:orders:create',error:'invalid_scope'}]){
  const denied=await h.inject({url:'/oauth/authorize?'+new URLSearchParams({client_id:client,resource:wrong.resource,scope:wrong.scope,redirect_uri:callback,response_type:'code',code_challenge:challenge,code_challenge_method:'S256'})});
  assert.equal(denied.statusCode,302);const target=new URL(denied.headers.location);assert.equal(target.searchParams.get('iss'),origin);assert.equal(target.searchParams.get('error'),wrong.error);
 }
 const authorize=await h.inject({url:'/oauth/authorize?'+new URLSearchParams({client_id:client,resource,scope:'luckin:catalog:read',redirect_uri:callback,response_type:'code',code_challenge:challenge,code_challenge_method:'S256'})});assert.equal(authorize.statusCode,303);
 const request=new URL(authorize.headers.location).searchParams.get('request');
 assert.equal((await h.inject({method:'POST',url:'/oauth/consent',headers:{cookie,origin},payload:{request,decision:'allow'}})).statusCode,403);
 const consent=await h.inject({method:'POST',url:'/oauth/consent',headers:{cookie,origin,'x-csrf-token':csrf},payload:{request,decision:'allow'}});assert.equal(consent.statusCode,200);
 const code=new URL(consent.json().redirectUrl).searchParams.get('code'),url='http://127.0.0.1:'+h.app.server.address().port;
 const wrongPkce=await fetch(url+'/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:client,code,redirect_uri:callback,resource,code_verifier:'x'.repeat(48)})});assert.equal(wrongPkce.status,400);await wrongPkce.arrayBuffer();
 const exchanged=await fetch(url+'/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:client,code,redirect_uri:callback,resource,code_verifier:verifier})});assert.equal(exchanged.status,200);assert.equal(exchanged.headers.get('cache-control'),'no-store');const tokens=await exchanged.json();assert(tokens.access_token&&tokens.refresh_token);
 const files=readdirSync(join(h.root,'oauth'));for(const file of files){const bytes=readFileSync(join(h.root,'oauth',file));assert(!bytes.includes(Buffer.from(tokens.access_token)));assert(!bytes.includes(Buffer.from(tokens.refresh_token)));assert(!bytes.includes(Buffer.from(h.password)));}
 const list=await h.inject({method:'POST',url:'/api/luckin/mcp',headers:{authorization:'Bearer '+tokens.access_token,accept:'application/json, text/event-stream','mcp-protocol-version':'2025-06-18'},payload:{jsonrpc:'2.0',id:1,method:'tools/list'}});assert.equal(list.statusCode,200);assert.equal(list.json().result.tools.length,3);
 assert.equal((await h.inject({method:'POST',url:'/auth/logout',headers:{cookie,origin,'x-csrf-token':csrf}})).statusCode,200);assert.equal((await h.inject({url:'/auth/session',headers:{cookie}})).statusCode,401);
});
test('登录尝试限流不泄露口令，登录不批准任何订单',async t=>{
 const h=await ownerApp(t);for(let n=0;n<5;n++)assert.equal((await h.inject({method:'POST',url:'/auth/login',headers:{origin},payload:{username:'owner',password:'SYNTHETIC-WRONG'}})).statusCode,401);
 const rejected=await h.login();assert.equal(rejected.statusCode,429);assert(!rejected.body.includes(h.password));assert(!readdirSync(h.root).includes('luckin-orders'));
});
test('内置SQLite事务：授权码单次消费，refresh旋转与重用撤销持久化',t=>{
 const root=mkdtempSync(join(tmpdir(),'luckin-oauth-transaction-')),resource=origin+'/api/luckin/mcp',client='synthetic-client',scope='luckin:catalog:read';
 const store=new OAuthStore(root,resource,scope,Date.now,[{resource,client,scope,owner:'synthetic-owner'}]);
 t.after(()=>{store.close();rmSync(root,{recursive:true,force:true});});
 const code=store.issueCode({client,resource,owner:'synthetic-owner',challenge:'s'.repeat(43),redirect:'https://callback.example/return'});
 const first=store.exchange(client,code,'https://callback.example/return',new URL(resource));assert.equal(store.verify(first.access_token).clientId,client);
 assert.throws(()=>store.exchange(client,code,'https://callback.example/return',new URL(resource)));
 const next=store.refresh(client,first.refresh_token);assert.throws(()=>store.verify(first.access_token));assert.equal(store.verify(next.access_token).clientId,client);
 assert.throws(()=>store.refresh(client,first.refresh_token));assert.throws(()=>store.verify(next.access_token));
});
