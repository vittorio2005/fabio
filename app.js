'use strict';
const $=id=>document.getElementById(id);
let db,key,config,profile,records=[],pendingImport=null,attachment=null,previewURL=null,recorder=null,stream=null,chunks=[],timer=null,started=0,cancelled=false,urls=[],busy=false,lastActive=Date.now(),toastTimer;
let cloudSyncing=false,cloudInitialized=false;
let visibleCount=80,parsedImport=null,searchMatches=[],searchPosition=0;
let cloudDatabaseId='';
let selectedMessageId=null,cancelMessagePress=()=>{};
const thoughtMode=!!window.ChatCloud&&new URLSearchParams(location.search).get('pensieri')==='1';
function newMessage(message){return{...message,direction:thoughtMode?'in':'out',kind:thoughtMode?'thought':'message',pendingCloud:!!window.ChatCloud,date:Date.now(),id:crypto.randomUUID()}}
const enc=new TextEncoder(),dec=new TextDecoder();
const b64=bytes=>{let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s)};
const unb64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function seal(value){return value}
async function open(value){return value}
let dbOpening=null;
function database(){return new Promise((resolve,reject)=>{
 const request=indexedDB.open(window.ChatCloud?'fabietto-cloud-'+cloudDatabaseId:'fabietto-local-v1',1);
 request.onupgradeneeded=()=>{request.result.createObjectStore('config');request.result.createObjectStore('messages',{keyPath:'id'})};
 request.onsuccess=()=>{const connection=request.result;
  connection.onclose=()=>{if(db===connection)db=null};
  connection.onversionchange=()=>{connection.close();if(db===connection)db=null};
  resolve(connection);
 };request.onerror=()=>reject(request.error);
})}
async function ensureDatabase(){
 if(db)return db;
 if(!dbOpening)dbOpening=database().then(connection=>{db=connection;return connection}).finally(()=>{dbOpening=null});
 return dbOpening;
}
async function withDatabase(operation){
 for(let attempt=0;attempt<3;attempt++){
  const connection=await ensureDatabase();
  try{return await operation(connection)}catch(error){
   const interrupted=['InvalidStateError','UnknownError','AbortError'].includes(error?.name)||/connection.*clos|database.*clos/i.test(error?.message||'');
   if(!interrupted||attempt===2)throw error;
   // WebKit may close IndexedDB while the archive is downloading or Safari is suspended.
   // Retry the whole atomic transaction on a fresh connection; never delete the database.
   if(db===connection)db=null;
   try{connection.close()}catch{}
  }
 }
}
function transaction(stores,mode,enqueue){return withDatabase(connection=>new Promise((resolve,reject)=>{
 let tx,result;
 try{
  tx=connection.transaction(stores,mode);
  tx.oncomplete=()=>resolve(result);
  tx.onerror=tx.onabort=()=>reject(tx.error||new DOMException('Operazione interrotta.','AbortError'));
  const request=enqueue(tx);if(request)request.onsuccess=()=>{result=request.result};
 }catch(error){try{tx?.abort()}catch{}reject(error)}
}))}
function read(store,id){return transaction(store,'readonly',tx=>tx.objectStore(store).get(id))}
function all(){return transaction('messages','readonly',tx=>tx.objectStore('messages').getAll())}
function write(store,value,id){return transaction(store,'readwrite',tx=>{const s=tx.objectStore(store);id===undefined?s.put(value):s.put(value,id)})}
function replaceDatabase(c,items){return transaction(['config','messages'],'readwrite',tx=>{
 tx.objectStore('config').put(c,'main');const s=tx.objectStore('messages');s.clear();items.forEach(item=>s.put(item));
})}
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,6000)}
function renderProfile(){$('contact-title').textContent=profile.name;$('avatar').replaceChildren();if(profile.photo){const img=document.createElement('img');img.src=profile.photo;img.alt='';$('avatar').append(img)}else $('avatar').textContent='🤍';$('backup-status').textContent=config.lastBackup?'Ultima esportazione: '+new Date(config.lastBackup).toLocaleString('it-IT'):'Nessun backup esportato su questo dispositivo.'}
function dataBlob(data){const [header,body]=data.split(',');const mime=header.match(/^data:(.+);base64$/)?.[1];if(!mime)throw Error('Formato allegato non valido.');return new Blob([unb64(body)],{type:mime})}
function mediaNode(record){
 const url=URL.createObjectURL(dataBlob(record.value));urls.push(url);
 if(record.type==='file'){const link=document.createElement('a');link.className='file-card';link.href=url;link.download=record.name||'allegato';link.textContent='↓ '+(record.name||'Scarica allegato');return link}
 if(record.type==='image'){const img=document.createElement('img');img.src=url;img.alt=record.sticker?'Sticker':record.name||'Foto';img.loading='lazy';img.onclick=()=>{const full=document.createElement('img');full.src=url;full.alt=img.alt;$('viewer-content').replaceChildren(full);$('viewer').showModal()};return img}
 if(record.type==='video'){const video=document.createElement('video');video.src=url;video.controls=true;video.preload='metadata';video.setAttribute('playsinline','');return video}
 const player=document.createElement('div');player.className='voice-player';const audio=document.createElement('audio');audio.src=url;audio.preload='metadata';
 const play=document.createElement('button');play.className='voice-play';play.textContent='▶';play.setAttribute('aria-label','Riproduci vocale');
 const middle=document.createElement('div');middle.className='voice-track';const seek=document.createElement('input');seek.type='range';seek.min='0';seek.max='100';seek.value='0';seek.step='.1';seek.setAttribute('aria-label','Posizione del vocale');seek.disabled=true;const duration=document.createElement('span');duration.className='voice-duration';duration.textContent='0:00';const speed=document.createElement('button');speed.className='voice-speed';speed.textContent='1×';speed.setAttribute('aria-label','Velocità di riproduzione');
 const format=t=>{if(!Number.isFinite(t))return '0:00';return Math.floor(t/60)+':'+String(Math.floor(t%60)).padStart(2,'0')};
 const error=()=>{play.disabled=true;duration.textContent='Formato non supportato';const link=document.createElement('a');link.href=url;link.download=record.name||'vocale';link.textContent='Scarica vocale';link.className='audio-download';if(!player.querySelector('.audio-download'))player.append(link)};
 play.onclick=async()=>{if(audio.paused){document.querySelectorAll('audio').forEach(other=>{if(other!==audio)other.pause()});try{await audio.play()}catch{toast('Impossibile riprodurre il vocale in questo browser. Puoi scaricarlo.');error()}}else audio.pause()};
 audio.onplay=()=>{play.textContent='Ⅱ';play.setAttribute('aria-label','Metti in pausa il vocale')};audio.onpause=audio.onended=()=>{play.textContent='▶';play.setAttribute('aria-label','Riproduci vocale')};audio.onloadedmetadata=()=>{seek.disabled=!Number.isFinite(audio.duration);duration.textContent=format(audio.duration)};audio.ontimeupdate=()=>{if(Number.isFinite(audio.duration)&&audio.duration>0)seek.value=String(audio.currentTime/audio.duration*100);duration.textContent=format(audio.currentTime)+' / '+format(audio.duration)};audio.onerror=error;seek.oninput=()=>{if(Number.isFinite(audio.duration))audio.currentTime=Number(seek.value)*audio.duration/100};speed.onclick=()=>{audio.playbackRate=audio.playbackRate===1?1.5:audio.playbackRate===1.5?2:1;speed.textContent=audio.playbackRate+'×'};
 middle.append(seek,duration);player.append(play,middle,speed,audio);return player;
}
function recordStamp(r){const date=new Date(r.date);return{day:r.originalDate||date.toLocaleDateString('it-IT'),time:r.originalTime||date.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'}),date}}
function messageStates(items){
 const states=new Map();for(const r of items){if(!['thought-state','message-state'].includes(r.kind)||typeof r.targetId!=='string'||typeof r.hidden!=='boolean')continue;const old=states.get(r.targetId);if(!old||r.date>old.date||(r.date===old.date&&r.id>old.id))states.set(r.targetId,r)}return states;
}
function visibleMessages(items=records){const states=messageStates(items);return items.filter(r=>!['thought-state','message-state'].includes(r.kind)&&!((r.kind==='thought'||(r.direction==='out'&&!r.system))&&states.get(r.id)?.hidden))}
function canManageMessage(r){return !r.system&&!['thought-state','message-state'].includes(r.kind)&&(thoughtMode?r.kind==='thought':r.direction==='out')}
async function changeMessage(id,hidden){
 if(busy||!records.some(r=>r.id===id&&canManageMessage(r)))return;
 busy=true;try{await saveMessage({type:'text',value:'',targetId:id,hidden},'message-state');refreshRemovedMessages();toast(hidden?'Messaggio rimosso. Puoi recuperarlo nelle info.':'Messaggio ripristinato.')}catch{toast('Operazione non salvata. Riprova.')}finally{busy=false}
}
function refreshRemovedMessages(){
 const list=$('removed-thoughts-list');list.replaceChildren();const states=messageStates(records),removed=records.filter(r=>canManageMessage(r)&&states.get(r.id)?.hidden);
 if(!removed.length){const p=document.createElement('p');p.textContent='Nessun messaggio rimosso.';list.append(p);return}
 for(const r of removed){const row=document.createElement('div');row.className='removed-thought';const p=document.createElement('p');p.textContent=r.type==='text'?r.value.slice(0,150):r.name||'Allegato';const button=document.createElement('button');button.className='setting-button';button.textContent='Ripristina';button.onclick=()=>changeMessage(r.id,false);row.append(p,button);list.append(row)}
}
function render(options={}){cancelMessagePress();urls.forEach(u=>URL.revokeObjectURL(u));urls=[];const shown=visibleMessages(),messages=$('messages'),oldHeight=messages.scrollHeight,oldTop=messages.scrollTop;messages.replaceChildren($('empty'));$('empty').hidden=true;const focused=Number.isInteger(options.focusIndex),start=focused?Math.max(0,options.focusIndex-30):Math.max(0,shown.length-visibleCount),end=focused?Math.min(shown.length,start+80):shown.length;if(start&&!focused){const more=document.createElement('button');more.className='load-older';more.textContent='Mostra messaggi precedenti';more.onclick=()=>{visibleCount+=80;render({preserve:true})};messages.append(more)}let previous='';for(const r of shown.slice(start,end)){const stamp=recordStamp(r);if(stamp.day!==previous){const divider=document.createElement('div');divider.className='day';const label=document.createElement('span');label.textContent=stamp.date.toDateString()===new Date().toDateString()?'Oggi':stamp.day;divider.append(label);messages.append(divider);previous=stamp.day}const bubble=document.createElement('article');bubble.className='bubble'+(r.direction==='in'?' incoming':'')+(r.system?' system-message':'')+(r.sticker?' sticker-message':'');bubble.dataset.messageId=r.id;if(r.kind==='thought'){bubble.classList.add('thought-message');const label=document.createElement('div');label.className='thought-label';label.textContent='Fabietto🦋🤍';const context=document.createElement('span');context.className='thought-context';context.textContent='Pensiero in ricordo';label.append(context);bubble.append(label)}if(r.type==='text'){const p=document.createElement('p');if(r.attachmentMissing){p.className='missing-media';const ext=(r.attachmentName||'').split('.').pop().toLowerCase();p.textContent=(['opus','mp3','m4a','ogg'].includes(ext)?'Messaggio vocale':['webp'].includes(ext)?'Sticker':['jpg','jpeg','png'].includes(ext)?'Foto':['mp4','mov'].includes(ext)?'Video':'Allegato')+' non incluso nell’esportazione';}else p.textContent=r.value;bubble.append(p)}else{bubble.append(mediaNode(r));if(r.caption){const caption=document.createElement('p');caption.textContent=r.caption;bubble.append(caption)}}const time=document.createElement('time');time.className='time';time.dateTime=stamp.date.toISOString();time.textContent=stamp.day+' · '+stamp.time+(r.pendingCloud?' · in attesa':'');bubble.append(time);if(canManageMessage(r)){bubble.classList.add('message-manageable');bubble.tabIndex=0;bubble.setAttribute('aria-haspopup','dialog');bubble.setAttribute('aria-label','Messaggio: tieni premuto per aprire le opzioni')}messages.append(bubble)}requestAnimationFrame(()=>{messages.scrollTop=options.preserve?messages.scrollHeight-oldHeight+oldTop:messages.scrollHeight})}
async function saveMessage(message,kind){if(!key)throw Error('Apri la chat per salvare il messaggio.');const r=newMessage(message);if(kind)r.kind=kind;const payload=await seal(r);await write('messages',{id:r.id,payload});records.push(r);visibleCount=80;render();if(window.ChatCloud){cloudStatus('In attesa di salvataggio…');setTimeout(syncCloud,0)}}
async function send(event){event.preventDefault();const value=$('message-input').value.trim();if(!value||busy)return;busy=true;$('send').disabled=true;try{await saveMessage({type:'text',value});$('message-input').value='';composerState()}catch{toast('Messaggio non salvato. Verifica lo spazio libero e riprova.')}finally{busy=false;$('send').disabled=false}}
function composerState(){const input=$('message-input');$('send').hidden=!input.value.trim();$('voice').hidden=!!input.value.trim();input.style.height='44px';input.style.height=Math.min(130,input.scrollHeight)+'px'}
const fileData=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file)});
async function chooseAttachment(){const file=$('attachment-input').files[0];$('attachment-input').value='';if(!file)return;if(file.size>50*1024*1024){toast('Questo file supera 50 MB. Scegli un video più breve o un file più piccolo.');return}const type=file.type.startsWith('image/')?'image':file.type.startsWith('video/')?'video':null;if(!type){toast('Scegli una foto o un video. Per HEIC, esporta una copia JPEG da Foto.');return}attachment={type,file,name:file.name};previewURL=URL.createObjectURL(file);const node=document.createElement(type==='image'?'img':'video');node.src=previewURL;if(type==='video'){node.controls=true;node.setAttribute('playsinline','')}else node.alt='Anteprima della foto';$('media-preview').replaceChildren(node);$('attachment-name').textContent=file.name+' · '+(file.size/1024/1024).toFixed(1)+' MB';$('media-dialog').showModal()}
async function saveAttachment(){if(!attachment||busy)return;busy=true;$('save-attachment').disabled=true;try{await saveMessage({type:attachment.type,name:attachment.name,value:await fileData(attachment.file)});$('media-dialog').close()}catch{toast('Allegato non salvato. Verifica lo spazio libero e riprova.')}finally{busy=false;$('save-attachment').disabled=false}}
function releaseMedia(){attachment=null;if(previewURL)URL.revokeObjectURL(previewURL);previewURL=null;$('media-preview').replaceChildren()}
async function startRecording(){if(recorder||busy)return;if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){toast('La registrazione non è disponibile. Apri il sito in Safari aggiornato.');return}busy=true;try{stream=await navigator.mediaDevices.getUserMedia({audio:true});const mime=['audio/mp4','audio/webm;codecs=opus','audio/webm'].find(t=>MediaRecorder.isTypeSupported(t));recorder=mime?new MediaRecorder(stream,{mimeType:mime}):new MediaRecorder(stream);chunks=[];cancelled=false;recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};recorder.onstop=async()=>{const type=recorder.mimeType;stream.getTracks().forEach(t=>t.stop());stream=null;recorder=null;clearInterval(timer);$('recording').hidden=true;$('composer').hidden=false;if(!cancelled){busy=true;try{const blob=new Blob(chunks,{type});await saveMessage({type:'audio',value:await fileData(blob),name:'Messaggio vocale'})}catch{toast('Vocale non salvato. Verifica lo spazio libero e riprova.')}finally{busy=false}}chunks=[]};recorder.start();started=Date.now();$('record-time').textContent='0:00';$('recording').hidden=false;$('composer').hidden=true;timer=setInterval(()=>{const seconds=Math.floor((Date.now()-started)/1000);$('record-time').textContent=Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');if(seconds>=300){toast('Raggiunti 5 minuti: il vocale viene salvato.');stopRecording(false)}},500)}catch{stream?.getTracks().forEach(t=>t.stop());stream=null;toast('Consenti l’accesso al microfono nelle impostazioni di Safari, poi riprova.')}finally{busy=false}}
function stopRecording(cancel){cancelled=cancel;if(recorder?.state==='recording')recorder.stop()}
async function backup(){if(busy||!key)return;busy=true;$('backup').disabled=true;try{const messages=await all();const body=JSON.stringify({format:'fabietto-chat',version:1,config,messages});const url=URL.createObjectURL(new Blob([body],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='chat-backup-'+new Date().toISOString().slice(0,10)+'.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);config.lastBackup=Date.now();await write('config',config,'main');renderProfile();toast('Backup preparato. Conservalo in File: contiene i tuoi messaggi e allegati.')}catch{toast('Impossibile esportare il backup. Riprova.')}finally{busy=false;$('backup').disabled=false}}
async function chooseBackup(){const file=$('backup-input').files[0];$('backup-input').value='';if(!file)return;if(busy||recorder){toast('Termina prima il salvataggio o la registrazione.');return}busy=true;try{const imported=JSON.parse(await file.text());if(imported.format!=='fabietto-chat'||imported.version!==1||!Array.isArray(imported.messages)||imported.messages.some(r=>typeof r.id!=='string'||!r.payload||!['text','image','video','audio','file'].includes(r.payload.type)||typeof r.payload.value!=='string'||!Number.isFinite(r.payload.date))||new Set(imported.messages.map(r=>r.id)).size!==imported.messages.length)throw Error();for(const r of imported.messages){if(r.payload.type!=='text'){const blob=dataBlob(r.payload.value);if(r.payload.type!=='file'&&!blob.type.startsWith(r.payload.type+'/'))throw Error()}}if(!confirm('Il backup sostituirà i messaggi su questo dispositivo. Esporta prima quelli attuali se vuoi conservarli. Continuare?'))return;await replaceDatabase(config,imported.messages);records=imported.messages.map(r=>({...r.payload,id:r.id})).sort((a,b)=>a.date-b.date);render();$('settings').close();toast('Backup ripristinato.')}catch{toast('Backup non valido o spazio insufficiente. La chat attuale è conservata.')}finally{busy=false}}
$('composer').addEventListener('submit',send);$('message-input').addEventListener('input',composerState);$('attach').onclick=()=>$('attachment-input').click();$('attachment-input').onchange=chooseAttachment;$('save-attachment').onclick=saveAttachment;$('media-dialog').addEventListener('close',releaseMedia);$('voice').onclick=startRecording;$('cancel-record').onclick=()=>stopRecording(true);$('stop-record').onclick=()=>stopRecording(false);$('menu-button').onclick=$('profile-button').onclick=$('contact-profile').onclick=()=>$('settings').showModal();document.querySelectorAll('.close-dialog').forEach(b=>b.onclick=()=>b.closest('dialog').close());$('backup').onclick=backup;$('restore').onclick=()=>$('backup-input').click();$('backup-input').onchange=chooseBackup;
window.addEventListener('pagehide',()=>{if(recorder)stopRecording(true)});
function cloudStatus(text){$('sync-status').textContent=text}
function localMessagesForRecovery(rows,existing){
 const known=new Set(existing.map(r=>r.id)),uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 const local=rows.filter(r=>r&&r.payload&&typeof r.payload==='object').map(r=>({...r.payload,id:r.id,direction:r.payload.direction||'out'}));
 return visibleMessages(local).filter(r=>uuid.test(r.id)&&!known.has(r.id)&&r.direction==='out'&&!r.system&&Number.isFinite(r.date)&&typeof r.value==='string'&&['text','image','video','audio','file'].includes(r.type)).map(r=>({...r,kind:'message',pendingCloud:true}));
}
function readLocalMessages(){return new Promise((resolve,reject)=>{
 let absent=false;const request=indexedDB.open('fabietto-local-v1',1);
 request.onupgradeneeded=()=>{absent=true;request.transaction.abort()};
 request.onerror=()=>absent?resolve([]):reject(request.error);
 request.onsuccess=()=>{const local=request.result;if(!local.objectStoreNames.contains('messages')){local.close();resolve([]);return}
  try{const tx=local.transaction('messages','readonly'),read=tx.objectStore('messages').getAll();let rows=[];read.onsuccess=()=>{rows=read.result};tx.oncomplete=()=>{local.close();resolve(rows)};tx.onerror=tx.onabort=()=>{local.close();reject(tx.error||Error('Lettura locale interrotta.'))}}catch(e){local.close();reject(e)}
 };
})}
async function checkLocalRecovery(){
 if(!window.ChatCloud||thoughtMode)return;
 try{const local=localMessagesForRecovery(await readLocalMessages(),records);$('local-recovery').hidden=!local.length;$('local-recovery-note').textContent=local.length===1?'Un messaggio non è ancora nella chat online. Puoi copiarlo qui e sincronizzarlo.':local.length+' messaggi non sono ancora nella chat online. Puoi copiarli qui e sincronizzarli.'}catch{ /* The original local database remains untouched. */ }
}
async function recoverLocalMessages(){
 if(!window.ChatCloud||thoughtMode||!cloudInitialized||busy)return;
 busy=true;$('recover-local').disabled=true;
 try{const local=localMessagesForRecovery(await readLocalMessages(),records);
  if(local.length){await transaction('messages','readwrite',tx=>{const store=tx.objectStore('messages');local.forEach(r=>store.put({id:r.id,payload:r}))});records.push(...local);records.sort((a,b)=>a.date-b.date);visibleCount=80;render();cloudStatus('In attesa di salvataggio…')}
  $('local-recovery').hidden=true;await syncCloud();
 }catch{toast('Recupero non completato. I messaggi originali sono ancora in questo browser.')}finally{busy=false;$('recover-local').disabled=false}
}
async function initializeChat(){try{if(window.ChatCloud)cloudDatabaseId=await ChatCloud.ready;db=await ensureDatabase();config=await read('config','main');if(!config){config={version:1,lastBackup:null};await write('config',config,'main')}key=true;profile={name:'Fabietto🦋🤍',photo:'fabietto.png'};records=(await all()).map(r=>({...r.payload,id:r.id})).sort((a,b)=>a.date-b.date);$('chat').hidden=false;render();renderProfile();navigator.storage?.persist?.().catch(()=>{});if(window.ChatCloud){$('whatsapp-import').hidden=true;$('import-note').hidden=true;$('restore').hidden=true;$('sync-now').hidden=false;$('copy-chat-link').hidden=false;$('storage-note').textContent='I messaggi vengono cifrati prima di essere salvati online. Conserva il link riservato: chi lo possiede può aprire questa chat. Puoi anche esportare una copia in File; il backup esportato contiene i messaggi in chiaro.';$('composer').hidden=!config.seedLoaded;await initializeCloud();await checkLocalRecovery()}else{cloudStatus('Solo su questo dispositivo');$('access-notice').hidden=false}}catch{$('chat').hidden=false;$('composer').hidden=true;toast('Impossibile aprire lo spazio. Riprova in Safari senza navigazione privata.')}}
async function initializeCloud(){if(cloudInitialized)return;cloudStatus('Caricamento della cronologia…');try{if(!config.seedLoaded){const zip=await ChatCloud.seed();const parsed=await readWhatsAppArchive(zip,JSZip);const author=parsed.authors.find(name=>!/fabio|fabietto/i.test(name));if(!author)throw Error('Mittente non riconosciuto.');const seeded=await prepareWhatsAppMessages(parsed,author,(done,total)=>cloudStatus('Preparazione '+Math.round(done/total*100)+'%'));const merged=new Map(seeded.map(r=>[r.id,r]));records.forEach(r=>merged.set(r.id,r));const next=[...merged.values()].sort((a,b)=>a.date-b.date||(a.importOrder??0)-(b.importOrder??0));const nextConfig={...config,seedLoaded:true};await replaceDatabase(nextConfig,next.map(r=>({id:r.id,payload:r})));config=nextConfig;records=next;render()}cloudInitialized=true;$('composer').hidden=false;await syncCloud()}catch(e){cloudStatus(config.seedLoaded?'Offline · cronologia sul dispositivo':'Caricamento interrotto · riprova nelle info');toast(e.message||'Impossibile caricare la cronologia. Riprova.')}}
async function syncCloud(){if(!window.ChatCloud||cloudSyncing||!cloudInitialized)return;cloudSyncing=true;try{cloudStatus('Sincronizzazione…');let changed=false;for(const record of records.filter(r=>r.pendingCloud)){await ChatCloud.put(record);const updated={...record,pendingCloud:false};await write('messages',{id:record.id,payload:updated});Object.assign(record,updated);changed=true;const label=[...$('messages').querySelectorAll('[data-message-id]')].find(e=>e.dataset.messageId===record.id)?.querySelector('time');if(label){const stamp=recordStamp(record);label.textContent=stamp.day+' · '+stamp.time}}
 const known=new Set(records.map(r=>r.id)),ids=await ChatCloud.list();for(const id of ids){if(known.has(id))continue;const record=await ChatCloud.get(id);await write('messages',{id,payload:record});records.push(record);known.add(id);changed=true}if(changed){records.sort((a,b)=>a.date-b.date||(a.importOrder??0)-(b.importOrder??0));const atBottom=$('messages').scrollHeight-$('messages').scrollTop-$('messages').clientHeight<100;if(!Array.from(document.querySelectorAll('audio')).some(a=>!a.paused)){if(!$('search-bar').hidden&&$('search-input').value.trim())searchChat();else render({preserve:!atBottom})}}
 const pending=records.some(r=>r.pendingCloud);cloudStatus(pending?'In attesa di salvataggio…':'Salvato online');if(pending)setTimeout(syncCloud,500)}catch{cloudStatus(records.some(r=>r.pendingCloud)?'Offline · messaggi in attesa':'Offline · copia sul dispositivo')}finally{cloudSyncing=false}}
$('sync-now').onclick=()=>cloudInitialized?syncCloud():initializeCloud();window.addEventListener('online',()=>{if(window.ChatCloud)cloudInitialized?syncCloud():initializeCloud()});document.addEventListener('visibilitychange',()=>{if(!document.hidden&&window.ChatCloud&&cloudInitialized)syncCloud()});setInterval(()=>{if(!document.hidden&&window.ChatCloud&&cloudInitialized)syncCloud()},15000);
$('connect-chat').onclick=()=>{$('access-error').textContent='';$('access-dialog').showModal()};
$('access-form').onsubmit=event=>{event.preventDefault();const access=window.ChatAccess?.secretFromLink($('access-link').value);if(!access){$('access-error').textContent='Questo link è incompleto o non valido. Copia tutto il link riservato ricevuto.';return}location.assign(ChatAccess.chatURL(access))};
$('copy-chat-link').onclick=async()=>{const url=window.ChatAccess?.recipientURL();if(!url)return;try{await navigator.clipboard.writeText(url);toast('Link completo copiato. Condividilo solo con chi deve aprire la chat.')}catch{$('share-link').value=url;$('settings').close();$('share-link-dialog').showModal();$('share-link').select()}};
$('recover-local').onclick=recoverLocalMessages;
$('removed-thoughts').onclick=()=>{refreshRemovedMessages();$('settings').close();$('removed-thoughts-dialog').showModal()};
$('removed-thoughts').hidden=false;
if(thoughtMode){$('thought-mode').hidden=false;$('message-input').placeholder='Scrivi un pensiero per lei…';$('message-input').setAttribute('aria-label','Scrivi un pensiero per lei');$('send').setAttribute('aria-label','Invia pensiero')}
initializeChat();
if(window.visualViewport){const resize=()=>{document.documentElement.style.setProperty('--app-height',window.visualViewport.height+'px');if(!document.querySelector('dialog[open]'))window.scrollTo(0,0)};window.visualViewport.addEventListener('resize',resize);resize()}

$('whatsapp-import').onclick=()=>{if(busy||recorder){toast('Termina prima il salvataggio o la registrazione.');return}$('whatsapp-input').click()};
$('whatsapp-input').onchange=async()=>{const file=$('whatsapp-input').files[0];$('whatsapp-input').value='';if(!file)return;if(busy||recorder){toast('Termina prima il salvataggio o la registrazione.');return}busy=true;try{if(file.size>150*1024*1024)throw Error('Lo ZIP supera 150 MB.');toast('Lettura della cronologia…');parsedImport=/\.zip$/i.test(file.name)?await readWhatsAppArchive(await file.arrayBuffer(),JSZip):{...parseWhatsApp(await file.text()),available:0};if(!parsedImport.messages.length||!parsedImport.authors.length)throw Error('Non riconosco una chat WhatsApp in questo file.');if(parsedImport.ignored)throw Error('Il file contiene righe iniziali non riconosciute. Controlla il formato prima di importarlo.');$('import-author').replaceChildren(...parsedImport.authors.map(author=>{const option=document.createElement('option');option.value=author;option.textContent=author;return option}));const other=parsedImport.authors.find(author=>!/fabio|fabietto/i.test(author));if(other)$('import-author').value=other;const missing=parsedImport.messages.filter(r=>r.attachmentMissing).length-parsedImport.available;$('import-summary').textContent=parsedImport.messages.length.toLocaleString('it-IT')+' messaggi e '+parsedImport.available+' allegati disponibili.'+(missing?' Altri '+missing+' allegati non sono presenti nell’esportazione.':'');$('settings').close();$('import-dialog').showModal()}catch(e){parsedImport=null;toast(e.message||'Impossibile leggere il file.')}finally{busy=false}};
$('confirm-import').onclick=async()=>{if(busy||recorder||!parsedImport)return;busy=true;const button=$('confirm-import');button.disabled=true;$('import-dialog').querySelector('.close-dialog').disabled=true;const selected=$('import-author').value;try{const known=new Set(records.map(r=>r.id));const converted=await prepareWhatsAppMessages(parsedImport,selected,(done,total)=>{button.textContent='Importazione '+Math.round(done/total*100)+'%'});const combined=new Map(records.map(r=>[r.id,r]));for(const r of converted){const existing=combined.get(r.id);combined.set(r.id,existing&&existing.type!=='text'&&r.attachmentMissing?{...existing,direction:r.direction}:r)}const merged=[...combined.values()].sort((a,b)=>a.date-b.date||(a.importOrder??0)-(b.importOrder??0));await replaceDatabase(config,merged.map(r=>({id:r.id,payload:r})));records=merged;visibleCount=80;render();$('import-dialog').close();const added=converted.filter(r=>!known.has(r.id)).length;toast(added?added.toLocaleString('it-IT')+' messaggi importati. Esporta un backup per conservarli.':'Cronologia aggiornata senza duplicare i messaggi.');parsedImport=null}catch(e){toast(e.message||'Importazione non completata. I messaggi precedenti sono conservati.')}finally{busy=false;button.disabled=false;$('import-dialog').querySelector('.close-dialog').disabled=false;button.textContent='Importa sul dispositivo'}};
$('import-dialog').addEventListener('cancel',e=>{if(busy)e.preventDefault()});
function searchChat(){const query=$('search-input').value.trim().toLocaleLowerCase('it');searchMatches=query?visibleMessages().filter(r=>r.value.toLocaleLowerCase('it').includes(query)):[];searchPosition=searchMatches.length-1;showSearchResult()}
function showSearchResult(){document.querySelectorAll('.search-hit').forEach(e=>e.classList.remove('search-hit'));$('search-count').textContent=searchMatches.length?(searchPosition+1)+'/'+searchMatches.length:($('search-input').value?'0 risultati':'');$('search-prev').disabled=$('search-next').disabled=!searchMatches.length;if(!searchMatches.length)return;const r=searchMatches[searchPosition],index=visibleMessages().findIndex(item=>item.id===r.id);render({focusIndex:index});requestAnimationFrame(()=>{const bubble=[...$('messages').querySelectorAll('.bubble')].find(e=>e.dataset.messageId===r.id);bubble?.classList.add('search-hit');bubble?.scrollIntoView({block:'center',behavior:'auto'})})}
$('search-button').onclick=()=>{$('search-bar').hidden=false;$('search-input').focus()};$('search-bar').onsubmit=e=>{e.preventDefault();searchChat()};let searchTimer;$('search-input').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(searchChat,250)};$('search-prev').onclick=()=>{if(searchMatches.length){searchPosition=(searchPosition-1+searchMatches.length)%searchMatches.length;showSearchResult()}};$('search-next').onclick=()=>{if(searchMatches.length){searchPosition=(searchPosition+1)%searchMatches.length;showSearchResult()}};$('search-close').onclick=()=>{$('search-bar').hidden=true;$('search-input').value='';searchMatches=[];visibleCount=80;render()};

function openMessageActions(id){
 const record=records.find(r=>r.id===id);if(!record||!canManageMessage(record)||busy)return;
 selectedMessageId=id;document.querySelectorAll('.message-selected').forEach(e=>e.classList.remove('message-selected'));
 const bubble=[...$('messages').querySelectorAll('[data-message-id]')].find(e=>e.dataset.messageId===id);bubble?.classList.add('message-selected');
 if(!$('message-actions').open)$('message-actions').showModal();
}
function bindMessageActions(){
 const messages=$('messages');let press=null,timer=null,suppressClickUntil=0,suppressId=null;
 const cancel=()=>{clearTimeout(timer);timer=null;press=null};cancelMessagePress=cancel;
 const actionable=event=>{const bubble=event.target.closest?.('.message-manageable');return bubble&&messages.contains(bubble)&&!event.target.closest('button,input,a,audio,video')?bubble:null};
 messages.addEventListener('pointerdown',event=>{
  cancel();if(!event.isPrimary||(event.pointerType==='mouse'&&event.button!==0))return;const bubble=actionable(event);if(!bubble)return;
  press={id:bubble.dataset.messageId,pointerId:event.pointerId,x:event.clientX,y:event.clientY};
  timer=setTimeout(()=>{const id=press?.id;cancel();if(!id)return;suppressId=id;suppressClickUntil=Date.now()+800;openMessageActions(id)},550);
 });
 messages.addEventListener('pointermove',event=>{if(press&&event.pointerId===press.pointerId&&Math.hypot(event.clientX-press.x,event.clientY-press.y)>10)cancel()});
 messages.addEventListener('scroll',cancel,{passive:true});
 window.addEventListener('pointerup',cancel);window.addEventListener('pointercancel',cancel);window.addEventListener('blur',cancel);
 document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel()});
 messages.addEventListener('click',event=>{if(Date.now()<suppressClickUntil&&event.target.closest?.('[data-message-id]')?.dataset.messageId===suppressId){event.preventDefault();event.stopImmediatePropagation()}},true);
 messages.addEventListener('contextmenu',event=>{const bubble=actionable(event);if(!bubble)return;event.preventDefault();cancel();suppressId=bubble.dataset.messageId;suppressClickUntil=Date.now()+800;openMessageActions(suppressId)});
 messages.addEventListener('keydown',event=>{if(event.target.classList.contains('message-manageable')&&(event.key==='Enter'||event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10'))){event.preventDefault();openMessageActions(event.target.dataset.messageId)}});
 $('message-actions').addEventListener('close',()=>{selectedMessageId=null;document.querySelectorAll('.message-selected').forEach(e=>e.classList.remove('message-selected'))});
 $('remove-selected-message').onclick=()=>{const id=selectedMessageId;$('message-actions').close();if(id)changeMessage(id,true)};
 $('cancel-message-actions').onclick=()=>$('message-actions').close();
}
bindMessageActions();
