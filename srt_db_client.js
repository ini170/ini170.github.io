(() => {
  'use strict';
  const button=document.getElementById('srtDbSendBtn');
  const status=document.getElementById('srtDbSendStatus');
  if(!button)return;
  let serial=0;
  const pending=new Map();
  const clean=value=>String(value||'').replace(/\\/g,'/').replace(/^[a-z]:\//i,'').replace(/^\/+|\/+$/g,'');
  const basename=value=>clean(value).split('/').pop()||'';
  const withRoot=(path,root)=>{
    let p=clean(path),r=clean(root);
    if(r&&p&&p.toLowerCase()!==r.toLowerCase()&&!p.toLowerCase().startsWith(r.toLowerCase()+'/'))p=r+'/'+p;
    return p;
  };
  const setStatus=(text,error=false)=>{if(status){status.textContent=text;status.style.color=error?'#e4ad68':'var(--faint)';}};
  button.addEventListener('click',()=>{
    const item=(typeof playlist!=="undefined"&&Array.isArray(playlist))?playlist[(typeof currentIndex==="number"?currentIndex:0)]:null;
    const editor=document.getElementById('editor');
    const rawText=editor&&editor.value||'';
    if(!item){setStatus('재생목록에서 영상 항목을 선택하세요.',true);return;}
    if(!rawText.trim()){setStatus('현재 로드된 SRT가 비어 있습니다.',true);return;}
    let srtName=item.srt&&item.srt.name||item.placeholderSrtName||'';
    if(typeof _playlistFileName==='function')srtName=_playlistFileName(item,'srt')||srtName;
    srtName=srtName||'subtitle.srt';
    let videoName=item.video&&item.video.name||item.placeholderVideoName||'';
    if(typeof _playlistFileName==='function')videoName=_playlistFileName(item,'video')||videoName;
    videoName=videoName||srtName.replace(/\.srt$/i,'');
    videoName=videoName.replace(/\.[^.]+$/,'');
    const root=item.sourceRootName||'';
    const sourcePath=withRoot(item.srtPath||item.srt&&item.srt.webkitRelativePath||srtName,root);
    const videoPath=withRoot(item.videoPath||item.video&&item.video.webkitRelativePath||sourcePath,root);
    const videoFolder=videoPath.includes('/')?videoPath.slice(0,videoPath.lastIndexOf('/')):'(폴더 정보 없음)';
    const requestId='vp-srt-'+Date.now()+'-'+(++serial);
    pending.set(requestId,true);
    setStatus('문장 DB로 전송 중…');
    button.disabled=true;
    const timeout=setTimeout(()=>{
      if(!pending.has(requestId))return;
      pending.delete(requestId);button.disabled=false;
      setStatus('앱 문장 DB 응답 시간 초과. 앱 탭을 열고 다시 전송하세요.',true);
    },20000);
    pending.set(requestId,timeout);
    window.parent.postMessage({
      llt:'vp-srt-db-save',requestId,rawText,sourcePath,sourceName:srtName,
      videoFolder,videoName
    },'*');
  });
  window.addEventListener('message',event=>{
    if(event.source!==window.parent)return;
    const message=event.data;
    if(!message||message.llt!=='vp-srt-db-save-result'||!pending.has(String(message.requestId||'')))return;
    const id=String(message.requestId),timer=pending.get(id);clearTimeout(timer);pending.delete(id);button.disabled=false;
    if(message.ok)setStatus('문장 DB 저장 완료 · cue '+Number(message.cues||0).toLocaleString()+'개 · 수동 검토 대기 '+Number(message.review||0).toLocaleString()+'개');
    else setStatus('문장 DB 저장 실패: '+String(message.error||'알 수 없는 오류'),true);
  });
})();