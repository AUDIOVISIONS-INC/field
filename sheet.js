/* AVI Field app — the pull sheet. DATA comes from the job file the loader read. */
const DATA = window.__JOB;

const KEY = 'avi_pull_' + (DATA.meta.number||'x') + '_' + (DATA.meta.sheet||'x');

const FLAGS = [
  {k:'moved',    t:'Moved'},
  {k:'rerouted', t:'Re-routed'},
  {k:'added',    t:'Added in field'},
  {k:'deleted',  t:'Deleted'},
  {k:'length',   t:'Length differs'},
  {k:'blocked',  t:'No access'},
  {k:'damaged',  t:'Damaged / reorder'},
];
const FLAGT = Object.fromEntries(FLAGS.map(f=>[f.k,f.t]));
/* DLF v172 · NOW FED FROM. Keypad loops get changed on site. A note saying so has to be read
   and re-drawn by hand; this records it as a fact the office can apply in one click. Offered on
   lighting runs only, and only when the composer sent the list of lighting devices (ltNodes). */
const LT_NODES = Array.isArray(DATA.ltNodes) ? DATA.ltNodes : [];
const LT_NODE = Object.fromEntries(LT_NODES.map(n=>[n.id,n]));
function devKeyOf(rowId){ return String(rowId||'').split('::')[0]; }
function fedLabel(id){ const n=LT_NODE[id]; return n ? [n.tag,n.room,n.name].filter(Boolean).join(' · ') : ''; }

/* ---------- state ---------- */
/* rows: id -> {done,ts,flags[],note,mine,actual}
   moves (v133): deviceId -> {px,py,ft,brg,planId,why[],note,by,ts,mts} */
let S = {tech:'', rows:{}, extra:[], collapsed:{}, moves:{}};
let storageOK = true;
function load(){
  try{ const raw=localStorage.getItem(KEY); if(raw) S=Object.assign(S,JSON.parse(raw)); }
  catch(e){ storageOK=false; }
  try{ localStorage.setItem(KEY+'_probe','1'); localStorage.removeItem(KEY+'_probe'); }
  catch(e){ storageOK=false; }
}
let saveT=null;
function save(){
  if(!storageOK) return;
  clearTimeout(saveT);
  saveT=setTimeout(()=>{ try{ localStorage.setItem(KEY, JSON.stringify(S)); }catch(e){ storageOK=false; paintWarn(); } },150);
}
/* ══ v132 · TWO KINDS OF NOTE ══════════════════════════════════════════════════════════
   Mike, 09-16: "there's a section for the tech to make notes for the office, but how do they
   make notes for themselves that won't go to the office or end up on the DLF?"

   They couldn't, and it was worse than that: `note` is the ONLY note there has ever been, and
   isFlagged() returns true for any non-empty one. So "wire is coiled in the attic until the
   wall is finished" put the row in the Flagged view, into the header's flagged count, into the
   markups CSV that lands in Dropbox, and into the NEEDS ENGINEERING block of the summary that
   goes out to a PM. A self-reminder read as a red-line, and it padded the one list that only
   works when it is short.

   `mine` is the crew's side. It is NOT private to one person — the second tech tomorrow is
   exactly who needs to know the wire is coiled — so it merges on hand-off like any other note.
   What it does not do is flag, export, or reach the office at all. */
function st(id){ return S.rows[id] ||
  (S.rows[id]={done:false,ts:null,flags:[],note:'',mine:'',actual:''}); }
function has(id){ return S.rows[id]; }

/* ══ DLF v218 · LENGTH FROM THE FOOTAGE MARKS ══════════════════════════════════════════
   Production + systems, 10-08: techs rarely have time to tape a run, but nearly all cable is
   printed with footage marks. Read the number at each end, type both, and the sheet takes the
   difference. Which way the numbers count depends on which end of the box was grabbed, so the
   ORDER does not matter — it is the distance between them. The marks are only a way to fill in
   Actual length; Actual is still the one number that goes back to the office (and the report
   CSV is unchanged), and a tech who did measure just types it. */
function markLen(a,b,u){
  const x=parseFloat(a), y=parseFloat(b);
  if(String(a).trim()===''||String(b).trim()===''||!isFinite(x)||!isFinite(y)) return null;
  let d=Math.abs(y-x); if(u==='m') d*=3.28084;
  return Math.round(d);
}
/* One wrong digit (1482 typed as 182) makes a 1,300 ft "run". Warn — never block — when the
   length is zero, or more than double / under half what the drawing estimated. */
function lenCheck(r,act){
  if(act==null||String(act).trim()==='') return '';
  const a=parseFloat(act); if(!isFinite(a)) return '';
  if(a<=0) return '⚠ Zero length — check the numbers.';
  const e=parseFloat(r.length);
  if(!(isFinite(e)&&e>0)) return '';
  if(a>2*e) return '⚠ '+a+' ft is more than double the drawing’s '+e+' ft. A missed or extra digit? Save it anyway if it’s right.';
  if(a<e/2) return '⚠ '+a+' ft is under half the drawing’s '+e+' ft. A missed digit? Save it anyway if it’s right.';
  return '';
}
/* "Same as above" for cables pulled together: another cable to the SAME device that already
   has a length (nearest first), else the row directly above this one in its room. The button
   names the tag it copies, so the tech decides whether they really went in together. */
function sameAsOf(r){
  const vis=visible(); let rows=vis, i=vis.findIndex(x=>x.id===r.id);
  if(i<0){ rows=allRows(); i=rows.findIndex(x=>x.id===r.id); }
  const dk=devKeyOf(r.id);
  const sib=rows.map((x,j)=>({x,j}))
    .filter(o=>o.x.id!==r.id && devKeyOf(o.x.id)===dk && (has(o.x.id)||{}).actual)
    .sort((a,b)=>Math.abs(a.j-i)-Math.abs(b.j-i) || a.j-b.j);
  if(sib.length) return sib[0].x;
  const up=i>0?rows[i-1]:null;
  if(up && grpKey(up)===grpKey(r) && (has(up.id)||{}).actual) return up;
  return null;
}

/* ══ v133 · "IT NEEDS TO MOVE, AND HERE IS WHERE" ═════════════════════════════════════
   Mike, 09-16: "circle a speaker that needs to move on the DLF and draw an arrow to where
   it should end up."

   Built as a PICK, not as ink. A tech taps the device and then taps the spot; the sheet
   draws the ring and the arrow. Freehand was mocked up beside it and lost on its merits:
   a finger at tag scale produces a scribble, ink near two speakers does not say which one
   is meant, and a drawing can only ever be a picture somebody re-reads by hand. A pick
   carries the DEVICE ID and a point in the plan's own world units, so the sheet can price
   the distance in feet itself and the composer can one day just do the move.

   A move belongs to the DEVICE, not to a cable row — moving a speaker moves every cable
   it pulls — so it is keyed by device id, and every row of that device reports it. */
const devIdOf = id => String(id||'').split('::')[0];
const MOVES = () => (S.moves || (S.moves={}));
const moveOf = id => MOVES()[devIdOf(id)] || null;

/* Where the composer says this device sits, and on which plan. Read out of the export —
   never hunted for in the SVG, which answers in local coordinates inside the transformed
   glyph groups and quietly lands a ring in empty space. */
let devIx=null;
function devIndex(){
  if(devIx) return devIx;
  devIx={};
  PLANS.forEach((p,i)=>(p.devs||[]).forEach(d=>{ if(!(d.id in devIx)) devIx[d.id]={...d, pi:i}; }));
  return devIx;
}
function devPt(id){ return devIndex()[devIdOf(id)] || null; }

/* feet, as a tech writes them */
function feetTxt(ft){
  if(!(ft>0)) return '';
  const w=Math.floor(ft), inch=Math.round((ft-w)*12);
  return inch===12 ? (w+1)+"'-0\"" : w+"'-"+inch+'"';
}
const COMPASS=['E','NE','N','NW','W','SW','S','SE'];
function bearingTxt(dx,dy){
  /* SVG y grows downward, so north is -y. */
  const a=Math.atan2(-dy,dx), i=Math.round(a/(Math.PI/4));
  return COMPASS[((i%8)+8)%8];
}

/* ---------- rows, incl. field-added ---------- */
function allRows(){ return DATA.rows.concat(S.extra); }
function isFlagged(r){ if(r.dupTag||r.newRoom||r.newType) return true;
  if(moveOf(r.id)) return true;            // v133: a move is engineering's business
  const s=has(r.id); return !!(s && ((s.flags&&s.flags.length) || (s.note&&s.note.trim()))); }
function isDeleted(r){ const s=has(r.id); return !!(s && s.flags && s.flags.includes('deleted')); }

/* ---------- view state ---------- */
let V={view:'all', floor:'', disc:'', type:'', q:''};
const norm = s => (s||'').toString().toLowerCase();

function visible(){
  const q=norm(V.q);
  return allRows().filter(r=>{
    const s=has(r.id);
    if(V.view==='todo' && (s&&s.done)) return false;
    if(V.view==='todo' && isDeleted(r)) return false;
    if(V.view==='done' && !(s&&s.done)) return false;
    if(V.view==='flag' && !isFlagged(r)) return false;
    /* v132: everything the crew left itself, in one screen — the view a tech actually wants
       at the start of the next day. Nothing here is reported. */
    if(V.view==='crew' && !(s && (s.mine||'').trim())) return false;
    if(V.floor && r.floor!==V.floor) return false;
    /* v126: the sheet carries the whole job now — AV and Lighting & Shade together —
       because a tech pulls all the wire in a house. This narrows it when they want. */
    if(V.disc && (r.discName||'')!==V.disc) return false;
    if(V.type && r.type!==V.type) return false;
    if(q){
      const hay=norm(r.tag+' '+r.fromRoom+' '+r.fromNo+' '+r.device+' '+r.manuf+' '+r.type+' '+r.label+' '+r.toRoom);
      if(!hay.includes(q)) return false;
    }
    return true;
  });
}
function pillClass(r){
  const t=(r.type||'').toUpperCase();
  if(t.includes('CAT')) return 'cat';
  if(t.includes('14/')||t.includes('16/')) return 'spk';
  return 'ctl';
}

/* ---------- render ---------- */
const $=id=>document.getElementById(id);
/* Which room groups are shut. Lives in S so it survives a reload — a tech who
   collapses everything to work one room should not get all 39 back on a refresh. */
const grpKey = r => (r.floor||'')+'␟'+(r.fromNo||'')+'␟'+(r.fromRoom||'').toUpperCase();
const collapsed = () => (S.collapsed || (S.collapsed={}));
const allKeys = () => [...new Set(allRows().map(grpKey))];
function setAllGroups(shut){
  const c={}; if(shut) for(const k of allKeys()) c[k]=true;
  S.collapsed=c; save(); paintList();
}


/* ══ v138 · WHERE IS THIS SHEET ACTUALLY RUNNING? ═══════════════════════════════════
   Mike, 09-17, relaying a tech on the live job:

     "When moving around on the DLF, Dropbox thinks you want to move between files by
      swiping left or right. To prevent this you have to hold your finger down then
      slowly move the DLF."

   Nothing in this page can cause that. The plan has carried `touch-action:none` since
   v120, so in a browser this page claims horizontal drags outright. What CAN cause it is
   a host app's OWN pager — native UI sitting above the web view, where no CSS reaches.
   The long-press-then-drag workaround is the signature of a native gesture recogniser,
   not of a slow page.

   And the swipe is the least of it. Inside a host app's web view the sheet's storage
   belongs to THAT APP: it is not the storage the sheet found its ticks in last time, and
   it can be cleared without warning. A tech can work a full day in there and lose the
   day. Mike had told them to save it to Files and open it in Safari; it did not happen,
   and nothing on screen said otherwise. Now the sheet says so itself, every time, for as
   long as it is true — there is nothing to dismiss, because the condition IS the problem
   and it disappears the moment they fix it.

   DELIBERATELY NARROW. A false banner is worse than no banner: it teaches a crew to
   ignore the one warning that can save their day's work. So the named apps are matched
   outright, and the generic case is scoped to iOS WKWebView only — real Safari always
   carries a `Version/` token and an embedded web view does not. Desktop, Android and the
   third-party iOS browsers are left alone. */
const HOST_APPS=[
  [/Dropbox/i,'Dropbox'], [/OneDrive/i,'OneDrive'], [/\bBoxApp|\bBox\//i,'Box'],
  [/Slack/i,'Slack'], [/Teams|MSTeams/i,'Teams'], [/FBAN|FBAV|FB_IAB/,'Facebook'],
  [/Instagram/i,'Instagram'], [/GSA\//,'the Google app'], [/\bLine\//,'LINE'],
  [/Gmail/i,'Gmail'], [/Outlook/i,'Outlook'], [/WhatsApp/i,'WhatsApp'],
  [/Drive\//i,'Google Drive']];
function hostApp(){
  const ua=navigator.userAgent||'';
  /* the two ways it is SUPPOSED to be open */
  if(location.protocol==='file:') return null;                    // from Files
  if(window.navigator.standalone===true) return null;             // home-screen app
  try{ if(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
         return null; }catch(e){}
  for(const [re,name] of HOST_APPS) if(re.test(ua)) return {app:name, sure:true};
  if(/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)) return null;            // real iOS browsers
  const ios = /iPad|iPhone|iPod/.test(ua) ||
              (/Macintosh/.test(ua) && (navigator.maxTouchPoints||0) > 1);  // iPadOS lies
  if(ios && /AppleWebKit/.test(ua) && !/Version\/\d/.test(ua))
    return {app:'another app', sure:false};
  return null;
}
const HOSTINFO = hostApp();
const HOSTAPP  = HOSTINFO && HOSTINFO.app;
/* How loudly to say it is tied to how sure the detection is. A NAMED app is certain
   enough to interrupt for — a lost day is worse than an interruption. The generic
   WKWebView guess only gets the bar, because a false modal on every load would teach
   a crew to dismiss the one warning that matters. */
const HOSTSURE = !!(HOSTINFO && HOSTINFO.sure);

/* The whole point of this sheet is that a tech never loses work. So the fix-it screen
   leads with the ticks they have ALREADY made in here — switching to Files without
   saving first would strand them in the wrong storage, which is a worse outcome than
   the problem being fixed. */
function openHostFix(){
  const app=esc(HOSTAPP||'another app');
  openSheet('<div class="sh"><h2 style="font-family:var(--sans)">Open this from Files</h2>'+
    '<button class="x" data-x>✕</button></div>'+
    '<div class="banner">⚠ This sheet is running inside <b>'+app+'</b>, not on the iPad itself.</div>'+
    '<div class="chk-row bad"><div class="chk-k">Your ticks may not be kept</div>'+
      '<div class="chk-t">'+app+'’s storage is not the iPad’s. It can be cleared '+
      'without warning, and a full day’s work can go with it.</div></div>'+
    '<div class="chk-row bad"><div class="chk-k">The drawing fights your finger</div>'+
      '<div class="chk-t">'+app+' reads a sideways swipe as “next file” before the '+
      'plan ever sees it. That is why you have to hold still and drag slowly.</div></div>'+
    '<p class="lbl" style="margin-top:16px">Fix it once — twenty seconds</p>'+
    '<ol class="steps"><li>Tap the <b>share</b> icon at the top of this screen</li>'+
      '<li><b>Save to Files</b></li><li>Pick the job’s folder</li>'+
      '<li>Open <b>Files</b>, find it there, and tap it</li></ol>'+
    '<div class="destbox"><div class="k">IF YOU HAVE ALREADY TICKED THINGS IN HERE</div>'+
      '<div class="p">Do this <b>first</b>: ☰ → <b>Save / hand off</b>, into the job’s '+
      'folder. Then open the sheet from Files and ☰ → <b>Take over from another tech</b> '+
      '→ that file. Nothing is lost.</div></div>'+
    '<button class="btn" data-ok>Got it</button>');
  const sb=$('sheetBody');
  sb.querySelector('[data-x]').onclick=closeSheet;
  sb.querySelector('[data-ok]').onclick=closeSheet;
}
function paintWarn(){
  $('storeWarn').innerHTML =
    (HOSTAPP ? '<button type="button" class="banner hostwarn" id="hostBar">'+
       '⚠ This sheet is running inside <b>'+esc(HOSTAPP)+'</b>, not on your iPad. '+
       'Your ticks may not be saved. <u>Tap to fix it</u></button>' : '')+
    (storageOK ? '' :
     '<div class="banner">⚠ This tablet is not keeping your ticks automatically — use ☰ → '+
     '<b>Save / hand off</b> before you close this page.</div>');
  const hb=$('hostBar'); if(hb) hb.onclick=openHostFix;
}
function paintHead(){
  const m=DATA.meta;
  $('hTitle').textContent = (m.project||'') + (m.number?(' · '+m.number):'');
  const ds=(m.disciplines&&m.disciplines.length)?m.disciplines.join(' + '):null;
  $('hSub').textContent = [m.client, m.sheet && ('SHEET '+m.sheet), m.rev && ('REV '+m.rev),
    ds, (m.savedAt||'').slice(0,10)].filter(Boolean).join('  ·  ');
  const live=allRows().filter(r=>!isDeleted(r));
  const done=live.filter(r=>{const s=has(r.id);return s&&s.done;}).length;
  $('pDone').textContent=done; $('pTot').textContent=live.length;
  $('pFill').style.width = (live.length? (done/live.length*100):0).toFixed(1)+'%';
  const fl=allRows().filter(isFlagged).length;
  $('pRight').textContent = fl ? (fl+' flagged') : (done===live.length&&live.length?'complete':'');
}
function paintFilters(){
  const floors=[...new Set(DATA.rows.map(r=>r.floor))].filter(Boolean);
  const types=[...new Set(allRows().map(r=>r.type))].filter(Boolean).sort();
  const sel=(el,opts,blank,cur)=>{ el.innerHTML='<option value="">'+blank+'</option>'+
    opts.map(o=>'<option value="'+o+'"'+(o===cur?' selected':'')+'>'+o+'</option>').join(''); };
  sel($('fFloor'),floors,'All floors',V.floor);
  const discs=[...new Set(allRows().map(r=>r.discName).filter(Boolean))];
  const dsel=$('fDisc');
  dsel.style.display = discs.length>1 ? '' : 'none';   // one discipline: no pointless picker
  sel(dsel,discs,'AV + Lighting',V.disc);
  sel($('fType'),types,'All cable types',V.type);
}
function paintList(){
  const rows=visible();
  const el=$('list');
  if(!rows.length){ el.innerHTML='<div class="empty">Nothing matches.<br>Clear a filter, or switch back to <b>All</b>.</div>';
    paintRooms(0,0); paintHead(); return; }
  const groups=new Map();
  for(const r of rows){
    const k=grpKey(r);
    if(!groups.has(k)) groups.set(k,[]); groups.get(k).push(r);
  }
  let html='';
  for(const [k,rs] of groups){
    const [floor,no,name]=k.split('␟');
    const live=rs.filter(r=>!isDeleted(r));
    const d=live.filter(r=>{const s=has(r.id);return s&&s.done;}).length;
    const open=!collapsed()[k];
    html+='<section class="grp"><div class="gh" data-grp="'+esc(k)+'">'+
      '<span class="caret">'+(open?'▾':'▸')+'</span>'+
      '<span class="no'+(no?'':' new')+'">'+esc(no||'NEW')+'</span><span class="nm">'+esc(name)+'</span>'+
      '<span class="ct'+(d===live.length&&live.length?' done':'')+'">'+d+'/'+live.length+'</span></div>';
    if(open) for(const r of rs) html+=rowHTML(r);
    html+='</section>';
  }
  el.innerHTML=html;
  paintRooms(groups.size, rows.length);
  paintHead();
}
function paintRooms(nRooms,nCables){
  $('roomCount').textContent = nRooms+' room'+(nRooms===1?'':'s')+' · '+nCables+' cable'+(nCables===1?'':'s');
  const keys=allKeys(), c=collapsed();
  const shut=keys.filter(k=>c[k]).length;
  $('btnExpand').disabled   = shut===0;
  $('btnCollapse').disabled = shut===keys.length;
}
function esc(s){ return (s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

function rowHTML(r){
  const s=has(r.id)||{};
  const del=isDeleted(r);
  let flags=(s.flags||[]).map(f=>'<span class="flag'+(f==='deleted'?' del':f==='added'?' add':'')+'">'+FLAGT[f]+'</span>').join('');
  if(r.dupTag) flags+='<span class="flag del">⚠ '+
    (r.dupKind==='origin'?'Device # already used':'Duplicate tag')+'</span>';
  const mv=moveOf(r.id);
  if(mv) flags+='<span class="flag mvd">◎ Moves '+esc(mv.ft?feetTxt(mv.ft):'')+
    (mv.brg?(' '+esc(mv.brg)):'')+'</span>';
  if(r.newRoom) flags+='<span class="flag add">New room</span>';
  if(r.newType) flags+='<span class="flag add">New cable</span>';
  const ft=(s.actual? s.actual+"' actual" : (r.length!==''&&r.length!=null? r.length+"' est" : ''));
  const ftChk=!!(s.actual && lenCheck(r,s.actual));                       // DLF v218
  return '<div class="row'+((s.done&&!del)?' done':'')+'" data-id="'+esc(r.id)+'"'+(del?' style="opacity:.55"':'')+'>'+
    '<button class="chk" data-act="tick"><span class="box">✓</span></button>'+
    '<button class="body" data-act="open">'+
      '<span class="l1"><span class="tag">'+esc(r.tag||'—')+'</span>'+
        '<span class="pill '+pillClass(r)+'">'+esc(r.label||r.type)+'</span>'+
        '<span class="grow"></span><span class="ft'+(ftChk?' chk':'')+'"'+(ftChk?' title="Check this length"':'')+'>'+esc(ft)+(ftChk?' ⚠':'')+'</span></span>'+
      '<span class="l2"><span class="dev">'+esc([r.manuf,r.device].filter(Boolean).join(' ')||'—')+'</span>'+
        (r.toRoom||r.toNo
          ? '<span class="dest"><span class="arw">→</span>'+esc((r.toRoom||'').toUpperCase())+
            ' <span class="dno">'+esc(r.toNo)+'</span></span>'
          : '<span class="dest none"><span class="arw">→</span>NOT SET</span>')+'</span>'+
      (flags||s.note? '<span class="l3">'+flags+'</span>':'')+
      (s.note? '<span class="note"><b>'+esc(s.by||'note')+'</b> — '+esc(s.note)+'</span>':'')+
      /* v132: the crew's own note, marked so nobody mistakes it for something the office
         has been told about. No flag chip above it — it is not a flag. */
      (s.mine? '<span class="note crew"><b>✎ crew</b> — '+esc(s.mine)+'</span>':'')+
    '</button>'+
    '<button class="more" data-act="open">›</button></div>';
}

/* ---------- drawer ---------- */
let sheetOn=false;
function openSheet(html){ $('sheetBody').innerHTML=html; $('sheet').classList.add('on'); $('scrim').classList.add('on'); sheetOn=true; }
function closeSheet(){ $('sheet').classList.remove('on'); $('scrim').classList.remove('on'); sheetOn=false; }
$('scrim').onclick=closeSheet;

function openRow(id){
  const r=allRows().find(x=>x.id===id); if(!r) return;
  const s=st(id);
  openSheet(
   '<div class="sh"><h2>'+esc(r.tag||'—')+'</h2><button class="x" data-x>✕</button></div>'+
   '<dl class="facts">'+
     '<dt>From</dt><dd>'+esc((r.fromRoom||'').toUpperCase())+' <span class="m">'+esc(r.fromNo)+'</span></dd>'+
     '<dt>To</dt><dd>'+esc((r.toRoom||'').toUpperCase())+' <span class="m">'+esc(r.toNo)+'</span></dd>'+
     '<dt>Device</dt><dd>'+esc([r.manuf,r.device].filter(Boolean).join(' ')||'—')+'</dd>'+
     '<dt>Cable</dt><dd class="m">'+esc(r.label||'')+(r.type&&r.type!==r.label?' · '+esc(r.type):'')+'</dd>'+
     '<dt>Signal</dt><dd>'+esc(r.signal||'—')+'</dd>'+
     '<dt>Est. length</dt><dd class="m">'+(r.length!==''&&r.length!=null?esc(r.length)+" ft":'—')+'</dd>'+
     '<dt>Terminate</dt><dd>'+esc(r.terminate||'—')+'</dd>'+
     (r.floor?'<dt>Sheet</dt><dd>'+esc(r.floor)+'</dd>':'')+
   '</dl>'+
   '<button class="bigtog'+(s.done?' on':'')+'" data-big>'+(s.done?'✓ PULLED':'MARK AS PULLED')+'</button>'+
   (s.ts?'<p class="lbl" style="margin-top:-8px">ticked '+esc(s.ts)+(s.by?(' by '+esc(s.by)):'')+'</p>':'')+
   '<p class="lbl">What changed?</p><div class="chips">'+
     FLAGS.map(f=>'<button class="chip" data-flag="'+f.k+'" aria-pressed="'+((s.flags||[]).includes(f.k))+'">'+f.t+'</button>').join('')+
   '</div>'+
   ((r.disc==='lt' && LT_NODES.length) ? (function(){ const me=devKeyOf(r.id);
     return '<p class="lbl">Now fed from</p>'+
       '<p class="hintline">Pick where this keypad or shade now gets its link, if the loop changed on site. The office re-chains the drawing from this.</p>'+
       '<select id="iFed" style="width:100%;font-size:17px;padding:10px;border-radius:10px;margin-bottom:12px">'+
       '<option value="">(unchanged)</option>'+
       LT_NODES.filter(n=>n.id!==me).map(n=>'<option value="'+esc(n.id)+'"'+(s.fedFrom===n.id?' selected':'')+'>'+esc(fedLabel(n.id))+'</option>').join('')+
       '</select>'; })() : '')+
   /* DLF v218: footage marks fill in Actual length */
   (function(){ const u=s.markU||S.markU||'ft', same=sameAsOf(r);
     return '<p class="lbl">Footage marks on the cable</p>'+
       '<p class="hintline">The number printed on the jacket at each end, in either order. The sheet works out the length.</p>'+
       '<div class="marks">'+
         '<input id="iMa" type="number" inputmode="decimal" placeholder="One end" value="'+esc(s.markA||'')+'">'+
         '<span class="sep">↔</span>'+
         '<input id="iMb" type="number" inputmode="decimal" placeholder="Other end" value="'+esc(s.markB||'')+'">'+
         '<div class="unit" role="group" aria-label="Marks are in">'+
           '<button type="button" data-u="ft" aria-pressed="'+(u==='ft')+'">ft</button>'+
           '<button type="button" data-u="m" aria-pressed="'+(u==='m')+'">m</button></div>'+
       '</div><p class="markres" id="iMr"></p>'+
       (same ? '<button type="button" class="btn ghost" style="margin:-4px 0 14px;padding:12px" data-same="'+esc(same.id)+'">'+
         '= Same length as '+esc(same.tag||'the row above')+' — '+esc(has(same.id).actual)+' ft</button>' : '');
   })()+
   '<div class="two"><div><p class="lbl">Actual length (ft)</p>'+
     '<input id="iAct" type="number" inputmode="numeric" value="'+esc(s.actual||'')+'" placeholder="'+esc(r.length||'')+'"></div>'+
     '<div><p class="lbl">Your initials</p><input id="iBy" value="'+esc(S.tech||'')+'" placeholder="e.g. RJ"></div></div>'+
   '<p class="lenwarn" id="iWarn">'+esc(lenCheck(r,s.actual))+'</p>'+
   /* v132 · TWO BOXES, NOT ONE BOX WITH A SWITCH. A switch saves a little screen and costs
      a mis-tap: one wrong press sends a private reminder to engineering, or buries a real
      red-line where the office will never see it. Two labelled boxes cannot be got wrong
      with gloves on in a hallway, and each one says where it goes right under the label. */
   '<p class="lbl">Note for the office</p>'+
   '<p class="hintline">Goes back to engineering, and flags this run for a look.</p>'+
   '<textarea id="iNote" placeholder="e.g. Moved 4 ft north of the beam — owner added a soffit. Pulled to the new location.">'+esc(s.note||'')+'</textarea>'+
   '<p class="lbl" style="margin-top:14px">✎ Just for the crew</p>'+
   '<p class="hintline">Stays on this job’s sheet. Never sent to the office, never on the drawing. '+
     'Your crew sees it — including whoever picks this up tomorrow.</p>'+
   '<textarea id="iMine" placeholder="e.g. Wire is coiled in the attic until the wall is finished.">'+esc(s.mine||'')+'</textarea>'+
   '<button class="btn" data-save>Save</button>'+
   /* v129: the button is whichever way you are NOT looking. Opened from the list it
      offers the drawing; opened by tapping a tag ON the drawing it offers the list,
      which is the trip Mike asked for and the one that was missing. */
   (inPlan ? '<button class="btn ghost" style="margin-top:10px" data-list>\u2261 Show it on the list</button>'
    : PLANS.length ? '<button class="btn ghost" style="margin-top:10px" data-plan>\u25a6 Find it on the drawing</button>'
    : '')+
   /* v133: only offered when the composer actually told us where this device is. */
   (devPt(id) ? (function(){ const mv=moveOf(id);
     return mv
       ? '<div class="movebox"><b>\u25ce Marked to move '+esc(feetTxt(mv.ft))+' '+esc(mv.brg||'')+'</b>'+
         (mv.note?'<span>'+esc(mv.note)+'</span>':'')+
         '<div class="two" style="margin-top:8px">'+
           '<button class="btn ghost" data-mvredo>Move it somewhere else</button>'+
           '<button class="btn ghost" data-mvclear>Not moving after all</button></div></div>'
       : '<button class="btn ghost" style="margin-top:10px" data-move>'+
         '\u25ce Move it \u2014 tap where it goes</button>'; })() : ''));

  const sb=$('sheetBody');
  sb.querySelector('[data-x]').onclick=closeSheet;
  const big=sb.querySelector('[data-big]');
  big.onclick=()=>{ touchTs(s); s.done=!s.done; s.ts=s.done?stamp():null; if(s.done) s.by=($('iBy').value||S.tech||'').trim();
    big.classList.toggle('on',s.done); big.textContent=s.done?'✓ PULLED':'MARK AS PULLED';
    save(); paintList(); paintPlan(); };
  sb.querySelectorAll('[data-flag]').forEach(b=>b.onclick=()=>{
    const k=b.dataset.flag; s.flags=s.flags||[];
    const i=s.flags.indexOf(k); if(i<0) s.flags.push(k); else s.flags.splice(i,1); touchTs(s);
    b.setAttribute('aria-pressed', i<0); });
  const pb=sb.querySelector('[data-plan]'); if(pb) pb.onclick=()=>showOnPlan(id);
  const lb=sb.querySelector('[data-list]'); if(lb) lb.onclick=()=>showInList(id);
  const mb=sb.querySelector('[data-move]'); if(mb) mb.onclick=()=>armMove(id);
  const mr=sb.querySelector('[data-mvredo]'); if(mr) mr.onclick=()=>armMove(id);
  const mc=sb.querySelector('[data-mvclear]'); if(mc) mc.onclick=()=>clearMove(id);
  /* DLF v218: marks → Actual, live. Typing Actual by hand still works and wins. */
  let unit=s.markU||S.markU||'ft';
  const iMa=$('iMa'), iMb=$('iMb'), iAct=$('iAct'), iMr=$('iMr'), iWarn=$('iWarn');
  const recheck=()=>{ iWarn.textContent=lenCheck(r,iAct.value); };
  const fromMarks=(fill=true)=>{
    const L=markLen(iMa.value,iMb.value,unit);
    if(L==null){ iMr.textContent=''; return; }
    const raw=Math.abs(parseFloat(iMb.value)-parseFloat(iMa.value));
    iMr.textContent='= '+(unit==='m' ? (Math.round(raw*10)/10)+' m → '+L+' ft' : L+' ft');
    if(fill){ iAct.value=L; recheck(); } };
  iMa.oninput=()=>fromMarks(); iMb.oninput=()=>fromMarks(); iAct.oninput=recheck;
  sb.querySelectorAll('[data-u]').forEach(b=>b.onclick=()=>{ unit=b.dataset.u;
    sb.querySelectorAll('[data-u]').forEach(x=>x.setAttribute('aria-pressed', x.dataset.u===unit));
    fromMarks(); });
  const sm=sb.querySelector('[data-same]');
  if(sm) sm.onclick=()=>{ const o=has(sm.dataset.same)||{}, tw=allRows().find(x=>x.id===sm.dataset.same);
    iMa.value=''; iMb.value=''; iAct.value=o.actual||'';
    iMr.textContent='= same as '+((tw&&tw.tag)||'the row above'); recheck(); };
  fromMarks(false);                       /* reopening shows the sum, never overwrites a typed Actual */
  sb.querySelector('[data-save]').onclick=()=>{
    touchTs(s); s.note=$('iNote').value; s.mine=$('iMine').value; s.actual=$('iAct').value;
    s.markA=iMa.value.trim(); s.markB=iMb.value.trim(); s.markU=unit; S.markU=unit;   // DLF v218
    const fe=$('iFed'); if(fe){ s.fedFrom=fe.value||'';                                  // DLF v172
      if(s.fedFrom){ s.flags=s.flags||[]; if(!s.flags.includes('rerouted')) s.flags.push('rerouted'); } }
    const by=($('iBy').value||'').trim(); if(by){ S.tech=by; s.by=by; }
    save(); closeSheet(); paintList(); paintPlan(); toast('Saved'); };
}
function stamp(){ const d=new Date(); const p=n=>String(n).padStart(2,'0');
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes()); }
/* ══ v134 · A TOAST THAT CAN TAKE IT BACK ════════════════════════════════════════════
   Mike, 09-16, on the move markup: "is there any kind of undo?" There was none, anywhere —
   and it had not bitten before because everything else the sheet does is one tap from
   reversible: a tick untoggles, a note is just editable text. A move is the first thing
   that is genuinely hard to take back, which is exactly why it came up.

   No general undo stack (his call, and the right one). Instead the standard fat-finger
   catch: the action that just happened offers to reverse itself for a few seconds. The
   toast keeps `pointer-events:none` unless it is carrying a button, so a plain toast can
   never swallow a tap meant for the row underneath it. */
let toastT=null;
function toast(t, act){
  const el=$('toast');
  if(toastT){ clearTimeout(toastT); toastT=null; }
  el.textContent='';
  el.appendChild(document.createTextNode(t));
  el.classList.toggle('act', !!act);
  if(act){
    const b=document.createElement('button');
    b.type='button'; b.textContent=act.label||'Undo';
    b.onclick=()=>{ el.classList.remove('on','act');
      if(toastT){ clearTimeout(toastT); toastT=null; }
      try{ act.fn(); }catch(e){} };
    el.appendChild(b);
  }
  el.classList.add('on');
  /* long enough to actually reach when there is something to press */
  toastT=setTimeout(()=>{ el.classList.remove('on','act'); toastT=null; }, act?6000:1600);
}

/* ---------- add a run found in the field ----------
   Both pickers carry a "not on this list" escape, because the two things a tech
   most often hits are a room the drawing never had and a cable nobody quoted. A
   new room needs its floor (nothing else can supply it) and takes a room number
   only if the tech knows one — the office fills it in on the red-line pass.

   The TAG is checked live against every tag on the sheet, field additions included.
   It WARNS, it does not block — the same rule as the composer's own duplicate
   monitor, and for the same reason: the tech is recording what is physically in the
   wall, and a tool that refuses the entry just means it never gets recorded at all.
   A duplicate is carried onto the row and into the report so the office must look. */
/* ══ v128 · WHAT COUNTS AS THE SAME TAG ══════════════════════════════════════════════
   Mike, 09-15: "I tried typing in a cable tag that I knew was already used and it didn't
   warn me." Reproduced on this job. The old check compared the two strings raw, so it
   only caught a tag typed back character-for-character. Two shapes slipped through, and
   they are not edge cases here — on Joseph, 40 of 131 tags carry a fabric mark and 14
   carry an a/b letter, so 54 tags (41%) were silently un-checkable:

     sheet says  105.04-112.02 (SH)   tech types  105.04-112.02     → was silent
     sheet says  112.23a-112.01       tech types  112.23-112.01     → was silent

   The fabric mark is a note about what hangs on the run, not part of its identity, so it
   comes off before comparing. The a/b letter is the second cable to ONE device — which
   means a bare number colliding with a lettered one is the more serious clash of the two:
   it is the device number that is taken, not just the string. Both warn, with different
   words, and neither blocks — the tech is recording what is in the wall. */
const stripFabric = t => String(t||'').replace(/\s*\((?:SH|BO|DR|\?\?)\)\s*$/i,'');
const tagKey   = t => stripFabric(t).trim().toUpperCase().replace(/\s+/g,'');
/* The left half of an AVI tag — [origin room].[seq] — with and without the a/b letter. */
const leftKey  = t => { const k=tagKey(t), h=k.indexOf('-'); return h<0?k:k.slice(0,h); };
const originKey= t => { const l=leftKey(t).replace(/[A-Z]+$/,'');
                        return /^\d+\.\d+$/.test(l) ? l : ''; };
const hasLetter= t => /[A-Z]$/.test(leftKey(t));
function tagClash(tag, selfId){
  const k=tagKey(tag); if(!k) return null;
  const rows=allRows().filter(r=>r.id!==selfId);
  const hit=rows.find(r=>tagKey(r.tag)===k);
  if(hit) return {row:hit, kind:'exact'};
  const o=originKey(tag); if(!o) return null;
  /* Same device AND same letter, different destination — a numbering error either way. */
  const lk=leftKey(tag);
  const same=rows.find(r=>originKey(r.tag) && leftKey(r.tag)===lk);
  if(same) return {row:same, kind:'origin'};
  /* A BARE number colliding with a lettered one: 112.23 vs 112.23a is the same first
     cable under two names. A LETTERED tag against a different letter is left alone —
     that is exactly what the letter is for, a second cable to one device. */
  if(hasLetter(tag)) return null;
  const own=rows.find(r=>originKey(r.tag)===o);
  return own ? {row:own, kind:'origin'} : null;
}
/* ══ WHERE A FIELD-ADDED RUN GOES ═══════════════════════════════════════════════════
   The head-ends and landing points this job actually uses, read off the sheet's own rows
   rather than guessed: grouped by room NUMBER (the drawing writes the name both cased and
   upper), commonest first, so the MDF is at the top and the boxes a run lands in follow.
   Plus a free-text option, because "the cabinet below the TV" is a real destination that
   no drawing ever named. */
const NEWD='\u2795 Somewhere else\u2026';
function destList(){
  const m={};
  for(const r of DATA.rows){
    const no=String(r.toNo||'').trim(); const nm=String(r.toRoom||'').trim();
    if(!no && !nm) continue;
    const k=no||nm.toUpperCase();
    if(!m[k]) m[k]={no, room:nm.toUpperCase(), n:0};
    m[k].n++;
  }
  return Object.values(m).sort((a,b)=>b.n-a.n);
}
function destLabel(d){ return (d.room+' '+d.no).trim(); }
function destOptions(){
  return destList().map(d=>'<option>'+esc(destLabel(d))+'</option>').join('')+
         '<option>'+NEWD+'</option>';
}
/* What the picker currently means, in the shape a row stores. */
function destFor(){
  const sel=$('aDest'); if(!sel) return {room:'',no:''};
  if(sel.value===NEWD){
    return {room:($('aDestName').value||'').trim().toUpperCase(),
            no:($('aDestNo').value||'').trim()};
  }
  const d=destList().find(x=>destLabel(x)===sel.value);
  return d?{room:d.room,no:d.no}:{room:'',no:''};
}
/* The right-hand half of a tag is the LANDING POINT (112.01), not the room number (112).
   Read the one this job actually uses for that room off its own tags, so a seeded tag
   comes out 106.14-112.01 and not 106.14-112. Falls back to the bare number only if no
   row lands there yet — a destination the tech has just invented. */
function destTagFor(no){
  if(!no) return '';
  const c={};
  for(const r of allRows()){
    if(String(r.toNo||'').trim()!==String(no)) continue;
    const t=tagKey(r.tag), h=t.indexOf('-');
    if(h>0) c[t.slice(h+1)]=(c[t.slice(h+1)]||0)+1;
  }
  const best=Object.keys(c).sort((a,b)=>c[b]-c[a])[0];
  return best || String(no);
}
/* Next free sequence in a room, carrying that room's usual destination. */
function suggestTag(no){
  if(!no) return '';
  let seq=0; const dests={};
  for(const r of allRows()){
    const m=/^(\d+)\.(\d+)[a-z]*(?:-(.+))?$/i.exec(String(r.tag||'').trim());
    if(!m || m[1]!==String(no)) continue;
    seq=Math.max(seq, parseInt(m[2],10)||0);
    if(m[3]) dests[m[3]]=(dests[m[3]]||0)+1;
  }
  const dest=Object.keys(dests).sort((a,b)=>dests[b]-dests[a])[0];
  const n=String(seq+1).padStart(2,'0');
  return dest ? no+'.'+n+'-'+dest : no+'.'+n;
}
/* ══ v137 · ONE DEVICE, ONE SAVE ════════════════════════════════════════════════════
   Mike, 09-16, the second thing off the first orientation with the techs:

     "when 'adding a run', could it be possible to add multiple wires at once. For
      instance if they add a 122F, could the entire cable complement be added in one
      save instead of adding each wire and saving after each one?"

   A 122F is six cables. Under v128 that was six passes through this sheet — six room
   pickers, six destinations, six tags typed by hand on a tablet in a stud bay, and six
   chances to type 105.14 where 105.14c belongs. The sheet was built around a cable
   because every row in it is a cable; but a tech does not pull a cable, a tech installs
   a DEVICE and the cables follow.

   So the form is now a cable LIST, and picking a device fills it. Three things follow
   from that, none of them free:

   1 · THE CATALOG HAS TO SHIP. The sheet has no library — it only ever knew the cables
       already on the drawing. v137's composer sends `catalog`, the same way v133 sent
       `devs` and `fpp`. If an older export is loaded, DATA.catalog is absent and the
       device picker simply does not appear; the cable list still does, so "add three
       cables at once" works on every sheet ever exported.

   2 · THE LETTERS ARE THE OFFICE'S, NOT MINE. A device carrying two or more cables
       letters them on the ORIGIN side — 105.14a-112.01, 105.14b-112.01 — and a device
       carrying one does not. That is v50's rule in the composer and this is the same
       rule written a second time, which is a thing worth being nervous about: if it
       ever drifts, a field addition comes back under a tag the drawing would never
       have minted. Held to one place here (`blockTags`) so there is one line to fix.

   3 · THE LIST IS EDITABLE, INCLUDING AFTER THE DEVICE FILLS IT. The catalog says what
       a 122F wants. What went in the wall is what the tech pulled, which on a real job
       is sometimes five of the six. Removing a line is a tap, and the tags renumber
       underneath. A complement that could not be edited would be a sheet that lies
       with more confidence than the one it replaced. ════════════════════════════════ */

/* The letters, once. `n` cables on one device -> ['a','b',...]; one cable -> ['']. */
function cableLetters(n){
  if(n<2) return [''];
  const L=[]; for(let i=0;i<n;i++){ let s='',k=i;
    do{ s=String.fromCharCode(97+(k%26))+s; k=Math.floor(k/26)-1; }while(k>=0);
    L.push(s); }
  return L;
}
/* base '105.14-112.01' + n -> the n tags that block will carry. The letter goes on the
   origin side, before the hyphen, exactly where the composer puts it. */
function blockTags(base,n){
  const b=String(base||'').trim().toUpperCase();
  return cableLetters(n).map(suf=>{
    if(!suf) return b;
    const h=b.indexOf('-');
    return h<0 ? b+suf : b.slice(0,h)+suf+b.slice(h);
  });
}
const CATALOG = () => (DATA.catalog||[]);
/* '122F | WALL' -> '122F · WALL'; '(SINGLE)' carries nothing, so the family speaks. */
function catState(e){
  const st=String(e.st||'').replace(/^\(|\)$/g,'').replace(/\s*\|\s*/g,' · ').trim();
  return st && !/^SINGLE/i.test(st) ? st : e.fam.toUpperCase();
}
function catLabel(e){
  return catState(e)+'  —  '+e.fam+'  ('+e.c.length+(e.c.length===1?' cable)':' cables)');
}

function openAdd(){
  const NEWR='➕ Room not on this list…';
  const rooms=[...new Set(DATA.rows.map(r=>(r.fromNo||'')+' '+(r.fromRoom||'').toUpperCase()))].sort();
  const jobTypes=[...new Set(allRows().map(r=>r.label||r.type))].filter(Boolean).sort();
  const catTypes=[...new Set([].concat(...CATALOG().map(e=>e.c.map(c=>c.l))))].filter(Boolean).sort();
  const cabOpts=[...new Set(jobTypes.concat(catTypes))].sort();
  const floors=[...new Set(DATA.rows.map(r=>r.floor))].filter(Boolean);
  const opts=(a,extra)=>a.map(o=>'<option>'+esc(o)+'</option>').join('')+(extra?'<option>'+extra+'</option>':'');
  const cat=CATALOG();

  openSheet('<div class="sh"><h2>Add a run</h2><button class="x" data-x>✕</button></div>'+
    '<div class="banner" style="background:var(--surf2);color:var(--ink2);border-color:var(--line)">'+
      'For cable pulled on site that is not on this list. It comes back to the office flagged '+
      '<b>ADDED IN FIELD</b> so engineering can put it on the drawing and the change order.</div>'+
    '<p class="lbl">Room</p><select id="aRoom">'+opts(rooms,NEWR)+'</select>'+
    '<div id="aRoomNew" style="display:none">'+
      '<div class="two"><div><p class="lbl">New room name</p>'+
        '<input id="aRoomName" placeholder="e.g. WINE CELLAR" autocapitalize="characters"></div>'+
        '<div><p class="lbl">Room # <span style="text-transform:none">(if you know it)</span></p>'+
        '<input id="aRoomNo" inputmode="numeric" placeholder="leave blank"></div></div>'+
      '<p class="lbl">Which sheet is it on?</p><select id="aFloor">'+opts(floors,'')+'</select>'+
    '</div>'+
    '<p class="lbl">Where does it go?</p>'+
    '<select id="aDest">'+destOptions()+'</select>'+
    '<div id="aDestNew" style="display:none">'+
      '<div class="two"><div><p class="lbl">Where it lands</p>'+
        '<input id="aDestName" placeholder="e.g. cabinet below the TV" autocapitalize="characters"></div>'+
        '<div><p class="lbl">Room # <span style="text-transform:none">(if it has one)</span></p>'+
        '<input id="aDestNo" inputmode="numeric" placeholder="leave blank"></div></div></div>'+

    /* the device picker — only when the export carried a catalog */
    (cat.length
      ? '<p class="lbl">What did you install?</p>'+
        '<p class="hintline">Pick it and its whole cable complement drops into the list below. '+
        'Skip it and just list what you pulled.</p>'+
        '<input id="aFind" placeholder="Type a device — 122F, D2, DOME, SHADE…" '+
          'autocapitalize="characters" autocomplete="off" spellcheck="false">'+
        '<select id="aSym"></select>'
      : '')+

    '<p class="lbl">Cables <span style="text-transform:none;font-weight:400" id="aCount"></span></p>'+
    '<div id="aCabs" class="cabs"></div>'+
    '<button type="button" class="btn ghost" id="aMore" style="margin-bottom:16px">＋ Another cable</button>'+

    '<p class="lbl" id="aTagLbl">Cable tag</p>'+
    '<input id="aTag" class="tagin" autocapitalize="characters" autocomplete="off" spellcheck="false">'+
    '<div id="aTagMsg" class="tagmsg"></div>'+
    '<div class="two"><div><p class="lbl">Device / what it feeds</p>'+
      '<input id="aDev" placeholder="e.g. extra ceiling speaker"></div>'+
    '<div><p class="lbl">Length pulled (ft)</p><input id="aLen" type="number" inputmode="numeric"></div></div>'+
    '<p class="lbl">Note</p><textarea id="aNote" placeholder="Why it was added, and where it lands."></textarea>'+
    '<datalist id="aCabList">'+opts(cabOpts,'')+'</datalist>'+
    '<button class="btn" data-add>Add to the sheet</button>');

  const sb=$('sheetBody');
  sb.querySelector('[data-x]').onclick=closeSheet;
  const roomSel=$('aRoom'), tagIn=$('aTag'), msg=$('aTagMsg'), destSel=$('aDest');
  const findIn=$('aFind'), symSel=$('aSym'), cabBox=$('aCabs');
  let tagTouched=false;
  let cabs=[''];                       // ONE blank line: the v128 form, still one save
  let picked=null;                     // the catalog entry, if a device was chosen

  const curNo=()=> roomSel.value===NEWR ? ($('aRoomNo').value||'').trim()
                                        : roomSel.value.split(' ')[0];

  /* ── the cable list ──────────────────────────────────────────────────────── */
  function paintCabs(){
    const L=cableLetters(cabs.length);
    cabBox.innerHTML=cabs.map((v,i)=>
      '<div class="cab">'+
        '<span class="cab-n">'+(cabs.length>1?L[i]:String(i+1))+'</span>'+
        '<input class="cab-in" list="aCabList" data-ci="'+i+'" value="'+esc(v)+'" '+
          'placeholder="what did you pull?" autocapitalize="characters" autocomplete="off">'+
        (cabs.length>1?'<button type="button" class="cab-x" data-cx="'+i+'" aria-label="remove">✕</button>':'')+
      '</div>').join('');
    $('aCount').textContent = cabs.length>1 ? '— '+cabs.length+' on this device, lettered a…'+L[L.length-1] : '';
    cabBox.querySelectorAll('[data-ci]').forEach(el=>{
      el.oninput=()=>{ cabs[+el.dataset.ci]=el.value; };
    });
    cabBox.querySelectorAll('[data-cx]').forEach(el=>{
      el.onclick=()=>{ cabs.splice(+el.dataset.cx,1); picked=null; paintCabs(); checkTag(); };
    });
    checkTag();
  }
  $('aMore').onclick=()=>{ cabs.push(''); paintCabs();
    const ins=cabBox.querySelectorAll('[data-ci]'); ins[ins.length-1].focus(); };

  /* ── the device picker ───────────────────────────────────────────────────── */
  function paintSyms(){
    if(!symSel) return;
    const q=(findIn.value||'').trim().toUpperCase().replace(/\s+/g,' ');
    const hits=cat.filter(e=>!q || (catState(e)+' '+e.fam+' '+e.sym).toUpperCase().includes(q))
                  .sort((a,b)=>catLabel(a).localeCompare(catLabel(b)));
    symSel.innerHTML='<option value="">'+
      (q && !hits.length ? 'Nothing matches "'+esc(q)+'" — list the cables below'
                         : '— pick a device, or list the cables below —')+'</option>'+
      hits.map((e,i)=>'<option value="'+cat.indexOf(e)+'">'+esc(catLabel(e))+'</option>').join('');
    /* one hit and the tech has typed enough to mean it: choose it for them */
    if(q.length>=2 && hits.length===1){ symSel.value=String(cat.indexOf(hits[0])); takeSym(); }
  }
  function takeSym(){
    if(!symSel) return;
    const e=cat[+symSel.value];
    if(!e){ picked=null; return; }
    picked=e;
    cabs=e.c.map(c=>c.l||c.t);
    if(!$('aDev').value) $('aDev').value=catState(e)+' '+e.fam;
    paintCabs();
  }
  if(symSel){ findIn.oninput=paintSyms; symSel.onchange=takeSym; paintSyms(); }

  /* ── the tag, and what the block will be called ──────────────────────────── */
  function checkTag(){
    const v=tagIn.value.trim();
    const tags=blockTags(v, cabs.length);
    let firstHit=null, nHit=0;
    for(const t of tags){ const h=tagClash(t); if(h){ nHit++; if(!firstHit) firstHit={t,h}; } }
    tagIn.classList.toggle('dup', !!firstHit);
    if(firstHit){
      /* ══ v138 · BOTH MESSAGES BACK ═══════════════════════════════════════════════
         v137 flattened v128's two clash messages into one and lost the half that tells
         a tech what to DO about it — the a/b letter. gate19 holds that rule and would
         have said so on the day, but it runs against the mockup and the mockup had not
         been rebuilt since v136, so the regression shipped. The advice matters MORE now,
         not less: a block letters itself, so a tech hand-typing a second cable to a
         device is exactly who needs telling. */
      const r=firstHit.h.row, k=cabs.length, many=k>1;
      const where=esc((r.fromRoom||'').toUpperCase())+' '+esc(r.fromNo);
      const them=many?'them':'it';
      const exact=firstHit.h.kind==='exact';
      /* Four sentences, assembled plainly, because this is the one message on the sheet
         that has to be read correctly by someone standing in a stud bay:
           WHAT clashes · WHICH one · WHAT TO DO · and that they may add it anyway.
         A block shares ONE number, so however many of its tags clash the answer is the
         same — move the block. A single cable has the other answer, the a/b letter, and
         that is the half v137 dropped when it flattened v128's two messages into one. */
      const count = many ? '<b>'+nHit+'</b> of these '+k+' tags clash. The first, ' : '';
      const what  = exact
        ? '<b>'+esc(firstHit.t)+'</b> is already on this sheet — '+where+', '+
          esc(r.label||r.type)+'.'
        : 'device <b>'+esc(originKey(firstHit.t)||firstHit.t)+'</b> is already used by <b>'+
          esc(r.tag)+'</b> in '+where+'.';
      const advice = many
        ? ' Pick a free number for this device.'
        : (exact ? '' : ' If this is a second cable to the same device, letter it (<b>'+
                        esc(originKey(firstHit.t)+'b')+'</b>).');
      msg.className='tagmsg dup';
      msg.innerHTML = '⚠ ' + (many ? count + what : (exact ? what : 'The ' + what)) +
        advice + ' You can still add ' + them + (exact?'':' as typed') +
        '; the office is told.';
    }
    else if(v){
      msg.className='tagmsg ok';
      msg.innerHTML = cabs.length>1
        ? '✓ '+cabs.length+' free tags — <span class="m">'+esc(tags[0])+'</span> through '+
          '<span class="m">'+esc(tags[tags.length-1])+'</span>'
        : '✓ not used anywhere else on this sheet';
    }
    else { msg.className='tagmsg';
      msg.textContent='Leave it blank and '+(cabs.length>1?'they come':'it comes')+
        ' back as FIELD-'+String(S.extra.length+1).padStart(2,'0')+
        (cabs.length>1?'a…':'')+' for the office to tag.'; }
    const btn=sb.querySelector('[data-add]');
    if(btn) btn.textContent = cabs.length>1 ? 'Add '+cabs.length+' cables to the sheet'
                                            : 'Add to the sheet';
    /* The box holds the number all of them SHARE, and the tags carry letters off it.
       Say so on the label, because what is typed here is not what any row ends up
       called and finding that out afterwards is a bad way to learn it. */
    const lb=$('aTagLbl');
    if(lb) lb.innerHTML = cabs.length>1
      ? 'Cable tag <span style="text-transform:none;font-weight:400">— the number all '+
        cabs.length+' share</span>'
      : 'Cable tag';
  }
  function reseed(){
    if(tagTouched){ checkTag(); return; }
    let t=suggestTag(curNo());
    const dt=destTagFor(destFor().no);
    if(t && dt){ const h=t.indexOf('-'); t=(h<0?t:t.slice(0,h))+'-'+dt; }
    tagIn.value=t; tagIn.placeholder=t||'e.g. 106.14-112.01';
    checkTag();
  }
  tagIn.oninput=()=>{ tagTouched=true; checkTag(); };
  destSel.onchange=()=>{
    $('aDestNew').style.display = destSel.value===NEWD ? 'block' : 'none';
    if(destSel.value===NEWD){ $('aDestNo').oninput=reseed; $('aDestName').focus(); }
    reseed();
  };
  roomSel.onchange=()=>{
    const rn=roomSel.value===NEWR;
    $('aRoomNew').style.display=rn?'block':'none';
    if(rn){ $('aRoomNo').oninput=reseed; }
    reseed();
    if(rn && document.activeElement===roomSel) $('aRoomName').focus();
  };
  paintCabs(); reseed();

  /* ── one save ────────────────────────────────────────────────────────────── */
  sb.querySelector('[data-add]').onclick=()=>{
    let no,nm,floor;
    if(roomSel.value===NEWR){
      nm=($('aRoomName').value||'').trim().toUpperCase();
      if(!nm){ toast('Give the new room a name'); $('aRoomName').focus(); return; }
      no=($('aRoomNo').value||'').trim();
      floor=$('aFloor').value||'';
    } else {
      const rv=roomSel.value.split(' '); no=rv.shift(); nm=rv.join(' ');
      floor=(DATA.rows.find(x=>x.fromNo===no)||{}).floor||'';
    }
    const list=cabs.map(c=>String(c||'').trim().toUpperCase()).filter(Boolean);
    if(!list.length){ toast('Say what cable you pulled');
      const f=cabBox.querySelector('[data-ci]'); if(f) f.focus(); return; }

    const typed=tagIn.value.trim().toUpperCase();
    const tags=typed ? blockTags(typed,list.length) : [];
    const dest=destFor();
    const known=new Set(jobTypes.map(t=>t.toUpperCase()));
    const stamp0=Date.now();
    const base='FIELD-'+String(S.extra.length+1).padStart(2,'0');
    const letters=cableLetters(list.length);
    const note=$('aNote').value, len=$('aLen').value||'';
    const devName=$('aDev').value||'(field addition)';
    let dups=0;

    /* Each cable is its own row — its own tick, its own actual length, its own note —
       because that is what the rest of this sheet is made of and a block that behaved
       differently would be a second kind of row to maintain forever. What is shared is
       everything the tech only said once. */
    list.forEach((cable,i)=>{
      const tag = tags.length ? tags[i] : base+(list.length>1?letters[i]:'');
      const clash=tagClash(tag); const dup=!!clash; if(dup) dups++;
      const id='FIELD_'+stamp0+'_'+i;
      S.extra.push({ id, floor, fromRoom:nm, fromNo:no,
        toRoom:dest.room, toNo:dest.no,
        device:devName, manuf:'',
        tag, signal:(picked && picked.c[i] ? picked.c[i].g : '')||'',
        label:cable, type:(picked && picked.c[i] && picked.c[i].l===cable ? picked.c[i].t : cable)||cable,
        length:len, terminate:'Yes', status:'field',
        dupTag: dup||undefined,
        dupOf: dup?clash.row.tag:undefined, dupKind: dup?clash.kind:undefined,
        newRoom: roomSel.value===NEWR || undefined,
        newType: known.has(cable) ? undefined : true,
        /* What the office needs to read these as ONE device rather than n coincidences.
           Six rows sharing a note and a seq LOOK related; saying so is cheaper than
           making engineering infer it from the letters. */
        blockOf: list.length>1 ? ('FIELD_'+stamp0) : undefined,
        blockN:  list.length>1 ? list.length : undefined,
        /* only when the CATALOG named it — otherwise this just repeats the device
           column back at whoever is reading the report. */
        blockDev:(list.length>1 && picked) ? catState(picked)+' '+picked.fam : undefined });
      const s=touchTs(st(id));
      s.flags=['added']; s.note=note; s.by=S.tech; s.done=true; s.ts=stamp(); s.actual=len;
    });

    save(); closeSheet(); paintFilters(); paintList();
    toast(dups ? 'Added '+list.length+' — '+dups+' duplicate tag'+(dups>1?'s':'')+' flagged'
               : 'Added '+list.length+' cable'+(list.length>1?'s':'')+' — flagged for the office');
  };
}


/* ══ HAND-OFF ═══════════════════════════════════════════════════════════════════
   Two techs, two tablets, one job. A progress file is a SNAPSHOT of somebody's day,
   so loading one used to replace the whole sheet — and quietly threw away whatever
   the tech doing the loading had already ticked. It merges now.

   Per cable, the later timestamp wins; flags are unioned; two different notes are
   kept BOTH, each with its author's initials, because a note is the one thing the
   office actually reads and losing half of it is worse than a long note. Runs added
   in the field come across from both sides. Nothing is ever deleted by a merge, so
   the worst case is a cable marked pulled that is not — visible, and fixable —
   rather than a morning's work vanishing. One level of undo, because a merge is the
   only irreversible thing in this sheet.

   `mts` is epoch-ms, written on every edit. Older files have only `ts` (a printable
   "YYYY-MM-DD HH:MM"), so that is the fallback; a row with neither is treated as
   oldest and loses to anything dated. ══════════════════════════════════════════ */
function touchTs(s){ s.mts=Date.now(); return s; }
function whenOf(s){
  if(!s) return 0;
  if(s.mts) return s.mts;
  if(s.ts){ const t=Date.parse(String(s.ts).replace(' ','T')); if(!isNaN(t)) return t; }
  return 0;
}
function mergeNote(a,b,aBy,bBy){
  const x=(a||'').trim(), y=(b||'').trim();
  if(!y) return x; if(!x) return y;
  if(x===y) return x;
  if(x.includes(y)) return x;
  const tagFor=(t,who)=> (who && !t.startsWith(who+' —')) ? (who+' — '+t) : t;
  return tagFor(x,aBy)+'\n'+tagFor(y,bBy);
}
/* v138: was `mergeProgress`, which took its own undo snapshot and returned it. The
   snapshot moved up to `mergeBatch` so one Undo covers a whole takeover; this merges
   ONE file into S and reports only what it changed. */
function mergeOne(P){
  const mine=S, theirs=P||{};
  const tr=theirs.rows||{}, mr=mine.rows||{};
  const rep={took:0, kept:0, both:0, notes:0, flags:0, added:0,
             from:(theirs.tech||'').trim()};
  for(const id of Object.keys(tr)){
    const t=tr[id], m=mr[id];
    if(!m){ mr[id]={...t}; if(t.done) rep.took++; continue; }
    const tw=whenOf(t), mw=whenOf(m);
    if(t.done && m.done) rep.both++;
    else if(t.done && !m.done){ if(tw>=mw){ m.done=true; m.ts=t.ts; m.by=t.by; rep.took++; } }
    else if(!t.done && m.done){ if(tw>mw){ m.done=false; m.ts=null; } else rep.kept++; }
    const fl=new Set([...(m.flags||[]), ...(t.flags||[])]);
    if(fl.size!==(m.flags||[]).length) rep.flags++;
    m.flags=[...fl];
    const nb=mergeNote(m.note, t.note, m.by||mine.tech, t.by||theirs.tech);
    if(nb!==(m.note||'')) rep.notes++;
    m.note=nb;
    /* v132: the crew note merges exactly like the office note. "Just for the crew" means it
       does not leave the crew — not that it does not leave the tablet. The tech picking the
       job up tomorrow is the main reader of "coiled in the attic until the wall is finished". */
    const cb=mergeNote(m.mine, t.mine, m.by||mine.tech, t.by||theirs.tech);
    if(cb!==(m.mine||'')) rep.notes++;
    m.mine=cb;
    if(t.fedFrom!==undefined && (!m.fedFrom || tw>mw)) m.fedFrom=t.fedFrom;             // DLF v172: newer decision stands
    const takeLen=()=>{ m.actual=t.actual; m.markA=t.markA||''; m.markB=t.markB||''; if(t.markU) m.markU=t.markU; }; // DLF v218: marks travel with their length
    if(!m.actual && t.actual) takeLen();
    else if(m.actual && t.actual && m.actual!==t.actual && tw>mw) takeLen();
    m.mts=Math.max(tw,mw)||Date.now();
  }
  mine.rows=mr;
  /* v133: moves merge per device, later timestamp wins. Two techs marking the same speaker
     to two different spots is a genuine disagreement, not something to average — the newer
     decision stands and the report carries whose it was. */
  const tm=theirs.moves||{}, mm=mine.moves||(mine.moves={});
  for(const k of Object.keys(tm)){
    const t=tm[k], m=mm[k];
    if(!m || (+t.mts||0) > (+m.mts||0)){ mm[k]=t; rep.moves=(rep.moves||0)+1; }
  }
  /* DLF v179: panels merge entry by entry — a plate, a port, a tick — newest stamp wins. */
  const tp=theirs.panels||{}, mpn=mine.panels||(mine.panels={});
  for(const pid of Object.keys(tp)){ const a=mpn[pid]||(mpn[pid]={plates:{},ports:{},tk:{}}), b=tp[pid]||{};
    ['plates','ports','tk'].forEach(f=>{ const A=a[f]||(a[f]={}), B=b[f]||{};
      Object.keys(B).forEach(k=>{ if(!A[k] || (+B[k].mts||0)>(+A[k].mts||0)){ A[k]=B[k]; rep.panels=(rep.panels||0)+1; } }); }); }
  const seen=new Set((mine.extra||[]).map(x=>x.id));
  for(const x of (theirs.extra||[])) if(!seen.has(x.id)){ mine.extra.push(x); seen.add(x.id); rep.added++; }
  S=mine;
  return rep;
}
function mergeReport(rep, before, bad){
  bad=bad||[];
  const names=(rep && rep.from && rep.from.length) ? rep.from : [];
  const who = names.length ? esc(names.join(' and ')) : 'the other tablet';
  const nf  = rep ? (rep.files||1) : 0;
  const line=(n,txt,cls)=> n ? '<div class="chk-row'+(cls||'')+'"><div class="chk-k">'+n+'</div>'+
      '<div class="chk-t">'+txt+'</div></div>' : '';
  const skipped = bad.length
    ? '<p class="lbl" style="margin-top:16px">Not merged</p>'+
      bad.map(x=>'<div class="chk-row bad"><div class="chk-k">⚠ '+esc(x.name)+'</div>'+
        '<div class="chk-t">'+esc(x.err)+'</div></div>').join('')
    : '';
  if(!rep){
    openSheet('<div class="sh"><h2 style="font-family:var(--sans)">Nothing merged</h2>'+
      '<button class="x" data-x>✕</button></div>'+skipped+
      '<button class="btn" data-ok>Carry on</button>');
    const sb0=$('sheetBody');
    sb0.querySelector('[data-x]').onclick=closeSheet;
    sb0.querySelector('[data-ok]').onclick=closeSheet;
    return;
  }
  openSheet('<div class="sh"><h2 style="font-family:var(--sans)">Merged</h2>'+
    '<button class="x" data-x>✕</button></div>'+
    '<p class="tagmsg">'+(nf>1?('<b>'+nf+' files</b> taken over in one go. '):'')+
      'Nothing was deleted. Your own work is still here.</p>'+
    (line(rep.took, 'cables '+who+' pulled, now ticked here')||
     '<div class="chk-row"><div class="chk-k">0</div><div class="chk-t">new ticks from '+who+
       ' — '+(nf>1?'those files were':'that file was')+
       ' older than what you already have.</div></div>')+
    line(rep.kept, 'you had ticked that '+who+' had not — kept as yours')+
    line(rep.both, 'both of you had already ticked')+
    line(rep.notes, 'notes joined, each with whose it is')+
    line(rep.flags, 'cables that picked up a change flag from '+who)+
    line(rep.added, 'run'+(rep.added===1?'':'s')+' '+who+' added in the field, brought across')+
    line(rep.moves, 'device'+(rep.moves===1?'':'s')+' '+who+' marked to move, brought across')+
    skipped+
    '<button class="btn" data-ok>Carry on</button>'+
    '<button class="btn ghost" style="margin-top:10px" data-undo>'+
      (nf>1?('Undo all '+nf+' files'):'Undo this merge')+'</button>');
  const sb=$('sheetBody');
  sb.querySelector('[data-x]').onclick=closeSheet;
  sb.querySelector('[data-ok]').onclick=closeSheet;
  sb.querySelector('[data-undo]').onclick=()=>{
    S=before; save(); closeSheet(); paintFilters(); paintList(); paintPlan();
    toast('Merge undone'); };
}
/* ══ v138 · WHAT GOES FIRST IN THE NAME ═════════════════════════════════════════════
   The tech on the live job, 09-17:

     "Because of the iPad layout, the file names become hard to see and can cause issues
      to find the right json file to merge later."

   These were named job-first — `Joseph_14176_progress_MD_0916.json` — so two techs' files
   differed at character 22, which is exactly where an iPad's file list stops showing them.
   And with no TIME in the name, two saves on the same day by the same tech collided and
   iOS quietly appended a number.

   So the distinguishing part leads: initials, then the date, then the time. The job still
   follows, because a file in the wrong folder should still be obvious. */
function nameStamp(){
  const d=new Date(), p=n=>String(n).padStart(2,'0');
  return p(d.getMonth()+1)+p(d.getDate())+'_'+p(d.getHours())+p(d.getMinutes());
}
function techSlug(){ return (S.tech||'').trim().replace(/[^A-Za-z0-9]/g,''); }
function progressName(){
  const who=techSlug();
  return (who?who+'_':'')+nameStamp()+'_'+base()+'_progress.json';
}

/* ══ THE END-OF-DAY REPORT ═══════════════════════════════════════════════════════
   One destination, always: the job's Markups folder in Dropbox. The tablet cannot put
   a file there by itself — Safari has no file-system access and Dropbox needs a
   sign-in this page cannot do — so the next best thing is that it never leaves the
   choice to memory: the folder is named on screen, in full, every single time, and the
   file name repeats it so a misfiled one is obvious at a glance.

   E-mail is the exception, for something that cannot wait until the office opens the
   folder. `mailto:` CANNOT carry an attachment — nothing can, from a web page — so the
   e-mail carries the SUMMARY in its body, which is what someone reading a phone wants
   anyway. The file still goes to Dropbox. The screen says so in those words rather than
   letting a tech think they have sent the report when they have sent a note about it. */
const MARKUPS = (DATA.meta && DATA.meta.markups) || 'Markups';
const CONTACTS = (DATA.meta && DATA.meta.contacts) || [];

function reportRows(){
  const out=[];
  for(const r of allRows()){
    /* v133: a move is recorded against the DEVICE, so a row can be reportable while
       carrying no per-row state of its own. Every cable off a moved device is affected —
       the length changes for all of them — so every one of them reports. */
    const mv=moveOf(r.id);
    const pi=PANELS.length?panelInfoOf(r.id):null;                    /* DLF v179 */
    const s=has(r.id) || ((mv||(pi&&pi.touched)) ? st(r.id) : null); if(!s) continue;
    /* v132: `s.mine` is deliberately NOT in this test and must never be added to it. A row
       carrying only a crew note has nothing to tell the office, and putting it here would
       hand engineering a list of the crew's reminders to themselves. Same reason there is no
       crew-note column below. */
    if(!mv && !(pi&&pi.touched) && !s.done && !(s.flags||[]).length && !(s.note||'').trim() && !String(s.actual||'').trim()) continue; /* DLF v218: a length alone is worth sending */
    out.push({r,s});
  }
  return out;
}
function reportCsv(rows){
  const head=['Cable Tag','From Room','From #','To Room','To #','Device','Cable','Est ft','Actual ft',
              'Pulled','Ticked','By','Change flags','Field note',
              /* DLF v172: appended, never inserted — the office's red-line import joins on Row ID. */
              'Row ID','Fed from ID','Fed from','Move X','Move Y','Move plan',
              /* DLF v179: appended — the panel as built */
              'Panel','Port','Office port','Terminated','Tested'];
  const out=[csvRow(head)];
  for(const {r,s} of rows){
    out.push(csvRow([r.tag,r.fromRoom,r.fromNo,r.toRoom,r.toNo,
      [r.manuf,r.device].filter(Boolean).join(' '), r.label||r.type, r.length, s.actual,
      s.done?'YES':'', s.ts, s.by||S.tech,
      (function(){ const mv=moveOf(r.id);
        const own=(s.flags||[]).map(f=>FLAGT[f]);
        /* v133: the move's own reasons, then the distance, so a reader sees WHY before
           HOW FAR. De-duplicated against the row's own flags — "moved" is usually both. */
        const why=mv?(mv.why||[]).map(f=>FLAGT[f]).filter(t=>!own.includes(t)):[];
        return own.concat(why,
          mv?['MOVED '+(feetTxt(mv.ft)||'')+' '+(mv.brg||'')+
              ' (marked on the plan'+(mv.by?(' by '+mv.by):'')+')']:[],
          r.dupTag?[(r.dupKind==='origin'?'DEVICE NUMBER ALREADY USED':'DUPLICATE TAG')+
                    (r.dupOf?(' (clashes with '+r.dupOf+')'):'')]:[],
          r.newRoom?['ROOM NOT ON THE DRAWING']:[],
          r.newType?['CABLE NOT ON THE LIST']:[],
          /* v137: a device added in the field arrives as n rows. Saying so beats making
             engineering infer one block from n letters that happen to share a seq. */
          r.blockOf?['ONE DEVICE, '+r.blockN+' CABLES'+(r.blockDev?(' — '+r.blockDev):'')]:[]
          ).join('; '); })(),
      (function(){ const mv=moveOf(r.id);
        return [s.note, mv&&mv.note].filter(x=>x&&String(x).trim()).join(' — '); })(),
      r.id, s.fedFrom||'', s.fedFrom?fedLabel(s.fedFrom):'',
      (function(){ const mv=moveOf(r.id); return mv&&mv.px!=null?(+mv.px).toFixed(2):''; })(),
      (function(){ const mv=moveOf(r.id); return mv&&mv.py!=null?(+mv.py).toFixed(2):''; })(),
      (function(){ const mv=moveOf(r.id); return mv&&mv.planId?mv.planId:''; })(),
      ...(function(){ const pi=PANELS.length?panelInfoOf(r.id):null;          /* DLF v179 */
        return pi?[pi.P.name||'', pi.port, pi.office, pi.term?'YES':'', pi.test?'YES':'']:['','','','','']; })()]));
  }
  /* DLF v179: plates the tech changed from the office's layout — one line each, keyed
     panel:<id>:<position> so the composer's import knows it is not a cable. */
  PANELS.forEach(P=>{ const ov=(pnS(P).plates||{}); Object.keys(ov).forEach(pos=>{ const v=ov[pos].v||'', o=(P.plates||{})[pos]||'';
    if(v===o) return;
    const L=new Array(25).fill('');
    L[0]='PANEL '+(P.name||'')+' '+pos; L[10]=ov[pos].mts?new Date(ov[pos].mts).toLocaleString():''; L[11]=ov[pos].by||S.tech||'';
    L[12]=o ? ('PLATE CHANGED '+o+' → '+(v||'(empty)')) : ('PLATE INSTALLED '+(v||'(none)')); L[14]='panel:'+P.id+':'+pos; L[20]=P.name||''; L[21]=pos;
    out.push(csvRow(L));
  }); });
  return out.join('\n');
}
/* The name repeats the destination, so a report sitting in the wrong folder is obvious. */
function reportName(){
  const d=new Date(), p=n=>String(n).padStart(2,'0');
  const who=techSlug();
  /* v138: the office reads these by job, so the job stays in front — but the TIME goes in,
     because two reports on one day used to collide. */
  return base()+'_MARKUPS_REPORT'+(who?('_'+who):'')+'_'+nameStamp()+'.csv';
}
function summaryText(){
  const live=allRows().filter(r=>!isDeleted(r));
  const done=live.filter(r=>{const s=has(r.id);return s&&s.done;});
  const fl=allRows().filter(isFlagged);
  let t=(DATA.meta.project||'')+' '+(DATA.meta.number||'')+' — wire pull\n'+
    done.length+' of '+live.length+' pulled'+(S.tech?('  —  '+S.tech):'')+'\n'+stamp()+'\n';
  if(fl.length){ t+='\nNEEDS ENGINEERING ('+fl.length+'):\n'+fl.map(r=>{ const s=has(r.id)||{};
    return '• '+r.tag+'  ('+(r.fromRoom||'').toUpperCase()+' '+(r.fromNo||'')+')  '+
      (s.flags||[]).map(f=>FLAGT[f]).join(', ')+
      (function(){ const mv=moveOf(r.id); return mv
        ? '  ◎ MOVES '+(feetTxt(mv.ft)||'')+' '+(mv.brg||'')+' — marked on the plan' : ''; })()+
      (r.dupTag?(' '+(r.dupKind==='origin'?'DEVICE NUMBER ALREADY USED':'DUPLICATE TAG')+
                 (r.dupOf?(' — clashes with '+r.dupOf):'')):'')+
      (r.newRoom?' ROOM NOT ON THE DRAWING':'')+
      (r.newType?' CABLE NOT ON THE LIST':'')+
      (s.note?('\n   '+s.note.replace(/\n/g,'\n   ')):'')+
      (function(){ const mv=moveOf(r.id);
        return mv&&mv.note?('\n   '+mv.note.replace(/\n/g,'\n   ')):''; })(); }).join('\n'); }
  else t+='\nNothing flagged for engineering.\n';
  t+='\nThe full report is in Dropbox → '+MARKUPS+'.\n';
  return t;
}
function mailtoFor(c){
  const flagged=allRows().filter(isFlagged).length;
  const subj=(DATA.meta.project||'')+' '+(DATA.meta.number||'')+' — wire pull'+
    (flagged?(' — '+flagged+' flagged'):'');
  return 'mailto:'+encodeURIComponent(c.email)+
    '?subject='+encodeURIComponent(subj)+'&body='+encodeURIComponent(summaryText());
}
function openSend(){
  const rows=reportRows();
  const flagged=allRows().filter(isFlagged).length;
  const mail=CONTACTS.filter(c=>c.email);
  openSheet('<div class="sh"><h2 style="font-family:var(--sans)">Report for the office</h2>'+
    '<button class="x" data-x>✕</button></div>'+
    (rows.length
      ? '<dl class="facts"><dt>In this report</dt><dd class="m">'+rows.length+' cable'+(rows.length===1?'':'s')+'</dd>'+
        '<dt>Flagged</dt><dd class="m">'+flagged+'</dd>'+
        '<dt>Tech</dt><dd>'+esc(S.tech||'—')+'</dd>'+
        (S.lastReport?('<dt>Last sent</dt><dd>'+esc(S.lastReport.when)+' · '+S.lastReport.rows+' rows</dd>'):'')+
        '</dl>'
      : '<div class="banner">Nothing to report yet — tick a cable or leave a note first.</div>')+
    '<div class="destbox"><div class="k">ALWAYS GOES HERE</div>'+
      '<div class="p">Dropbox → <b>'+esc(DATA.meta.project||'this job')+
        (DATA.meta.number?(' '+esc(DATA.meta.number)):'')+'</b> → <b>'+esc(MARKUPS)+'</b></div></div>'+
    '<button class="btn" data-go '+(rows.length?'':'disabled style="opacity:.45"')+
      '>Save to Dropbox → '+esc(MARKUPS)+'</button>'+
    '<p class="tagmsg">Pick <b>Dropbox</b> on the next screen, then that folder. '+
      'The file is named <span class="m">…_MARKUPS_REPORT…</span> so a misfiled one is easy to spot.</p>'+
    (mail.length
      ? '<p class="lbl" style="margin-top:6px">Urgent — needs an answer before the office opens the folder</p>'+
        /* a real <a href="mailto:"> rather than a scripted navigation: iOS hands an anchor
           straight to Mail, and the address is in the markup instead of being assembled
           at click time. */
        '<div class="menu">'+mail.map(c=>'<a class="mailto" data-mail href="'+esc(mailtoFor(c))+'">'+
          '✉ E-mail '+esc(c.name)+
          '<small>'+esc(c.email)+' — sends the SUMMARY, not the file. The file still goes to Dropbox.</small></a>').join('')+
        '</div>'
      : '<p class="tagmsg">No urgent contacts were set for this job. Call the office.</p>')+
    '<button class="btn ghost" data-copy>Copy the summary as text</button>');
  const sb=$('sheetBody');
  sb.querySelector('[data-x]').onclick=closeSheet;
  const go=sb.querySelector('[data-go]');
  if(go && rows.length) go.onclick=async ()=>{
    await sendFile(reportName(), reportCsv(rows), 'text/csv', 'Report saved');
    S.lastReport={when:stamp(), rows:rows.length, by:S.tech||''}; save();
    closeSheet();
  };
  sb.querySelector('[data-copy]').onclick=()=>{
    const t=summaryText();
    if(navigator.clipboard) navigator.clipboard.writeText(t).then(()=>toast('Copied')).catch(()=>toast('Copy failed'));
    else toast('Copy not available here');
  };
}

/* ---------- menu / export ---------- */
function openMenu(){
  const changed=allRows().filter(isFlagged).length;
  const done=allRows().filter(r=>{const s=has(r.id);return s&&s.done;}).length;
  openSheet('<div class="sh"><h2 style="font-family:var(--sans)">This sheet</h2><button class="x" data-x>✕</button></div>'+
    '<dl class="facts"><dt>Pulled</dt><dd class="m">'+done+' of '+allRows().length+'</dd>'+
    '<dt>Flagged</dt><dd class="m">'+changed+'</dd>'+
    '<dt>Tech</dt><dd>'+esc(S.tech||'—')+'</dd>'+
    '<dt>Autosave</dt><dd>'+(storageOK?'on (this tablet)':'⚠ off — save a file')+'</dd>'+
    (S.lastReport?('<dt>Last report</dt><dd>'+esc(S.lastReport.when)+' \u00b7 '+S.lastReport.rows+' rows</dd>'):'')+
    (S.lastMerge?('<dt>Last merge</dt><dd>'+esc(S.lastMerge.when)+
      (S.lastMerge.files>1?(' · '+S.lastMerge.files+' files'):'')+
      (S.lastMerge.from?(' from '+esc(S.lastMerge.from)):'')+
      ' · took '+S.lastMerge.took+'</dd>'):'')+'</dl>'+
    '<div class="menu">'+
    '<button data-m="jobs">🗂 Jobs on this iPad<small>Switch to another job, or load a new or revised job file from Dropbox.</small></button>'+
    '<button data-m="send">📤 Report for the office<small>Everything you touched, as a file for Dropbox \u2192 '+esc(MARKUPS)+'. E-mail it too if it is urgent.</small></button>'+
    '<button data-m="prog">💾 Save / hand off<small>The whole sheet as a file, named with your initials and today\u2019s date. Share it into the job\u2019s Dropbox folder.</small></button>'+
    '<button data-m="open">📂 Take over from another tech<small>Opens their file and MERGES it with yours \u2014 nothing you have done is lost. Pick as MANY files as you like; they all merge in one go.</small></button>'+

    '<button data-m="print">🖨 Print / save as PDF<small>The paper backup, with the ticks on it.</small></button>'+
    '<button data-m="check">🩺 Check this tablet<small>Four answers about how this iPad handles the sheet. Send them to the office.</small></button>'+
    '<button data-m="reset" style="color:var(--err)">↺ Clear all ticks<small>Starts this sheet over. Cannot be undone.</small></button>'+
    '</div><input type="file" id="fileIn" accept=".json" multiple style="display:none">');
  const sb=$('sheetBody');
  sb.querySelector('[data-x]').onclick=closeSheet;
  sb.querySelectorAll('[data-m]').forEach(b=>b.onclick=()=>doMenu(b.dataset.m));
  $('fileIn').onchange=e=>{
    const files=[...(e.target.files||[])]; if(!files.length) return;
    readProgressFiles(files).then(res=>{ e.target.value=''; mergeBatch(res); });
  };
}
/* Read every file the tech picked, and judge each one separately: a folder holding
   one good file and one for the wrong job should merge the good one and SAY so about
   the other, not refuse the lot. */
function readProgressFiles(files){
  return Promise.all(files.map(f=>new Promise(res=>{
    const fr=new FileReader();
    fr.onerror=()=>res({name:f.name, err:'could not be read'});
    fr.onload=()=>{
      let P; try{ P=JSON.parse(fr.result); }
      catch(err){ return res({name:f.name, err:'is not a readable file'}); }
      if(!P || P._type!=='avi_pull_progress')
        return res({name:f.name, err:'is not a pull-sheet progress file'});
      if(P.meta && P.meta.number && DATA.meta.number &&
         String(P.meta.number)!==String(DATA.meta.number))
        return res({name:f.name, err:'is for job '+P.meta.number+', not '+DATA.meta.number});
      res({name:f.name, P});
    };
    fr.readAsText(f);
  })));
}
/* ══ v138 · ONE TAKEOVER, HOWEVER MANY FILES ════════════════════════════════════════
   The tech on the live job, 09-17:

     "When reloading the main file and doing a takeover, I have to do a takeover for each
      file to merge all the data. ... This isn't an issue really just lots of extra steps
      and the lead will have to verify all json files are uploaded."

   It was not a decision — v121 wrote `e.target.files[0]` and the input had no `multiple`.
   Two techs on a job is the case this sheet was BUILT for; two files was the shape it
   already produced and the one thing it would not accept.

   THE UNDO IS THE ONLY REAL DESIGN POINT. v121 keeps one level of it because a merge is
   the only irreversible thing in this sheet. Snapshotting per file would rewind to the
   state before the LAST of four — leaving three merged, under a button that says "Undo
   this merge". So the snapshot is taken ONCE, before the batch, and Undo means the whole
   takeover.

   Oldest first, by the `savedAt` each file carries. The per-row merge is timestamp-based
   and order-independent, but `lastMerge` is not: reading them in order leaves the sheet
   naming the most recent hand-off rather than whichever file the picker happened to list
   first. */
function mergeBatch(res){
  const ok=res.filter(r=>r.P), bad=res.filter(r=>r.err);
  if(!ok.length){
    toast(bad.length===1 ? 'That file '+bad[0].err : 'None of those were progress files');
    if(bad.length>1) mergeReport(null, null, bad);
    return;
  }
  const before=JSON.parse(JSON.stringify(S));
  ok.sort((a,b)=>String((a.P||{}).savedAt||'').localeCompare(String((b.P||{}).savedAt||'')));
  const tot={took:0,kept:0,both:0,notes:0,flags:0,added:0,moves:0,from:[],files:ok.length};
  for(const r of ok){
    const rep=mergeOne(r.P);
    for(const k of ['took','kept','both','notes','flags','added','moves'])
      tot[k]+=(rep[k]||0);
    const nm=(rep.from||'').trim();
    if(nm && tot.from.indexOf(nm)<0) tot.from.push(nm);
  }
  S.lastMerge={when:stamp(), from:tot.from.join(' + '), took:tot.took, files:ok.length};
  save();
  paintFilters(); paintList(); paintPlan();
  mergeReport(tot, before, bad);
}
/* iOS has no download folder a tech will find. Hand the file to the Share sheet
   when the device offers it — Mail, Messages, Dropbox, Files all appear — and fall
   back to a plain download everywhere else. Both paths are wired, so whichever one
   the tablet supports, the report gets off the iPad. */
function canShareFiles(){
  try{ return !!(navigator.canShare && navigator.share &&
    navigator.canShare({files:[new File([''],'t.txt',{type:'text/plain'})]})); }
  catch(e){ return false; }
}
async function sendFile(name,text,mime,label){
  if(canShareFiles()){
    try{ await navigator.share({files:[new File([text],name,{type:mime})], title:name});
         toast('Sent'); return; }
    catch(e){ if(e && e.name==='AbortError') return; }   // tech backed out — not an error
  }
  dl(name,text,mime); toast(label||'Downloaded');
}
function dl(name,text,mime){
  const b=new Blob([text],{type:mime||'text/plain'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download=name;
  document.body.appendChild(a); a.click(); a.remove();
}
function base(){ return ((DATA.meta.project||'sheet')+'_'+(DATA.meta.number||'')).replace(/\s+/g,'_'); }
function csvRow(a){ return a.map(c=>'"'+String(c==null?'':c).replace(/"/g,'""')+'"').join(','); }
function doMenu(m){
  if(m==='jobs'){ if(window.AVI_FIELD) window.AVI_FIELD.showStart(); return; }   /* hosted app: back to the start screen */
  if(m==='send'){ openSend(); return; }
  if(m==='prog'){ sendFile(progressName(), JSON.stringify({_type:'avi_pull_progress',meta:DATA.meta,
      /* v133: `moves` MUST be listed here. This object enumerates S's fields explicitly,
         so anything new is silently dropped from the hand-off file — the same trap the
         composer's returnToTray hit. The move geometry rides in this file, which is also
         the only machine-readable path back to the composer. */
      tech:S.tech,rows:S.rows,extra:S.extra,collapsed:S.collapsed,moves:S.moves||{},panels:S.panels||{},   /* DLF v179 */
      savedAt:stamp()},null,1),
      'application/json', 'Progress saved'); }
  if(m==='open'){ $('fileIn').click(); }
  if(m==='check'){ tabletCheck(); return; }
  if(m==='print'){ closeSheet(); setTimeout(()=>window.print(),250); }
  if(m==='reset'){ if(confirm('Clear every tick and note on this sheet?')){ S={tech:S.tech,rows:{},extra:[],collapsed:S.collapsed||{},moves:{},panels:{}};
    save(); closeSheet(); paintList(); toast('Cleared'); } }
}

/* ---------- 🩺 check this tablet ----------
   Four questions this session could not answer from a sandbox, asked on the device
   itself: does autosave work, can a file leave the iPad, is this the installed app,
   and is there room to store the job. The tech taps once and sends the answer back. */
function tabletCheck(){
  const out=[];
  const say=(k,ok,txt)=>out.push({k,ok,txt});

  // autosave — a real round trip, not a capability sniff
  let auto=false, why='';
  try{
    const probe='__avi_probe_'+Date.now();
    localStorage.setItem(probe,'1');
    auto = localStorage.getItem(probe)==='1';
    localStorage.removeItem(probe);
    if(!auto) why='wrote but could not read back';
  }catch(e){ why=(e&&e.name)||'blocked'; }
  say('Autosave', auto, auto
    ? 'Ticks are kept on this iPad between visits.'
    : 'NOT working'+(why?' ('+why+')':'')+' — save a progress file before closing.');

  // can a file get off the device
  const share=canShareFiles();
  say('Sending a file', true, share
    ? 'Share sheet available — reports go straight to Mail, Messages or Dropbox.'
    : 'No share sheet; reports will download to Files instead. Use the test below.');

  // installed as an app, or opened from a file / browser
  const standalone = (window.navigator.standalone===true) ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  const scheme = location.protocol.replace(':','');
  /* v138: this line already held the answer to the 09-17 swipe report — it just said it
     too gently to act on. A sheet running inside a host app is a WARNING, not a note. */
  say('How it opened', !HOSTAPP, standalone ? 'Home-screen app — the best case.'
      : (HOSTAPP ? 'Running INSIDE '+HOSTAPP+', not on the iPad. Ticks may not be kept and '+
                   'the plan will fight your finger — save it to Files and open it from there.'
      : (scheme==='file' ? 'Opened from a file in Files. Works, but autosave is the least reliable this way.'
                         : 'Opened in the browser from a link.')));

  say('This sheet', true, allRows().length+' cables, '+allKeys().length+' rooms. '+
      Math.round((JSON.stringify(S).length/1024))+' KB of your work stored.');

  const ua=navigator.userAgent||'';
  const body =
    '<div class="sh"><h2 style="font-family:var(--sans)">Check this tablet</h2>'+
      '<button class="x" data-x>✕</button></div>'+
    out.map(o=>'<div class="chk-row'+(o.ok?'':' bad')+'"><div class="chk-k">'+
      (o.ok?'✓':'⚠')+' '+esc(o.k)+'</div><div class="chk-t">'+esc(o.txt)+'</div></div>').join('')+
    '<p class="lbl" style="margin-top:16px">Test a download</p>'+
    '<button class="btn ghost" data-test>Save a test file</button>'+
    '<p class="tagmsg" id="dlMsg">Tap it, then look in Files → Downloads. If nothing arrives, '+
      'tell the office — reports will need the share sheet instead.</p>'+
    '<button class="btn" data-send>Send this to the office</button>';
  openSheet(body);
  const sb=$('sheetBody');
  sb.querySelector('[data-x]').onclick=closeSheet;
  sb.querySelector('[data-test]').onclick=()=>{
    const tn='AVI_download_test_'+nameStamp()+'.txt';
    dl(tn,'If you can read this, downloads work on this iPad.\n','text/plain');
    $('dlMsg').className='tagmsg ok';
    $('dlMsg').textContent='Asked for the download. Check Files → Downloads for '+tn+'.';
  };
  sb.querySelector('[data-send]').onclick=()=>{
    const txt='AVI PULL SHEET — TABLET CHECK\n'+
      (DATA.meta.project||'')+' '+(DATA.meta.number||'')+'\n'+stamp()+
      (S.tech?('  — '+S.tech):'')+'\n\n'+
      out.map(o=>(o.ok?'OK   ':'WARN ')+o.k+': '+o.txt).join('\n')+
      '\n\nscreen '+screen.width+'x'+screen.height+'  dpr '+(window.devicePixelRatio||1)+
      '\n'+ua+'\n';
    /* v138: this used to be one fixed name, so two techs overwrote each other — and a
       stray `AVI_tablet_check.txt` beside a progress file is exactly what got reported
       as "it seems to be saving 2 files". Now it says whose it is and when. */
    sendFile('AVI_tablet_check_'+(techSlug()?techSlug()+'_':'')+nameStamp()+'.txt',
             txt, 'text/plain', 'Saved');
  };
}

/* ---------- ? help — written for the tech, not for the office ---------- */
const HELP=[
 ['What this is',
  'The wire pull list for this job, on your iPad. It works with no signal. '+
  'Nothing you do here changes the drawing — the office reads what you send back and updates it.'],
 ['Mark a wire pulled',
  'Tap the box on the left. That is the whole job. The bar at the top counts down as you go, '+
  'and every room shows its own count.'],
 ['Find your room',
  'Tap Collapse all and the sheet becomes a list of rooms. Tap the room you are standing in to open '+
  'just that one. To pull hides everything already done.'],
 ['Something changed',
  'Tap the row (not the box) to open it. Mark what happened — moved, re-routed, deleted, no access — '+
  'put the real length in, and type a note. Say where it went, not just that it moved. '+
  'The office reads that note.'],
 ['A note to yourself',
  'Two note boxes, and they go to different places. Note for the office goes back to engineering '+
  'and flags the run. ✎ Just for the crew stays on this sheet — the office never sees it, and it '+
  'never reaches the drawing. Use it for "coiled in the attic until the wall is finished". '+
  'The ✎ Crew tab lists every one you have left.'],
 ['Something needs to MOVE',
  'Open the row, tap \u25ce Move it, and the drawing opens on that device with it ringed. Tap the '+
  'spot it should end up. The sheet works out how far and which way, asks why, and draws the '+
  'arrow. It goes back to engineering as a red-line. Tap the ring or arrow on the drawing to '+
  'change it or clear it, and Undo on the black bar takes back the last one.'],
 ['Length without a tape',
  'Most cable has footage printed on the jacket. Open the row and type the number at each end — '+
  'either order, counting up or down — and the sheet fills in the length. Flip ft / m if the '+
  'jacket is metric. Cables pulled together? = Same length copies the one above. A ⚠ means the '+
  'length is far off the drawing — usually a missed digit.'],
 ['You pulled something extra',
  /* v138: this was 108 words and blew the 75-word rule gate5 holds the Help to. The
     stale mockup hid it for two versions. Trimmed to 74 — the duplicate-tag warning came
     out, because a tech meets that one on screen the moment it matters. */
  'The ＋ Add a run button, bottom left. Pick the room, then say what you installed — type '+
  '122F, D2, DOME — and its whole cable complement drops into the list. Take out any line '+
  'you did not pull. Not a listed device? Skip that box and type the cables. The tag box '+
  'suggests the next free number and letters them a, b, c… the way the drawing would. '+
  'One save, however many cables.'],
 ['Send it to the office',
  '☰ menu → Send back to the office. That sends only what you touched — every tick, note and '+
  'change. Do it when a room is finished, not just at the end of the job.'],
 ['Ending the day, and handing off',
  'The iPad usually remembers your ticks, but do not rely on it for a long job. \u2630 menu \u2192 '+
  'Save / hand off, into the job\u2019s Dropbox folder. That file is the real record. The next tech '+
  'taps \u2630 \u2192 Take over from another tech and picks it: it MERGES, so both of your ticks, notes '+
  'and moves survive, and it tells you what it did.'],
 ['If something looks wrong',
  '☰ menu → Check this tablet, then Send this to the office. It answers the questions engineering '+
  'will ask before anything else.'],
];
function openHelp(){
  openSheet('<div class="sh"><h2 style="font-family:var(--sans)">How to use this</h2>'+
    '<button class="x" data-x>✕</button></div>'+
    HELP.map(h=>'<div class="help-b"><h4>'+esc(h[0])+'</h4><p>'+esc(h[1])+'</p></div>').join('')+
    '<p class="tagmsg" style="margin-top:14px">AVI field pull sheet — questions to the office.</p>');
  $('sheetBody').querySelector('[data-x]').onclick=closeSheet;
}

/* ══════════════════════════════════════════════════════════════════════════════
   THE PLAN  —  green means PULLED
   The drawing is the composer's own export SVG, so every cable tag on it is the
   tag the sheet prints. Each tag text carries data-c: the space-separated ids of
   the schedule rows it stands for. An AV block prints ONE tag for however many
   cables it pulls, so a tag with two rows behind it fills HALF green when one of
   them is ticked — the highlight is a progress bar, not a flag.

   "Show what's left" inverts it: the highlight marks what is still to pull and a
   finished tag greys out. Same rects, one boolean.

   v129 · and a DIFFERENT COLOUR. Mike, 09-15: "green is already used to show wires that
   were pulled." Reading the same green two opposite ways depends entirely on noticing a
   switch at the top of the screen, which on a tablet in a hallway is not a safe bet — a
   tech glancing at the plan would see a room full of green and read it as finished. So
   what is still to pull is amber, and green never means anything but pulled.
   ══════════════════════════════════════════════════════════════════════════════ */
const PLANS = (DATA.plans||[]);
const GREEN = '#D1E8B6';           // sampled off AVI's own marked-up plots
const AMBER = '#F6C27A';           // still to pull — a warning, not an achievement
const GREY  = '#A9A49B';
let planIx = 0, planLeft = false, planBuilt = {}, inPlan = false;
let VBOX = null, VB0 = null;

const planHost = () => $('stage');
function curPlan(){ return PLANS[planIx]||null; }

function buildPlan(i){
  const p=PLANS[i]; if(!p) return null;
  if(planBuilt[i]) return planBuilt[i];
  const host=document.createElement('div');
  host.style.cssText='position:absolute;inset:0;';
  host.innerHTML=p.svg;
  const svg=host.querySelector('svg');
  svg.removeAttribute('width'); svg.removeAttribute('height');
  svg.setAttribute('preserveAspectRatio','xMidYMid meet');
  /* An SVG clips to its ELEMENT box, not to its viewBox — so with the viewBox set to the
     drawing area, the title-block strip still paints in the letterbox beside it. Clip the
     whole drawing to the view rect so "fit" really does frame the plan. */
  const NS='http://www.w3.org/2000/svg';
  const v=p.view||{x:0,y:0,w:2592,h:1728};
  const cp=document.createElementNS(NS,'clipPath'); cp.setAttribute('id','planclip'+i);
  const cr=document.createElementNS(NS,'rect');
  cr.setAttribute('x',v.x); cr.setAttribute('y',v.y);
  cr.setAttribute('width',v.w); cr.setAttribute('height',v.h);
  cp.appendChild(cr);
  const g=document.createElementNS(NS,'g'); g.setAttribute('clip-path','url(#planclip'+i+')');
  while(svg.firstChild) g.appendChild(svg.firstChild);
  svg.appendChild(cp); svg.appendChild(g);
  /* one highlight rect per tag, made once — repainting is then only width + fill */
  const tags=[];
  svg.querySelectorAll('[data-c]').forEach(t=>{
    const keys=(t.getAttribute('data-c')||'').split(/\s+/).filter(Boolean);
    if(!keys.length) return;
    tags.push({el:t, keys, rect:null, box:null});
  });
  planBuilt[i]={host, svg, tags, sized:false};
  return planBuilt[i];
}
/* getBBox only works once the SVG is in the DOCUMENT — off-document it answers 0 for
   everything, silently. So sizing is deferred to the first paint after the plan is shown,
   and it REFUSES to run on a detached plan and only records success if it actually
   measured something. Without both guards one call on a detached plan sets `sized` with
   no rects built, and that plan can never highlight again: its tags stay plain for the
   rest of the session and "Find it on the drawing" has no box to zoom to. That is exactly
   what happened when showOnPlan built every plan looking for a key. */
function sizePlan(P){
  if(!P || P.sized) return;
  if(!P.host || !P.host.isConnected) return;
  let made=0;
  for(const t of P.tags){
    let bb; try{ bb=t.el.getBBox(); }catch(e){ continue; }
    if(!bb || !bb.width) continue;
    const pad=bb.height*0.16;
    const r=document.createElementNS('http://www.w3.org/2000/svg','rect');
    r.setAttribute('y', bb.y-pad*0.7); r.setAttribute('height', bb.height+pad*1.4);
    r.setAttribute('x', bb.x-pad); r.setAttribute('rx', pad*0.6);
    r.setAttribute('fill', GREEN); r.setAttribute('width', 0);
    /* identity, so nothing has to recognise a highlight by its colour — the zoom
       flash repaints one of these amber for a moment */
    r.setAttribute('class','hl');
    r.style.pointerEvents='none';
    t.el.parentNode.insertBefore(r, t.el);
    t.el.style.cursor='pointer';
    t.rect=r; t.box={x:bb.x-pad, y:bb.y, w:bb.width+pad*2, h:bb.height};
    made++;
  }
  if(made || !P.tags.length) P.sized=true;
}
function paintPlan(){
  const P=planBuilt[planIx]; if(!P) return;
  if(!P.host || !P.host.isConnected) return;     // not on screen yet — nothing to paint
  sizePlan(P);
  let done=0, total=0;
  for(const t of P.tags){
    if(!t.rect) continue;
    const n=t.keys.length;
    const d=t.keys.filter(k=>{ const s=has(k); return s&&s.done; }).length;
    total+=n; done+=d;
    const frac = planLeft ? (1-d/n) : (d/n);
    t.rect.setAttribute('width', (t.box.w*frac).toFixed(2));
    t.rect.setAttribute('fill', planLeft ? AMBER : GREEN);
    t.el.setAttribute('fill', (planLeft && d===n) ? GREY : '#33506b');
  }
  paintMoves(P);
  $('planCt').textContent = P.tags.length
    ? (planLeft ? (total-done)+' of '+total+' cables still to pull on this sheet'
                : done+' of '+total+' cables pulled on this sheet')
    : 'No cable tags on this sheet.';
}
/* ══ v133 · the move, drawn ═══════════════════════════════════════════════════════════
   Rebuilt from scratch on every paint rather than patched in place: there are only ever a
   handful of moves on a sheet, and a redraw cannot leave a stale arrow pointing at a spot
   the tech has since changed. Everything is sized off the DEVICE's own radius, in world
   units, so it reads the same at any zoom — the same rule flashTag follows. */
const MOVE_RED='#D84048';
/* ══ WHICH SPACE IS WHICH ═════════════════════════════════════════════════════════════
   buildFloorSVG wraps the whole drawing in one group carrying
   `translate(ox,oy) scale(sc)`, so there are TWO coordinate systems in play:

     world   — what the composer stores and what `devs[]` carries (d.x, d.y)
     sheet   — the SVG's own viewBox, which is what VBOX is

   Anything drawn as a sibling of that group lands in sheet space, which on this job is
   about 59 x 35 points away from where it belongs — enough to put a ring in the middle of
   an empty room next to the device it is supposed to be circling. That is exactly what the
   first build of this did, and the gate did not catch it because it read the ring's
   attributes rather than looking at where it appeared.

   So: draw INSIDE the group, and convert through the SVG's own matrices rather than
   re-deriving the arithmetic. `getCTM()` gives world -> sheet; `getScreenCTM().inverse()`
   gives screen -> world and gets the viewBox letterboxing right for free. Both need the
   plan to be on-document, which it is whenever any of this runs. */
function gwOf(P){
  if(P._gw && P._gw.isConnected) return P._gw;
  const t=P.svg.querySelector('[data-c]');
  P._gw = (t && t.parentNode && t.parentNode!==P.svg) ? t.parentNode
        : (P.svg.querySelector('g[transform]') || P.svg);
  return P._gw;
}
/* gW's OWN transform — translate(ox,oy) scale(sc) — which is what maps world to the
   SVG's user units, i.e. to the space VBOX is expressed in. NOT getCTM(): that folds in
   the viewBox transform as well and answers in rendered viewport units, which framed the
   plan on a different room entirely the first time this was written. */
function worldToSheet(P,x,y){
  const gw=gwOf(P);
  const c=gw.transform && gw.transform.baseVal && gw.transform.baseVal.consolidate();
  if(!c) return {x,y};
  const m=c.matrix;
  return {x: m.a*x + m.c*y + m.e, y: m.b*x + m.d*y + m.f};
}
function clientToWorld(P,cx,cy){
  const gw=gwOf(P); const m=gw.getScreenCTM && gw.getScreenCTM();
  if(!m) return null;
  const i=m.inverse();
  return {x: i.a*cx + i.c*cy + i.e, y: i.b*cx + i.d*cy + i.f};
}
function paintMoves(P){
  const NS='http://www.w3.org/2000/svg';
  P.svg.querySelectorAll('.mvmark').forEach(e=>e.remove());
  const g=document.createElementNS(NS,'g'); g.setAttribute('class','mvmark');
  /* v134 · TAPPABLE, BUT ONLY WHERE THERE IS INK.
     Mike, 09-16: "can they just tap and delete it if necessary?" They could not — the whole
     group was pointer-events:none so it could never swallow a tap meant for a cable tag, and
     the side effect was that the most obvious gesture did nothing.

     The group is live now, but each piece answers only where it is actually drawn: the ring
     and the arrow shaft on their STROKE, so the ring's empty middle stays transparent and the
     device under it is still reachable; the head and the distance plate on their fill. And
     the stage's tap handler checks cable tags FIRST, so nothing that worked before stops. */
  g.style.pointerEvents='none';
  let any=false;
  const armDev = moveArm ? moveArm.devId : null;
  for(const [devId,mv] of Object.entries(MOVES())){
    const d=devIndex()[devId]; if(!d || PLANS[d.pi]!==PLANS[planIx]) continue;
    any=true;
    const sub=document.createElementNS(NS,'g');
    sub.setAttribute('class','mvone'); sub.setAttribute('data-mv',devId);
    sub.style.pointerEvents='auto';
    const el=(n,a,t)=>{ const e=document.createElementNS(NS,n);
      for(const k in a) e.setAttribute(k,a[k]); if(t) e.textContent=t;
      e.style.pointerEvents = (n==='circle'||n==='line') ? 'stroke' : 'auto';
      e.style.cursor='pointer';
      sub.appendChild(e); return e; };
    drawMoveMark(el, d, mv.px, mv.py, mv, false);
    g.appendChild(sub);
  }
  /* while armed, ring the device being moved even though nothing is placed yet. This one
     stays INERT — the next tap belongs to the destination, not to the ring. */
  if(armDev){ const d=devIndex()[armDev];
    if(d && PLANS[d.pi]===PLANS[planIx]){ any=true;
      const el=(n,a,t)=>{ const e=document.createElementNS(NS,n);
        for(const k in a) e.setAttribute(k,a[k]); if(t) e.textContent=t;
        g.appendChild(e); return e; };
      drawMoveMark(el, d, null, null, null, true); } }
  if(any) gwOf(P).appendChild(g);       // INSIDE the world group — see the note above
}
function drawMoveMark(el, d, px, py, mv, armed){
  const R=d.r*1.55;
  el('circle',{cx:d.x, cy:d.y, r:R, fill:'none', stroke:MOVE_RED,
    'stroke-width':d.r*0.20, 'stroke-dasharray': armed ? (d.r*0.5)+' '+(d.r*0.34) : 'none'});
  if(px==null) return;
  const dx=px-d.x, dy=py-d.y, L=Math.hypot(dx,dy)||1;
  const ux=dx/L, uy=dy/L;
  const sx=d.x+ux*R, sy=d.y+uy*R;
  const head=d.r*0.85;
  const ex=px-ux*head*0.9, ey=py-uy*head*0.9;
  el('line',{x1:sx,y1:sy,x2:ex,y2:ey,stroke:MOVE_RED,'stroke-width':d.r*0.20});
  const a=Math.atan2(uy,ux);
  el('path',{d:'M '+(ex-Math.cos(a-0.42)*head)+' '+(ey-Math.sin(a-0.42)*head)+
             ' L '+px+' '+py+
             ' L '+(ex-Math.cos(a+0.42)*head)+' '+(ey-Math.sin(a+0.42)*head)+' Z',
             fill:MOVE_RED});
  /* the distance, beside the head, on a white plate so it survives busy drawing */
  const txt=(feetTxt(mv&&mv.ft)||'')+(mv&&mv.brg?(' '+mv.brg):'');
  if(!txt) return;
  const fs=d.r*0.78, w=fs*(txt.length*0.58)+fs*0.8, h=fs*1.55;
  const lx=px+(ux>=0? head*0.9 : -(w+head*0.9)), ly=py-h/2;
  el('rect',{x:lx,y:ly,width:w,height:h,rx:fs*0.34,fill:'#ffffff',
    stroke:MOVE_RED,'stroke-width':d.r*0.08});
  el('text',{x:lx+fs*0.4, y:py+fs*0.38, 'font-family':'Arial,sans-serif',
    'font-size':fs, 'font-weight':'bold', fill:MOVE_RED}, txt);
}
function fitPlan(){
  const p=curPlan(); if(!p) return;
  const v=p.view||{x:0,y:0,w:2592,h:1728};
  VBOX={x:v.x,y:v.y,w:v.w,h:v.h}; VB0={...VBOX}; applyVB();
}
function applyVB(){
  const P=planBuilt[planIx]; if(!P||!VBOX) return;
  P.svg.setAttribute('viewBox', `${VBOX.x} ${VBOX.y} ${VBOX.w} ${VBOX.h}`);
}
/* ══ v136 · WHY THE PLAN WAS SLUGGISH ════════════════════════════════════════════════
   First feedback off a real tablet, 09-16: "the DLF on the tablet is really sluggish to
   move around."

   Changing an SVG's `viewBox` re-rasterises the whole drawing. These plans are only ~600
   nodes but 500–800 KB of path data — the architect's background arrives as a handful of
   enormous paths — so every frame of a pan was a full re-render of all of it. Measured in
   Chromium with the CPU throttled to roughly tablet speed:

       CPU x1   viewBox 60 fps    transform 60 fps
       CPU x4   viewBox 52 fps    transform 60 fps
       CPU x8   viewBox 37 fps    transform 59 fps

   And that understates it: the real handler ran on every `pointermove`, which on a
   ProMotion iPad fires at 120 Hz — up to twice the re-renders per second of the bench.

   So during a gesture the drawing is not re-rendered at all. The SVG keeps the viewBox it
   had when the finger went down, and the pan/pinch is expressed as a CSS transform, which
   the compositor applies to an already-rasterised layer. On release the transform is
   cleared and the viewBox is set ONCE. One re-render per gesture instead of per frame.

   The transform is exact, not an approximation. For a world point X rendered under viewBox
   v0 at scale s0 with letterbox ox0, and wanted under v1:
       a  = s1/s0
       tx = ox1 - a*ox0 + (v0.x - v1.x)*s1
   Aspect is preserved throughout a gesture (pan changes neither w nor h; pinch scales both
   by the same k), so a single translate+scale reproduces the target viewBox exactly. */
/* The committed viewBox this gesture is measured from. It CANNOT come from the pointer
   handler's own `start` — that lives inside initStage's closure, and gestureShow is called
   from a requestAnimationFrame at module scope. Reaching for it there threw a ReferenceError
   on every frame, which looked like a working pan (the view still jumped into place on
   release) and was really a plan that did not move at all while the finger was down. */
let gBase=null;
function gestureShow(){
  const P=planBuilt[planIx]; if(!P||!gBase||!VBOX) return;
  const r=planHost().getBoundingClientRect();
  const v0=gBase, v1=VBOX;
  const s0=Math.min(r.width/v0.w, r.height/v0.h);
  const s1=Math.min(r.width/v1.w, r.height/v1.h);
  if(!(s0>0)||!(s1>0)) return;
  const a=s1/s0;
  const ox0=(r.width-v0.w*s0)/2, oy0=(r.height-v0.h*s0)/2;
  const ox1=(r.width-v1.w*s1)/2, oy1=(r.height-v1.h*s1)/2;
  const tx=ox1-a*ox0+(v0.x-v1.x)*s1;
  const ty=oy1-a*oy0+(v0.y-v1.y)*s1;
  /* on the HOST DIV, not on the <svg>. Transforming the SVG element itself still makes the
     engine re-rasterise its vector content — measured at 38 fps against the viewBox path's
     37, i.e. no gain at all. The wrapper is a plain box the compositor can move as a
     finished layer: 59 fps on the same drawing. */
  const h=P.host;
  h.style.transformOrigin='0 0';
  h.style.transform='translate('+tx.toFixed(2)+'px,'+ty.toFixed(2)+'px) scale('+a.toFixed(5)+')';
}
/* Put the drawing back in charge of its own coordinates. MUST run before anything reads
   getScreenCTM — a leftover CSS transform is folded into that matrix, and a tap would be
   converted through it twice. */
function commitGesture(){
  const P=planBuilt[planIx]; if(!P) return;
  if(vbRaf){ cancelAnimationFrame(vbRaf); vbRaf=null; }
  if(P.host.style.transform){ P.host.style.transform=''; P.host.style.transformOrigin=''; }
  P.host.style.willChange='';
  gBase=null;
  applyVB();
}
let vbRaf=null;
function queueGesture(){
  if(vbRaf) return;                       /* coalesce 120 Hz of pointermove into one frame */
  vbRaf=requestAnimationFrame(()=>{ vbRaf=null; gestureShow(); });
}
function showPlan(i){
  if(!PLANS.length) return;
  planIx=Math.max(0,Math.min(PLANS.length-1,i));
  const P=buildPlan(planIx);
  const stage=planHost();
  [...stage.children].forEach(c=>{ if(c.dataset&&c.dataset.planhost) c.remove(); });
  P.host.dataset.planhost='1';
  stage.insertBefore(P.host, stage.firstChild);
  fitPlan(); paintPlan(); paintTabs();
}
function paintTabs(){
  $('fTabs').innerHTML = PLANS.map((p,i)=>
    '<button class="ftab'+(i===planIx?' on':'')+'" data-p="'+i+'">'+
    esc(p.name)+(p.sheetNo?(' · '+esc(p.sheetNo)):'')+'</button>').join('');
  $('fTabs').querySelectorAll('[data-p]').forEach(b=>
    b.onclick=()=>showPlan(parseInt(b.dataset.p,10)));
}
function setView(plan){
  inPlan=!!plan;
  $('planWrap').classList.toggle('on', inPlan);
  $('btnView').textContent = inPlan ? '≣ List' : '▦ Plan';
  $('btnAdd').style.display = inPlan ? 'none' : '';
  document.body.style.overflow = inPlan ? 'hidden' : '';
  if(inPlan){ if(!planBuilt[planIx]) showPlan(planIx); else { paintPlan(); paintTabs(); }
    setTimeout(()=>$('planHint').style.opacity=0, 4000); }
}
/* ---- pan + pinch on the viewBox ---- */
function initStage(){
  const st=$('stage');
  const pts=new Map(); let start=null;
  const toWorld=(cx,cy)=>{ const r=st.getBoundingClientRect();
    const P=planBuilt[planIx]; if(!P||!VBOX) return {x:0,y:0};
    /* preserveAspectRatio=meet: the viewBox is letterboxed inside the stage */
    const s=Math.min(r.width/VBOX.w, r.height/VBOX.h);
    const ox=(r.width - VBOX.w*s)/2, oy=(r.height - VBOX.h*s)/2;
    return {x: VBOX.x + (cx-r.left-ox)/s, y: VBOX.y + (cy-r.top-oy)/s, s};
  };
  st.addEventListener('pointerdown',e=>{
    if(e.target.closest('.zoomc')) return;
    /* v129: capture is a nicety — it keeps a drag alive if the finger leaves the stage.
       It throws if the pointer is already gone, and an uncaught throw HERE abandons the
       rest of the handler, so `start` never gets set and the tap and the pan both die.
       Never let a nicety take the interaction down with it. */
    try{ st.setPointerCapture(e.pointerId); }catch(_){}
    /* v136: a second finger landing mid-gesture would otherwise take its baseline from a
       VBOX the drawing has not been given yet. Commit first, then measure from the truth. */
    if(start) commitGesture();
    gBase={...VBOX};                              /* the view the drawing is actually showing */
    const P0=planBuilt[planIx];
    if(P0) P0.host.style.willChange='transform';  /* ask for a composited layer up front */
    pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
    start={vb:{...VBOX}, pts:new Map(pts), moved:0, multi:pts.size>1,   /* Field 0.3: a second finger is never a tap */
           tag:e.target.hasAttribute&&e.target.hasAttribute('data-c')?e.target:null,
           /* v134: which saved move, if any, this press landed on */
           mv:(e.target.closest&&e.target.closest('.mvone'))||null};
  });
  st.addEventListener('pointermove',e=>{
    if(!pts.has(e.pointerId)||!start||!VBOX) return;
    const prev=pts.get(e.pointerId);
    start.moved += Math.abs(e.clientX-prev.x)+Math.abs(e.clientY-prev.y);
    pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
    const r=st.getBoundingClientRect();
    const ids=[...pts.keys()];
    if(ids.length>=2){
      const a=pts.get(ids[0]), b=pts.get(ids[1]);
      const a0=start.pts.get(ids[0]), b0=start.pts.get(ids[1]);
      if(!a0||!b0) return;
      const d0=Math.hypot(b0.x-a0.x,b0.y-a0.y)||1, d1=Math.hypot(b.x-a.x,b.y-a.y)||1;
      const k=Math.max(0.15, Math.min(14, d0/d1));
      /* AVI Field 0.3 · PINCH THAT STAYS UNDER THE FINGERS. The old pinch re-picked its anchor
         from wherever the fingers' midpoint was NOW, against the view from when they landed:
         as the hand drifted the anchor slid, so the drawing swam and could not be panned
         while zooming. Now the drawing point under the midpoint at touch-down is held, and
         carried to wherever the midpoint goes: zoom and pan together, like a photo. */
      start.multi=true;
      const m0x=(a0.x+b0.x)/2, m0y=(a0.y+b0.y)/2;
      const cx=(a.x+b.x)/2, cy=(a.y+b.y)/2;
      const s0=Math.min(r.width/start.vb.w, r.height/start.vb.h);
      const ox=(r.width-start.vb.w*s0)/2, oy=(r.height-start.vb.h*s0)/2;
      const wx=start.vb.x+(m0x-r.left-ox)/s0, wy=start.vb.y+(m0y-r.top-oy)/s0;
      const nw=start.vb.w*k, nh=start.vb.h*k, s1=Math.min(r.width/nw, r.height/nh);
      const ox1=(r.width-nw*s1)/2, oy1=(r.height-nh*s1)/2;
      VBOX={x: wx-(cx-r.left-ox1)/s1, y: wy-(cy-r.top-oy1)/s1, w:nw, h:nh};
    } else {
      const s=Math.min(r.width/start.vb.w, r.height/start.vb.h);
      const p0=start.pts.get(e.pointerId);
      VBOX={x:start.vb.x-(e.clientX-p0.x)/s, y:start.vb.y-(e.clientY-p0.y)/s,
            w:start.vb.w, h:start.vb.h};
    }
    queueGesture();          /* v136: compositor, once a frame — not a full re-render */
  });
  const up=e=>{
    /* v136: hand the drawing its real coordinates back BEFORE anything below reads them.
       clientToWorld goes through getScreenCTM, which folds in a CSS transform still on the
       element — leave it and a tap that ends a pan lands the arrow somewhere else entirely. */
    commitGesture();
    /* AVI Field 0.3: lifting ONE finger of a pinch used to leave the other finger measured from
       where the pinch began, so the drawing jumped the moment it moved. Start a fresh one-finger
       pan from exactly where the drawing is now, and never treat the end of a pinch as a tap. */
    if(pts.size>1 && pts.has(e.pointerId)){
      pts.delete(e.pointerId);
      start={vb:{...VBOX}, pts:new Map(pts), moved:99, multi:true, tag:null, mv:null};
      gBase={...VBOX};
      return;
    }
    if(start && start.multi){ pts.delete(e.pointerId); if(!pts.size) start=null; return; }
    /* v133: while a move is armed the same tap-not-drag test lands the device instead of
       opening a row. It is checked FIRST so a destination that happens to sit on top of
       another cable's tag still works — a speaker often moves to where the next one is. */
    if(moveArm && start && start.moved<8 && !e.target.closest('.zoomc')){
      /* through the SVG's own matrix — the hand-rolled version would answer in sheet
         space and land the arrow tens of points from the finger */
      const P=planBuilt[planIx];
      const w=P && clientToWorld(P, e.clientX, e.clientY);
      if(w) dropMove(w.x, w.y);
      pts.delete(e.pointerId); if(!pts.size) start=null; return;
    }
    /* cable tags first, so nothing that worked before this version stops working */
    if(start && start.tag && start.moved<8) tapTag(start.tag);
    else if(start && start.mv && start.moved<8) openMoveSheet(start.mv.getAttribute('data-mv'));
    /* DLF v213: a tap on a symbol (not a tag) opens that device — only when the office sent spec sheets */
    else if(start && start.moved<8 && pts.size<=1 && typeof tapDevice==='function') tapDevice(e.clientX, e.clientY);
    pts.delete(e.pointerId); if(!pts.size) start=null;
  };
  st.addEventListener('pointerup',up); st.addEventListener('pointercancel',up);
  st.addEventListener('wheel',e=>{ if(!VBOX) return; e.preventDefault();
    const k=e.deltaY>0?1.12:0.89; const r=st.getBoundingClientRect();
    const s=Math.min(r.width/VBOX.w, r.height/VBOX.h);
    const ox=(r.width-VBOX.w*s)/2, oy=(r.height-VBOX.h*s)/2;
    const wx=VBOX.x+(e.clientX-r.left-ox)/s, wy=VBOX.y+(e.clientY-r.top-oy)/s;
    VBOX={x:wx-(wx-VBOX.x)*k, y:wy-(wy-VBOX.y)*k, w:VBOX.w*k, h:VBOX.h*k};
    applyVB(); },{passive:false});
  const zoom=k=>{ if(!VBOX) return; const cx=VBOX.x+VBOX.w/2, cy=VBOX.y+VBOX.h/2;
    VBOX={x:cx-VBOX.w*k/2, y:cy-VBOX.h*k/2, w:VBOX.w*k, h:VBOX.h*k}; applyVB(); };
  $('zIn').onclick=()=>zoom(0.7); $('zOut').onclick=()=>zoom(1.42); $('zFit').onclick=fitPlan;
}
/* tapping a tag on the plan takes you to its rows in the list */
function tapTag(el){
  const keys=(el.getAttribute('data-c')||'').split(/\s+/).filter(Boolean);
  const mine=allRows().filter(r=>keys.includes(r.id));
  if(!mine.length){ toast('That tag has no rows on this sheet'); return; }
  if(mine.length===1){ openRow(mine[0].id); return; }
  openSheet('<div class="sh"><h2>'+esc((el.textContent||'').trim())+'</h2>'+
    '<button class="x" data-x>✕</button></div>'+
    '<p class="tagmsg">This tag pulls '+mine.length+' cables. Pick the one you mean.</p>'+
    '<div class="menu">'+mine.map(r=>{ const s=has(r.id)||{};
      return '<button data-go="'+esc(r.id)+'">'+(s.done?'✓ ':'')+esc(r.label||r.type)+
        '<small>'+esc(r.device||'')+(r.length?(' · '+esc(r.length)+" ft est"):'')+'</small></button>'; }).join('')+
    '</div>');
  const sb=$('sheetBody');
  sb.querySelector('[data-x]').onclick=closeSheet;
  sb.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>openRow(b.dataset.go));
}
/* Which plan holds a cable — read off the SVG TEXT, once. Building the plans to look is
   what poisoned sizePlan above, and it is also needless work: the keys are in the markup
   already. Exact token match, so `…::1` never matches `…::10`. */
let keyPlanIx=null;
function planIxOfKey(id){
  if(!keyPlanIx){
    keyPlanIx={};
    PLANS.forEach((p,i)=>{
      const re=/data-c="([^"]*)"/g; let m;
      while((m=re.exec(p.svg||''))){
        for(const k of m[1].split(/\s+/)) if(k && !(k in keyPlanIx)) keyPlanIx[k]=i;
      }
    });
  }
  return (id in keyPlanIx) ? keyPlanIx[id] : -1;
}
/* and the reverse: find this cable on the drawing */
function showOnPlan(id){
  const ix=planIxOfKey(id);
  if(ix<0){ toast('This cable is not on a plan in this file'); return; }
  closeSheet();
  planIx=ix;                 // before setView, so it cannot mount a different sheet first
  setView(true);
  showPlan(ix);              // mounts, fits, paints — sizing happens here, on-document
  const P=planBuilt[ix]; sizePlan(P);
  const t=P.tags.find(t=>t.keys.includes(id));
  if(t&&t.box){ const z=Math.max(70, t.box.w*7);
    VBOX={x:t.box.x+t.box.w/2-z/2, y:t.box.y+t.box.h/2-z*0.32, w:z, h:z*0.62};
    applyVB();
    flashTag(t);
  }
}
/* ══ v129 · AND BACK AGAIN ═══════════════════════════════════════════════════════════
   The trip from the list to the drawing existed; the return trip did not. Tapping a tag
   on the plan opened its row, but the row opened OVER the plan, so a tech who wanted the
   list around it — the room, what else is in it, what is left — had to go back and hunt.

   Two things can hide a row once we get there, and both are silent failures: a filter or
   search that excludes it, and a shut room. So this checks whether the row is actually on
   the list first, clears what is in the way, and SAYS so — landing on an empty list with
   no explanation is worse than not offering the button. */
function showInList(id){
  const r=allRows().find(x=>x.id===id); if(!r) return;
  closeSheet();
  let cleared=false;
  if(!visible().some(x=>x.id===id)){
    V={view:'all', floor:'', disc:'', type:'', q:''};
    $('fQ').value=''; $('fFloor').value=''; $('fDisc').value=''; $('fType').value='';
    [...$('segView').children].forEach(x=>x.setAttribute('aria-pressed', x.dataset.v==='all'));
    cleared=true;
  }
  const k=grpKey(r), c=collapsed();
  if(c[k]){ delete c[k]; save(); }
  setView(false);
  paintFilters(); paintList();
  const el=$('list').querySelector('[data-id="'+String(id).replace(/"/g,'\\"')+'"]');
  if(el){
    el.scrollIntoView({block:'center', behavior:'smooth'});
    el.classList.add('found');
    setTimeout(()=>{ try{ el.classList.remove('found'); }catch(_){} }, 2100);
  }
  if(cleared) toast('Filters cleared so it would show');
}
/* ══ v133 · ARMING A MOVE ════════════════════════════════════════════════════════════
   Take the tech to the device on the drawing, ring it, and wait for ONE tap. The tap is
   read by the stage's existing pointer handler, which already distinguishes a tap from a
   drag by distance — so panning and pinching keep working while the move is armed, and a
   tech who needs to scroll the plan to find the spot can. */
let moveArm=null;                                    // {rowId, devId}
/* Removing a move is as undoable as making one — a tech who taps the wrong mark should not
   have to re-measure the whole thing to get it back. */
function clearMove(rowId){
  const key=devIdOf(rowId);
  const was=MOVES()[key] ? JSON.parse(JSON.stringify(MOVES()[key])) : null;
  if(!was) return;
  delete MOVES()[key]; save(); closeSheet(); paintList(); paintPlan();
  toast('Move removed', {label:'Undo', fn:()=>{ MOVES()[key]=was;
    save(); paintList(); paintPlan(); toast('Move put back'); }});
}
function armMove(rowId){
  const d=devPt(rowId);
  if(!d){ toast('This device is not on a plan in this file'); return; }
  closeSheet();
  moveArm={rowId, devId:devIdOf(rowId)};
  planIx=d.pi;
  setView(true);
  showPlan(d.pi);
  /* frame the device with room around it — the destination is usually just off it.
     VBOX is the viewBox, i.e. SHEET space, so the device's world point is converted. */
  const P=planBuilt[planIx];
  const c=P ? worldToSheet(P, d.x, d.y) : {x:d.x, y:d.y};
  const z=Math.max(220, d.r*26);
  VBOX={x:c.x-z/2, y:c.y-z*0.31, w:z, h:z*0.62};
  applyVB(); paintPlan();
  $('moveBar').classList.add('on');
  $('planHint').style.opacity=0;
}
function cancelMove(){
  moveArm=null; $('moveBar').classList.remove('on'); paintPlan();
}
/* the tap that lands the device */
function dropMove(wx,wy){
  const arm=moveArm; if(!arm) return;
  const d=devPt(arm.rowId); if(!d) { cancelMove(); return; }
  const p=PLANS[d.pi]||{};
  const fpp=+p.fpp||0;
  const dx=wx-d.x, dy=wy-d.y;
  const ft=fpp>0 ? Math.hypot(dx,dy)*fpp : 0;
  if(Math.hypot(dx,dy) < d.r*0.8){
    toast('Tap a bit further from the device'); return;
  }
  moveArm=null; $('moveBar').classList.remove('on');
  confirmMove(arm.rowId, {px:+wx.toFixed(2), py:+wy.toFixed(2), ft:+ft.toFixed(2),
                          brg:bearingTxt(dx,dy), planId:p.id||''});
}
/* v134: tapping the mark on the drawing. Everything a tech might want to do with a move
   they are looking at, without having to work out which cable tag it belongs to first. */
function openMoveSheet(devId){
  const mv=MOVES()[devId]; if(!mv) return;
  const rows=allRows().filter(r=>devIdOf(r.id)===devId);
  const r=rows[0]||{};
  openSheet('<div class="sh"><h2>◎ '+esc(r.tag||'This device')+'</h2>'+
    '<button class="x" data-x>✕</button></div>'+
    '<div class="banner" style="background:#FBE3DE;color:#D84048;border-color:#F1BDB4">'+
      'Marked to move <b>'+esc(feetTxt(mv.ft)||'—')+' '+esc(mv.brg||'')+'</b>'+
      (mv.by?(' by '+esc(mv.by)):'')+(mv.ts?(' · '+esc(mv.ts)):'')+'</div>'+
    '<dl class="facts"><dt>Device</dt><dd>'+
      esc([r.manuf,r.device].filter(Boolean).join(' ')||'—')+'</dd>'+
      '<dt>Room</dt><dd>'+esc((r.fromRoom||'').toUpperCase())+' <span class="m">'+
      esc(r.fromNo||'')+'</span></dd>'+
      '<dt>Affects</dt><dd>'+rows.length+' cable'+(rows.length===1?'':'s')+'</dd>'+
      (mv.why&&mv.why.length?'<dt>Why</dt><dd>'+esc(mv.why.map(k=>FLAGT[k]||k).join(', '))+'</dd>':'')+
    '</dl>'+
    (mv.note?'<p class="lbl">Note for the office</p><div class="note">'+esc(mv.note)+'</div>':'')+
    '<button class="btn ghost" style="margin-top:12px" data-mvredo>Move it somewhere else</button>'+
    '<button class="btn ghost" style="margin-top:10px" data-mvclear>Not moving after all</button>'+
    '<button class="btn ghost" style="margin-top:10px" data-mvrow>≡ Open the cable row</button>');
  const sb=$('sheetBody');
  sb.querySelector('[data-x]').onclick=closeSheet;
  sb.querySelector('[data-mvredo]').onclick=()=>armMove(r.id);
  sb.querySelector('[data-mvclear]').onclick=()=>clearMove(r.id);
  sb.querySelector('[data-mvrow]').onclick=()=>openRow(r.id);
}
/* Why it moved, in the same words the rest of the sheet uses — so a move lands in the
   report as a red-line with a reason, not as a bare distance. */
function confirmMove(rowId, mv){
  const r=allRows().find(x=>x.id===rowId)||{};
  const prev=moveOf(rowId)||{};
  openSheet('<div class="sh"><h2>◎ Moving '+esc(r.tag||'this device')+'</h2>'+
    '<button class="x" data-x>✕</button></div>'+
    '<div class="banner" style="background:#FBE3DE;color:#D84048;border-color:#F1BDB4">'+
      '<b>'+esc(feetTxt(mv.ft)||'—')+' '+esc(mv.brg)+'</b> from where the drawing has it. '+
      'This goes back to engineering as a red-line.</div>'+
    '<dl class="facts"><dt>Device</dt><dd>'+
      esc([r.manuf,r.device].filter(Boolean).join(' ')||'—')+'</dd>'+
      '<dt>Room</dt><dd>'+esc((r.fromRoom||'').toUpperCase())+' <span class="m">'+
      esc(r.fromNo||'')+'</span></dd></dl>'+
    '<p class="lbl">Why?</p><div class="chips">'+
      FLAGS.map(f=>'<button class="chip" data-mwhy="'+f.k+'" aria-pressed="'+
        ((prev.why||['moved']).includes(f.k))+'">'+f.t+'</button>').join('')+
    '</div>'+
    '<p class="lbl">Note for the office</p>'+
    '<textarea id="mvNote" placeholder="e.g. Joist in the way — landed it between the next pair.">'+
      esc(prev.note||'')+'</textarea>'+
    '<p class="lbl">Your initials</p><input id="mvBy" value="'+esc(S.tech||'')+'" placeholder="e.g. RJ">'+
    '<button class="btn" data-mvsave>Save the move</button>'+
    '<button class="btn ghost" style="margin-top:10px" data-mvagain>Pick a different spot</button>');
  const sb=$('sheetBody');
  const why=new Set(prev.why&&prev.why.length?prev.why:['moved']);
  sb.querySelector('[data-x]').onclick=()=>{ closeSheet(); paintPlan(); };
  sb.querySelectorAll('[data-mwhy]').forEach(b=>b.onclick=()=>{
    const k=b.dataset.mwhy; if(why.has(k)) why.delete(k); else why.add(k);
    b.setAttribute('aria-pressed', why.has(k)); });
  sb.querySelector('[data-mvagain]').onclick=()=>{ closeSheet(); armMove(rowId); };
  sb.querySelector('[data-mvsave]').onclick=()=>{
    const by=($('mvBy').value||'').trim(); if(by) S.tech=by;
    const key=devIdOf(rowId);
    const was=MOVES()[key] ? JSON.parse(JSON.stringify(MOVES()[key])) : null;
    MOVES()[key]={...mv, why:[...why], note:$('mvNote').value||'',
      by:by||S.tech||'', ts:stamp(), mts:Date.now()};
    save(); closeSheet(); paintList(); paintPlan();
    toast('Move saved — the office is told',
      {label:'Undo', fn:()=>{ if(was) MOVES()[key]=was; else delete MOVES()[key];
        save(); paintList(); paintPlan();
        toast(was?'Put back as it was':'Move undone'); }});
  };
}
/* A ring around the tag, sized in WORLD units off the tag's own box so it reads the same
   at any zoom, pulsed twice and then taken away. Nothing else on the plan is touched. */
function flashTag(t){
  if(!t||!t.box) return;
  const P=planBuilt[planIx]; if(!P) return;
  const NS='http://www.w3.org/2000/svg';
  P.svg.querySelectorAll('.findmark').forEach(e=>e.remove());   // only ever one
  const pad=t.box.h*0.55, w=t.box.h*0.30;
  const r=document.createElementNS(NS,'rect');
  r.setAttribute('class','findmark');
  r.setAttribute('x', t.box.x-pad);        r.setAttribute('y', t.box.y-pad*0.8);
  r.setAttribute('width', t.box.w+pad*2);  r.setAttribute('height', t.box.h+pad*1.6);
  r.setAttribute('rx', pad*0.7);
  r.style.setProperty('--fw1', w.toFixed(3));
  r.style.setProperty('--fw2', (w*0.5).toFixed(3));
  r.style.setProperty('--fw3', (w*3.2).toFixed(3));
  r.setAttribute('stroke-width', w.toFixed(3));
  t.el.parentNode.appendChild(r);
  setTimeout(()=>{ try{ r.remove(); }catch(_){} }, 2100);
}
function planHelp(){
  openSheet('<div class="sh"><h2 style="font-family:var(--sans)">The plan</h2>'+
    '<button class="x" data-x>✕</button></div>'+
    '<div class="help-b"><h4>Green means pulled</h4><p>A cable tag fills in green as you tick '+
      'it off on the list — the same mark your crew makes by hand, made for you. One tag can '+
      'cover more than one cable, so it fills half way when half of them are done.</p></div>'+
    '<div class="help-b"><h4>Show what’s left</h4><p>Flip the switch and it reads the other '+
      'way round: <b>orange</b> is what is still to pull, and a finished tag goes grey. '+
      'Green only ever means pulled.</p></div>'+
    '<div class="help-b"><h4>Moving around</h4><p>Drag to move, pinch to zoom, ➕ ➖ and '+
      '⤡ at the bottom right. Tap a cable tag to open it, and <b>≡ Show it on the list</b> '+
      'at the bottom of that to jump to it in the list.</p></div>'+
    '<div class="help-b"><h4>A move you marked</h4><p>The red ring and arrow are a device you '+
      'marked to move. <b>Tap the ring or the arrow</b> to open it — you can send it somewhere '+
      'else, or clear it. Right after you save or clear one, the black bar at the bottom offers '+
      '<b>Undo</b> for a few seconds.</p></div>'+
    '<div class="help-b"><h4>This is a copy</h4><p>Marking the plan changes nothing on the real '+
      'drawing. The office updates that from what you send back.</p></div>');
  $('sheetBody').querySelector('[data-x]').onclick=closeSheet;
}

/* ---------- events ---------- */
$('list').addEventListener('click',e=>{
  const gh=e.target.closest('.gh');
  if(gh){ const k=gh.dataset.grp; const c=collapsed(); c[k]=!c[k]; save(); paintList(); return; }
  const btn=e.target.closest('[data-act]'); if(!btn) return;
  const id=btn.closest('.row').dataset.id;
  if(btn.dataset.act==='tick'){
    const s=touchTs(st(id)); s.done=!s.done; s.ts=s.done?stamp():null; if(s.done&&S.tech) s.by=S.tech;
    save(); paintList(); paintPlan();
    if(navigator.vibrate) navigator.vibrate(s.done?18:0);
  } else openRow(id);
});
$('segView').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b) return;
  V.view=b.dataset.v; [...$('segView').children].forEach(x=>x.setAttribute('aria-pressed',x===b)); paintList(); });
$('fFloor').onchange=e=>{V.floor=e.target.value;paintList();};
$('fDisc').onchange=e=>{V.disc=e.target.value;paintList();};
$('fType').onchange=e=>{V.type=e.target.value;paintList();};
$('fQ').oninput=e=>{V.q=e.target.value;paintList();};
$('btnExpand').onclick=()=>{ setAllGroups(false); window.scrollTo({top:0}); };
$('btnCollapse').onclick=()=>{ setAllGroups(true); window.scrollTo({top:0}); };
$('btnAdd').onclick=openAdd;
$('btnMenu').onclick=openMenu;
$('btnHelp').onclick=openHelp;
$('btnPlanHelp').onclick=planHelp;
$('mvCancel').onclick=cancelMove;
/* leaving the plan with a move armed would strand the red bar on a screen that no longer
   has a drawing under it */
$('btnView').onclick=()=>{ if(moveArm) cancelMove(); setView(!inPlan); };
$('swLeft').onchange=e=>{ planLeft=e.target.checked; paintPlan(); };
$('btnTheme').onclick=()=>{ const h=document.documentElement;
  const t=h.getAttribute('data-theme')==='dark'?'light':'dark'; h.setAttribute('data-theme',t);
  try{localStorage.setItem(KEY+'_theme',t);}catch(e){} };
document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&sheetOn) closeSheet(); });

/* ---------- boot ---------- */
load();
try{ const t=localStorage.getItem(KEY+'_theme'); if(t) document.documentElement.setAttribute('data-theme',t); }catch(e){}
paintWarn(); paintFilters(); paintList();
/* Every load inside a host app is another chance to lose the day, so this is not
   remembered and not suppressed — it stops the moment the sheet is opened properly. */
if(HOSTSURE) setTimeout(openHostFix, 500);
if(PLANS.length){ initStage(); $('btnView').classList.add('show'); paintTabs(); }


/* ═════════════════════════════════════════════════════════════════════════════════════════
   DLF v179 · THE PANEL VIEW
   Mike, 09-30-26: the techs build Frameworks panels on site. When the office has laid the
   panel out, it arrives here filled in — every plate, every port, every cable; when it has
   not, the same view is a blank template and the tech builds it as he goes. Either way he
   ticks each port TERMINATED and TESTED, and anything he changes from the office's layout
   (a different plate, a cable on a different port) goes back as a red-line.
   The cable tag never changes; a port is <position>.<nn> (LS1.03) and is stored against the
   same row id the list uses. State is S.panels[panelId] = {plates, ports, tk}, every entry
   stamped, so two tablets merge port by port.
   ═════════════════════════════════════════════════════════════════════════════════════════ */
const PANELS = Array.isArray(DATA.panels) ? DATA.panels : [];
const FWP = DATA.fwPlates || {};
let pnIx = 0, inPanel = false;
function pnS(P){ S.panels=S.panels||{}; return S.panels[P.id]||(S.panels[P.id]={plates:{},ports:{},tk:{}}); }
function pnStamp(){ return {mts:Date.now(), by:(S.tech||'').trim()}; }
function rowClass(r){
  const t=String((r&&r.type)||'').toUpperCase().replace(/\s+/g,'');
  if(t==='CAT6A') return 'C6A'; if(t==='CAT6') return 'C6';
  if(/^F\d+C$/.test(t)) return 'FBR'; if(t==='14/4') return 'DA8'; if(t==='16/2') return 'TB2';
  return '';
}
function rowNeed(r){ const t=String((r&&r.type)||'').toUpperCase().replace(/\s+/g,''); const f=t.match(/^F(\d+)C$/); return f?Math.max(1,Math.ceil(+f[1]/2)):1; }
function effPlate(P,pos){ const e=(pnS(P).plates||{})[pos]; return e ? (e.v||'') : ((P.plates||{})[pos]||''); }
function platePorts(pt,pos){ const cap=(FWP[pt]||{}).cap||{}; const out=[]; let i=1;
  Object.keys(cap).forEach(k=>{ for(let j=0;j<cap[k];j++,i++) out.push({port:pos+'.'+String(i).padStart(2,'0'), k, pos}); }); return out; }
function allPorts(P){ return P.positions.flatMap(pos=>platePorts(effPlate(P,pos),pos)); }
const ROWBY = ()=>{ const m={}; allRows().forEach(r=>{ m[r.id]=r; }); return m; };
/* the port -> row map as it stands on this tablet: the office's, overridden port by port,
   and only where the cable's class still fits the plate that is actually there now */
function pnMap(P, rb){
  rb=rb||ROWBY(); const out={}; const ov=pnS(P).ports||{};
  allPorts(P).forEach(pp=>{ const e=ov[pp.port]; const rid=e?(e.v||''):((P.ports||{})[pp.port]||'');
    const r=rb[rid]; if(r && rowClass(r)===pp.k) out[pp.port]=rid; });
  return out;
}
function officePortOf(P,rid){ const o=P.ports||{}; return Object.keys(o).filter(k=>o[k]===rid).sort()[0]||''; }
function tkOf(P,port){ return (pnS(P).tk||{})[port]||{}; }
function pnName(P){ return (P.name||'Panel')+(P.room?(' · '+P.room):''); }
/* where a row landed, across every panel (for the list and the report) */
function panelInfoOf(rid){
  for(const P of PANELS){ const mp=pnMap(P); const ports=Object.keys(mp).filter(k=>mp[k]===rid).sort();
    const off=officePortOf(P,rid);
    if(ports.length || off){ const tk=ports.map(p=>tkOf(P,p));
      const term=ports.length&&tk.every(x=>x.term), test=ports.length&&tk.every(x=>x.test);
      const moved=(ports[0]||'')!==off;
      return {P, port:ports.join(' + '), office:off, term, test, moved, touched:moved||tk.some(x=>x.term||x.test)}; } }
  return null;
}
function pnStats(P){ const mp=pnMap(P); const ports=Object.keys(mp);
  return {n:ports.length, term:ports.filter(p=>tkOf(P,p).term).length, test:ports.filter(p=>tkOf(P,p).test).length}; }
function paintPanel(){
  if(!PANELS.length) return;
  const P=PANELS[pnIx]; const rb=ROWBY(); const mp=pnMap(P,rb); const st=pnStats(P);
  $('pnTitle').textContent=pnName(P)+' — '+(P.frameName||'');
  const laidOut=P.positions.some(p=>(P.plates||{})[p]);
  $('pnStat').textContent=(laidOut?'Laid out by the office':'No layout from the office — build it as you go')+
    ' · '+st.n+' on a port · '+st.term+' terminated · '+st.test+' tested';
  $('pnTabs').innerHTML=PANELS.length>1?PANELS.map((Q,i)=>'<button class="chip" data-pn="'+i+'" aria-pressed="'+(i===pnIx)+'">'+esc(Q.name||('Panel '+(i+1)))+'</button>').join(''):'';
  $('pnTabs').querySelectorAll('[data-pn]').forEach(b=>b.onclick=()=>{ pnIx=+b.dataset.pn; paintPanel(); });
  let h='';
  for(let d=0; d<P.nPanels; d++){
    h+='<div class="dpan">';
    for(let i=0;i<P.perSide;i++){
      const n=d*P.perSide+i+1;
      ['LS','RS'].forEach(sd=>{ const pos=sd+n, pt=effPlate(P,pos), off=(P.plates||{})[pos]||'';
        const chg=laidOut && !!(pnS(P).plates||{})[pos] && pt!==off;   /* a blank template has nothing to change FROM */
        const pp=platePorts(pt,pos);
        h+='<button class="plate'+(pt?'':' empty')+(chg?' chg':'')+'" data-pos="'+pos+'"><div class="ph"><span>'+pos+'</span><span class="pt">'+
          (pt?esc(pt==='BNK'?'blank':pt):'tap to set')+'</span></div>'+
          (pp.length?'<div class="pdots">'+pp.map(x=>{ const tk=tkOf(P,x.port); const a=!!mp[x.port];
            return '<div class="pdot'+(tk.test?' x':tk.term?' t':a?' a':'')+'">'+(+x.port.slice(-2))+'</div>'; }).join('')+'</div>':'')+
          (chg?'<div class="pt" style="color:var(--warn);margin-top:4px">changed from '+esc(off||'empty')+'</div>':'')+'</button>'; });
    }
    h+='</div>';
  }
  /* the cables the office sent here that have no port yet */
  const used={}; Object.values(mp).forEach(r=>{ used[r]=(used[r]||0)+1; });
  const left=(P.land||[]).map(x=>rb[x.rid]).filter(r=>r && (used[r.id]||0)<rowNeed(r));
  if(left.length) h+='<div class="pnleft"><p class="lbl">Landing here, not on a port yet ('+left.length+')</p>'+
    left.map(r=>'<button data-find="'+esc(r.id)+'"><span class="m">'+esc(r.tag)+'</span> · '+esc(r.fromRoom||'')+' · '+esc(r.label||r.type||'')+'</button>').join('')+'</div>';
  h+='<p class="hintline" style="margin-top:12px">Grey = cable on the port · light green = terminated · green = tested. Tap a plate to work on it.</p>';
  $('pnBody').innerHTML=h;
  $('pnBody').querySelectorAll('[data-pos]').forEach(b=>b.onclick=()=>openPlate(P,b.dataset.pos));
  $('pnBody').querySelectorAll('[data-find]').forEach(b=>b.onclick=()=>openFind(P,b.dataset.find));
}
function openPlate(P,pos){
  const rb=ROWBY(); const mp=pnMap(P,rb); const pt=effPlate(P,pos), off=(P.plates||{})[pos]||'';
  const pp=platePorts(pt,pos);
  openSheet('<div class="sh"><h2>'+esc(P.name||'')+' · '+pos+'</h2><button class="x" data-x>✕</button></div>'+
    '<p class="lbl">Plate</p><select id="iPlate" style="width:100%;font-size:17px;padding:10px;border-radius:10px;margin-bottom:6px">'+
      '<option value="">— nothing here yet —</option>'+
      (P.allowed||[]).map(k=>'<option value="'+k+'"'+(k===pt?' selected':'')+'>'+esc(k+' · '+((FWP[k]||{}).name||'')+' · '+((FWP[k]||{}).pn||''))+'</option>').join('')+
    '</select>'+
    (off&&pt!==off?'<p class="hintline" style="color:var(--warn)">The office drew '+esc(off)+' here — this change goes back as a red-line.</p>'
      :'<p class="hintline">Set what is actually installed. A change from the office’s layout goes back as a red-line.</p>')+
    (pp.length?'<p class="lbl" style="margin-top:12px">Ports</p>'+pp.map(x=>{ const r=rb[mp[x.port]]; const tk=tkOf(P,x.port);
      const offRid=(P.ports||{})[x.port]||''; const chg=(mp[x.port]||'')!==offRid && !!(pnS(P).ports||{})[x.port];
      return '<div class="prow"><span class="pn">'+x.port.split('.')[1]+(x.k!=='C6'&&x.k!=='C6A'&&x.k!=='C6SH'?'<br><span style="font-size:10px;color:var(--ink3)">'+x.k+'</span>':'')+'</span>'+
        '<button class="pc'+(r?'':' sp')+(chg?' chg':'')+'" data-pc="'+x.port+'">'+(r?('<b class="m">'+esc(r.tag)+'</b> · '+esc(r.fromRoom||'')+' · '+esc(r.device||'')):'spare — tap to set')+'</button>'+
        '<button class="tg'+(tk.term?' on':'')+'" data-term="'+x.port+'">'+(tk.term?'✓ TERM':'TERM')+'</button>'+
        '<button class="tg'+(tk.test?' on':'')+'" data-test="'+x.port+'">'+(tk.test?'✓ TEST':'TEST')+'</button></div>'; }).join('')
      :(pt==='BNK'?'<p class="hintline">Blank plate — no ports.</p>':''))+
    '<button class="btn ghost" style="margin-top:14px" data-done>Done</button>');
  const sb=$('sheetBody');
  sb.querySelector('[data-x]').onclick=()=>{ closeSheet(); paintPanel(); };
  sb.querySelector('[data-done]').onclick=()=>{ closeSheet(); paintPanel(); };
  $('iPlate').onchange=e=>{ const v=e.target.value; pnS(P).plates[pos]={v, ...pnStamp()}; save(); paintPanel(); openPlate(P,pos); };
  sb.querySelectorAll('[data-pc]').forEach(b=>b.onclick=()=>openPick(P,pos,b.dataset.pc));
  const tog=(port,f)=>{ const cur=tkOf(P,port); const nx={...cur, ...pnStamp()}; nx[f]=!cur[f];
    if(f==='test'&&nx.test) nx.term=true; if(f==='term'&&!nx.term) nx.test=false;
    pnS(P).tk[port]=nx; save(); paintPanel(); openPlate(P,pos); };
  sb.querySelectorAll('[data-term]').forEach(b=>b.onclick=()=>tog(b.dataset.term,'term'));
  sb.querySelectorAll('[data-test]').forEach(b=>b.onclick=()=>tog(b.dataset.test,'test'));
}
function setPort(P,port,rid){
  const ov=pnS(P).ports; const mp=pnMap(P);
  if(rid){ const r=ROWBY()[rid]; const need=r?rowNeed(r):1;
    const on=Object.keys(mp).filter(k=>mp[k]===rid && k!==port);
    if(on.length>=need) on.slice(0,on.length-need+1).forEach(k=>{ ov[k]={v:'', ...pnStamp()}; }); }   // a cable is on one port (fiber: n)
  ov[port]={v:rid||'', ...pnStamp()}; save();
}
function openPick(P,pos,port){
  const rb=ROWBY(); const mp=pnMap(P,rb); const k=platePorts(effPlate(P,pos),pos).find(x=>x.port===port).k;
  const cur=mp[port]||'';
  const onPort={}; PANELS.forEach(Q=>{ const m=pnMap(Q,rb); Object.keys(m).forEach(p=>{ (onPort[m[p]]=onPort[m[p]]||[]).push(Q===P?p:(Q.name+' '+p)); }); });
  const landIds=new Set((P.land||[]).map(x=>x.rid));
  const cands=allRows().filter(r=>rowClass(r)===k && !isDeleted(r));
  const here=cands.filter(r=>landIds.has(r.id)).sort((a,b)=>String(a.tag).localeCompare(String(b.tag),undefined,{numeric:true}));
  const else_=cands.filter(r=>!landIds.has(r.id)).sort((a,b)=>String(a.tag).localeCompare(String(b.tag),undefined,{numeric:true}));
  const btn=r=>'<button class="pick'+(r.id===cur?' cur':'')+'" data-rid="'+esc(r.id)+'"><span class="m">'+esc(r.tag)+'</span> · '+esc(r.fromRoom||'')+' · '+esc(r.device||'')+
    (onPort[r.id]&&r.id!==cur?'<br><span style="font-size:12px;color:var(--warn)">now on '+esc(onPort[r.id].join(', '))+' — moves here</span>':'')+'</button>';
  openSheet('<div class="sh"><h2>'+port+' — which cable?</h2><button class="x" data-x>✕</button></div>'+
    '<input id="iPk" type="search" placeholder="Search tag or room…" style="width:100%;font-size:16px;padding:10px;border-radius:10px;margin-bottom:10px">'+
    '<button class="pick" data-rid=""><b>Spare</b> — nothing on this port</button>'+
    (here.length?'<p class="lbl" style="margin-top:10px">Lands at this panel</p>'+here.map(btn).join(''):'')+
    (else_.length?'<p class="lbl" style="margin-top:10px">Elsewhere on the job</p>'+else_.map(btn).join(''):'')+
    (!here.length&&!else_.length?'<p class="hintline">No '+esc(k)+' cables on this sheet. Add the run from the list (＋ Add a run) first.</p>':''));
  const sb=$('sheetBody');
  sb.querySelector('[data-x]').onclick=()=>openPlate(P,pos);
  sb.querySelectorAll('[data-rid]').forEach(b=>b.onclick=()=>{ setPort(P,port,b.dataset.rid); paintPanel(); openPlate(P,pos); });
  $('iPk').oninput=e=>{ const q=e.target.value.toLowerCase();
    sb.querySelectorAll('.pick[data-rid]').forEach(b=>{ if(!b.dataset.rid) return; b.style.display=b.textContent.toLowerCase().includes(q)?'':'none'; }); };
}
/* start from the cable: "where did this one land?" */
function openFind(P,rid){
  const r=ROWBY()[rid]; if(!r) return; const k=rowClass(r); const mp=pnMap(P);
  const free=allPorts(P).filter(x=>x.k===k && !mp[x.port]);
  openSheet('<div class="sh"><h2>'+esc(r.tag)+' — which port?</h2><button class="x" data-x>✕</button></div>'+
    '<p class="hintline">'+esc((r.fromRoom||'')+' · '+(r.device||'')+' · '+(r.label||r.type||''))+'</p>'+
    (free.length?free.map(x=>'<button class="pick" data-port="'+x.port+'"><span class="m">'+x.port+'</span> · '+esc(effPlate(P,x.pos))+'</button>').join('')
      :'<p class="hintline">No free '+esc(k)+' port on this panel. Set a plate first — tap an empty position.</p>'));
  const sb=$('sheetBody');
  sb.querySelector('[data-x]').onclick=()=>{ closeSheet(); paintPanel(); };
  sb.querySelectorAll('[data-port]').forEach(b=>b.onclick=()=>{ setPort(P,b.dataset.port,rid); closeSheet(); paintPanel(); toast(r.tag+' → '+b.dataset.port); });
}
function setPanelView(on){
  inPanel=on; $('panelWrap').classList.toggle('on',on);
  $('btnPanel').textContent=on?'≣ List':'▣ Panel';
  $('btnView').style.visibility=on?'hidden':'';
  $('btnAdd').style.display=on?'none':'';
  if(on) paintPanel(); else paintList();
}
if(PANELS.length){
  $('btnPanel').classList.add('show');
  $('btnPanel').onclick=()=>{ if(typeof inPlan!=='undefined' && inPlan) setView(false); setPanelView(!inPanel); };
}


/* ══ DLF v213 · SPEC SHEETS FROM THE JOB'S SPEC BINDER ════════════════════════════════════
   Mike, 10-07-26: tap a device on the plan, get its spec sheet — offline, on the iPad.
   The office picks the binder at ↓ Field Sheet; only sheets for PLACED devices ride along,
   each once (DATA.specs, by the binder's own spec id), and DATA.devInfo says which device
   has which. pdf.js and its worker come out of the binder itself, so no network is needed.
   A sheet exported without a binder has neither, and nothing below does anything. */
const SPECS = DATA.specs || {};
const DEVINFO = DATA.devInfo || {};
const HAS_DEV = Object.keys(DEVINFO).length > 0;
function tapDevice(cx, cy){
  if(!HAS_DEV || sheetOn) return false;
  const P = planBuilt[planIx], plan = PLANS[planIx];
  if(!P || !plan || !plan.devs) return false;
  const w = clientToWorld(P, cx, cy); if(!w) return false;
  const m = gwOf(P).getScreenCTM && gwOf(P).getScreenCTM();
  const k = m ? Math.hypot(m.a, m.b) : 1;          /* screen px per world unit */
  const slop = 22 / (k || 1);                      /* about a fingertip */
  let best = null, bd = Infinity;
  plan.devs.forEach(d => { const dd = Math.hypot(d.x - w.x, d.y - w.y);
    if(dd <= (d.r || 0) + slop && dd < bd){ best = d; bd = dd; } });
  if(!best) return false;
  openDevice(best.id); return true;
}
function openDevice(id){
  const I = DEVINFO[id] || {};
  const rows = allRows().filter(r => devKeyOf(r.id) === id);
  const sid = I.sheet && SPECS[I.sheet] ? I.sheet : '';
  openSheet('<div class="sh"><h2>'+esc(I.model || 'Device')+'</h2><button class="x" data-x>✕</button></div>'+
    '<p class="devsub">'+esc([I.manuf, I.room, I.name].filter(Boolean).join(' · '))+'</p>'+
    (sid ? '<button class="btn" data-spec>📄 Spec sheet</button><p class="specline" style="margin-top:6px">'+esc(SPECS[sid].name||'')+(I.via?' \u00b7 matched by room to '+esc(I.via):'')+'</p>'
         : '<button class="btn ghost" disabled style="opacity:.6;margin-bottom:16px">No spec sheet in the binder</button>')+
    (rows.length ? '<p class="lbl">Cables ('+rows.length+')</p><div class="menu">'+rows.map(r => { const s = has(r.id) || {};
        return '<button data-go="'+esc(r.id)+'">'+(s.done?'✓ ':'')+esc(r.tag || r.label || r.type)+
          '<small>'+esc(r.label || r.type || '')+(r.length ? (' · '+esc(r.length)+' ft est') : '')+'</small></button>'; }).join('')+'</div>'
     : '<p class="hintline">No cables on this device.</p>'));
  const sb = $('sheetBody');
  sb.querySelector('[data-x]').onclick = closeSheet;
  const b = sb.querySelector('[data-spec]'); if(b) b.onclick = () => openSpec(sid);
  sb.querySelectorAll('[data-go]').forEach(x => x.onclick = () => openRow(x.dataset.go));
}

/* ---------- the viewer: one page at a time, re-rendered sharp at each zoom ---------- */
let SV = {sid:null, doc:null, page:1, np:1, zoom:1}, svTok = 0;
function svBytes(b){ const s = atob(b), u = new Uint8Array(s.length); for(let i=0;i<s.length;i++) u[i] = s.charCodeAt(i); return u; }
function svMsg(t){ $('specPgs').innerHTML = '<p class="msg">'+esc(t)+'</p>'; }
async function openSpec(sid){
  const e = SPECS[sid]; if(!e) return;
  if(SV.doc && SV.doc.destroy) try{ SV.doc.destroy(); }catch(_){}
  SV = {sid, doc:null, page:1, np:1, zoom:1};
  $('specName').textContent = e.name || 'Spec sheet';
  $('specV').classList.add('on');
  if(e.kind === 'img'){ SV.np = (e.pages || []).length || 1; return svRender(); }
  if(typeof pdfjsLib === 'undefined'){ svMsg('The PDF viewer is missing from this file. Ask the office to export the Field Sheet again with the Spec Binder.'); return; }
  svMsg('Opening…'); $('specPg').textContent = '';
  try{ SV.doc = await pdfjsLib.getDocument({data: svBytes(e.src)}).promise; SV.np = SV.doc.numPages; }
  catch(err){ svMsg('This spec sheet could not be opened ('+(err && err.message || err)+').'); return; }
  svRender();
}
function svClose(){ $('specV').classList.remove('on'); svTok++;
  if(SV.doc && SV.doc.destroy) try{ SV.doc.destroy(); }catch(_){}
  SV = {sid:null, doc:null, page:1, np:1, zoom:1}; $('specPgs').innerHTML = ''; }
async function svRender(){
  const tok = ++svTok, e = SPECS[SV.sid]; if(!e) return;
  const host = $('specPgs');
  $('specPg').textContent = SV.page+' / '+SV.np;
  $('specV').querySelector('[data-sp]').disabled = SV.page <= 1;
  $('specV').querySelector('[data-sn]').disabled = SV.page >= SV.np;
  const W = Math.max(200, host.clientWidth - 24), cssW = Math.round(W * SV.zoom);
  if(e.kind === 'img'){ const im = new Image(); im.src = (e.pages || [])[SV.page-1] || ''; im.style.width = cssW+'px';
    host.innerHTML = ''; host.appendChild(im); return; }
  if(!SV.doc) return;
  const pg = await SV.doc.getPage(SV.page); if(tok !== svTok) return;
  const v1 = pg.getViewport({scale:1});
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let scale = cssW / v1.width * dpr;
  /* iPad Safari refuses canvases much past ~16 megapixels — stay well under */
  const MAXPX = 12e6; if(v1.width*v1.height*scale*scale > MAXPX) scale = Math.sqrt(MAXPX / (v1.width*v1.height));
  const vp = pg.getViewport({scale});
  const c = document.createElement('canvas');
  c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  c.style.width = cssW+'px'; c.style.height = Math.round(cssW * v1.height / v1.width)+'px';
  try{ await pg.render({canvasContext: c.getContext('2d'), viewport: vp}).promise; }
  catch(err){ if(tok === svTok) svMsg('This page could not be drawn ('+(err && err.message || err)+').'); return; }
  if(tok !== svTok) return;
  /* keep the reader's place across a zoom: same fraction of the page under the middle of the screen */
  const fx = host.scrollWidth > host.clientWidth ? (host.scrollLeft + host.clientWidth/2) / host.scrollWidth : 0.5;
  const fy = host.scrollHeight > host.clientHeight ? (host.scrollTop + host.clientHeight/2) / host.scrollHeight : 0;
  host.innerHTML = ''; host.appendChild(c);
  host.scrollLeft = fx * host.scrollWidth - host.clientWidth/2;
  host.scrollTop = fy * host.scrollHeight - host.clientHeight/2;
}
function svZoom(f){ SV.zoom = Math.max(0.5, Math.min(6, SV.zoom * f)); svRender(); }
(function(){
  const V = $('specV');
  V.querySelector('[data-sx]').onclick = svClose;
  V.querySelector('[data-sp]').onclick = () => { if(SV.page > 1){ SV.page--; $('specPgs').scrollTop = 0; svRender(); } };
  V.querySelector('[data-sn]').onclick = () => { if(SV.page < SV.np){ SV.page++; $('specPgs').scrollTop = 0; svRender(); } };
  V.querySelector('[data-zo]').onclick = () => svZoom(1/1.4);
  V.querySelector('[data-zi]').onclick = () => svZoom(1.4);
  /* pinch: two fingers scale the page live, then it is re-drawn sharp at the new zoom.
     One finger stays a native scroll. */
  const host = $('specPgs'); let d0 = 0, kNow = 1;
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  host.addEventListener('touchstart', e => { if(e.touches.length === 2){ d0 = dist(e.touches); kNow = 1; } }, {passive:true});
  host.addEventListener('touchmove', e => { if(e.touches.length !== 2 || !d0) return; e.preventDefault();
    kNow = dist(e.touches) / d0; const el = host.firstElementChild;
    if(el && el.tagName !== 'P') el.style.transform = 'scale('+kNow+')'; }, {passive:false});
  host.addEventListener('touchend', e => { if(!d0 || e.touches.length >= 2) return; d0 = 0;
    const el = host.firstElementChild; if(el) el.style.transform = '';
    if(Math.abs(kNow - 1) > 0.05) svZoom(kNow); }, {passive:true});
  document.addEventListener('keydown', e => { if(e.key === 'Escape' && V.classList.contains('on')){ e.stopImmediatePropagation(); svClose(); } }, true);
  let rz = 0; window.addEventListener('resize', () => { if(!V.classList.contains('on')) return; clearTimeout(rz); rz = setTimeout(svRender, 200); });
})();
