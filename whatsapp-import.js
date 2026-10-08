/* Parser locale: il contenuto del file non lascia il browser. */
(function(root){
'use strict';
function parseWhatsApp(source){
 const lines=source.replace(/^\uFEFF/,'').split(/\r?\n/),messages=[];let current=null,ignored=0;
 const pattern=/^[\u200e\u200f\u202a-\u202e]*\[?(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\]?\s*(?:-\s*)?(.*)$/;
 function finish(){if(!current)return;const split=current.body.indexOf(': ');current.sender=split>=0?current.body.slice(0,split).replace(/[\u200e\u200f]/g,'').trim():'';current.value=split>=0?current.body.slice(split+2):current.body;current.system=!current.sender||/crittografat[io].*end.to.end|end.to.end encrypted/i.test(current.value);const attached=current.value.match(/<\s*(?:allegato|attached):\s*([^>]+)>/i);current.attachmentName=attached?.[1]?.trim()||null;current.attachmentMissing=!!attached||/^(?:[\u200e\u200f]*)(?:immagine|video|audio|sticker|documento|GIF|image|media).*\b(?:omess[oa]|omitted)\b/i.test(current.value);delete current.body;messages.push(current)}
 for(const line of lines){const match=pattern.exec(line);if(!match){if(current)current.body+='\n'+line;else if(line.trim())ignored++;continue}finish();const [d,m,y,h,min,sec]=match.slice(1,7).map(v=>Number(v||0));const year=y<100?2000+y:y;const date=new Date(year,m-1,d,h,min,sec);if(date.getFullYear()!==year||date.getMonth()!==m-1||date.getDate()!==d||h>23||min>59||sec>59)throw Error('Una data nel file non è valida.');current={date:date.getTime(),originalDate:[String(d).padStart(2,'0'),String(m).padStart(2,'0'),String(year)].join('/'),originalTime:[String(h).padStart(2,'0'),String(min).padStart(2,'0'),String(sec).padStart(2,'0')].join(':'),body:match[7],type:'text',importOrder:messages.length};}
 finish();if(messages.length)messages[messages.length-1].value=messages[messages.length-1].value.replace(/\n$/,'');return{messages,authors:[...new Set(messages.filter(m=>!m.system).map(m=>m.sender))],ignored};
}
const mediaTypes={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',heic:'image/heic',mp4:'video/mp4',mov:'video/quicktime',webm:'video/webm',opus:'audio/ogg;codecs=opus',ogg:'audio/ogg',mp3:'audio/mpeg',m4a:'audio/mp4',aac:'audio/aac',wav:'audio/wav',pdf:'application/pdf',vcf:'text/vcard'};
const baseName=name=>name.replace(/\\/g,'/').split('/').pop().normalize('NFC');
async function readWhatsAppArchive(buffer,zipLibrary){
 const zip=await zipLibrary.loadAsync(buffer);const entries=Object.values(zip.files).filter(e=>!e.dir&&!e.name.startsWith('__MACOSX/'));
 if(entries.length>20000)throw Error('L’archivio contiene troppi file.');
 const texts=entries.filter(e=>baseName(e.name)==='_chat.txt');if(texts.length!==1)throw Error('Lo ZIP deve contenere un solo file _chat.txt.');
 const parsed=parseWhatsApp(await texts[0].async('string'));const files=new Map();for(const entry of entries){const name=baseName(entry.name);if(files.has(name))throw Error('Ci sono file con lo stesso nome in cartelle diverse.');files.set(name,entry)}
 return{...parsed,files,available:parsed.messages.filter(m=>m.attachmentName&&files.has(baseName(m.attachmentName))).length};
}
async function prepareWhatsAppMessages(parsed,ownAuthor,onProgress=()=>{}){
 const occurrences=new Map(),cache=new Map(),converted=[];let total=0;
 for(let i=0;i<parsed.messages.length;i++){
  const source=parsed.messages[i],r={...source};const canonical=JSON.stringify([r.originalDate,r.originalTime,r.sender,r.value]),nth=occurrences.get(canonical)||0;occurrences.set(canonical,nth+1);
  const hash=await root.crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical+'|'+nth));r.id='wa-'+[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');r.direction=r.sender===ownAuthor?'out':'in';
  const name=r.attachmentName?baseName(r.attachmentName):null,entry=name&&parsed.files?.get(name);
  if(entry){let media=cache.get(name);if(!media){const data=await entry.async('uint8array');total+=data.length;if(data.length>100*1024*1024||total>300*1024*1024)throw Error('Gli allegati superano il limite di importazione di 300 MB.');const ext=name.split('.').pop().toLowerCase(),mime=mediaTypes[ext]||'application/octet-stream';let binary='';for(let offset=0;offset<data.length;offset+=8192)binary+=String.fromCharCode(...data.subarray(offset,offset+8192));media={value:'data:'+mime+';base64,'+root.btoa(binary),type:mime.startsWith('image/')?'image':mime.startsWith('audio/')?'audio':mime.startsWith('video/')?'video':'file',name,sticker:ext==='webp'};cache.set(name,media)}const caption=r.value.replace(/<\s*(?:allegato|attached):\s*[^>]+>/i,'').replace(/[\u200e\u200f]/g,'').trim();Object.assign(r,media,{attachmentMissing:false,caption});}
  converted.push(r);if(i%100===0){onProgress(i,parsed.messages.length);await new Promise(resolve=>setTimeout(resolve,0))}
 }
 onProgress(parsed.messages.length,parsed.messages.length);return converted;
}

Object.assign(root,{parseWhatsApp,readWhatsAppArchive,prepareWhatsAppMessages});if(typeof module!=='undefined')module.exports={parseWhatsApp,readWhatsAppArchive,prepareWhatsAppMessages};
})(typeof window!=='undefined'?window:globalThis);
