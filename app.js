/* ══ AVI FIELD — the loader ═════════════════════════════════════════════════════════════
   Plan: claude/field_app_hosted_plan.md, claude/field_app_rack_schematic_plan.md.

   The app is the same for every job. A job is made of PARTS, each a file a composer writes
   into the job's Dropbox folder:
     pull      …_FieldJob.json  (DLF Composer)   → the pull sheet (sheet.js)
     rack      the rack elevation PDF            → the drawings viewer
     sch       the schematic PDF                 → the drawings viewer
     other     any other PDF, by file name       → the drawings viewer
   0.4 (10-15): every job loaded stays on the iPad; revised files replace that part.
   0.5 (10-15): "Load job files" takes several files at once; PDFs are filed under their job
   by job number (PDF keywords → title-block text → file name → ask); a job can start from
   drawings alone; tabs switch between the parts. Removing a job keeps its ticks (Mike).

   Where things live on the iPad:
     IndexedDB 'avi-field' v3: 'jobs' (key → {text} of the pull sheet), 'index' (key → card data,
       incl. parts), 'files' (key|part → {name, buf, addedAt} of a PDF)
     ticks & notes  localStorage 'avi_pull_<number>_<sheet>' — unchanged since the HTML sheet
     open job       localStorage 'avi_field_active'; open part 'avi_field_part'           */
(function(){
  const APP_VERSION = '0.5 · drawings';
  const $ = id => document.getElementById(id);
  const esc = s => (s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const LS = { get(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } },
               set(k,v){ try{ localStorage.setItem(k,v); }catch(e){} },
               del(k){ try{ localStorage.removeItem(k); }catch(e){} } };
  const SS = { get(k){ try{ return sessionStorage.getItem(k); }catch(e){ return null; } },
               set(k,v){ try{ sessionStorage.setItem(k,v); }catch(e){} },
               del(k){ try{ sessionStorage.removeItem(k); }catch(e){} } };

  /* ---- IndexedDB ---- */
  let dbP=null;
  function db(){
    return dbP || (dbP=new Promise((res,rej)=>{
      const r=indexedDB.open('avi-field',3);
      r.onupgradeneeded=()=>{ const d=r.result;
        ['jobs','index','files'].forEach(n=>{ if(!d.objectStoreNames.contains(n)) d.createObjectStore(n); }); };
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
    return new Promise((res,rej)=>{ const t=d.transaction(['jobs','index','files'],'readwrite');
      ops.forEach(([s,op,k,v])=>{ if(op==='put') t.objectStore(s).put(v,k); else t.objectStore(s).delete(k); });
      t.oncomplete=()=>res(); t.onerror=()=>rej(t.error); t.onabort=()=>rej(t.error); }); }

  try{ if(navigator.storage && navigator.storage.persist) navigator.storage.persist(); }catch(e){}

  function msg(t,bad){ const m=$('stMsg'); m.textContent=t||''; m.className='st-msg'+(bad?' bad':''); }

  function unwrap(o){
    if(o && o._type==='avi_field_job' && o.data) return {D:o.data, at:o.exportedAt||(o.data.meta&&o.data.meta.savedAt)||''};
    if(o && o.meta && Array.isArray(o.rows)) return {D:o, at:o.meta.savedAt||''};
    return null;
  }
  const keyFor = num => 'job:'+String(num||'job').trim().toUpperCase();
  const keyOf = (meta,name) => keyFor(meta.number||meta.project||name);
  const tickKey = meta => 'avi_pull_'+(meta.number||'x')+'_'+(meta.sheet||'x');    // = sheet.js KEY
  const p2 = n => String(n).padStart(2,'0');
  function nowStamp(){ const d=new Date(); return d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate())+' '+p2(d.getHours())+':'+p2(d.getMinutes()); }
  function when(t){ if(!t) return ''; const d=new Date(t); if(isNaN(d)) return String(t).slice(0,16);
    return d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); }
  function pulled(card){
    if(!card.rowCount) return null;
    let S=null; try{ S=JSON.parse(LS.get(tickKey(card.meta||{}))||'null'); }catch(e){}
    const rows=(S&&S.rows)||{}; const done=Object.keys(rows).filter(k=>rows[k]&&rows[k].done).length;
    const tot=(card.rowCount||0)+((S&&S.extra)||[]).length;
    return tot ? Math.min(100,Math.round(done/tot*100)) : 0;
  }
  const PART_NAME={pull:'Pull sheet', rack:'Rack', sch:'Schematic'};
  function partList(c){ const P=c.parts||{}; const out=[];
    if(c.rowCount||P.pull) out.push({id:'pull', label:'Pull sheet'});
    if(P.rack) out.push({id:'rack', label:'Rack'});
    if(P.sch) out.push({id:'sch', label:'Schematic'});
    Object.keys(P).filter(k=>k.startsWith('other:')).sort().forEach(k=>out.push({id:k, label:P[k].label||k.slice(6)}));
    return out; }

  /* ---- 0.3 → 0.4: the one job kept under 'current' becomes the first entry of the list ---- */
  async function migrate(){
    const old=await get('jobs','current'); if(!old) return;
    let u=null; try{ u=unwrap(JSON.parse(old.text)); }catch(e){}
    if(!u){ await write([['jobs','delete','current']]); return; }
    const k=keyOf(u.D.meta||{},old.name);
    await write([['jobs','put',k,{text:old.text}],
                 ['index','put',k,{key:k, meta:u.D.meta||{}, name:old.name||'', exportedAt:u.at, rowCount:(u.D.rows||[]).length,
                                   loadedAt:old.loadedAt||nowStamp(), openedAt:Date.now(), size:old.text.length, parts:{pull:{name:old.name||''}}}],
                 ['jobs','delete','current']]);
    if(!LS.get('avi_field_active')) LS.set('avi_field_active',k);
  }

  /* ---- the start screen: every job on this iPad ---- */
  async function showStart(){
    document.body.classList.add('nojob'); document.body.classList.remove('drwonly');
    $('drw').hidden=true; $('start').hidden=false;
    let cards=[]; try{ cards=await all('index'); }catch(e){ msg('This iPad is not letting the app store jobs ('+(e&&e.message||e)+').',true); }
    cards.sort((a,b)=>(b.openedAt||0)-(a.openedAt||0));
    const active=LS.get('avi_field_active');
    $('stJobsHead').hidden=!cards.length;
    $('stLoad').classList.toggle('ghost', cards.length>0);
    $('stJobs').innerHTML=cards.map(c=>{ const m=c.meta||{};
      const nm=[m.project,m.number].filter(Boolean).join(' · ')||c.name||'Job';
      const sub=[m.client, m.rev&&('REV '+m.rev), c.exportedAt&&('exported '+when(c.exportedAt))].filter(Boolean).join('  ·  ');
      const pc=pulled(c);
      return '<div class="st-job'+(c.key===active?' cur':'')+'">'+
        '<button class="main" data-open="'+esc(c.key)+'"><div class="nm">'+esc(nm)+'</div>'+
          (sub?'<div class="mt">'+esc(sub)+'</div>':'')+
          '<div class="mt">'+esc(partList(c).map(p=>p.label).join(' · '))+
            (c.openedAt?'  ·  opened '+esc(when(c.openedAt)):'')+'</div></button>'+
        (pc==null?'':'<div class="pc"><b>'+pc+'%</b>pulled</div>')+
        '<button class="rm" data-rm="'+esc(c.key)+'" aria-label="Remove from this iPad">Remove</button></div>'; }).join('');
    $('stJobs').querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>openJob(b.dataset.open));
    $('stJobs').querySelectorAll('[data-rm]').forEach(b=>b.onclick=()=>removeJob(b.dataset.rm));
    let store='';
    try{ if(navigator.storage&&navigator.storage.estimate){ const e=await navigator.storage.estimate();
      if(e&&e.usage!=null) store='  ·  '+Math.round(e.usage/1048576)+' MB used'; } }catch(e){}
    $('stVer').textContent='AVI Field '+APP_VERSION+'  ·  '+cards.length+' job'+(cards.length===1?'':'s')+' on this iPad'+store;
  }
  window.AVI_FIELD={ showStart(){ SS.set('avi_field_start','1'); location.reload(); }, version:APP_VERSION };

  async function openJob(k, part){
    const c=await get('index',k); if(!c) return;
    c.openedAt=Date.now(); await write([['index','put',k,c]]);
    LS.set('avi_field_active',k); if(part) LS.set('avi_field_part',part);
    SS.del('avi_field_start');
    location.reload();
  }
  async function removeJob(k){
    const c=await get('index',k); if(!c) return;
    const m=c.meta||{}, nm=[m.project,m.number].filter(Boolean).join(' ')||'this job';
    if(!confirm('Remove '+nm+' from this iPad?\n\nDo ☰ → Save / hand off first if anything is not in Dropbox yet. '+
                'Your ticks stay on the iPad, so loading the job again brings them back.')) return;
    const ops=[['jobs','delete',k],['index','delete',k]];
    Object.keys(c.parts||{}).filter(p=>p!=='pull').forEach(p=>ops.push(['files','delete',k+'|'+p]));
    await write(ops);
    if(LS.get('avi_field_active')===k) LS.del('avi_field_active');
    await showStart(); msg('Removed '+nm+'.');
  }

  function loadScript(src){
    return new Promise((res,rej)=>{ if(document.querySelector('script[data-src="'+src+'"]')) return res();
      const s=document.createElement('script'); s.src=src; s.dataset.src=src;
      s.onload=res; s.onerror=()=>rej(new Error('could not load '+src)); document.body.appendChild(s); });
  }
  async function needPdf(){ if(typeof pdfjsLib==='undefined'){ await loadScript('pdf.min.js'); await loadScript('pdf.worker.min.js'); } }

  /* ---- tabs: one per part of the job ---- */
  let CUR=null;              // the open job's index card
  function tabsHTML(active, withJobs){
    return (withJobs?'<button class="jobs" data-jobs>‹ Jobs</button>':'')+
      partList(CUR).map(p=>'<button data-part="'+esc(p.id)+'"'+(p.id===active?' class="on"':'')+'>'+esc(p.label)+'</button>').join('');
  }
  function wireTabs(el){
    el.querySelectorAll('[data-part]').forEach(b=>b.onclick=()=>showPart(b.dataset.part));
    const j=el.querySelector('[data-jobs]'); if(j) j.onclick=()=>window.AVI_FIELD.showStart();
  }
  function paintTabs(active){
    const n=partList(CUR).length;
    $('drwTabs').innerHTML=tabsHTML(active,true); wireTabs($('drwTabs'));
    const h=$('jobTabs'); if(h){ h.hidden=n<2; h.innerHTML=tabsHTML(active,false); wireTabs(h); }
  }
  async function showPart(part){
    LS.set('avi_field_part',part);
    if(part==='pull'){ $('drw').hidden=true; paintTabs('pull'); return; }
    paintTabs(part); $('drw').hidden=false;
    await openDrawing(CUR.key, part);
  }

  /* ---- open a job ---- */
  async function startJob(k){
    const c=await get('index',k);
    if(!c){ LS.del('avi_field_active'); return showStart(); }
    CUR=c;
    document.body.classList.remove('nojob'); $('start').hidden=true;
    const parts=partList(c).map(p=>p.id);
    let want=LS.get('avi_field_part'); if(!parts.includes(want)) want=parts[0];
    if(c.rowCount){
      const rec=await get('jobs',k); let u=null;
      try{ u=rec&&unwrap(JSON.parse(rec.text)); }catch(e){}
      if(!u){ await showStart(); msg('That job could not be read on this iPad. Load its job files again.',true); return; }
      window.__JOB=u.D;
      try{
        if(u.D.specs && Object.keys(u.D.specs).length) await needPdf();
        await loadScript('sheet.js');
        /* the tab row sits at the top of the pull sheet's own header */
        const hd=document.querySelector('header > div');
        if(hd && !$('jobTabs')){ const t=document.createElement('div'); t.id='jobTabs'; t.className='jtabs'; hd.insertBefore(t, hd.firstChild); }
        try{ const was=LS.get('avi_field_ver');
             if(was && was!==APP_VERSION && typeof toast==='function') toast('Updated to AVI Field '+APP_VERSION);
             LS.set('avi_field_ver',APP_VERSION); }catch(_){}
        showRevisionNote();
      }catch(e){
        await showStart(); msg('The app could not start ('+(e&&e.message||e)+'). Check the signal and try again.',true); return;
      }
    } else {
      document.body.classList.add('drwonly');           // drawings only: no pull sheet to show
      LS.set('avi_field_ver',APP_VERSION);
    }
    if(want==='pull'){ paintTabs('pull'); $('drw').hidden=true; } else showPart(want);
  }

  /* ══ THE DRAWINGS VIEWER ════════════════════════════════════════════════════════════════
     One canvas the size of the screen. A pan or pinch moves the last picture as a CSS
     transform (the compositor, no re-draw — the same idea as the plan view), and when the
     fingers lift the visible part of the page is drawn again, sharp, at the new zoom. So a
     36x48 sheet never has to fit in one giant canvas, which an iPad refuses past ~16 MP. */
  const V={doc:null, key:'', part:'', page:1, n:1, fit:1, z:1, px:0, py:0, rz:1, rpx:0, rpy:0, task:null, tok:0, pw:0, ph:0};
  const DPR=()=>Math.min(window.devicePixelRatio||1, 2);
  async function openDrawing(k, part){
    const stage=$('drwStage'); $('drwMsg').textContent='Opening…';
    const f=await get('files', k+'|'+part);
    if(!f){ $('drwMsg').textContent='This drawing is not on the iPad. Load it again from Dropbox.'; return; }
    try{ await needPdf(); }catch(e){ $('drwMsg').textContent='The drawing viewer could not load. Open the app once with signal.'; return; }
    try{
      if(V.doc && V.doc.destroy) try{ V.doc.destroy(); }catch(_){}
      V.doc=await pdfjsLib.getDocument({data:new Uint8Array(f.buf.slice(0))}).promise;
    }catch(e){ $('drwMsg').textContent='That drawing could not be opened ('+(e&&e.message||e)+').'; return; }
    V.key=k; V.part=part; V.n=V.doc.numPages;
    const pk='avi_field_page_'+k+'|'+part; V.page=Math.min(V.n, +LS.get(pk)||1);
    $('drwMsg').textContent='';
    paintPages(); await gotoPage(V.page);
  }
  function paintPages(){
    const el=$('drwPages');
    el.innerHTML=V.n>1?Array.from({length:V.n},(_,i)=>'<button data-pg="'+(i+1)+'"'+(i+1===V.page?' class="on"':'')+'>Sheet '+(i+1)+'</button>').join(''):'';
    el.querySelectorAll('[data-pg]').forEach(b=>b.onclick=()=>gotoPage(+b.dataset.pg));
  }
  async function gotoPage(n){
    V.page=n; LS.set('avi_field_page_'+V.key+'|'+V.part, n); paintPages();
    const pg=await V.doc.getPage(n); const vp=pg.getViewport({scale:1});
    V.pw=vp.width; V.ph=vp.height; fitPage(); render();
  }
  function fitPage(){
    const r=$('drwStage').getBoundingClientRect();
    V.fit=Math.min(r.width/V.pw, r.height/V.ph); V.z=1;
    V.px=(r.width-V.pw*V.fit)/2; V.py=(r.height-V.ph*V.fit)/2;
  }
  async function render(){
    if(!V.doc) return;
    const tok=++V.tok, cv=$('drwCanvas'), r=$('drwStage').getBoundingClientRect(), d=DPR();
    if(V.task){ try{ V.task.cancel(); }catch(_){} V.task=null; }
    const pg=await V.doc.getPage(V.page); if(tok!==V.tok) return;
    const s=V.fit*V.z;
    const off=document.createElement('canvas');
    off.width=Math.round(r.width*d); off.height=Math.round(r.height*d);
    const ctx=off.getContext('2d'); ctx.fillStyle='#fff'; ctx.fillRect(0,0,off.width,off.height);
    const vp=pg.getViewport({scale:s*d});
    V.task=pg.render({canvasContext:ctx, viewport:vp, transform:[1,0,0,1,V.px*d,V.py*d]});
    try{ await V.task.promise; }catch(e){ return; }            // cancelled by a newer render
    if(tok!==V.tok) return;
    cv.width=off.width; cv.height=off.height; cv.style.width=r.width+'px'; cv.style.height=r.height+'px';
    cv.getContext('2d').drawImage(off,0,0);
    cv.style.transform=''; V.rz=V.z; V.rpx=V.px; V.rpy=V.py;
  }
  /* show the gesture as a transform of the last picture: page point X sits at rp + X*fit*rz
     and must land on p + X*fit*z → scale a = z/rz, offset p − a·rp */
  function showGesture(){ const a=V.z/V.rz;
    $('drwCanvas').style.transform='translate('+(V.px-a*V.rpx).toFixed(2)+'px,'+(V.py-a*V.rpy).toFixed(2)+'px) scale('+a.toFixed(5)+')'; }
  let raf=null; const queue=()=>{ if(raf) return; raf=requestAnimationFrame(()=>{ raf=null; showGesture(); }); };
  function zoomAt(k, cx, cy){
    const r=$('drwStage').getBoundingClientRect(), x=cx-r.left, y=cy-r.top;
    const z=Math.max(1, Math.min(16, V.z*k)), wx=(x-V.px)/(V.fit*V.z), wy=(y-V.py)/(V.fit*V.z);
    V.z=z; V.px=x-wx*V.fit*z; V.py=y-wy*V.fit*z;
  }
  (function gestures(){
    const st=$('drwStage'), pts=new Map(); let g=null;
    const begin=()=>{ g={px:V.px, py:V.py, z:V.z, pts:new Map(pts)}; };
    st.addEventListener('pointerdown',e=>{ if(e.target.closest('.zoomc')) return;
      try{ st.setPointerCapture(e.pointerId); }catch(_){}
      pts.set(e.pointerId,{x:e.clientX,y:e.clientY}); begin(); });
    st.addEventListener('pointermove',e=>{ if(!pts.has(e.pointerId)||!g) return;
      pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
      const ids=[...pts.keys()], r=st.getBoundingClientRect();
      if(ids.length>=2){ const a=pts.get(ids[0]), b=pts.get(ids[1]), a0=g.pts.get(ids[0]), b0=g.pts.get(ids[1]); if(!a0||!b0) return;
        const k=(Math.hypot(b.x-a.x,b.y-a.y)||1)/(Math.hypot(b0.x-a0.x,b0.y-a0.y)||1);
        const m0x=(a0.x+b0.x)/2-r.left, m0y=(a0.y+b0.y)/2-r.top, m1x=(a.x+b.x)/2-r.left, m1y=(a.y+b.y)/2-r.top;
        const z=Math.max(1, Math.min(16, g.z*k)), wx=(m0x-g.px)/(V.fit*g.z), wy=(m0y-g.py)/(V.fit*g.z);
        V.z=z; V.px=m1x-wx*V.fit*z; V.py=m1y-wy*V.fit*z;
      } else { const p0=g.pts.get(e.pointerId); if(!p0) return; V.px=g.px+(e.clientX-p0.x); V.py=g.py+(e.clientY-p0.y); }
      queue(); });
    const up=e=>{ if(!pts.has(e.pointerId)) return; pts.delete(e.pointerId);
      if(pts.size) begin(); else { g=null; render(); } };
    st.addEventListener('pointerup',up); st.addEventListener('pointercancel',up);
    st.addEventListener('wheel',e=>{ e.preventDefault(); zoomAt(e.deltaY>0?1/1.15:1.15, e.clientX, e.clientY); render(); },{passive:false});
    const mid=()=>{ const r=st.getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2]; };
    $('dzIn').onclick=()=>{ zoomAt(1.5,...mid()); render(); };
    $('dzOut').onclick=()=>{ zoomAt(1/1.5,...mid()); render(); };
    $('dzFit').onclick=()=>{ fitPage(); render(); };
    let rz=0; window.addEventListener('resize',()=>{ if($('drw').hidden) return; clearTimeout(rz); rz=setTimeout(()=>{ fitPage(); render(); },200); });
  })();

  /* ---- revised pull sheet: what changed, said once, on the sheet itself (0.4) ---- */
  function showRevisionNote(){
    let n=null; try{ n=JSON.parse(SS.get('avi_field_note')||'null'); SS.del('avi_field_note'); }catch(e){}
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

  /* ══ LOAD JOB FILES ═════════════════════════════════════════════════════════════════════
     Several at once. Job files first (they name the jobs), then every PDF is filed under a
     job by its number: the composer's keywords (project=…), else a number in its title block
     that matches a job in this batch or on the iPad, else the title block's own number, else
     a number in the file name, else the tech is asked. What kind of drawing: the keywords'
     source=, else the file name (rack / schem), else its text (ELEVATION / SCHEMATIC). */
  const readAs=(f,how)=>new Promise((res,rej)=>{ const fr=new FileReader(); fr.onerror=()=>rej(fr.error);
    fr.onload=()=>res(fr.result); how==='text'?fr.readAsText(f):fr.readAsArrayBuffer(f); });
  async function pdfFacts(buf, name){
    await needPdf();
    const doc=await pdfjsLib.getDocument({data:new Uint8Array(buf.slice(0))}).promise;
    let kw=''; try{ const md=await doc.getMetadata(); kw=String((md&&md.info&&md.info.Keywords)||''); }catch(_){}
    let lines=[]; try{ const pg=await doc.getPage(1); const tc=await pg.getTextContent(); lines=tc.items.map(i=>String(i.str||'').trim()).filter(Boolean); }catch(_){}
    try{ doc.destroy(); }catch(_){}
    const kv={}; kw.split('|').forEach(s=>{ const m=/^\s*([a-zA-Z]+)\s*=\s*(.*?)\s*$/.exec(s); if(m) kv[m[1].toLowerCase()]=m[2]; });
    const text=lines.join('\n');
    let kind='';
    const src=(kv.source||'')+' '+(kv.sheet||'');
    if(/rack/i.test(src)) kind='rack'; else if(/schem/i.test(src)) kind='sch';
    else if(/rack/i.test(name)) kind='rack'; else if(/schem/i.test(name)) kind='sch';
    else if(/RACK LAYOUT|ELEVATION/i.test(text)) kind='rack'; else if(/SCHEMATIC/i.test(text)) kind='sch';
    const nums=lines.filter(l=>/^\d{4,6}$/.test(l));
    const fnNums=(String(name).match(/(?:^|[^\d])(\d{4,6})(?!\d)/g)||[]).map(s=>s.replace(/\D/g,''));
    /* the title-block line just above the number names the project ("75 Rock Rd") */
    let project='';
    if(nums.length){ const i=lines.indexOf(nums[0]);
      for(let j=i-1;j>=0 && j>i-5;j--){ const l=lines[j]; if(/^\d{2,4}[-\s]\d{2}([-\s]\d{2})?$/.test(l)) continue; project=l; break; } }
    return {kind, kwNum:(kv.project||'').trim(), nums, fnNums, project};
  }
  async function loadFiles(files){
    msg('Reading '+files.length+' file'+(files.length===1?'':'s')+' …');
    const cards={}; (await all('index')).forEach(c=>{ cards[c.key]=c; });
    const known=()=>Object.values(cards).map(c=>String((c.meta||{}).number||'')).filter(Boolean);
    const ops=[], report=[], touched=new Set(); let note=null, lastKey=null, lastPart=null;
    const jsonF=files.filter(f=>!/\.pdf$/i.test(f.name)), pdfF=files.filter(f=>/\.pdf$/i.test(f.name));
    /* 1 · job files */
    for(const f of jsonF){
      let u=null, text=''; try{ text=await readAs(f,'text'); u=unwrap(JSON.parse(text)); }catch(_){}
      if(!u){ report.push('“'+f.name+'” is not a job file or a PDF — skipped.'); continue; }
      const meta=u.D.meta||{}, k=keyOf(meta,f.name), nm=[meta.project,meta.number].filter(Boolean).join(' ')||f.name;
      const old=cards[k];
      if(old && old.rowCount){
        const tOld=Date.parse(old.exportedAt||''), tNew=Date.parse(u.at||'');
        if(isFinite(tOld)&&isFinite(tNew)&&tNew<tOld &&
           !confirm('This pull sheet is OLDER than the '+nm+' already on this iPad.\n\nOn the iPad: exported '+when(old.exportedAt)+
                    '\nThis file: exported '+when(u.at)+'\n\nLoad the older one anyway?')){ report.push('Kept the newer '+nm+' pull sheet.'); continue; }
        if(!(isFinite(tOld)&&isFinite(tNew)&&tNew===tOld)){
          let prev=null; try{ const pr=await get('jobs',k); prev=pr&&unwrap(JSON.parse(pr.text)); }catch(_){}
          if(prev){ const nowIds=new Set((u.D.rows||[]).map(r=>r.id)), wasIds=new Set((prev.D.rows||[]).map(r=>r.id));
            let S=null; try{ S=JSON.parse(LS.get(tickKey(meta))||'null'); }catch(_){}
            const st=(S&&S.rows)||{};
            const removed=(prev.D.rows||[]).filter(r=>!nowIds.has(r.id)).map(r=>({tag:r.tag, label:r.label||r.type||'',
              from:[(r.fromRoom||'').toUpperCase(), r.fromNo].filter(Boolean).join(' '),
              done:!!(st[r.id]&&st[r.id].done), note:(st[r.id]&&st[r.id].note)||''}));
            note={name:nm, at:u.at, added:(u.D.rows||[]).filter(r=>!wasIds.has(r.id)).length, removed}; }
        }
      }
      const c=Object.assign({key:k, parts:{}}, old||{}, {meta:Object.assign({}, (old&&old.meta)||{}, meta), name:f.name, exportedAt:u.at,
        rowCount:(u.D.rows||[]).length, loadedAt:nowStamp(), openedAt:Date.now(), size:text.length});
      c.parts=Object.assign({}, c.parts||{}, {pull:{name:f.name, addedAt:nowStamp()}});
      cards[k]=c; touched.add(k); lastKey=k; lastPart='pull';
      ops.push(['jobs','put',k,{text}]);
      report.push('Pull sheet — '+nm+(old&&old.rowCount?' (replaced)':''));
    }
    /* 2 · drawings */
    for(const f of pdfF){
      let buf=null, F=null;
      try{ buf=await readAs(f,'buf'); F=await pdfFacts(buf, f.name); }
      catch(e){ report.push('“'+f.name+'” could not be read as a PDF — skipped.'); continue; }
      const batch=[...touched].map(k=>String((cards[k].meta||{}).number||''));
      const pool=new Set(batch.concat(known()));
      let num=F.kwNum || F.nums.find(n=>pool.has(n)) || F.fnNums.find(n=>pool.has(n)) ||
              (batch.length===1 && !F.nums.length && !F.fnNums.length ? batch[0] : '') || F.nums[0] || F.fnNums[0] || '';
      if(!num){ num=(prompt('Which job number is “'+f.name+'” for?', batch[0]||'')||'').trim(); }
      if(!num){ report.push('“'+f.name+'” — no job number, skipped.'); continue; }
      const k=keyFor(num);
      const part=F.kind || ('other:'+f.name.replace(/\.pdf$/i,''));
      const old=cards[k];
      const c=old || {key:k, meta:{number:num, project:F.project||''}, name:f.name, exportedAt:'', rowCount:0, loadedAt:nowStamp(), parts:{}};
      if(!c.meta.project && F.project) c.meta.project=F.project;
      c.parts=Object.assign({}, c.parts||{});
      const replaced=!!c.parts[part];
      c.parts[part]={name:f.name, addedAt:nowStamp(), label:F.kind?PART_NAME[F.kind]:f.name.replace(/\.pdf$/i,'')};
      c.openedAt=Date.now(); cards[k]=c; touched.add(k); lastKey=k; if(!lastPart) lastPart=part;
      ops.push(['files','put',k+'|'+part,{name:f.name, buf, addedAt:nowStamp()}]);
      report.push((F.kind?PART_NAME[F.kind]:'Drawing “'+f.name+'”')+' — job '+num+(replaced?' (replaced)':'')+(old?'':' (new job)'));
    }
    touched.forEach(k=>ops.push(['index','put',k,cards[k]]));
    if(!ops.length){ msg(report.join(' ')||'Nothing loaded.',true); return; }
    try{ await write(ops); }
    catch(err){ msg('The files could not be stored on this iPad ('+(err&&err.message||err)+').',true); return; }
    if(note) SS.set('avi_field_note',JSON.stringify(note));
    SS.set('avi_field_loaded',JSON.stringify(report));
    LS.set('avi_field_active',lastKey); LS.set('avi_field_part',lastPart||'pull');
    SS.del('avi_field_start');
    location.reload();
  }
  $('stLoad').onclick=()=>$('jobIn').click();
  $('jobIn').onchange=e=>{ const fs=[...(e.target.files||[])]; e.target.value=''; if(fs.length) loadFiles(fs); };

  /* ---- the offline copy (sw.js) ---- */
  if('serviceWorker' in navigator){
    window.addEventListener('load',()=>{ navigator.serviceWorker.register('sw.js').catch(()=>{}); });
  }

  /* ---- boot ---- */
  (async function(){
    try{ await migrate(); }catch(e){}
    const wantStart=SS.get('avi_field_start')==='1'; SS.del('avi_field_start');
    const k=LS.get('avi_field_active');
    let c=null; try{ c=k&&await get('index',k); }catch(e){}
    if(c && !wantStart){ c.openedAt=Date.now(); try{ await write([['index','put',k,c]]); }catch(e){} await startJob(k);
      let rep=null; try{ rep=JSON.parse(SS.get('avi_field_loaded')||'null'); SS.del('avi_field_loaded'); }catch(_){}
      if(rep && rep.length && typeof toast==='function') toast('Loaded: '+rep.join(' · '));
    }
    else showStart();
  })();
})();
