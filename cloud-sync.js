(function(root){
'use strict';
const API='https://uno-spazio-per-te.daintysiren.chatgpt.site',encoder=new TextEncoder();
const hex=buffer=>Array.from(new Uint8Array(buffer),b=>b.toString(16).padStart(2,'0')).join('');
const digest=s=>crypto.subtle.digest('SHA-256',encoder.encode(s));
const params=new URLSearchParams(location.hash.slice(1));let secret=params.get('chat');
if(secret&&!/^[A-Za-z0-9_-]{43}$/.test(secret))secret=null;
try{if(secret)localStorage.setItem('fabio-cloud-access',secret);else secret=localStorage.getItem('fabio-cloud-access')}catch{}
if(!secret){root.ChatCloud=null;return}
let auth,key,identity;
const ready=(async()=>{auth=hex(await digest('auth:'+secret));identity=hex(await digest('store:'+secret)).slice(0,24);key=await crypto.subtle.importKey('raw',await digest('enc:'+secret),{name:'AES-GCM'},false,['encrypt','decrypt']);return identity})();
async function request(path,options={}){await ready;const response=await fetch(API+path,{...options,headers:{Authorization:'Bearer '+auth,...options.headers},cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'});if(!response.ok)throw Error(response.status===401?'Il link riservato non è valido.':'Archivio online non raggiungibile.');return response}
async function encrypt(value,aad){await ready;const iv=crypto.getRandomValues(new Uint8Array(12));const bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(aad)},key,encoder.encode(JSON.stringify(value)));const result=new Uint8Array(12+bytes.byteLength);result.set(iv);result.set(new Uint8Array(bytes),12);return result}
async function decrypt(buffer,aad){await ready;const bytes=new Uint8Array(buffer);return crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12),additionalData:encoder.encode(aad)},key,bytes.slice(12))}
root.ChatCloud={ready,async seed(){const response=await request('/api/seed');return decrypt(await response.arrayBuffer(),'seed-v1')},async put(record){const clean={...record};delete clean.pendingCloud;const payload=await encrypt(clean,record.id);await request('/api/messages/'+record.id,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:payload})},async list(){let cursor=null,ids=[];do{const result=await(await request('/api/list'+(cursor?'?cursor='+encodeURIComponent(cursor):''))).json();ids.push(...result.ids);cursor=result.cursor}while(cursor);return ids},async get(id){const response=await request('/api/messages/'+id),value=JSON.parse(new TextDecoder().decode(await decrypt(await response.arrayBuffer(),id)));if(value.id!==id||!Number.isFinite(value.date)||typeof value.value!=='string'||!['text','image','video','audio','file'].includes(value.type))throw Error('Messaggio online non valido.');return value}};
})(window);
