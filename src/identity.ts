import type {FastifyInstance} from 'fastify';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import {randomBytes,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {readPrivateFile} from './secrets.js';

const scrypt=promisify(scryptCallback);
export interface OwnerSession {ownerId:string;csrfToken:string}
export type SessionInspector=(cookie:string)=>Promise<OwnerSession|undefined>;
export interface OwnerIdentity {
  ownerId:string;
  inspectSession:SessionInspector;
  register(app:FastifyInstance):void;
}
interface OwnerRecord {version:1;ownerId:string;username:string;salt:string;hash:string}
const random=()=>randomBytes(32).toString('base64url');
export function sameSecret(a:string,b:string) {
  const left=Buffer.from(a),right=Buffer.from(b);
  return left.length===right.length&&timingSafeEqual(left,right);
}
export function protectedOwner(origin:string,inspect:SessionInspector) {
  return async (request:{headers:Record<string,unknown>})=> {
    if(request.headers.origin!==origin)return undefined;
    const session=await inspect(typeof request.headers.cookie==='string'?request.headers.cookie:'');
    const supplied=request.headers['x-csrf-token'];
    if(!session||typeof supplied!=='string'||supplied.length>256||!sameSecret(supplied,session.csrfToken))return undefined;
    return session;
  };
}
export function localOwnerIdentity(options:{file:string;publicOrigin:string;now?:()=>number}):OwnerIdentity {
  const owner=JSON.parse(readPrivateFile(options.file,16384).toString('utf8')) as OwnerRecord;
  if(owner.version!==1||!/^[\w-]{1,128}$/.test(owner.ownerId)||typeof owner.username!=='string'||!owner.username||owner.username.length>128||!/^[a-f0-9]{32}$/.test(owner.salt)||!/^[a-f0-9]{128}$/.test(owner.hash))throw Error('OWNER_RECORD_INVALID');
  const now=options.now??Date.now;
  const sessions=new Map<string,{expires:number;csrfToken:string}>();
  const inspectSession:SessionInspector=async header=>{
    if(header.length>4096)return undefined;
    const value=header.split(';').map(v=>v.trim()).find(v=>v.startsWith('__Host-luckin-session='))?.slice('__Host-luckin-session='.length);
    if(!value)return undefined;
    const session=sessions.get(value);
    if(!session||session.expires<=now()){sessions.delete(value);return undefined;}
    return {ownerId:owner.ownerId,csrfToken:session.csrfToken};
  };
  return {ownerId:owner.ownerId,inspectSession,register(app){
    app.register(async scope=>{
      await scope.register(cookie);
      await scope.register(rateLimit,{max:120,timeWindow:60000,keyGenerator:()=> 'single-owner-auth'});
      scope.addHook('onSend',async(_req,reply)=>{reply.header('Cache-Control','no-store');reply.header('Referrer-Policy','no-referrer');});
      scope.get('/auth/session',async(req,reply)=>{
        const session=await inspectSession(req.headers.cookie??'');
        return session??reply.code(401).send({error:'login_required'});
      });
      scope.post<{Body:{username?:unknown;password?:unknown}}>('/auth/login',{
        bodyLimit:2048,config:{rateLimit:{max:5,timeWindow:900000,keyGenerator:()=> 'single-owner-login'}},
      },async(req,reply)=>{
        if(req.headers.origin!==options.publicOrigin)return reply.code(403).send({error:'access_denied'});
        if(typeof req.body?.username!=='string'||typeof req.body.password!=='string'||req.body.password.length>512||req.body.username.length>128)return reply.code(400).send({error:'invalid_request'});
        // 一律执行代价固定的口令校验，不记录用户名、口令、Cookie或CSRF。
        const computed=Buffer.from(await scrypt(req.body.password,owner.salt,64) as Buffer);
        req.body.password='';
        if(!sameSecret(req.body.username,owner.username)||!timingSafeEqual(computed,Buffer.from(owner.hash,'hex')))return reply.code(401).send({error:'login_failed'});
        for(const [key,value] of sessions)if(value.expires<=now())sessions.delete(key);
        if(sessions.size>=32)return reply.code(429).send({error:'session_capacity'});
        const token=random();sessions.set(token,{expires:now()+8*60*60*1000,csrfToken:random()});
        reply.setCookie('__Host-luckin-session',token,{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:8*60*60});
        return {status:'logged_in'};
      });
      scope.post('/auth/logout',async(req,reply)=>{
        if(!await protectedOwner(options.publicOrigin,inspectSession)(req))return reply.code(403).send({error:'access_denied'});
        const token=req.cookies['__Host-luckin-session'];if(token)sessions.delete(token);
        reply.clearCookie('__Host-luckin-session',{path:'/',secure:true,httpOnly:true,sameSite:'lax'});
        return {status:'logged_out'};
      });
    });
  }};
}
