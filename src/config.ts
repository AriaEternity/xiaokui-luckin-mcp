import {resolve,isAbsolute} from 'node:path';
export interface AppConfig { publicOrigin: string }
export interface RuntimeConfig extends AppConfig {
  root: string; port: number; ownerFile: string;
  previewEnabled: boolean; ordersEnabled: boolean; createEnabled: boolean;
  synthetic: boolean; credentialFile?: string;
}
function flag(value: string | undefined) {
  if (value !== undefined && !['true','false'].includes(value)) throw Error('CONFIG_FLAG_INVALID');
  return value === 'true';
}
export function loadRuntimeConfig(env: NodeJS.ProcessEnv): RuntimeConfig {
  const publicOrigin = env.PUBLIC_ORIGIN ?? '';
  const url = new URL(publicOrigin);
  if (url.origin !== publicOrigin || url.protocol !== 'https:' || url.username || url.password) throw Error('PUBLIC_ORIGIN_HTTPS_REQUIRED');
  const root=resolve(env.DATA_ROOT ?? './data');
  const port=Number(env.PORT ?? 4318);
  if(!Number.isSafeInteger(port)||port<1024||port>65535)throw Error('PORT_INVALID');
  const previewEnabled=flag(env.ENABLE_PREVIEW),ordersEnabled=flag(env.ENABLE_ORDERS),createEnabled=flag(env.ENABLE_ORDER_CREATE),synthetic=flag(env.SYNTHETIC_UPSTREAM);
  if(createEnabled&&!ordersEnabled)throw Error('CREATE_REQUIRES_ORDERS');
  const ownerFile=resolve(env.OWNER_FILE ?? root+'/owner.json');
  const credentialFile=env.LUCKIN_TOKEN_FILE ?? (env.CREDENTIALS_DIRECTORY?env.CREDENTIALS_DIRECTORY+'/luckin-token':undefined);
  if(credentialFile!==undefined&&!isAbsolute(credentialFile))throw Error('CREDENTIAL_PATH_ABSOLUTE_REQUIRED');
  if(!synthetic&&!credentialFile)throw Error('CREDENTIAL_FILE_REQUIRED');
  return {publicOrigin,root,port,ownerFile,previewEnabled,ordersEnabled,createEnabled,synthetic,...(credentialFile?{credentialFile}:{})};
}
