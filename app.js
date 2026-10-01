// Pinche Güey — weight-cut tracker. All data lives in this browser's localStorage.
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
const plural=(n,w)=>n+' '+w+(n===1?'':'s');

let mode='loading'; // 'example' | 'mine' | 'memory'
let mine={};        // date -> entry (real)
let example={};
let goals={protein:null,steps:null};
let settings={schedule:'daily'};
let moods={};       // date -> {morning:'locked', evening:'exhausted', ...}
let onPlan=null;
let ratings={hunger:null,energy:null,sleep:null}; // debrief ratings currently in the Log form

/* ---------- storage (localStorage) ---------- */
const KEY_ENTRIES='cutcoach.entries';   // all logged days, keyed by date
const KEY_GOALS='cutcoach.goals';       // protein and step goals
const KEY_SETTINGS='cutcoach.settings'; // weigh-in schedule
const KEY_MOODS='cutcoach.moods';       // mood check-ins, keyed by date then time of day
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

/* ---------- weigh-in schedules ---------- */
// Everything that depends on how often you weigh in lives here.
//  every:    days between scheduled weigh-ins
//  alpha:    how hard each weigh-in pulls the trend line (see series()). Fewer weigh-ins
//            need a bigger pull, so the trend "remembers" roughly the same 2–4 weeks either way.
//  win:      days the stall check looks back over
//  minPts:   weigh-ins needed before the stall check gives a verdict
//  plateau:  days of history needed before a flat trend counts as a true plateau
//  chart:    days shown on the trend chart
//  recap:    days covered by the summary
const SCHEDULES={
  daily:   {every:1, alpha:0.1,win:14,minPts:7,plateau:14,chart:42, recap:7, winLabel:'2 weeks',recapLabel:'Last 7 days'},
  weekly:  {every:7, alpha:0.5,win:42,minPts:3,plateau:28,chart:84, recap:28,winLabel:'6 weeks',recapLabel:'Last 4 weeks'},
  biweekly:{every:14,alpha:0.6,win:56,minPts:3,plateau:42,chart:112,recap:56,winLabel:'8 weeks',recapLabel:'Last 8 weeks'},
};
const sched=()=>SCHEDULES[settings.schedule]||SCHEDULES.daily;
const isDaily=()=>sched().every===1;

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
// Trend weight: each weigh-in pulls the trend part of the way toward it (alpha).
function series(){
  const a=sched().alpha;
  const days=Object.values(entries()).sort((x,y)=>x.date<y.date?-1:1);
  let t=null; const pts=[];
  for(const e of days){ if(e.weight==null) continue; t = t==null?e.weight:t+a*(e.weight-t); pts.push({date:e.date,w:e.weight,t}); }
  return {days,pts};
}
function trendAt(pts,date){ let v=null; for(const p of pts){ if(p.date<=date) v=p; else break;} return v; }

function analyze(){
  const S=sched(); const {days,pts}=series();
  const ref = days.length? (days[days.length-1].date>today()?days[days.length-1].date:today()) : today();
  const winStart=addDays(ref,-(S.win-1));
  const inWin=days.filter(e=>e.date>=winStart&&e.date<=ref);
  const planKnown=inWin.filter(e=>e.onPlan!=null);
  const planRate=planKnown.length?planKnown.filter(e=>e.onPlan).length/planKnown.length:null;
  // "Logged" means: daily = days with any entry; weekly/bi-weekly = weigh-ins on schedule.
  const expected=S.win/S.every;
  // Extra weigh-ins beyond the schedule don't count twice, so the count is capped.
  const logCount=isDaily()?inWin.length:Math.min(expected,pts.filter(p=>p.date>=winStart&&p.date<=ref).length);
  const logRate=logCount/expected;
  let rate=null, span=0;
  if(pts.length>=2){
    const last=pts[pts.length-1]; const back=trendAt(pts,addDays(last.date,-S.win))||pts[0];
    const rs=diffDays(back.date,last.date); if(rs>=Math.max(5,S.every)) rate=(last.t-back.t)/rs*7;
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
  const how=isDaily()?'Weigh in each morning after the bathroom, before eating.'
    :`Weigh in ${S.every===7?'once a week':'every two weeks'}, same day and time: in the morning, after the bathroom, before eating.`;
  let v;
  if(pts.length<S.minPts){
    v={cls:'v-info',tag:'Getting started',head:`Log ${isDaily()?'about a week of':S.minPts} weigh-ins to unlock the stall check.`,why:`You have ${plural(pts.length,'weigh-in')} so far. Weight swings by a few pounds from water and salt, so the trend needs a few data points first.`,do:how};
  } else if(rate!=null && rate<=-0.2){
    const scaleUp = last && prev && last.w>prev.w;
    v= scaleUp
      ? {cls:'v-good',tag:'Normal fluctuation',head:`The scale went up, but your trend is still dropping ${fmt(-rate)} lb a week.`,why:'A single jump is almost always water, salt, or a late meal. The trend line smooths that out and it is still heading down.',do:'Nothing to fix. Keep doing what you are doing.'}
      : {cls:'v-good',tag:'On track',head:`You're losing about ${fmt(-rate)} lb a week on trend.`,why:`Your trend weight has been moving down steadily over the last ${S.winLabel}.`,do:'Keep the plan the same. Don\'t cut harder just because it\'s working.'};
  } else if((planRate!=null&&planRate<0.75)||logRate<0.7){
    const bits=[];
    if(planRate!=null&&planRate<0.75) bits.push(`you were on plan ${Math.round(planRate*100)}% of logged days`);
    if(logRate<0.7) bits.push(isDaily()?`you logged ${logCount} of the last 14 days`:`you weighed in ${logCount} of the ${expected} scheduled times`);
    v={cls:'v-warn',tag:'Consistency slipping',head:'Your progress stalled because the plan slipped, not because the plan stopped working.',why:`In the last ${S.winLabel} ${bits.join(' and ')}. Off-plan days can erase several on-plan days.`,do:pattern?'Fix the habit first: plan your weekends ahead of time.':'Fix the habit first. Aim for a full week on plan before changing anything else.'};
  } else if(span>=S.plateau){
    v={cls:'v-bad',tag:'True plateau',head:'You\'ve been consistent and the trend is flat. Time to adjust.',why:`You were on plan ${Math.round((planRate||0)*100)}% of days, but your trend moved ${rate==null?'about 0':fmt(rate)} lb/wk. Your body has likely adapted to this intake.`,do:'Make one small change: slightly lower intake, more daily steps, or a 1–2 week diet break at maintenance.'};
  } else {
    v={cls:'v-info',tag:'Too early to call',head:'The trend is flat, but it\'s too soon to call it a plateau.',why:`Real plateaus show up after ${S.plateau/7} or more consistent weeks. Short flat stretches are common.`,do:'Stay consistent and check back next week.'};
  }
  return {v,rate,planRate,logCount,expected,pattern,pts,days};
}

// Daily streak: consecutive days (back from today, or yesterday if today isn't logged yet).
function streak(test){
  const E=entries(); let d=today(); if(!E[d]) d=addDays(d,-1); let n=0;
  while(E[d]&&test(E[d])){n++;d=addDays(d,-1);} return n;
}
// Weigh-in streak for weekly/bi-weekly: consecutive periods that contain a weigh-in.
// The current period gets the same grace as "today" above: it doesn't break the streak yet.
function periodStreak(pts,every){
  const has=(s,e)=>pts.some(p=>p.date>=s&&p.date<=e);
  let end=today(), start=addDays(end,-(every-1)), n=0;
  if(!has(start,end)){end=addDays(start,-1);start=addDays(end,-(every-1));}
  while(has(start,end)){n++;end=addDays(start,-1);start=addDays(end,-(every-1));}
  return n;
}
// "Next weigh-in" text for the home status card and the Log tab.
function nextWeighIn(pts){
  const S=sched(), lastW=pts.length?pts[pts.length-1].date:null;
  if(isDaily()) return entries()[today()]?.weight!=null?'Weighed in today ✓':'Weigh-in due today';
  if(!lastW) return 'Weigh-in due';
  const due=addDays(lastW,S.every), d=diffDays(today(),due);
  if(d>0) return 'Next weigh-in in '+plural(d,'day');
  if(d===0) return 'Weigh-in due today';
  return 'Weigh-in overdue by '+plural(-d,'day');
}

/* ---------- end-of-day debrief: hunger, energy, sleep (1–5) ---------- */
// Stored on each day's entry as hunger/energy/sleep. The labels say which end is which,
// because "5" means opposite things: starving for hunger, great for sleep.
const METRICS=[
  {k:'hunger',name:'Hunger',lo:'Not hungry',hi:'Starving'},
  {k:'energy',name:'Energy',lo:'Drained',hi:'Charged'},
  {k:'sleep', name:'Sleep quality',lo:'Terrible',hi:'Great'},
];
const hasRatings=e=>METRICS.some(m=>e[m.k]!=null);
// Builds the three 1–5 rows inside a container. onPick(metric, value) runs on tap.
function buildRates(box,onPick){
  for(const m of METRICS){
    const row=document.createElement('div'); row.className='rate-row';
    const name=document.createElement('span'); name.className='rate-name'; name.textContent=m.name;
    const scale=document.createElement('div'); scale.className='rate-scale'; scale.setAttribute('role','group'); scale.setAttribute('aria-label',m.name+', 1 to 5');
    for(let v=1;v<=5;v++){
      const b=document.createElement('button'); b.type='button'; b.textContent=v; b.dataset.k=m.k; b.dataset.v=v;
      b.setAttribute('aria-label',m.name+' '+v+(v===1?' ('+m.lo+')':v===5?' ('+m.hi+')':''));
      b.setAttribute('aria-pressed','false');
      b.addEventListener('click',()=>onPick(m.k,v));
      scale.append(b);
    }
    const ends=document.createElement('div'); ends.className='rate-ends';
    const lo=document.createElement('span'); lo.textContent=m.lo; const hi=document.createElement('span'); hi.textContent=m.hi;
    ends.append(lo,hi);
    row.append(name,scale,ends); box.append(row);
  }
}
// Lights up the chosen value in each row (and every value below it, like a meter).
function paintRates(box,vals){
  for(const b of box.querySelectorAll('button')){
    const cur=vals[b.dataset.k], v=+b.dataset.v;
    b.setAttribute('aria-pressed',cur===v); b.classList.toggle('lit',cur!=null&&v<=cur);
  }
}
// Home debrief: a tap saves straight into that day's entry (tap the same value to clear).
function rateDay(date,k,v){
  if(mode==='example') mode=canStore?'mine':'memory';
  const e={date,weight:null,calories:null,protein:null,steps:null,onPlan:null,hunger:null,energy:null,sleep:null,...(mine[date]||{})};
  e[k]=e[k]===v?null:v;
  const empty=e.weight==null&&e.calories==null&&e.protein==null&&e.steps==null&&e.onPlan==null&&!hasRatings(e);
  if(empty) delete mine[date]; else mine[date]=e;
  if(canStore) save(KEY_ENTRIES,mine);
  if($('fDate').value===date){ ratings={...ratings,[k]:e[k]}; paintRates($('formRates'),ratings); }
  render();
}
// The debrief card shows from 5pm until 5am (the evening and night check-in slots).
// After midnight it still rates the previous day, same as the night mood check-in.
function renderDebrief(){
  const now=new Date(), slot=slotFor(now.getHours());
  const card=$('debriefCard'); card.hidden=!(slot==='evening'||slot==='night');
  if(card.hidden) return;
  const date=moodDate(now), e=entries()[date]||{};
  const vals={hunger:e.hunger??null,energy:e.energy??null,sleep:e.sleep??null};
  const done=METRICS.filter(m=>vals[m.k]!=null).length;
  $('debriefState').textContent=done===3?'Logged ✓':done?done+' / 3':'';
  $('debriefQ').textContent=done===3?'Debrief saved. Tap to change.':(date===today()?'Rate today, 1 to 5.':'Rate '+short(date)+', 1 to 5.');
  card.dataset.date=date;
  paintRates($('debriefRates'),mode==='example'?{}:vals);
}
// Progress → Body signals: averages over the summary period, plus a few plain-language notes.
function renderSignals(){
  const S=sched(), end=today(), start=addDays(end,-(S.recap-1));
  const all=Object.values(entries()).filter(hasRatings);
  const span=all.filter(e=>e.date>=start&&e.date<=end);
  const avg=(list,k)=>{const v=list.map(e=>e[k]).filter(x=>x!=null);return v.length?v.reduce((s,x)=>s+x,0)/v.length:null};
  const box=$('signals'); box.innerHTML='';
  const a={};
  for(const m of METRICS){
    a[m.k]=avg(span,m.k);
    const row=document.createElement('div'); row.className='sig-row';
    const name=document.createElement('span'); name.className='sig-name'; name.textContent=m.name;
    const meter=document.createElement('span'); meter.className='sig-meter';
    const fill=document.createElement('i'); fill.style.width=a[m.k]==null?'0':(a[m.k]/5*100)+'%'; meter.append(fill);
    const val=document.createElement('span'); val.className='sig-val num'; val.textContent=a[m.k]==null?'–':fmt(a[m.k]);
    row.append(name,meter,val); box.append(row);
  }
  const notes=[];
  if(!span.length) notes.push('Rate hunger, energy and sleep at the end of each day to see patterns here.');
  else{
    // Sleep → hunger: compare hunger after bad nights (sleep 1–2) with good nights (4–5).
    const bad=all.filter(e=>e.sleep!=null&&e.sleep<=2&&e.hunger!=null), good=all.filter(e=>e.sleep!=null&&e.sleep>=4&&e.hunger!=null);
    if(bad.length>=3&&good.length>=3){
      const hb=avg(bad,'hunger'), hg=avg(good,'hunger');
      if(hb-hg>=0.7) notes.push(`After bad sleep your hunger averages ${fmt(hb)} vs ${fmt(hg)} after good sleep. Protecting sleep makes the cut easier.`);
    }
    if(a.hunger!=null&&a.hunger>=4) notes.push('Hunger is running high. More protein and high-volume foods help. If it stays high, a short break at maintenance can reset it.');
    if(a.energy!=null&&a.energy<=2) notes.push('Energy is low. If it stays there, your deficit may be too aggressive.');
    if(a.sleep!=null&&a.sleep<=2.5) notes.push('Sleep is poor. Bad sleep raises hunger and makes the scale noisier.');
    if(!notes.length) notes.push(span.length<3?'Keep rating each evening. Patterns show up after a few days.':'Signals look steady. Keep going.');
  }
  const ul=$('signalNotes'); ul.innerHTML='';
  for(const n of notes.slice(0,2)){const li=document.createElement('li'); li.textContent=n; ul.append(li);}
}

/* ---------- render ---------- */
function render(){
  const S=sched(); const a=analyze(); const v=a.v;
  $('verdict').className='verdict '+v.cls;
  $('vTag').textContent=v.tag; $('vHead').textContent=v.head; $('vWhy').textContent=v.why; $('vDo').textContent=v.do;
  $('fRate').textContent=a.rate==null?'–':(a.rate>0?'+':'')+fmt(a.rate,2);
  $('fPlan').textContent=a.planRate==null?'–':Math.round(a.planRate*100)+'%';
  $('fPlanLbl').textContent='On plan, '+S.win+'d';
  $('fLog').textContent=a.logCount+'/'+a.expected;
  $('fLogLbl').textContent=isDaily()?'Days logged':'Weigh-ins';
  const p=$('pattern');
  if(a.pattern){p.hidden=false;p.innerHTML='';const b=document.createElement('b');b.textContent='Weekend pattern: ';p.append(b,`you're on plan ${Math.round(a.pattern.wk*100)}% of weekend days vs ${Math.round(a.pattern.wd*100)}% on weekdays.`);} else p.hidden=true;
  renderChart(a.pts);
  const g=curGoals();
  if(isDaily()){setStreak('sLog',streak(()=>true),'d');$('sLogLbl').textContent='Logging';}
  else{setStreak('sLog',periodStreak(a.pts,S.every)*S.every/7,'wk');$('sLogLbl').textContent='Weigh-ins on schedule';}
  setStreak('sPlan',streak(e=>e.onPlan===true),'d');
  setStreak('sProt',g.protein?streak(e=>e.protein!=null&&e.protein>=g.protein):0,'d');
  renderRecap(a.pts);
  renderSignals();
  renderDebrief();
  renderHist(a.days);
  renderBanner();
  // home status card + tab subtitles
  const lp=a.pts[a.pts.length-1], next=nextWeighIn(a.pts);
  const t=$('hsTag'); t.textContent=v.tag; t.className='tag '+v.cls;
  $('hsTrend').textContent=lp?'Trend '+fmt(lp.t)+' lb':'No weigh-ins yet';
  $('hsNext').textContent=next;
  $('logHint').textContent=isDaily()?next+'.':next+'. Weight is optional on other days; you can still log food, steps and the plan.';
  $('progSub').textContent=(isDaily()?'Daily':S.every===7?'Weekly':'Bi-weekly')+' weigh-ins · change in Settings';
  for(const b of document.querySelectorAll('[data-sched]')) b.setAttribute('aria-pressed',b.dataset.sched===settings.schedule);
}
function setStreak(id,n,unit){const el=$(id);el.textContent=n;const s=document.createElement('small');s.textContent=unit;el.append(s);}

// Summary over the schedule's period: 7 days, 4 weeks or 8 weeks.
function renderRecap(pts){
  const S=sched(); const end=today(); const start=addDays(end,-(S.recap-1));
  const span=Object.values(entries()).filter(e=>e.date>=start&&e.date<=end);
  const avg=k=>{const v=span.map(e=>e[k]).filter(x=>x!=null);return v.length?v.reduce((s,x)=>s+x,0)/v.length:null};
  const tEnd=trendAt(pts,end), tStart=trendAt(pts,addDays(start,-1));
  const ch=tEnd&&tStart?tEnd.t-tStart.t:null;
  const weighs=pts.filter(p=>p.date>=start&&p.date<=end).length;
  const answered=span.filter(e=>e.onPlan!=null).length;
  const rows=[
    ['Trend change',ch==null?'–':(ch>0?'+':'')+fmt(ch)+' lb'],
    ['Weigh-ins',weighs+' / '+S.recap/S.every],
    ['Avg weight',avg('weight')==null?'–':fmt(avg('weight'))+' lb'],
    ['Days on plan',answered?span.filter(e=>e.onPlan).length+' / '+answered:'–'],
    ['Avg protein',avg('protein')==null?'–':Math.round(avg('protein'))+' g'],
    ['Avg steps',avg('steps')==null?'–':Math.round(avg('steps')).toLocaleString()],
    ['Avg calories',avg('calories')==null?'–':Math.round(avg('calories')).toLocaleString()],
    ['Days logged',span.length+' / '+S.recap],
  ];
  $('recapTitle').textContent=S.recapLabel;
  const r=$('recap'); r.innerHTML='';
  for(const[k,val] of rows){const d=document.createElement('div');const a=document.createElement('span');a.textContent=k;const b=document.createElement('span');b.className='num';b.textContent=val;d.append(a,b);r.append(d);}
}

function renderHist(days){
  const h=$('hist'); h.innerHTML='';
  const list=[...days].reverse().slice(0,30);
  if(!list.length){const p=document.createElement('p');p.className='empty';p.textContent='No days logged yet. Your first entry will show up here.';h.append(p);return;}
  for(const e of list){
    const b=document.createElement('button');b.type='button';b.className='row';
    const d=document.createElement('span');d.className='d';d.textContent=short(e.date);
    const mid=document.createElement('span');mid.style.minWidth='0';
    const w=document.createElement('span');w.className='w';w.textContent=e.weight!=null?fmt(e.weight):'—';
    const m=document.createElement('div');m.className='meta';
    const rated=hasRatings(e)?'H'+(e.hunger??'–')+' E'+(e.energy??'–')+' S'+(e.sleep??'–'):null;
    m.textContent=[e.calories!=null?e.calories.toLocaleString()+' cal':null,e.protein!=null?e.protein+' g protein':null,e.steps!=null?e.steps.toLocaleString()+' steps':null,rated].filter(Boolean).join(' · ')||(e.weight!=null?'Weight only':'Habits only');
    mid.append(w,m);
    const pl=document.createElement('span');pl.className='pill '+(e.onPlan===true?'yes':e.onPlan===false?'no':'na');pl.textContent=e.onPlan===true?'On plan':e.onPlan===false?'Off plan':'—';
    b.append(d,mid,pl); b.addEventListener('click',()=>editDay(e.date)); h.append(b);
  }
}

function renderChart(pts){
  const el=$('chart'); const S=sched();
  const end=pts.length?pts[pts.length-1].date:today();
  const start=addDays(end,-(S.chart-1));
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
  const dotR=isDaily()?2.6:4;
  let s=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Trend weight over the last ${S.chart/7} weeks">`;
  for(let v=Math.ceil(lo/step)*step; v<=hi; v+=step){s+=`<line class="grid" x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L-8}" y="${y(v)+4}" text-anchor="end">${v}</text>`;}
  s+=`<text class="axis" x="${L}" y="${H-8}">${short(P[0].date)}</text><text class="axis" x="${W-R}" y="${H-8}" text-anchor="end">${short(end)}</text>`;
  const line=P.map((p,i)=>(i?'L':'M')+x(p.date).toFixed(1)+' '+y(p.t).toFixed(1)).join(' ');
  s+=`<path class="area" d="${line} L${x(end).toFixed(1)} ${H-B} L${x(P[0].date).toFixed(1)} ${H-B} Z"/>`;
  for(const p of P) s+=`<circle class="raw" cx="${x(p.date).toFixed(1)}" cy="${y(p.w).toFixed(1)}" r="${dotR}"/>`;
  s+=`<path class="trend" d="${line}"/>`;
  const lp=P[P.length-1];
  s+=`<circle class="end" cx="${x(lp.date)}" cy="${y(lp.t)}" r="5"/><text class="endlbl" x="${x(lp.date)+9}" y="${y(lp.t)+5}">${fmt(lp.t)}</text></svg>`;
  el.innerHTML=s;
}

function renderBanner(){
  const b=$('banner'); b.innerHTML='';
  if(mode==='example'){b.hidden=false;const t=document.createElement('span');t.innerHTML='<b>Example data.</b> Made-up numbers to show how the app works. Log your first day and they disappear.';b.append(t);}
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
  ratings={hunger:e.hunger??null,energy:e.energy??null,sleep:e.sleep??null}; paintRates($('formRates'),ratings);
  const exists=!!entries()[date]&&mode!=='example';
  $('delBtn').hidden=!exists;
  $('formTitle').textContent=date===today()?'Log today':'Edit '+short(date);
  $('saveBtn').textContent=exists?'Update day':'Save day';
  $('formMsg').textContent=''; $('formMsg').className='msg';
}
// Tapping a day in History: switch to the Log tab with that day loaded.
function editDay(date){ location.hash='log'; loadIntoForm(date); }
$('fDate').addEventListener('change',()=>{if($('fDate').value) loadIntoForm($('fDate').value)});
const numOrNull=id=>{const v=$(id).value.trim();return v===''?null:Number(v)};
$('form').addEventListener('submit',ev=>{
  ev.preventDefault();
  const msg=$('formMsg'); msg.className='msg';
  const date=$('fDate').value;
  if(!date){msg.className='msg err';msg.textContent='Pick a date first.';return;}
  const e={date,weight:numOrNull('fWeight'),calories:numOrNull('fCal'),protein:numOrNull('fProt'),steps:numOrNull('fSteps'),onPlan,...ratings};
  if(e.weight==null&&e.calories==null&&e.protein==null&&e.steps==null&&e.onPlan==null&&!hasRatings(e)){msg.className='msg err';msg.textContent='Enter at least one number, answer "Stuck to plan?", or rate the day.';return;}
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

/* ---------- settings: goals + weigh-in schedule ---------- */
function fillGoals(){$('gProt').value=goals.protein??'';$('gSteps').value=goals.steps??'';}
$('goalSave').addEventListener('click',()=>{
  goals={protein:numOrNull('gProt'),steps:numOrNull('gSteps')};
  render(); $('goalMsg').textContent='Saved.';
  if(canStore&&!save(KEY_GOALS,goals)) $('goalMsg').textContent='Couldn\'t save goals. Try again.';
});
// The schedule buttons appear in both Progress and Settings; they share one setting.
for(const b of document.querySelectorAll('[data-sched]')){
  b.addEventListener('click',()=>{
    settings={...settings,schedule:b.dataset.sched};
    if(canStore) save(KEY_SETTINGS,settings);
    render();
  });
}

/* ---------- export ---------- */
// Builds a CSV of your real entries (never the example data), oldest first,
// with the computed trend weight alongside each weigh-in, and downloads it.
$('exportBtn').addEventListener('click',()=>{
  const msg=$('histMsg');
  if(mode==='example'||!Object.keys(mine).length){msg.textContent='Nothing to export yet. Log a day first.';return;}
  const {days,pts}=series();
  const trend={}; for(const p of pts) trend[p.date]=p.t;
  const cell=v=>v==null?'':v;
  const lines=['date,weight_lb,trend_lb,calories,protein_g,steps,on_plan,hunger_1to5,energy_1to5,sleep_1to5'];
  for(const e of days){
    lines.push([e.date,cell(e.weight),trend[e.date]==null?'':trend[e.date].toFixed(2),cell(e.calories),cell(e.protein),cell(e.steps),e.onPlan==null?'':e.onPlan?'yes':'no',cell(e.hunger),cell(e.energy),cell(e.sleep)].join(','));
  }
  const blob=new Blob([lines.join('\n')+'\n'],{type:'text/csv'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download='pinche-guey-'+today()+'.csv';
  document.body.append(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  msg.textContent='Exported '+plural(days.length,'day')+'.';
});

/* ---------- mood check-ins ---------- */
// Four check-ins a day, matching the greeting: morning 5–12, afternoon 12–5, evening 5–9,
// night 9pm–5am. Night runs past midnight, so 1am still counts as the previous day's night.
// Your latest check-in today sets the color theme (data-mood on <html>; see styles.css).
const SLOTS=['morning','afternoon','evening','night'];
const SLOT_NAMES={morning:'Morning',afternoon:'Afternoon',evening:'Evening',night:'Night'};
const MOOD_NAMES={exhausted:'Exhausted',locked:'Locked in',energetic:'Energetic'};
const THEME_BG={exhausted:'#0a0b0d',locked:'#0a0304',energetic:'#0c0612'};
function slotFor(h){ return h>=5&&h<12?'morning':h>=12&&h<17?'afternoon':h>=17&&h<21?'evening':'night'; }
function moodDate(now){ const d=new Date(now); if(d.getHours()<5) d.setDate(d.getDate()-1); return ymd(d); }
function currentMood(now){
  const day=moods[moodDate(now)]||{};
  for(let i=SLOTS.indexOf(slotFor(now.getHours()));i>=0;i--) if(day[SLOTS[i]]) return day[SLOTS[i]];
  return null;
}
function renderMood(){
  const now=new Date(), slot=slotFor(now.getHours()), day=moods[moodDate(now)]||{}, picked=day[slot]||null;
  const cur=currentMood(now);
  if(cur) document.documentElement.dataset.mood=cur; else delete document.documentElement.dataset.mood;
  document.querySelector('meta[name="theme-color"]').content=THEME_BG[cur]||'#04060a';
  $('moodSlot').textContent=SLOT_NAMES[slot]+' check-in';
  $('moodQ').textContent=picked?'Feeling '+MOOD_NAMES[picked].toLowerCase()+'. Tap to change.':'How are you feeling?';
  $('moodNow').textContent=cur?MOOD_NAMES[cur]:'';
  for(const b of document.querySelectorAll('.mood-btn')) b.setAttribute('aria-pressed',b.dataset.mood===picked);
  // The day's four slots as a row of dots, colored by the mood you picked.
  const row=$('moodDay'); row.innerHTML='';
  const nowIdx=SLOTS.indexOf(slot);
  SLOTS.forEach((s,i)=>{
    const el=document.createElement('span'); el.className='slot'+(i===nowIdx?' now':'')+(i>nowIdx?' later':'');
    const dot=document.createElement('i'); dot.className='slot-dot'+(day[s]?' m-'+day[s]:'');
    const lbl=document.createElement('span'); lbl.textContent=SLOT_NAMES[s];
    el.title=SLOT_NAMES[s]+': '+(day[s]?MOOD_NAMES[day[s]]:'no check-in');
    el.append(dot,lbl); row.append(el);
  });
}
for(const b of document.querySelectorAll('.mood-btn')){
  b.addEventListener('click',()=>{
    const now=new Date(), d=moodDate(now), slot=slotFor(now.getHours());
    const day={...(moods[d]||{})};
    if(day[slot]===b.dataset.mood) delete day[slot]; else day[slot]=b.dataset.mood; // tap again to clear
    const before=currentMood(now);
    moods={...moods,[d]:day};
    if(canStore) save(KEY_MOODS,moods);
    if(currentMood(now)!==before) themeSwitch(b,renderMood); // animate only when the theme changes
    else renderMood();
  });
}
// Theme change: the new colors spread out in a circle from the button you tapped.
// Where the browser supports View Transitions (iOS 18+, recent Chrome), it keeps a picture of
// the old theme and we grow a circular window onto the new one, so it's one smooth sweep.
// Older browsers switch the colors directly while a soft glowing ring travels outward.
let ringTimer=0;
function themeSwitch(fromEl,apply){
  if(reduceMotion){apply();return;}
  const r=fromEl.getBoundingClientRect(), cx=r.left+r.width/2, cy=r.top+r.height/2;
  // Radius that just clears the farthest screen corner.
  const lmax=Math.ceil(Math.hypot(Math.max(cx,innerWidth-cx),Math.max(cy,innerHeight-cy)));
  if(document.startViewTransition){
    const vt=document.startViewTransition(apply);
    vt.ready.then(()=>document.documentElement.animate(
      {clipPath:[`circle(0px at ${cx}px ${cy}px)`,`circle(${lmax}px at ${cx}px ${cy}px)`]},
      {duration:1000,easing:'cubic-bezier(.5,0,.25,1)',pseudoElement:'::view-transition-new(root)'}
    )).catch(()=>{});
    return;
  }
  apply();
  const lw=$('lightwave');
  lw.style.setProperty('--x',cx+'px'); lw.style.setProperty('--y',cy+'px'); lw.style.setProperty('--lmax',(lmax+60)+'px');
  lw.hidden=false; lw.classList.remove('go'); void lw.offsetWidth; lw.classList.add('go'); // restart the ring
  clearTimeout(ringTimer); ringTimer=setTimeout(()=>{lw.hidden=true;lw.classList.remove('go');},1200);
}

/* ---------- home: greeting, clock, daily line ---------- */
const NAME='Josh';
function greetingFor(h){
  if(h>=5&&h<12) return 'Good morning';
  if(h>=12&&h<17) return 'Good afternoon';
  if(h>=17&&h<21) return 'Good evening';
  return 'Goodnight';
}
function tick(){
  const now=new Date();
  $('greetWord').textContent=greetingFor(now.getHours());
  $('greetName').textContent=NAME;
  const day=now.toLocaleDateString(undefined,{weekday:'short'}).toUpperCase();
  const date=now.toLocaleDateString(undefined,{month:'short',day:'2-digit'}).toUpperCase();
  $('clock').textContent=day+' '+date+' · '+pad(now.getHours())+':'+pad(now.getMinutes());
  renderMood(); renderDebrief(); // a new time of day means a new check-in slot
}

// One line per calendar day: the day number picks the quote, so it stays the same all day
// and changes at midnight. "Another" steps through the list from there.
const QUOTES=window.CUT_QUOTES||[];
let quoteShift=0;
function showQuote(){
  if(!QUOTES.length){$('quote').hidden=true;return;}
  const dayNum=Math.floor(parse(today()).getTime()/864e5);
  const q=QUOTES[((dayNum+quoteShift)%QUOTES.length+QUOTES.length)%QUOTES.length];
  $('qK').textContent=q.k; $('qT').textContent=q.t; $('qA').textContent=q.a;
}
$('qNext').addEventListener('click',()=>{quoteShift++;showQuote();});

/* ---------- intro animation ---------- */
// Plays on every open: boot lines type in, a scan line sweeps, the greeting decodes from
// random glyphs, your name assembles letter by letter, then the overlay dissolves.
// Tap anywhere to skip. It also replays when you come back after 10+ minutes away.
const GLYPHS='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+<>/\\=';
const reduceMotion=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
let introTimers=[], introRAF=0;
// Each character shows random glyphs until its turn, then locks to the real letter.
function decode(el,text,ms){
  const t0=performance.now();
  const step=now=>{
    const k=Math.min(1,(now-t0)/ms), locked=Math.floor(k*text.length);
    let out='';
    for(let i=0;i<text.length;i++) out+= i<locked||text[i]===' '?text[i]:GLYPHS[Math.floor(Math.random()*GLYPHS.length)];
    el.textContent=out;
    if(k<1) introRAF=requestAnimationFrame(step);
  };
  introRAF=requestAnimationFrame(step);
}
function endIntro(){
  const el=$('intro'); if(el.classList.contains('out')||el.hidden) return;
  introTimers.forEach(clearTimeout); introTimers=[]; cancelAnimationFrame(introRAF);
  el.classList.add('out');
  setTimeout(()=>{el.hidden=true;el.classList.remove('out','run');},reduceMotion?200:520);
}
function playIntro(){
  const el=$('intro'), now=new Date();
  const greet=greetingFor(now.getHours()).toUpperCase(), name=NAME.toUpperCase();
  introTimers.forEach(clearTimeout); introTimers=[]; cancelAnimationFrame(introRAF);
  el.hidden=false; el.classList.remove('out','run'); void el.offsetWidth; // restart CSS animations
  el.classList.add('run');
  const boot=$('introBoot'), g=$('introGreet'), n=$('introName');
  boot.innerHTML=''; g.textContent=''; n.innerHTML='';
  // The name is one span per letter so CSS can stagger them in.
  [...name].forEach((ch,i)=>{const s=document.createElement('span');s.textContent=ch;s.style.animationDelay=(1.55+i*0.09)+'s';n.append(s);});
  n.setAttribute('aria-label',name);
  if(reduceMotion){ g.textContent=greet; introTimers.push(setTimeout(endIntro,1400)); return; }
  const lines=['PINCHE GÜEY OS · BUILD 2049.10','NEURAL LINK ··········· OK','BIOMETRICS ············ SYNCED','IDENTITY ·············· '+name];
  lines.forEach((t,i)=>introTimers.push(setTimeout(()=>{const d=document.createElement('div');d.textContent=t;boot.append(d);},120+i*150)));
  introTimers.push(setTimeout(()=>decode(g,greet,650),900));
  introTimers.push(setTimeout(endIntro,3300));
}
$('intro').addEventListener('click',endIntro);
let hiddenAt=null;
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){hiddenAt=Date.now();return;}
  if(hiddenAt&&Date.now()-hiddenAt>10*60*1000){tick();playIntro();}
  hiddenAt=null;
});

/* ---------- router: bottom tabs ---------- */
// The URL hash says which tab is showing (#home, #log, #progress, #history, #settings).
// Each tab gets its own history entry, so the phone's back gesture works.
const TABS=[...document.querySelectorAll('.view')].map(v=>v.dataset.view);
function route(){
  let tab=location.hash.slice(1); if(!TABS.includes(tab)) tab='home';
  for(const el of document.querySelectorAll('.view')) el.hidden=el.dataset.view!==tab;
  for(const a of document.querySelectorAll('.tabbar a')){
    if(a.dataset.tab===tab) a.setAttribute('aria-current','page'); else a.removeAttribute('aria-current');
  }
  window.scrollTo(0,0);
}
window.addEventListener('hashchange',route);

/* ---------- boot ---------- */
example=buildExample();
canStore=storageWorks();
if(canStore){
  mine=load(KEY_ENTRIES,{});
  goals={protein:null,steps:null,...load(KEY_GOALS,{})};
  settings={schedule:'daily',...load(KEY_SETTINGS,{})};
  moods=load(KEY_MOODS,{});
}
mode=Object.keys(mine).length?'mine':'example';
buildRates($('formRates'),(k,v)=>{ratings={...ratings,[k]:ratings[k]===v?null:v};paintRates($('formRates'),ratings);});
buildRates($('debriefRates'),(k,v)=>rateDay($('debriefCard').dataset.date,k,v));
fillGoals(); loadIntoForm(today()); render();
tick(); setInterval(tick,30000); // keeps the greeting, clock and check-in slot current
showQuote();
route();
playIntro();

// If the app is open in two tabs, pick up changes saved in the other one.
window.addEventListener('storage',ev=>{
  if(ev.key===KEY_ENTRIES){mine=load(KEY_ENTRIES,{});if(Object.keys(mine).length) mode='mine';}
  else if(ev.key===KEY_GOALS){goals={protein:null,steps:null,...load(KEY_GOALS,{})};fillGoals();}
  else if(ev.key===KEY_SETTINGS){settings={schedule:'daily',...load(KEY_SETTINGS,{})};}
  else if(ev.key===KEY_MOODS){moods=load(KEY_MOODS,{});renderMood();return;}
  else return;
  render();
});
})();
