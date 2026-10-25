/* Lightweight video-player bridge. Engine and voice settings come from the parent app. */
(() => {
 'use strict';
 let prefs={engine:'local',rate:1,voices:{zh:'',ko:''}}, sequence=0, currentAudio=null, currentUtterance=null, cancelCurrent=null, volume=1;
 const langCode=lang=>String(lang||'zh').toLowerCase().startsWith('ko')?'ko-KR':'zh-CN';
 const langPrefix=lang=>langCode(lang).slice(0,2);
 const voices=lang=>{try{return window.speechSynthesis?.getVoices()?.filter(v=>(v.lang||'').toLowerCase().startsWith(langPrefix(lang))&&v.localService===true)||[]}catch{return[]}};
 function stop(){
  sequence++;
  if(cancelCurrent){const cancel=cancelCurrent;cancelCurrent=null;cancel()}
  if(currentAudio){const a=currentAudio;currentAudio=null;a.onended=a.onerror=a.onplaying=null;try{a.pause();a.removeAttribute('src');a.load()}catch{}}
  if(currentUtterance){currentUtterance.onend=currentUtterance.onerror=null;currentUtterance=null}
  try{window.speechSynthesis?.cancel()}catch{}
 }
 function setVolume(value){volume=Math.max(0,Math.min(1.5,Number(value)||0));if(currentAudio)currentAudio.volume=Math.min(1,volume);if(currentUtterance)currentUtterance.volume=Math.min(1,volume)}
 function playInstalled(text,lang,rate,token){
  return new Promise((resolve,reject)=>{
   if(!window.speechSynthesis||!window.SpeechSynthesisUtterance){reject(new Error('브라우저 음성 기능을 사용할 수 없습니다.'));return}
   const list=voices(lang), chosen=list.find(v=>v.voiceURI===prefs.voices[langPrefix(lang)])||list[0];
   if(!chosen){reject(new Error('설치된 '+(langPrefix(lang)==='ko'?'한국어':'중국어')+' 음성이 없습니다.'));return}
   if(token!==sequence){resolve();return}
   const u=new SpeechSynthesisUtterance(text);u.lang=langCode(lang);u.voice=chosen;u.rate=rate;u.volume=Math.min(1,volume);currentUtterance=u;
   let done=false;
   const finish=error=>{if(done)return;done=true;u.onend=u.onerror=null;if(currentUtterance===u)currentUtterance=null;if(cancelCurrent===cancel)cancelCurrent=null;error?reject(error):resolve()};
   const cancel=()=>finish(new Error('중지됨'));cancelCurrent=cancel;
   u.onend=()=>finish();u.onerror=()=>finish(new Error('설치 음성 재생 실패'));
   try{window.speechSynthesis.cancel();if(window.speechSynthesis.paused)window.speechSynthesis.resume();window.speechSynthesis.speak(u)}catch(e){finish(e)}
  })
 }
 function playGoogle(text,lang,rate,token){
  return new Promise((resolve,reject)=>{
   const a=new Audio();let done=false,timer=0;
   const finish=error=>{if(done)return;done=true;clearTimeout(timer);a.onended=a.onerror=a.onplaying=null;if(currentAudio===a)currentAudio=null;if(cancelCurrent===cancel)cancelCurrent=null;try{a.pause();a.removeAttribute('src');a.load()}catch{}error?reject(error):resolve()};
   const cancel=()=>finish(new Error('중지됨'));cancelCurrent=cancel;currentAudio=a;
   if(token!==sequence){finish();return}
   a.volume=Math.min(1,volume);a.playbackRate=rate;a.src='https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&ttsspeed=1&tl='+langCode(lang)+'&q='+encodeURIComponent(text.slice(0,190));
   a.onended=()=>finish();a.onerror=()=>finish(new Error('Google TTS 연결 실패'));a.onplaying=()=>{clearTimeout(timer);timer=setTimeout(()=>finish(new Error('Google TTS 재생 시간 초과')),45000)};
   timer=setTimeout(()=>finish(new Error('Google TTS 응답 시간 초과')),10000);
   try{const p=a.play();if(p?.catch)p.catch(finish)}catch(e){finish(e)}
  })
 }
 function speak(options={}){
  const text=String(options.text||'').trim();if(!text)return false;
  stop();const token=sequence,lang=options.lang||'zh',engine=options.engine||prefs.engine;
  const rate=Math.max(.25,Number(prefs.rate)||Number(options.rate)||1),parts=[];
  let rest=text;while(rest.length>190){let cut=rest.slice(0,190),at=Math.max(cut.lastIndexOf('。'),cut.lastIndexOf('，'),cut.lastIndexOf(','),cut.lastIndexOf(' '));if(at>40)cut=rest.slice(0,at+1);parts.push(cut);rest=rest.slice(cut.length)}if(rest)parts.push(rest);
  volume=options.volume==null?volume:Math.max(0,Math.min(1.5,Number(options.volume)||0));
  (async()=>{try{for(const part of parts){if(token!==sequence)return;if(engine==='google'){try{await playGoogle(part,lang,rate,token)}catch{if(token!==sequence)return;await playInstalled(part,lang,rate,token)}}else await playInstalled(part,lang,rate,token)}if(token===sequence)options.onend?.()}catch(error){if(token===sequence){options.onerror?.(error);options.onend?.()}}})();
  return true
 }
 function applySettings(value){if(!value)return;prefs={engine:value.engine==='google'?'google':'local',rate:Math.min(2,Math.max(.25,Number(value.rate)||1)),voices:{zh:String(value.voices?.zh??value.voice??''),ko:String(value.voices?.ko||'')}}}
 window.addEventListener('message',event=>{if(event.source!==window.parent||event.data?.llt!=='voice-settings')return;applySettings(event.data.settings)});
 if(window.parent!==window)window.parent.postMessage({llt:'voice-settings-request'},'*');
 window.LLTChina={isSpeaking:()=>!!currentAudio||!!currentUtterance,speak,stop,setVolume,engine:()=>prefs.engine,tabRate:()=>prefs.rate};
 window.addEventListener('beforeunload',stop);
})();
