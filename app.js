// Cut Coach — weight-cut tracker. All data lives in this browser's localStorage.
(function(){
const $=id=>document.getElementById(id);
const pad=n=>String(n).padStart(2,'0');
const ymd=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const parse=s=>{const[y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d)};
const addDays=(s,n)=>{const d=parse(s);d.setDate(d.getDate()+n);return ymd(d)};
const diffDays=(a,b)=>Math.round((parse(b)-parse(a))/864e5);
const today=()=>ymd(new Date());
const fmt=(n,dp=1)=>n==null||isNaN(n)?'–':Number(n).toFixed(dp);
const short=s=>{const d=parse(s);return d.toLocaleDateString(undefined,{month:'short',day:'numeric'})};

let mode='loading'; // 'example' | 'mine' | 'memory'
let mine={};        // date -> entry (real)
let example={};
let goals={protein:null,steps:null};
let onPlan=null;

/* ---------- storage (localStorage) ---------- */
// Two keys: all logged days as one object keyed by date, and the goals object.
const KEY_ENTRIES='cutcoach.entries';
const KEY_GOALS='cutcoach.goals';
// localStorage can be missing or throw (private windows, blocked site data, full quota),
// so every access goes through these wrappers. canStore is false when it can't be used.
let canStore=false;
function load(key,fallback){
  try{const raw=localStorage.getItem(key);return raw?JSON.parse(raw):fallback;}catch(e){return fallback;}
}
function save(key,value){
  try{localStorage.setItem(key,JSON.stringify(value));return true;}catch(e){return false;}
}
function storageWorks(){
  try{const k='cutcoach.test';localStorage.setItem(k,'1');localStorage.removeItem(k);return true;}catch(e){return false;}
}

/* ---------- example data (never saved) ---------- */
function buildExample(){
  const out={}; const end=addDays(today(),-1); const N=35;
  let w=191.6;
  for(let i=N-1;i>=0;i--){
    const d=addDays(end,-i); const k=N-1-i; const dow=parse(d).getDay(); const wknd=dow===0||dow===6;
    const late=k>=21;
    if(late && (k===24||k===31)) continue; // skipped logs
    const plan= late ? !wknd : !(wknd && k%13===6);
    w += late ? (plan?-0.06:0.28) : -0.13;
    const noise=Math.sin(k*1.7)*0.7+Math.cos(k*0.9)*0.4;
    out[d]={date:d,weight:+(w+noise).toFixed(1),calories:plan?2150+Math.round(Math.sin(k)*90):2900+Math.round(Math.cos(k)*200),protein:plan?165+Math.round(Math.sin(k*2)*12):115,steps:plan?9000+Math.round(Math.sin(k*3)*1500):4200,onPlan:plan};
  }
  return out;
}

const entries=()=>mode==='example'?example:mine;
const curGoals=()=>mode==='example'?{protein:160,steps:8000}:goals;

/* ---------- analysis ---------- */
function series(){
  const days=Object.values(entries()).sort((a,b)=>a.date<b.date?-1:1);
  let t=null; const pts=[];
  for(const e of days){ if(e.weight==null) continue; t = t==null?e.weight:t+0.1*(e.weight-t); pts.push({date:e.date,w:e.weight,t}); }
  return {days,pts};
}
function trendAt(pts,date){ let v=null; for(const p of pts){ if(p.date<=date) v=p; else break;} return v; }

function analyze(){
  const {days,pts}=series(); const E=entries();
  const ref = days.length? (days[days.length-1].date>today()?days[days.length-1].date:today()) : today();
  const winStart=addDays(ref,-13);
  const inWin=days.filter(e=>e.date>=winStart&&e.date<=ref);
  const planKnown=inWin.filter(e=>e.onPlan!=null);
  const planRate=planKnown.length?planKnown.filter(e=>e.onPlan).length/planKnown.length:null;
  const logRate=inWin.length/14;
  let rate=null, span=0;
  if(pts.length>=2){
    const last=pts[pts.length-1]; const back=trendAt(pts,addDays(last.date,-14))||pts[0];
    span=diffDays(back.date,last.date); if(span>=5) rate=(last.t-back.t)/span*7;
    span=diffDays(pts[0].date,last.date);
  }
  // weekend pattern over 28 days
  const s28=days.filter(e=>e.date>=addDays(ref,-27)&&e.onPlan!=null);
  const wk=s28.filter(e=>{const d=parse(e.date).getDay();return d===0||d===6});
  const wd=s28.filter(e=>{const d=parse(e.date).getDay();return d>0&&d<6});
  let pattern=null;
  if(wk.length>=3&&wd.length>=6){
    const a=wk.filter(e=>e.onPlan).length/wk.length, b=wd.filter(e=>e.onPlan).length/wd.length;
    if(b-a>=0.25) pattern={wk:a,wd:b};
  }
  const last=pts[pts.length-1], prev=pts[pts.length-2];
  let v;
  if(pts.length<7){
    v={cls:'v-info',tag:'Getting started',head:'Log about a week of weigh-ins to unlock the stall check.',why:`You have ${pts.length} weigh-in${pts.length===1?'':'s'} so far. Daily weight swings by a few pounds from water and salt, so the trend needs some data first.`,do:'Weigh in each morning after the bathroom, before eating.'};
  } else if(rate!=null && rate<=-0.2){
    const scaleUp = last && prev && last.w>prev.w;
    v= scaleUp
      ? {cls:'v-good',tag:'Normal fluctuation',head:`The scale went up, but your trend is still dropping ${fmt(-rate)} lb a week.`,why:'A one-day jump is almost always water, salt, or a late meal. The trend line smooths that out and it is still heading down.',do:'Nothing to fix. Keep doing what you are doing.'}
      : {cls:'v-good',tag:'On track',head:`You're losing about ${fmt(-rate)} lb a week on trend.`,why:'Your trend weight has been moving down steadily over the last two weeks.',do:'Keep the plan the same. Don\'t cut harder just because it\'s working.'};
  } else if((planRate!=null&&planRate<0.75)||logRate<0.7){
    const bits=[];
    if(planRate!=null&&planRate<0.75) bits.push(`you were on plan ${Math.round(planRate*100)}% of logged days`);
    if(logRate<0.7) bits.push(`you logged ${inWin.length} of the last 14 days`);
    v={cls:'v-warn',tag:'Consistency slipping',head:'Your progress stalled because the plan slipped, not because the plan stopped working.',why:`In the last two weeks ${bits.join(' and ')}. Off-plan days can erase several on-plan days.`,do:pattern?'Fix the habit first: plan your weekends ahead of time.':'Fix the habit first. Aim for a full week on plan before changing anything else.'};
  } else if(span>=14){
    v={cls:'v-bad',tag:'True plateau',head:'You\'ve been consistent and the trend is flat. Time to adjust.',why:`You were on plan ${Math.round((planRate||0)*100)}% of days, but your trend moved ${rate==null?'about 0':fmt(rate)} lb/wk. Your body has likely adapted to this intake.`,do:'Make one small change: slightly lower intake, more daily steps, or a 1–2 week diet break at maintenance.'};
  } else {
    v={cls:'v-info',tag:'Too early to call',head:'The trend is flat, but it\'s too soon to call it a plateau.',why:'Real plateaus show up after two or more consistent weeks. Short flat stretches are common.',do:'Stay consistent and check back next week.'};
  }
  return {v,rate,planRate,inWin:inWin.length,pattern,pts,days};
}

function streak(test){
  const E=entries(); let d=today(); if(!E[d]) d=addDays(d,-1); let n=0;
  while(E[d]&&test(E[d])){n++;d=addDays(d,-1);} return n;
}

/* ---------- render ---------- */
function render(){
  const a=analyze(); const v=a.v;
  const box=$('verdict'); box.className='verdict '+v.cls;
  $('vTag').textContent=v.tag; $('vHead').textContent=v.head; $('vWhy').textContent=v.why; $('vDo').textContent=v.do;
  $('fRate').textContent=a.rate==null?'–':(a.rate>0?'+':'')+fmt(a.rate,2);
  $('fPlan').textContent=a.planRate==null?'–':Math.round(a.planRate*100)+'%';
  $('fLog').textContent=a.inWin+'/14';
  const p=$('pattern');
  if(a.pattern){p.hidden=false;p.innerHTML='';const b=document.createElement('b');b.textContent='Weekend pattern: ';p.append(b,`you're on plan ${Math.round(a.pattern.wk*100)}% of weekend days vs ${Math.round(a.pattern.wd*100)}% on weekdays.`);} else p.hidden=true;
  renderChart(a.pts);
  const g=curGoals();
  setStreak('sLog',streak(()=>true));
  setStreak('sPlan',streak(e=>e.onPlan===true));
  setStreak('sProt',g.protein?streak(e=>e.protein!=null&&e.protein>=g.protein):0);
  renderRecap(a.pts);
  renderHist(a.days);
  renderBanner();
}
function setStreak(id,n){const el=$(id);el.textContent=n;const s=document.createElement('small');s.textContent='d';el.append(s);}

function renderRecap(pts){
  const E=entries(); const end=today(); const start=addDays(end,-6);
  const wk=Object.values(E).filter(e=>e.date>=start&&e.date<=end);
  const avg=k=>{const v=wk.map(e=>e[k]).filter(x=>x!=null);return v.length?v.reduce((s,x)=>s+x,0)/v.length:null};
  const tEnd=trendAt(pts,end), tStart=trendAt(pts,addDays(start,-1));
  const ch=tEnd&&tStart?tEnd.t-tStart.t:null;
  const rows=[
    ['Trend change',ch==null?'–':(ch>0?'+':'')+fmt(ch)+' lb'],
    ['Days on plan',wk.filter(e=>e.onPlan).length+' / 7'],
    ['Avg protein',avg('protein')==null?'–':Math.round(avg('protein'))+' g'],
    ['Avg steps',avg('steps')==null?'–':Math.round(avg('steps')).toLocaleString()],
    ['Avg calories',avg('calories')==null?'–':Math.round(avg('calories')).toLocaleString()],
    ['Days logged',wk.length+' / 7'],
  ];
  const r=$('recap'); r.innerHTML='';
  for(const[k,val] of rows){const d=document.createElement('div');const a=document.createElement('span');a.textContent=k;const b=document.createElement('span');b.className='num';b.textContent=val;d.append(a,b);r.append(d);}
}

function renderHist(days){
  const h=$('hist'); h.innerHTML='';
  const list=[...days].reverse().slice(0,21);
  if(!list.length){const p=document.createElement('p');p.className='empty';p.textContent='No days logged yet. Your first entry will show up here.';h.append(p);return;}
  for(const e of list){
    const b=document.createElement('button');b.type='button';b.className='row';
    const d=document.createElement('span');d.className='d';d.textContent=short(e.date);
    const mid=document.createElement('span');mid.style.minWidth='0';
    const w=document.createElement('span');w.className='w';w.textContent=e.weight!=null?fmt(e.weight):'—';
    const m=document.createElement('div');m.className='meta';
    m.textContent=[e.calories!=null?e.calories.toLocaleString()+' cal':null,e.protein!=null?e.protein+' g protein':null,e.steps!=null?e.steps.toLocaleString()+' steps':null].filter(Boolean).join(' · ')||'Weight only';
    mid.append(w,m);
    const pl=document.createElement('span');pl.className='pill '+(e.onPlan===true?'yes':e.onPlan===false?'no':'na');pl.textContent=e.onPlan===true?'On plan':e.onPlan===false?'Off plan':'—';
    b.append(d,mid,pl); b.addEventListener('click',()=>loadIntoForm(e.date)); h.append(b);
  }
}

function renderChart(pts){
  const el=$('chart');
  const end=pts.length?pts[pts.length-1].date:today();
  const start=addDays(end,-41);
  const P=pts.filter(p=>p.date>=start);
  if(P.length<2){el.innerHTML='<p class="empty">Your trend line appears after two weigh-ins.</p>';return;}
  const W=600,H=230,L=40,R=58,T=14,B=28;
  const vals=P.flatMap(p=>[p.w,p.t]);
  let lo=Math.floor(Math.min(...vals)-0.5), hi=Math.ceil(Math.max(...vals)+0.5);
  if(hi-lo<4){const m=(hi+lo)/2;lo=Math.floor(m-2);hi=Math.ceil(m+2);}
  const n=diffDays(P[0].date,end)||1;
  const x=d=>L+diffDays(P[0].date,d)/n*(W-L-R);
  const y=v=>T+(hi-v)/(hi-lo)*(H-T-B);
  const step=Math.max(1,Math.ceil((hi-lo)/4));
  let s=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Trend weight over the last six weeks">`;
  for(let v=Math.ceil(lo/step)*step; v<=hi; v+=step){s+=`<line class="grid" x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L-8}" y="${y(v)+4}" text-anchor="end">${v}</text>`;}
  s+=`<text class="axis" x="${L}" y="${H-8}">${short(P[0].date)}</text><text class="axis" x="${W-R}" y="${H-8}" text-anchor="end">${short(end)}</text>`;
  const line=P.map((p,i)=>(i?'L':'M')+x(p.date).toFixed(1)+' '+y(p.t).toFixed(1)).join(' ');
  s+=`<path class="area" d="${line} L${x(end).toFixed(1)} ${H-B} L${x(P[0].date).toFixed(1)} ${H-B} Z"/>`;
  for(const p of P) s+=`<circle class="raw" cx="${x(p.date).toFixed(1)}" cy="${y(p.w).toFixed(1)}" r="2.6"/>`;
  s+=`<path class="trend" d="${line}"/>`;
  const lp=P[P.length-1];
  s+=`<circle class="end" cx="${x(lp.date)}" cy="${y(lp.t)}" r="5"/><text class="endlbl" x="${x(lp.date)+9}" y="${y(lp.t)+5}">${fmt(lp.t)}</text></svg>`;
  el.innerHTML=s;
}

function renderBanner(){
  const b=$('banner'); b.innerHTML='';
  if(mode==='example'){b.hidden=false;const t=document.createElement('span');t.innerHTML='<b>Example data.</b> These numbers are made up to show how the app works. Save your first day and they disappear.';b.append(t);}
  else if(mode==='memory'){b.hidden=false;b.textContent='This browser is blocking storage, so entries last only until you close the page. Use Export CSV to keep a copy.';}
  else b.hidden=true;
}

/* ---------- form ---------- */
function setPlan(v){onPlan=v;$('planYes').setAttribute('aria-pressed',v===true);$('planNo').setAttribute('aria-pressed',v===false);}
$('planYes').onclick=()=>setPlan(onPlan===true?null:true);
$('planNo').onclick=()=>setPlan(onPlan===false?null:false);
function loadIntoForm(date){
  const e=entries()[date]||{};
  $('fDate').value=date; $('fWeight').value=e.weight??''; $('fCal').value=e.calories??''; $('fProt').value=e.protein??''; $('fSteps').value=e.steps??'';
  setPlan(e.onPlan??null);
  const exists=!!entries()[date]&&mode!=='example';
  $('delBtn').hidden=!exists;
  $('formTitle').textContent=date===today()?'Log today':'Edit '+short(date);
  $('saveBtn').textContent=exists?'Update day':'Save day';
  $('formMsg').textContent=''; $('formMsg').className='msg';
  if(date!==today()) $('form').scrollIntoView({behavior:'smooth',block:'center'});
}
$('fDate').addEventListener('change',()=>{if($('fDate').value) loadIntoForm($('fDate').value)});
const numOrNull=id=>{const v=$(id).value.trim();return v===''?null:Number(v)};
$('form').addEventListener('submit',ev=>{
  ev.preventDefault();
  const msg=$('formMsg'); msg.className='msg';
  const date=$('fDate').value;
  if(!date){msg.className='msg err';msg.textContent='Pick a date first.';return;}
  const e={date,weight:numOrNull('fWeight'),calories:numOrNull('fCal'),protein:numOrNull('fProt'),steps:numOrNull('fSteps'),onPlan};
  if(e.weight==null&&e.calories==null&&e.protein==null&&e.steps==null&&e.onPlan==null){msg.className='msg err';msg.textContent='Enter at least one number or answer "Stuck to plan?".';return;}
  if(e.weight!=null&&(e.weight<50||e.weight>700)){msg.className='msg err';msg.textContent='Weight should be in pounds, between 50 and 700.';return;}
  if(mode==='example') mode=canStore?'mine':'memory';
  mine[date]=e; render(); loadIntoForm(date);
  if(!canStore) msg.textContent='Saved for this session.';
  else if(save(KEY_ENTRIES,mine)) msg.textContent='Saved.';
  else {msg.className='msg err';msg.textContent='Couldn\'t save. Your browser storage may be full.';}
});
$('delBtn').addEventListener('click',()=>{
  const date=$('fDate').value; if(!mine[date]) return;
  delete mine[date]; render(); loadIntoForm(date); $('formMsg').textContent='Deleted.';
  if(canStore&&!save(KEY_ENTRIES,mine)){$('formMsg').className='msg err';$('formMsg').textContent='Couldn\'t delete. Try again.';}
});

/* ---------- goals ---------- */
function fillGoals(){$('gProt').value=goals.protein??'';$('gSteps').value=goals.steps??'';}
$('goalSave').addEventListener('click',()=>{
  goals={protein:numOrNull('gProt'),steps:numOrNull('gSteps')};
  render(); $('goalMsg').textContent='Saved.';
  if(canStore&&!save(KEY_GOALS,goals)) $('goalMsg').textContent='Couldn\'t save goals. Try again.';
});

/* ---------- export ---------- */
// Builds a CSV of your real entries (never the example data), oldest first,
// with the computed trend weight alongside each weigh-in, and downloads it.
$('exportBtn').addEventListener('click',()=>{
  const msg=$('histMsg');
  if(mode==='example'||!Object.keys(mine).length){msg.textContent='Nothing to export yet. Log a day first.';return;}
  const {days,pts}=series();
  const trend={}; for(const p of pts) trend[p.date]=p.t;
  const cell=v=>v==null?'':v;
  const lines=['date,weight_lb,trend_lb,calories,protein_g,steps,on_plan'];
  for(const e of days){
    lines.push([e.date,cell(e.weight),trend[e.date]==null?'':trend[e.date].toFixed(2),cell(e.calories),cell(e.protein),cell(e.steps),e.onPlan==null?'':e.onPlan?'yes':'no'].join(','));
  }
  const blob=new Blob([lines.join('\n')+'\n'],{type:'text/csv'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download='cut-coach-'+today()+'.csv';
  document.body.append(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  msg.textContent='Exported '+days.length+' day'+(days.length===1?'':'s')+'.';
});

/* ---------- boot ---------- */
example=buildExample();
canStore=storageWorks();
if(canStore){
  mine=load(KEY_ENTRIES,{});
  goals={protein:null,steps:null,...load(KEY_GOALS,{})};
}
mode=Object.keys(mine).length?'mine':'example';
fillGoals(); loadIntoForm(today()); render();

// If the app is open in two tabs, pick up changes saved in the other one.
window.addEventListener('storage',ev=>{
  if(ev.key===KEY_ENTRIES){mine=load(KEY_ENTRIES,{});if(Object.keys(mine).length) mode='mine';}
  else if(ev.key===KEY_GOALS){goals={protein:null,steps:null,...load(KEY_GOALS,{})};fillGoals();}
  else return;
  render();
});
})();
