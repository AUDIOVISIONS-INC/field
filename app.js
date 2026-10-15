/* ══ AVI FIELD — the loader ═════════════════════════════════════════════════════════════
   Plan: claude/field_app_hosted_plan.md.

   The app is the same for every job; each job arrives as a file the DLF Composer writes
   (…_FieldJob.json, kept in the job's Dropbox folder). This file reads it, keeps it on the
   iPad, and starts the pull sheet (sheet.js) with it.

   0.4 · JOBS ON THIS IPAD (Mike, 10-15-26). Every job loaded stays on the iPad, one per job
   number; a revised file for the same job replaces it. The start screen lists them all.
   Removing a job keeps its ticks (his call) — they are tiny, and loading the job again brings
   them back. Bundled with the revised-file checks: an OLDER export asks first, and a newer one
   reports what the office added and removed.

   Where things live on the iPad:
     job files      IndexedDB 'avi-field' v2: store 'jobs' (key → {text}), store 'index'
                    (key → the light card data, so the list never reads 20 MB per job)
     ticks & notes  localStorage 'avi_pull_<number>_<sheet>' — unchanged since the HTML sheet
     open job       localStorage 'avi_field_active'                                        */
(function(){
  const APP_VERSION = '0.4 · jobs';
  const $ = id => document.getElementById(id);
  const esc = s => (s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const LS = { get(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } },
               set(k,v){ try{ localStorage.setItem(k,v); }catch(e){} },
               del(k){ try{ localStorage.removeItem(k); }catch(e){} } };

  /* ---- IndexedDB ---- */
  let dbP=null;
  function db(){
    return dbP || (dbP=new Promise((res,rej)=>{
      const r=indexedDB.open('avi-field',2);
      r.onupgradeneeded=()=>{ const d=r.result;
        if(!d.objectStoreNames.contains('jobs')) d.createObjectStore('jobs');
        if(!d.objectStoreNames.contains('index')) d.createObjectStore('index'); };
      r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error);
    }));
  }
  async function get(store,key){ const d=await db();
    return new Promise((res,rej)=>{ const q=d.transaction(store).objectStore(store).get(key);
      q.onsuccess=()=>res(q.result||null); q.onerror=()=>rej(q.error); }); }
  async function all(store){ const d=await db();
    return new Promise((res,rej)=>{ const q=d.transaction(store).objectStore(store).getAll();
      q.onsuccess=()=>res(q.result||[]); q.onerror=()=>rej(q.error); }); }
  async function write(ops){ const d=await db();          // [[store,'put'|'delete',key,value]]
    return new Promise((res,rej)=>{ const t=d.transaction(['jobs','index'],'readwrite');
      ops.forEach(([s,op,k,v])=>{ if(op==='put') t.objectStore(s).put(v,k); else t.objectStore(s).delete(k); });
      t.oncomplete=()=>res(); t.onerror=()=>rej(t.error); t.onabort=()=>rej(t.error); }); }

  try{ if(navigator.storage && navigator.storage.persist) navigator.storage.persist(); }catch(e){}

  function msg(t,bad){ const m=$('stMsg'); m.textContent=t||''; m.className='st-msg'+(bad?' bad':''); }

  /* A job file is {_type:'avi_field_job', fmt, exportedAt, data:{meta, rows, …}}. A bare DATA
     object is accepted too. */
  function unwrap(o){
    if(o && o._type==='avi_field_job' && o.data) return {D:o.data, at:o.exportedAt||(o.data.meta&&o.data.meta.savedAt)||''};
    if(o && o.meta && Array.isArray(o.rows)) return {D:o, at:o.meta.savedAt||''};
    return null;
  }
  const keyOf = (meta,name) => 'job:'+String(meta.number||meta.project||name||'job').trim().toUpperCase();
  const tickKey = meta => 'avi_pull_'+(meta.number||'x')+'_'+(meta.sheet||'x');    // = sheet.js KEY
  const p2 = n => String(n).padStart(2,'0');
  function nowStamp(){ const d=new Date(); return d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate())+' '+p2(d.getHours())+':'+p2(d.getMinutes()); }
  /* "Oct 15, 11:02 AM" — the export time, so two exports from one day can be told apart */
  function when(t){ if(!t) return ''; const d=new Date(t); if(isNaN(d)) return String(t).slice(0,16);
    return d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); }
  function pulled(card){
    let S=null; try{ S=JSON.parse(LS.get(tickKey(card.meta||{}))||'null'); }catch(e){}
    const rows=(S&&S.rows)||{}; const done=Object.keys(rows).filter(k=>rows[k]&&rows[k].done).length;
    const tot=(card.rowCount||0)+((S&&S.extra)||[]).length;
    return tot ? Math.min(100,Math.round(done/tot*100)) : 0;
  }

  /* ---- 0.3 → 0.4: the one job kept under 'current' becomes the first entry of the list ---- */
  async function migrate(){
    const old=await get('jobs','current'); if(!old) return;
    let u=null; try{ u=unwrap(JSON.parse(old.text)); }catch(e){}
    if(!u){ await write([['jobs','delete','current']]); return; }
    const k=keyOf(u.D.meta||{},old.name);
    await write([['jobs','put',k,{text:old.text}],
                 ['index','put',k,{key:k, meta:u.D.meta||{}, name:old.name||'', exportedAt:u.at, rowCount:(u.D.rows||[]).length,
                                   loadedAt:old.loadedAt||nowStamp(), openedAt:Date.now(), size:old.text.length}],
                 ['jobs','delete','current']]);
    if(!LS.get('avi_field_active')) LS.set('avi_field_active',k);
  }

  /* ---- the start screen: every job on this iPad ---- */
  async function showStart(){
    document.body.classList.add('nojob');
    $('start').hidden=false;
    let cards=[]; try{ cards=await all('index'); }catch(e){ msg('This iPad is not letting the app store jobs ('+(e&&e.message||e)+').',true); }
    cards.sort((a,b)=>(b.openedAt||0)-(a.openedAt||0));
    const active=LS.get('avi_field_active');
    $('stJobsHead').hidden=!cards.length;
    $('stLoad').classList.toggle('ghost', cards.length>0);
    $('stJobs').innerHTML=cards.map(c=>{ const m=c.meta||{};
      const nm=[m.project,m.number].filter(Boolean).join(' · ')||c.name||'Job';
      const sub=[m.client, m.rev&&('REV '+m.rev), c.exportedAt&&('exported '+when(c.exportedAt))].filter(Boolean).join('  ·  ');
      return '<div class="st-job'+(c.key===active?' cur':'')+'">'+
        '<button class="main" data-open="'+esc(c.key)+'"><div class="nm">'+esc(nm)+'</div>'+
          '<div class="mt">'+esc(sub)+'</div>'+
          '<div class="mt">'+(c.openedAt?'opened '+esc(when(c.openedAt)):'loaded '+esc(c.loadedAt||''))+'</div></button>'+
        '<div class="pc"><b>'+pulled(c)+'%</b>pulled</div>'+
        '<button class="rm" data-rm="'+esc(c.key)+'" aria-label="Remove from this iPad">Remove</button></div>'; }).join('');
    $('stJobs').querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>openJob(b.dataset.open));
    $('stJobs').querySelectorAll('[data-rm]').forEach(b=>b.onclick=()=>removeJob(b.dataset.rm));
    let store='';
    try{ if(navigator.storage&&navigator.storage.estimate){ const e=await navigator.storage.estimate();
      if(e&&e.usage!=null) store='  ·  '+Math.round(e.usage/1048576)+' MB used'; } }catch(e){}
    $('stVer').textContent='AVI Field '+APP_VERSION+'  ·  '+cards.length+' job'+(cards.length===1?'':'s')+' on this iPad'+store;
  }
  window.AVI_FIELD={ showStart(){ try{ sessionStorage.setItem('avi_field_start','1'); }catch(e){} location.reload(); },
                     version:APP_VERSION };

  async function openJob(k){
    const c=await get('index',k); if(!c) return;
    c.openedAt=Date.now(); await write([['index','put',k,c]]);
    LS.set('avi_field_active',k);
    try{ sessionStorage.removeItem('avi_field_start'); }catch(_){}
    location.reload();
  }
  async function removeJob(k){
    const c=await get('index',k); if(!c) return;
    const m=c.meta||{}, nm=[m.project,m.number].filter(Boolean).join(' ')||'this job';
    if(!confirm('Remove '+nm+' from this iPad?\n\nDo ☰ → Save / hand off first if anything is not in Dropbox yet. '+
                'Your ticks stay on the iPad, so loading the job again brings them back.')) return;
    await write([['jobs','delete',k],['index','delete',k]]);
    if(LS.get('avi_field_active')===k) LS.del('avi_field_active');
    await showStart(); msg('Removed '+nm+'.');
  }

  function loadScript(src){
    return new Promise((res,rej)=>{ const s=document.createElement('script'); s.src=src;
      s.onload=res; s.onerror=()=>rej(new Error('could not load '+src)); document.body.appendChild(s); });
  }
  async function startSheet(k){
    const rec=await get('jobs',k); let u=null;
    try{ u=rec&&unwrap(JSON.parse(rec.text)); }catch(e){}
    if(!u){ LS.del('avi_field_active'); await showStart(); msg('That job could not be read on this iPad. Load its job file again.',true); return; }
    window.__JOB=u.D;
    document.body.classList.remove('nojob'); $('start').hidden=true;
    try{
      if(u.D.specs && Object.keys(u.D.specs).length){ await loadScript('pdf.min.js'); await loadScript('pdf.worker.min.js'); }
      await loadScript('sheet.js');
      try{ const was=LS.get('avi_field_ver');
           if(was && was!==APP_VERSION && typeof toast==='function') toast('Updated to AVI Field '+APP_VERSION);
           LS.set('avi_field_ver',APP_VERSION); }catch(_){}
      showRevisionNote();
    }catch(e){
      document.body.classList.add('nojob'); await showStart();
      msg('The app could not start ('+(e&&e.message||e)+'). Check the signal and try again.',true);
    }
  }

  /* ---- revised files: what changed, said once, on the sheet itself ---- */
  function showRevisionNote(){
    let n=null; try{ n=JSON.parse(sessionStorage.getItem('avi_field_note')||'null'); sessionStorage.removeItem('avi_field_note'); }catch(e){}
    if(!n || typeof openSheet!=='function') return;
    const gone=n.removed||[];
    const worked=gone.filter(r=>r.done||r.note);
    const body='<div class="sh"><h2 style="font-family:var(--sans)">Revised job loaded</h2><button class="x" data-x>✕</button></div>'+
      '<p class="tagmsg">'+esc(n.name)+' — exported '+esc(when(n.at))+'. Your ticks and notes carried over.</p>'+
      '<dl class="facts"><dt>New cables</dt><dd class="m">'+n.added+'</dd>'+
        '<dt>Removed from the drawing</dt><dd class="m">'+gone.length+'</dd></dl>'+
      (gone.length?'<p class="lbl">No longer on the list</p>'+
        gone.slice(0,60).map(r=>'<div class="chk-row'+((r.done||r.note)?' bad':'')+'"><div class="chk-k">'+(r.done?'✓ ':'')+esc(r.tag||'—')+'</div>'+
          '<div class="chk-t">'+esc([r.from,r.label].filter(Boolean).join(' · '))+(r.note?' — note: '+esc(r.note):'')+'</div></div>').join('')+
        (gone.length>60?'<p class="hintline">…and '+(gone.length-60)+' more.</p>':''):'')+
      (worked.length?'<div class="banner">⚠ You had already ticked or noted '+worked.length+' of these. If they were pulled, '+
        'tell the office — they are no longer on this sheet or in its report.</div>':'')+
      '<button class="btn" data-ok>Carry on</button>';
    openSheet(body);
    const sb=$('sheetBody'); sb.querySelector('[data-x]').onclick=closeSheet; sb.querySelector('[data-ok]').onclick=closeSheet;
  }

  /* ---- Load a job file ---- */
  $('stLoad').onclick=()=>$('jobIn').click();
  $('jobIn').onchange=e=>{
    const f=(e.target.files||[])[0]; e.target.value=''; if(!f) return;
    msg('Reading '+f.name+' …');
    const fr=new FileReader();
    fr.onerror=()=>msg('That file could not be read.',true);
    fr.onload=async()=>{
      let u=null; try{ u=unwrap(JSON.parse(fr.result)); }catch(err){}
      if(!u){ msg('“'+f.name+'” is not a job file. Pick the file ending in _FieldJob.json.',true); return; }
      const meta=u.D.meta||{}, k=keyOf(meta,f.name), nm=[meta.project,meta.number].filter(Boolean).join(' ')||f.name;
      const old=await get('index',k);
      let note=null;
      if(old){
        const tOld=Date.parse(old.exportedAt||''), tNew=Date.parse(u.at||'');
        if(isFinite(tOld) && isFinite(tNew) && tNew<tOld &&
           !confirm('This file is OLDER than the '+nm+' already on this iPad.\n\nOn the iPad: exported '+when(old.exportedAt)+
                    '\nThis file: exported '+when(u.at)+'\n\nLoad the older one anyway?')){ msg('Kept the newer job.'); return; }
        if(!(isFinite(tOld) && isFinite(tNew) && tNew===tOld)){
          /* what the office changed: compared by row id, the key the ticks are stored under */
          let prev=null; try{ const pr=await get('jobs',k); prev=pr&&unwrap(JSON.parse(pr.text)); }catch(err){}
          if(prev){
            const nowIds=new Set((u.D.rows||[]).map(r=>r.id)), wasIds=new Set((prev.D.rows||[]).map(r=>r.id));
            let S=null; try{ S=JSON.parse(LS.get(tickKey(meta))||'null'); }catch(err){}
            const st=(S&&S.rows)||{};
            const removed=(prev.D.rows||[]).filter(r=>!nowIds.has(r.id)).map(r=>({tag:r.tag, label:r.label||r.type||'',
              from:[(r.fromRoom||'').toUpperCase(), r.fromNo].filter(Boolean).join(' '),
              done:!!(st[r.id]&&st[r.id].done), note:(st[r.id]&&st[r.id].note)||''}));
            note={name:nm, at:u.at, added:(u.D.rows||[]).filter(r=>!wasIds.has(r.id)).length, removed};
          }
        }
      }
      const rec={key:k, meta, name:f.name, exportedAt:u.at, rowCount:(u.D.rows||[]).length,
                 loadedAt:nowStamp(), openedAt:Date.now(), size:fr.result.length};
      try{ await write([['jobs','put',k,{text:fr.result}],['index','put',k,rec]]); }
      catch(err){ msg('The job could not be stored on this iPad ('+(err&&err.message||err)+').',true); return; }
      LS.set('avi_field_active',k);
      try{ sessionStorage.removeItem('avi_field_start');
           if(note) sessionStorage.setItem('avi_field_note',JSON.stringify(note)); }catch(_){}
      location.reload();                       /* a clean start, exactly like opening the app */
    };
    fr.readAsText(f);
  };

  /* ---- the offline copy (sw.js) ---- */
  if('serviceWorker' in navigator){
    window.addEventListener('load',()=>{ navigator.serviceWorker.register('sw.js').catch(()=>{}); });
  }

  /* ---- boot ---- */
  (async function(){
    try{ await migrate(); }catch(e){}
    let wantStart=false; try{ wantStart=sessionStorage.getItem('avi_field_start')==='1'; sessionStorage.removeItem('avi_field_start'); }catch(e){}
    const k=LS.get('avi_field_active');
    let c=null; try{ c=k&&await get('index',k); }catch(e){}
    if(c && !wantStart){ c.openedAt=Date.now(); try{ await write([['index','put',k,c]]); }catch(e){} startSheet(k); }
    else showStart();
  })();
})();
