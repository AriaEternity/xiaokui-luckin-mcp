const escape=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function consentPage(requestId:string,clientName:string,scope:string,nonce:string):string {
 const description=scope==='luckin:orders:create'?'允许查询、选规格、预览，以及本人逐笔批准后的创建和订单查询。OAuth同意不批准任何一笔订单，付款由本人完成。':scope==='luckin:checkout:preview'?'允许查询、选规格及订单预览，可能使用官方自动优惠；不能创建、取消或支付。':'仅查询门店和商品；不能预览、创建、取消或支付。';
 return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>小葵 · 瑞幸授权</title>
<style>body{font:16px/1.7 system-ui;background:#17101d;color:#ffedf5;margin:0}main{max-width:540px;margin:6vh auto;padding:24px}input,button{font:inherit;padding:10px;margin:5px 0}input{box-sizing:border-box;display:block;width:100%}button{cursor:pointer}small{color:#cbb8c5}</style>
<main><h1>小葵 · 瑞幸授权</h1><p>连接：${escape(clientName)}</p><p>${description}</p><p id="status">正在核验登录…</p>
<form id="login" hidden><label>用户名<input id="username" autocomplete="username" required></label><label>口令<input id="password" type="password" autocomplete="current-password" required></label><button>登录</button></form>
<div id="actions" hidden><button id="allow">同意连接</button><button id="deny">拒绝</button><button id="revoke">撤销本资源授权</button></div><small>口令只发送到当前自托管网站，不发送给ChatGPT或瑞幸。访问令牌15分钟，授权最长30天。</small></main>
<script nonce="${nonce}">
const requestId=${JSON.stringify(requestId)},status=document.querySelector('#status'),login=document.querySelector('#login'),actions=document.querySelector('#actions');let csrf='';
async function session(){const r=await fetch('/auth/session',{credentials:'same-origin',cache:'no-store'});if(!r.ok){login.hidden=false;actions.hidden=true;status.textContent='请使用本服务主人账户登录。';return;}csrf=(await r.json()).csrfToken;login.hidden=true;actions.hidden=false;status.textContent='请本人核对后决定是否连接。';}
login.addEventListener('submit',async e=>{e.preventDefault();const p=document.querySelector('#password'),body=JSON.stringify({username:document.querySelector('#username').value,password:p.value});p.value='';try{const r=await fetch('/auth/login',{method:'POST',headers:{'content-type':'application/json'},credentials:'same-origin',body});if(!r.ok){status.textContent='登录失败或请求过多，请稍后重试。';return;}await session();}catch{status.textContent='登录服务暂不可用。';}});
async function act(decision){document.querySelectorAll('button').forEach(b=>b.disabled=true);try{const r=await fetch('/oauth/'+(decision==='revoke'?'revoke-resource':'consent'),{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify({request:requestId,decision})});if(!r.ok){status.textContent='未完成授权，请重新发起连接。';return;}const data=await r.json();if(data.redirectUrl)location.assign(data.redirectUrl);else status.textContent='本资源授权已撤销。';}catch{status.textContent='服务暂不可用。';}finally{document.querySelectorAll('button').forEach(b=>b.disabled=false);}}
for(const key of ['allow','deny','revoke'])document.querySelector('#'+key).onclick=()=>act(key);session().catch(()=>status.textContent='服务暂不可用。');
</script></html>`;
}
