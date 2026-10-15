/* ══ AVI FIELD — the loader ═════════════════════════════════════════════════════════════
   Step 1 of the hosted app (plan: claude/field_app_hosted_plan.md).

   The app is the same for every job; the job arrives as a file the DLF Composer writes
   (…_FieldJob.json, kept in the job's Dropbox folder). This file reads it, keeps it on the
   iPad, and starts the pull sheet (sheet.js) with it — exactly the sheet the techs know.

   Where things live on the iPad:
     the job file   IndexedDB  'avi-field' / 'jobs' / 'current'   (too big for localStorage)
     ticks & notes  localStorage, keyed by job number + sheet       (unchanged from the HTML
                    sheet, so a revised job file for the same job keeps them)
   Step 1 keeps ONE job. The list of several jobs is step 5. ═══════════════════════════ */
(function(){
  const APP_VERSION = '0.3 · pinch';
  const $ = id => document.getElementById(id);
  const esc = s => (s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

  /* ---- IndexedDB, the smallest wrapper that will do ---- */
  function db(){
    return new Promise((res,rej)=>{
      const r=indexedDB.open('avi-field',1);
      r.onupgradeneeded=()=>r.result.createObjectStore('jobs');
      r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error);
    });
  }
  async function getJob(){
    const d=await db();
    return new Promise((res,rej)=>{ const q=d.transaction('jobs').objectStore('jobs').get('current');
      q.onsuccess=()=>res(q.result||null); q.onerror=()=>rej(q.error); });
  }
  async function putJob(rec){
    const d=await db();
    return new Promise((res,rej)=>{ const t=d.transaction('jobs','readwrite');
      t.objectStore('jobs').put(rec,'current'); t.oncomplete=()=>res(); t.onerror=()=>rej(t.error); });
  }

  /* Ask the iPad to keep this app's storage. Home-screen apps generally keep it anyway. */
  try{ if(navigator.storage && navigator.storage.persist) navigator.storage.persist(); }catch(e){}

  function msg(t,bad){ const m=$('stMsg'); m.textContent=t||''; m.className='st-msg'+(bad?' bad':''); }

  /* A job file is {_type:'avi_field_job', fmt, data:{meta, rows, …}}. A bare DATA object
     is accepted too, so a hand-extracted file still loads. */
  function unwrap(o){
    if(o && o._type==='avi_field_job' && o.data) return o.data;
    if(o && o.meta && Array.isArray(o.rows)) return o;
    return null;
  }
  function label(meta){ return [meta.project, meta.number].filter(Boolean).join(' · ') || 'Job'; }
  function sub(meta){
    return [meta.client, meta.sheet && ('SHEET '+meta.sheet), meta.rev && ('REV '+meta.rev),
            (meta.savedAt||'').slice(0,10)].filter(Boolean).join('  ·  ');
  }

  async function showStart(){
    document.body.classList.add('nojob');
    $('start').hidden=false;
    $('stVer').textContent='AVI Field '+APP_VERSION;
    let rec=null; try{ rec=await getJob(); }catch(e){ msg('This iPad is not letting the app store jobs ('+(e&&e.message||e)+').',true); }
    if(rec){
      $('stJob').hidden=false;
      $('stLoad').classList.add('ghost');          /* one copper button per screen */
      $('stJobName').textContent=label(rec.meta||{});
      $('stJobMeta').textContent=sub(rec.meta||{})+(rec.loadedAt?('  ·  loaded '+rec.loadedAt):'');
    } else { $('stJob').hidden=true; $('stLoad').classList.remove('ghost'); }
  }
  window.AVI_FIELD={ showStart(){ try{ sessionStorage.setItem('avi_field_start','1'); }catch(e){} location.reload(); },
                     version:APP_VERSION };

  function loadScript(src){
    return new Promise((res,rej)=>{ const s=document.createElement('script'); s.src=src;
      s.onload=res; s.onerror=()=>rej(new Error('could not load '+src)); document.body.appendChild(s); });
  }
  async function startSheet(rec){
    let D;
    try{ D=unwrap(JSON.parse(rec.text)); }catch(e){ D=null; }
    if(!D){ await showStart(); msg('The job stored on this iPad could not be read. Load the job file again.',true); return; }
    window.__JOB=D;
    document.body.classList.remove('nojob'); $('start').hidden=true;
    try{
      /* the spec-sheet viewer only when the office sent spec sheets */
      if(D.specs && Object.keys(D.specs).length){ await loadScript('pdf.min.js'); await loadScript('pdf.worker.min.js'); }
      await loadScript('sheet.js');
      /* Step 2: say once that the app was updated, so a tech knows the new version arrived. */
      try{ const was=localStorage.getItem('avi_field_ver');
           if(was && was!==APP_VERSION && typeof toast==='function') toast('Updated to AVI Field '+APP_VERSION);
           localStorage.setItem('avi_field_ver',APP_VERSION); }catch(_){}
    }catch(e){
      document.body.classList.add('nojob'); await showStart();
      msg('The app could not start ('+(e&&e.message||e)+'). Check the signal and try again.',true);
    }
  }

  $('stLoad').onclick=()=>$('jobIn').click();
  $('stOpen').onclick=async()=>{ const rec=await getJob(); if(rec) startSheet(rec); };
  $('jobIn').onchange=e=>{
    const f=(e.target.files||[])[0]; e.target.value=''; if(!f) return;
    msg('Reading '+f.name+' …');
    const fr=new FileReader();
    fr.onerror=()=>msg('That file could not be read.',true);
    fr.onload=async()=>{
      let D=null; try{ D=unwrap(JSON.parse(fr.result)); }catch(err){}
      if(!D){ msg('“'+f.name+'” is not a job file. Pick the file ending in _FieldJob.json.',true); return; }
      const d=new Date(), p=n=>String(n).padStart(2,'0');
      const rec={ text:fr.result, meta:D.meta||{}, name:f.name,
                  loadedAt:d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes()) };
      try{ await putJob(rec); }
      catch(err){ msg('The job could not be stored on this iPad ('+(err&&err.message||err)+').',true); return; }
      try{ sessionStorage.removeItem('avi_field_start'); }catch(_){}
      location.reload();                       /* a clean start, exactly like opening the app */
    };
    fr.readAsText(f);
  };

  /* ---- Step 2: the offline copy. sw.js keeps every app file on the iPad, so the icon opens
     with no signal. With signal it checks GitHub for a newer version first. ---- */
  if('serviceWorker' in navigator){
    window.addEventListener('load',()=>{ navigator.serviceWorker.register('sw.js').catch(()=>{}); });
  }

  /* ---- boot ---- */
  (async function(){
    let wantStart=false; try{ wantStart=sessionStorage.getItem('avi_field_start')==='1'; sessionStorage.removeItem('avi_field_start'); }catch(e){}
    let rec=null; try{ rec=await getJob(); }catch(e){}
    if(rec && !wantStart) startSheet(rec); else showStart();
  })();
})();
