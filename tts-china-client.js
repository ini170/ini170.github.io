/* LLT China TTS: bridge providers, browser voices, offline cache and self-service UI. */
(() => {
 'use strict';
 const OPTIONS=[['cn-auto','중국 자동 대체'],['browser-online','브라우저 온라인 음성 (Edge 등)'],['cache','저장 음원 우선 (오프라인)'],['windows','Windows 설치 음성 (연결 도구)'],['baidu','百度 Baidu'],['ali-shanghai','阿里云 NLS 상하이'],['ali-beijing','阿里云 NLS 베이징'],['ali-shenzhen','阿里云 NLS 선전'],['qwen','阿里云 Qwen TTS'],['tencent','腾讯云 Tencent'],['xfyun','科大讯飞 iFLYTEK'],['volc','火山引擎 Doubao V1'],['huawei','华为云 Huawei SIS'],['minimax','MiniMax 중국'],['minimax-bj','MiniMax 베이징 예비'],['siliconflow','硅基流动 SiliconFlow'],['compatible','직접 지정 / 로컬 서버']];
 const KEY='llt.china.connection.v1';let cfg={url:'http://127.0.0.1:17863',key:'',engine:'auto'};
 try{cfg={...cfg,...JSON.parse(localStorage.getItem(KEY)||'{}')}}catch{}
 const oldSelect=document.getElementById('ttsEng');
 let liveVolume=1;let seq=0,active=null,currentAudio=null,currentUtterance=null,finishCurrent=null,dbPromise=null,preparing=null;
 const el=id=>document.getElementById(id);
 const note=text=>{const n=el('chinaStatus');if(n)n.textContent=text;window.dispatchEvent(new CustomEvent('llt-tts-status',{detail:text}));};
 function engine(){return oldSelect?oldSelect.value:cfg.engine}
 function saved(){try{localStorage.setItem(KEY,JSON.stringify(cfg))}catch{};syncFrames()}
 function syncFrames(){if(!oldSelect)return;document.querySelectorAll('iframe.toolFrame').forEach(f=>{try{f.contentWindow.postMessage({llt:'china-tts-config',config:{...cfg,engine:engine()}},'*')}catch{}})}
 window.addEventListener('message',e=>{
  if(e.data?.llt==='china-tts-request'&&oldSelect&&[...document.querySelectorAll('iframe.toolFrame')].some(f=>f.contentWindow===e.source))syncFrames();
  if(e.data?.llt==='china-tts-config'&&!oldSelect&&window.parent!==window&&e.source===window.parent){const c=e.data.config;if(c&&validURL(c.url)){cfg={url:c.url,key:String(c.key||''),engine:String(c.engine||'auto')};saved();paint()}}
 });
 if(!oldSelect&&window.parent!==window)window.parent.postMessage({llt:'china-tts-request'},'*');
 function validURL(s){try{const u=new URL(s);return u.protocol==='http:'&&u.hostname==='127.0.0.1'&&/^\d+$/.test(u.port)}catch{return false}}
 function openDB(){if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{const r=indexedDB.open('llt.china.audio.v1',1);r.onupgradeneeded=()=>{const st=r.result.createObjectStore('audio',{keyPath:'key'});st.createIndex('sentence','sentence')};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});return dbPromise}
 async function cacheGet(provider,text,lang){try{const db=await openDB();return await new Promise(resolve=>{const st=db.transaction('audio').objectStore('audio');const r=['cn-auto','cache'].includes(provider)?st.index('sentence').getAll(lang+'\n'+text):st.get(provider+'\n'+lang+'\n'+text);r.onsuccess=()=>resolve(Array.isArray(r.result)?r.result.at(-1):r.result);r.onerror=()=>resolve(null)})}catch{return null}}
 async function cachePut(provider,text,lang,blob){
  try{
   const db=await openDB();
   await new Promise(resolve=>{
    const tx=db.transaction('audio','readwrite');
    const st=tx.objectStore('audio');
    const cursor=st.openCursor();
    let count=0,totalBytes=0;
    cursor.onsuccess=()=>{
     const row=cursor.result;
     if(row){
      count++;
      totalBytes+=Number(row.value?.blob?.size)||0;
      if(count>=500||totalBytes+blob.size>128*1024*1024)return;
      row.continue();
      return;
     }
     st.put({key:provider+'\n'+lang+'\n'+text,sentence:lang+'\n'+text,provider,text,lang,blob,at:Date.now()});
    };
    tx.oncomplete=tx.onerror=tx.onabort=()=>resolve();
   });
  }catch{}
 }
 async function request(route,body,signal){if(!cfg.key)throw new Error('연결 코드를 먼저 입력하세요');const r=await fetch(cfg.url+'/api/'+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-LLT-Key':cfg.key},body:body?JSON.stringify(body):undefined,signal});if(!r.ok){let d;try{d=await r.json()}catch{}throw new Error(d?.error||'연결 도구 HTTP '+r.status)}return r}
 function stop(){seq++;if(active)active.abort();active=null;if(currentAudio){currentAudio.pause();currentAudio.onended=currentAudio.onerror=currentAudio.onplaying=null;currentAudio.removeAttribute('src');currentAudio.load();currentAudio=null}if(currentUtterance){currentUtterance.onend=currentUtterance.onerror=currentUtterance.onstart=null;try{speechSynthesis.cancel()}catch{}currentUtterance=null}if(finishCurrent){finishCurrent();finishCurrent=null}}
 function setVolume(v){liveVolume=Math.max(0,Math.min(1,v));if(currentAudio)currentAudio.volume=Math.max(0,Math.min(1,v))}
 function native(text,lang,rate,volume,online,voice,signal,wait=0){return new Promise((resolve,reject)=>{
  if(!window.speechSynthesis){reject(new Error('브라우저 음성 기능 없음'));return}
  let done=false,started=false,timer,submit;
  const finish=(e)=>{if(done)return;done=true;clearTimeout(timer);clearTimeout(submit);signal.removeEventListener('abort',cancel);if(currentUtterance===u)currentUtterance=null;u.onend=u.onerror=u.onstart=null;e?reject(e):resolve()};
  const cancel=()=>{finish(new Error('취소됨'));try{speechSynthesis.cancel()}catch{}};
  const list=speechSynthesis.getVoices().filter(v=>v.lang.toLowerCase().startsWith(lang));
  if(!list.length&&wait<10&&!signal.aborted){setTimeout(()=>resolve(native(text,lang,rate,volume,online,voice,signal,wait+1)),150);return}
  if(signal.aborted){reject(new Error('취소됨'));return}
  const picked=online?(list.find(v=>v.localService===false&&/natural/i.test(v.name))||list.find(v=>v.localService===false)):(list.find(v=>v.localService===true));
  if(!picked){reject(new Error(online?'온라인 음성 없음 · Edge/음성목록 확인':'설치된 '+lang+' 음성 없음 · Windows 언어팩 설치'));return}
  const u=new SpeechSynthesisUtterance(text);currentUtterance=u;u.lang=lang==='ko'?'ko-KR':'zh-CN';u.voice=(voice&&voice.localService===picked.localService)?voice:picked;u.rate=rate;u.volume=volume;
  u.onstart=()=>{started=true;clearTimeout(timer);timer=setTimeout(()=>finish(new Error('음성 완료 시간 초과')),Math.max(20000,text.length*1200/rate))};
  u.onend=()=>finish(started?null:new Error('음성이 시작되지 않음'));u.onerror=()=>finish(new Error('브라우저 음성 재생 실패'));
  if(signal.aborted){cancel();return}signal.addEventListener('abort',cancel,{once:true});
  timer=setTimeout(()=>{try{speechSynthesis.cancel()}catch{}finish(new Error('음성 시작 시간 초과'))},5000);
  try{speechSynthesis.cancel();if(speechSynthesis.paused)speechSynthesis.resume();submit=setTimeout(()=>{if(!done)speechSynthesis.speak(u)},80)}catch(e){finish(e)}
 })}
 function playBlob(blob,rate,volume,signal){return new Promise((resolve,reject)=>{
  const a=new Audio(),url=URL.createObjectURL(blob);currentAudio=a;let done=false,timer;
  const finish=(e)=>{if(done)return;done=true;clearTimeout(timer);signal.removeEventListener('abort',cancel);a.onended=a.onerror=a.onplaying=null;a.pause();a.removeAttribute('src');a.load();URL.revokeObjectURL(url);if(currentAudio===a)currentAudio=null;e?reject(e):resolve()};
  const cancel=()=>finish(new Error('취소됨'));finishCurrent=cancel;
  if(signal.aborted){cancel();return}signal.addEventListener('abort',cancel,{once:true});a.volume=volume;a.playbackRate=rate;a.src=url;
  a.onended=()=>finish();a.onerror=()=>finish(new Error('음원 디코딩 실패'));a.onplaying=()=>{clearTimeout(timer);timer=setTimeout(()=>finish(new Error('재생 시간 초과')),Math.max(30000,(Number.isFinite(a.duration)?a.duration:180)*1000/rate+10000))};
  timer=setTimeout(()=>finish(new Error('재생 시작 시간 초과')),5000);a.play().catch(finish);
 })}
 function chunks(text){let s=String(text||'').replace(/[~～〜]/g,' ').replace(/[*#_`^|\\/<>＜＞「」『』【】〈〉《》\[\]{}"'“”‘’＂]/g,' ').replace(/[·•※→←↔]/g,' ').replace(/\s{2,}/g,' ').trim();const out=[];while(s.length>190){let cut=s.slice(0,190);const at=Math.max(cut.lastIndexOf('。'),cut.lastIndexOf('，'),cut.lastIndexOf(','),cut.lastIndexOf('. '),cut.lastIndexOf(' '));if(at>40)cut=s.slice(0,at+1);out.push(cut);s=s.slice(cut.length)}if(s)out.push(s);return out}
 async function remoteBlob(provider,text,lang,signal){
  const hit=await cacheGet(provider,text,lang);if(hit){note('브라우저 저장 음원 · '+hit.provider);return hit.blob}
  const r=await request('synthesize',{provider,text,lang},signal);const blob=await r.blob();if(blob.size<32)throw new Error('빈 음원');const used=r.headers.get('X-LLT-Provider')||provider;await cachePut(used,text,lang,blob);note((r.headers.get('X-LLT-Cached')==='true'?'PC 저장 음원':'합성 성공')+' · '+used);return blob;
 }
 function speak(options){const provider=options.engine||engine();if(!OPTIONS.some(x=>x[0]===provider)&&!(provider==='local'&&!oldSelect))return false;
  stop();try{window.speechSynthesis?.cancel()}catch{}const my=seq,ctrl=new AbortController();active=ctrl;const lang=String(options.lang||'zh').slice(0,2),rate=Math.max(.25,Number(options.rate)||1),volume=options.volume==null?1:options.volume;liveVolume=volume;
  (async()=>{for(const text of chunks(options.text)){
   if(ctrl.signal.aborted)return;
   try{
    if(provider==='local'){note('브라우저 설치 음성');await native(text,lang,rate,volume,false,options.voice,ctrl.signal)}
    else if(provider==='browser-online'){note('브라우저 온라인 음성 시도');await native(text,lang,rate,volume,true,options.voice,ctrl.signal)}
    else {const signal=AbortSignal.any([ctrl.signal,AbortSignal.timeout(provider==='cn-auto'?90000:35000)]);const blob=await remoteBlob(provider,text,lang,signal);if(ctrl.signal.aborted)return;await playBlob(blob,rate,liveVolume,ctrl.signal)}
   }catch(e){if(ctrl.signal.aborted)return;if(options.strict)throw e;note(e.message+' → 설치 음성으로 대체');await native(text,lang,rate,volume,false,options.voice,ctrl.signal)}
  }} )().catch(e=>{if(!ctrl.signal.aborted){note('재생 실패: '+e.message);options.onerror?.(e)}}).finally(()=>{if(my===seq&&!ctrl.signal.aborted){active=null;options.onend?.()}});
  return true;
 }
 function configureEngine(value){stop();cfg.engine=value;if(oldSelect){oldSelect.value=value;oldSelect.dispatchEvent(new Event('change',{bubbles:true}))}saved();paint()}
 function paint(){if(el('chinaEngine'))el('chinaEngine').value=engine();if(el('chinaCode'))el('chinaCode').value=cfg.key?JSON.stringify({url:cfg.url,key:cfg.key}):''}
 function dialog(){let d=el('chinaDialog');if(d){paint();d.showModal();return}
  d=document.createElement('dialog');d.id='chinaDialog';d.style.cssText='background:#18212c;color:#ecf1f7;max-width:780px;width:90vw;max-height:90vh;overflow:auto;padding:22px;border:1px solid #8796a6;user-select:text';
  d.innerHTML='<form method="dialog" style="float:right"><button>닫기</button></form><h2>TTS 중국 연결 / 오프라인 대비</h2><button id="chinaHelp">사용·복구 안내</button><p>중국 현지 연결은 미검증입니다. 연결 도구에 키를 넣은 업체만 사용할 수 있습니다. 브라우저 설치 음성은 키 없이 사용합니다.</p><label>재생 엔진 <select id="chinaEngine"></select></label><p><label>PC 연결 코드<br><input id="chinaCode" type="password" autocomplete="off" style="width:96%" placeholder="TTS-중국-시작.cmd → 연결 코드 복사"></label> <button id="chinaConnect">연결 저장</button> <button id="chinaManage">업체 설정 열기</button></p><p><button id="chinaDiag">연결·음성 목록 확인</button> <button id="chinaReset">실패 상태 초기화</button></p><p><button id="chinaTestZh">선택 엔진 중국어 시험</button> <button id="chinaTestKo">한국어 시험</button> <button id="chinaStop">중지</button></p><pre id="chinaStatus" style="white-space:pre-wrap;overflow-wrap:anywhere">준비됨</pre><details><summary>출국 전 음원 미리 저장</summary><p>선택 엔진으로 합성하며 API 사용료가 발생할 수 있습니다. 최대 200문장. 저장 음원은 브라우저와 PC에 보관됩니다.</p><button id="chinaLoad">현재 선택/학습 문장 불러오기</button> <select id="chinaPrepLang"><option value="zh">중국어</option><option value="ko">한국어</option></select><textarea id="chinaPrepText" style="display:block;width:96%;height:110px" placeholder="문장별 한 줄"></textarea><button id="chinaPrepare">미리 저장 시작</button> <button id="chinaPrepStop">저장 중지</button></details><p>연결 실패: 시작 파일 다시 실행 → 연결 코드 확인 → 업체 키·음색·잔액·Token 만료 확인. 인터넷이 안 되면 저장 음원 또는 기기 음성을 선택하세요. 브라우저 캐시를 지우지 마세요.</p>';
  document.body.append(d);const sel=el('chinaEngine');[['auto',oldSelect?'기존 자동 / 기기 우선':'기존 엔진 (화면 기본)'],['local','기기 음성 (오프라인)'],...(oldSelect?[['google','Google (기존)']]:[]),...OPTIONS].forEach(([v,t])=>sel.add(new Option(t,v)));sel.onchange=()=>configureEngine(sel.value);
  el('chinaHelp').onclick=()=>window.open(oldSelect?new URL('TTS-중국-사용안내.html',document.baseURI).href:cfg.url+'/guide','_blank','noopener');
  el('chinaConnect').onclick=()=>{try{const c=JSON.parse(el('chinaCode').value);if(!validURL(c.url)||!c.key)throw new Error('연결 코드 형식 오류');cfg.url=c.url;cfg.key=String(c.key);saved();note('연결 정보 저장 완료')}catch(e){note(e.message)}};
  el('chinaManage').onclick=()=>window.open(cfg.url+'/#'+encodeURIComponent(cfg.key),'_blank','noopener');
  el('chinaDiag').onclick=async()=>{const list=window.speechSynthesis?.getVoices()||[];let report='중국어/한국어 브라우저 음성:\n'+list.filter(v=>/^(zh|ko)/i.test(v.lang)).map(v=>v.name+' · '+(v.localService?'설치':'온라인')).join('\n');try{const d=await(await request('status',null,AbortSignal.timeout(3000))).json();report+='\nPC 캐시 '+d.cache.count+'개\n'+d.providers.map(p=>p.name+': '+(!p.enabled?'꺼짐':!p.configured?'키 필요':'설정 있음 (합성 시험 필요)')).join('\n')}catch(e){report+='\n연결 도구: '+e.message}note(report)};
  el('chinaReset').onclick=()=>{stop();request('reset',{},AbortSignal.timeout(3000)).then(()=>note('실패 대기 초기화')).catch(e=>note(e.message));window.speechSynthesis?.getVoices()};
  for(const lang of ['Zh','Ko'])el('chinaTest'+lang).onclick=()=>{const text=lang==='Zh'?'你好，今天我们一起学习中文。':'안녕하세요. 한국어 음성 연결 시험입니다.';if(!speak({text,lang:lang==='Zh'?'zh':'ko',engine:engine(),rate:1,volume:.7,strict:true})){stop();const c=new AbortController();active=c;native(text,lang==='Zh'?'zh':'ko',1,.7,false,null,c.signal).then(()=>note('설치 음성 재생 완료')).catch(e=>note(e.message))}};
  el('chinaStop').onclick=stop;el('chinaPrepStop').onclick=()=>preparing?.abort();
  el('chinaLoad').onclick=()=>{const rows=window.LLTChinaRows?.()||[];const lang=el('chinaPrepLang').value;el('chinaPrepText').value=rows.map(r=>lang==='zh'?r.zh:r.ko).filter(Boolean).slice(0,100).join('\n');note(rows.length?'문장을 불러왔습니다. 미리 저장 시작을 누르세요.':'선택 문장이 없습니다. 직접 붙여넣으세요.')};
  el('chinaPrepare').onclick=async()=>{preparing?.abort();const c=new AbortController();preparing=c;const mode=engine();if(['auto','local','google','browser-online'].includes(mode)){note('미리 저장은 중국 자동 또는 연결 도구 업체 엔진을 선택하세요');return}const lang=el('chinaPrepLang').value,texts=el('chinaPrepText').value.split('\n').flatMap(chunks).slice(0,200);let ok=0,fail=0;for(let i=0;i<texts.length;i++){if(c.signal.aborted)break;try{await remoteBlob(mode,texts[i],lang,AbortSignal.any([c.signal,AbortSignal.timeout(90000)]));ok++}catch{if(c.signal.aborted)break;fail++}note((i+1)+'/'+texts.length+' · 저장 '+ok+' · 실패 '+fail)}if(c.signal.aborted)note('저장 중지 · 완료 '+ok);preparing=null};
  paint();d.showModal();
 }
 if(oldSelect){OPTIONS.forEach(([v,t])=>{if(![...oldSelect.options].some(o=>o.value===v))oldSelect.add(new Option(t,v))});if(OPTIONS.some(x=>x[0]===cfg.engine))oldSelect.value=cfg.engine;oldSelect.addEventListener('change',()=>{cfg.engine=oldSelect.value;saved()})}
 const menu=document.createElement('details');menu.className='llt-tts-menu';menu.setAttribute('aria-label','TTS 연결 설정');
 const label=document.createElement('summary');label.textContent='TTS';label.title='TTS 연결 설정';
 const action=document.createElement('button');action.type='button';action.textContent='연결 설정';action.onclick=()=>{menu.open=false;dialog()};
 menu.append(label,action);
 const menuStyle=document.createElement('style');menuStyle.textContent='.llt-tts-menu{position:relative;display:inline-flex;align-items:center;align-self:center;flex:0 0 auto;z-index:35;margin-left:3px;opacity:.56;font:10px/1 Arial,sans-serif}.llt-tts-menu:hover,.llt-tts-menu[open]{opacity:.92}.llt-tts-menu>summary{list-style:none;cursor:pointer;padding:3px 4px;color:#9298a0;border:1px solid transparent;border-radius:3px;white-space:nowrap;user-select:none}.llt-tts-menu>summary::-webkit-details-marker{display:none}.llt-tts-menu>summary::after{content:" ▾";font-size:8px;color:#737a83}.llt-tts-menu[open]>summary{border-color:#3c444f;background:#181c22;color:#c2c7ce}.llt-tts-menu>button{position:absolute;display:none;right:0;top:calc(100% + 3px);min-width:86px;padding:5px 8px;background:#20252c;color:#c3c8cf;border:1px solid #3b444f;border-radius:3px;font-size:10px;text-align:left;white-space:nowrap;z-index:50;cursor:pointer}.llt-tts-menu[open]>button{display:block}';document.head.append(menuStyle);
 const topTabs=el('tabs');
 if(oldSelect&&topTabs){const help=el('helpFab');if(help)topTabs.insertBefore(menu,help);else topTabs.append(menu)}
 else {const playerRow=el('btn-ttsLoop')?.parentElement;if(playerRow)playerRow.append(menu);else {const settings=el('settings');if(settings)settings.append(menu);else document.body.append(menu)}}
 window.LLTChina={isSpeaking:()=>!!active,speak,stop,setVolume,open:dialog,engine,chunks};
 window.addEventListener('online',()=>{if(cfg.key)request('reset',{},AbortSignal.timeout(3000)).catch(()=>{})});
 window.addEventListener('beforeunload',stop);
})();
