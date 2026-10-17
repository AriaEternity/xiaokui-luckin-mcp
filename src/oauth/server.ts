import express from 'express';
import rateLimit from '@fastify/rate-limit';
import {randomBytes} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import type {OAuthClientInformationFull} from '@modelcontextprotocol/sdk/shared/auth.js';
import type {OAuthServerProvider,AuthorizationParams} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import {authorizationHandler} from '@modelcontextprotocol/sdk/server/auth/handlers/authorize.js';
import {tokenHandler} from '@modelcontextprotocol/sdk/server/auth/handlers/token.js';
import {revocationHandler} from '@modelcontextprotocol/sdk/server/auth/handlers/revoke.js';
import {InvalidScopeError,InvalidTargetError,InvalidRequestError,TooManyRequestsError} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import {OAuthStore} from './store.js';
import {consentPage} from './page.js';
import {protectedOwner,type OwnerIdentity} from '../identity.js';
import type {McpAuthorization} from '../mcp/authorization.js';
export interface ResourceProfile {path:string;scope:string;clientId:string;name:string}
type Pending={profile:ResourceProfile;params:AuthorizationParams;expires:number};
export function createOAuth(options:{root:string;publicOrigin:string;identity:OwnerIdentity;profiles:ResourceProfile[];redirectUri?:string;now?:()=>number}) {
 const origin=options.publicOrigin,now=options.now??Date.now,base='/oauth';
 if(new URL(origin).origin!==origin||!origin.startsWith('https://')||!options.profiles.length)throw Error('OAUTH_CONFIG_INVALID');
 const redirectUri=options.redirectUri??'https://chatgpt.com/connector_platform_oauth_redirect';
 if(new URL(redirectUri).protocol!=='https:')throw Error('OAUTH_REDIRECT_HTTPS_REQUIRED');
 const policies=options.profiles.map(p=>({resource:origin+p.path,scope:p.scope,client:p.clientId,owner:options.identity.ownerId}));
 const first=policies[0]!;
 const store=new OAuthStore(options.root,first.resource,first.scope,now,policies);
 const clients=new Map(options.profiles.map(profile=>[profile.clientId,{client_id:profile.clientId,client_name:profile.name,redirect_uris:[redirectUri],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code'],scope:profile.scope} satisfies OAuthClientInformationFull]));
 const pending=new Map<string,Pending>();
 const provider:OAuthServerProvider={
  clientsStore:{getClient:id=>clients.get(id)},
  async authorize(client,params,response){
   const profile=options.profiles.find(p=>p.clientId===client.client_id);
   if(!profile||params.resource?.href!==origin+profile.path)throw new InvalidTargetError('授权资源不匹配。');
   if(params.scopes?.length&&(params.scopes.length!==1||params.scopes[0]!==profile.scope))throw new InvalidScopeError('授权权限不匹配。');
   if(!/^[\w-]{43}$/.test(params.codeChallenge)||(params.state?.length??0)>1024)throw new InvalidRequestError('授权参数无效。');
   for(const [id,entry] of pending)if(entry.expires<=now())pending.delete(id);
   if(pending.size>=100)throw new TooManyRequestsError('待确认连接过多。');
   const id=randomBytes(32).toString('base64url');pending.set(id,{profile,params,expires:now()+600000});
   response.redirect(303,origin+base+'/consent?request='+id);
  },
  async challengeForAuthorizationCode(client,code){return store.code(client.client_id,code).challenge;},
  async exchangeAuthorizationCode(client,code,_verifier,redirect,target){return store.exchange(client.client_id,code,redirect,target);},
  async exchangeRefreshToken(client,token,scopes,target){return store.refresh(client.client_id,token,scopes,target);},
  async verifyAccessToken(token){return store.verifyAny(token);},
  async revokeToken(client,request){store.revoke(client.client_id,request.token);},
 };
 const handlers=express();handlers.disable('x-powered-by');
 // RFC 9207：成功/拒绝/SDK生成的错误授权回跳都携带同一issuer。
 handlers.use((_req,res,next)=>{
  const redirect=res.redirect.bind(res);
  res.redirect=((statusOrUrl:number|string,url?:string)=>{
   const status=typeof statusOrUrl==='number'?statusOrUrl:302;
   const target=new URL(typeof statusOrUrl==='string'?statusOrUrl:url!);
   const registered=new URL(redirectUri);
   if(target.origin===registered.origin&&target.pathname===registered.pathname)target.searchParams.set('iss',origin);
   return redirect(status,target.href);
  }) as express.Response['redirect'];
  next();
 });
 handlers.use(express.urlencoded({extended:false,limit:8192}));
 handlers.use(base+'/authorize',authorizationHandler({provider}));handlers.use(base+'/token',tokenHandler({provider}));handlers.use(base+'/revoke',revocationHandler({provider}));
 handlers.use((_req,res)=>{res.status(404).json({error:'invalid_request'});});
 handlers.use(((error:{status?:number},_req:unknown,res:express.Response,_next:unknown)=>{res.status(error.status===413?413:400).json({error:'invalid_request'});}) as express.ErrorRequestHandler);
 function authorization(profile:ResourceProfile):McpAuthorization&{identify:(header:string|undefined)=>ReturnType<OAuthStore['binding']>;active:OAuthStore['grantActive']} {
  const extract=(header:string|undefined)=>header?.match(/^Bearer ([\w-]{43})$/i)?.[1]??'';
  return {challenge:`Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource${profile.path}", scope="${profile.scope}"`,securitySchemes:[{type:'oauth2',scopes:[profile.scope]}],async authorize(header){store.verify(extract(header),origin+profile.path);},identify:header=>store.binding(extract(header),origin+profile.path),active:binding=>store.grantActive(binding)};
 }
 function register(app:FastifyInstance){
  app.addHook('onClose',async()=>store.close());
  app.register(async scope=>{
   await scope.register(rateLimit,{max:60,timeWindow:60000,keyGenerator:()=> 'single-owner-oauth'});
   scope.addHook('onSend',async(_req,reply)=>{reply.header('Cache-Control','no-store');reply.header('Referrer-Policy','no-referrer');});
   scope.get('/.well-known/oauth-authorization-server',async()=>({issuer:origin,authorization_endpoint:origin+base+'/authorize',token_endpoint:origin+base+'/token',revocation_endpoint:origin+base+'/revoke',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],token_endpoint_auth_methods_supported:['none'],revocation_endpoint_auth_methods_supported:['none'],code_challenge_methods_supported:['S256'],scopes_supported:options.profiles.map(p=>p.scope),authorization_response_iss_parameter_supported:true}));
   for(const profile of options.profiles){
    const metadata={resource:origin+profile.path,authorization_servers:[origin],scopes_supported:[profile.scope],bearer_methods_supported:['header'],resource_name:profile.name};
    scope.get('/.well-known/oauth-protected-resource'+profile.path,async()=>metadata);
    if(profile===options.profiles[0])scope.get('/.well-known/oauth-protected-resource',async()=>metadata);
   }
   for(const path of ['/authorize','/token','/revoke'])scope.route({method:['GET','POST','OPTIONS','HEAD'],url:base+path,async onRequest(request,reply){
    reply.hijack();reply.raw.setHeader('Cache-Control','no-store');reply.raw.setHeader('Referrer-Policy','no-referrer');
    await new Promise<void>(resolve=>{reply.raw.once('finish',resolve);reply.raw.once('close',resolve);handlers(request.raw,reply.raw);});
   },async handler(){}});
   scope.get<{Querystring:{request?:string}}>(base+'/consent',async(req,reply)=>{
    const id=req.query.request??'',entry=pending.get(id);
    if(!entry||entry.expires<=now())return reply.code(400).send({error:'authorization_expired'});
    const nonce=randomBytes(24).toString('base64url');
    reply.header('Content-Security-Policy',`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
    return reply.type('text/html; charset=utf-8').send(consentPage(id,entry.profile.name,entry.profile.scope,nonce));
   });
   const authenticate=protectedOwner(origin,options.identity.inspectSession);
   scope.post<{Body:{request?:string;decision?:string}}>(base+'/consent',{bodyLimit:8192},async(req,reply)=>{
    const owner=await authenticate(req);
    if(!owner||owner.ownerId!==options.identity.ownerId)return reply.code(403).send({error:'access_denied'});
    const id=req.body?.request??'',entry=pending.get(id);
    if(!entry||entry.expires<=now()||!['allow','deny'].includes(req.body?.decision??''))return reply.code(400).send({error:'invalid_request'});
    pending.delete(id);const redirect=new URL(entry.params.redirectUri);redirect.searchParams.set('iss',origin);
    if(entry.params.state)redirect.searchParams.set('state',entry.params.state);
    if(req.body.decision==='deny')redirect.searchParams.set('error','access_denied');
    else redirect.searchParams.set('code',store.issueCode({client:entry.profile.clientId,challenge:entry.params.codeChallenge,redirect:entry.params.redirectUri,resource:origin+entry.profile.path,owner:owner.ownerId}));
    return {redirectUrl:redirect.href};
   });
   scope.post<{Body:{request?:string}}>(base+'/revoke-resource',{bodyLimit:8192},async(req,reply)=>{
    const owner=await authenticate(req),entry=pending.get(req.body?.request??'');
    if(!owner||owner.ownerId!==options.identity.ownerId)return reply.code(403).send({error:'access_denied'});
    if(!entry||entry.expires<=now())return reply.code(400).send({error:'invalid_request'});
    store.revokeResource(owner.ownerId,origin+entry.profile.path);return {status:'revoked'};
   });
   for(const profile of options.profiles)scope.post(base+'/revoke-'+profile.path.split('/').filter(Boolean).slice(-2,-1)[0],{bodyLimit:8192},async(req,reply)=>{
    const owner=await authenticate(req);if(!owner||owner.ownerId!==options.identity.ownerId)return reply.code(403).send({error:'access_denied'});
    store.revokeResource(owner.ownerId,origin+profile.path);return {status:'revoked'};
   });
  });
 }
 return {store,authorization,register};
}
