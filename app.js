// Pinche Güey — weight-cut tracker. All data lives in this browser's localStorage.
(function(){
// The version this copy of the app was loaded with: the ?v= that tools/release.sh stamps
// on app.js in index.html ('dev' when running unstamped, e.g. straight from the files).
const APP_VERSION=(()=>{try{return new URL(document.currentScript.src).searchParams.get('v')||'dev';}catch(e){return 'dev';}})();
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
const GOAL_DEFAULTS={protein:null,steps:null,calories:null};
const SETTING_DEFAULTS={schedule:'daily',checkinDay:0}; // checkinDay: 0 = Sunday … 6 = Saturday
let goals={...GOAL_DEFAULTS};
let settings={...SETTING_DEFAULTS};
let moods={};       // date -> {morning:'locked', evening:'exhausted', ...}
let onPlan=null;
let ratings={hunger:null,energy:null,sleep:null}; // debrief ratings currently in the Log form

/* ---------- storage (localStorage) ---------- */
const KEY_ENTRIES='cutcoach.entries';   // all logged days, keyed by date
const KEY_GOALS='cutcoach.goals';       // protein and step goals
const KEY_SETTINGS='cutcoach.settings'; // check-in schedule + check-in day
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

/* ---------- check-in schedules ---------- */
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
const curGoals=()=>mode==='example'?{protein:160,steps:8000,calories:2200}:goals;
// A day "has food" if any daily-fuel field was logged (as opposed to a weight-only check-in).
const hasFood=e=>e.calories!=null||e.protein!=null||e.steps!=null||e.onPlan!=null;

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
  // Two kinds of consistency: food logged daily, and check-ins (weigh-ins) on schedule.
  const foodDays=inWin.filter(hasFood).length, foodRate=foodDays/S.win;
  const expected=S.win/S.every;
  // Extra weigh-ins beyond the schedule don't count twice, so the count is capped.
  const checkCount=Math.min(expected,pts.filter(p=>p.date>=winStart&&p.date<=ref).length);
  const checkRate=checkCount/expected;
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
    :`Check in ${S.every===7?'every':'every other'} ${DAY_NAMES[settings.checkinDay]}: weigh in first thing in the morning (after the bathroom, before eating), then take your photo.`;
  let v;
  if(pts.length<S.minPts){
    v={cls:'v-info',tag:'Getting started',head:`Log ${isDaily()?'about a week of':S.minPts} weigh-ins to unlock the stall check.`,why:`You have ${plural(pts.length,'weigh-in')} so far. Weight swings by a few pounds from water and salt, so the trend needs a few data points first.`,do:how};
  } else if(rate!=null && rate<=-0.2){
    const scaleUp = last && prev && last.w>prev.w;
    v= scaleUp
      ? {cls:'v-good',tag:'Normal fluctuation',head:`The scale went up, but your trend is still dropping ${fmt(-rate)} lb a week.`,why:'A single jump is almost always water, salt, or a late meal. The trend line smooths that out and it is still heading down.',do:'Nothing to fix. Keep doing what you are doing.'}
      : {cls:'v-good',tag:'On track',head:`You're losing about ${fmt(-rate)} lb a week on trend.`,why:`Your trend weight has been moving down steadily over the last ${S.winLabel}.`,do:'Keep the plan the same. Don\'t cut harder just because it\'s working.'};
  } else if((planRate!=null&&planRate<0.75)||foodRate<0.7||checkRate<0.7){
    const bits=[];
    if(planRate!=null&&planRate<0.75) bits.push(`you were on plan ${Math.round(planRate*100)}% of logged days`);
    if(foodRate<0.7) bits.push(`you logged food on ${foodDays} of ${S.win} days`);
    if(checkRate<0.7) bits.push(isDaily()?`you weighed in ${checkCount} of the last 14 days`:`you checked in ${checkCount} of the ${expected} scheduled times`);
    v={cls:'v-warn',tag:'Consistency slipping',head:'Your progress stalled because the plan slipped, not because the plan stopped working.',why:`In the last ${S.winLabel} ${bits.join(' and ')}. Off-plan days can erase several on-plan days.`,do:pattern?'Fix the habit first: plan your weekends ahead of time.':'Fix the habit first. Aim for a full week on plan before changing anything else.'};
  } else if(span>=S.plateau){
    v={cls:'v-bad',tag:'True plateau',head:'You\'ve been consistent and the trend is flat. Time to adjust.',why:`You were on plan ${Math.round((planRate||0)*100)}% of days, but your trend moved ${rate==null?'about 0':fmt(rate)} lb/wk. Your body has likely adapted to this intake.`,do:'Make one small change: slightly lower intake, more daily steps, or a 1–2 week diet break at maintenance.'};
  } else {
    v={cls:'v-info',tag:'Too early to call',head:'The trend is flat, but it\'s too soon to call it a plateau.',why:`Real plateaus show up after ${S.plateau/7} or more consistent weeks. Short flat stretches are common.`,do:'Stay consistent and check back next week.'};
  }
  return {v,rate,planRate,foodDays,checkCount,expected,pattern,pts,days};
}

// Daily streak: consecutive days that pass the test, counting back from today (or from
// yesterday if today doesn't count yet, e.g. food hasn't been imported tonight).
function streak(test){
  const E=entries(); let d=today(); if(!(E[d]&&test(E[d]))) d=addDays(d,-1); let n=0;
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
// ---- Check-ins: weight + progress photo on a fixed day (weekly / bi-weekly) or daily ----
const DAY_NAMES=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const dayShort=date=>parse(date).toLocaleDateString(undefined,{weekday:'short'});
// The first date on or after `date` that falls on weekday `dow`.
function onOrAfter(date,dow){ return addDays(date,(dow-parse(date).getDay()+7)%7); }
// When the next check-in is due and where you stand. A check-in up to ~2 days early or late
// counts for the nearest check-in day, and the next one is due on the following check-in
// day: Sunday → next Sunday, a late Tuesday → this Sunday (back on schedule), an early
// Saturday → the Sunday after (not tomorrow). Bi-weekly works the same, a week further out.
// state: done | due | overdue | upcoming
function checkinStatus(pts){
  const S=sched(), t=today(), lastW=pts.length?pts[pts.length-1].date:null;
  const hasPhoto=lastW?!!photoFor(lastW):false;
  if(isDaily()) return {state:lastW===t?'done':'due',due:t,lastW,hasPhoto};
  const due=lastW?onOrAfter(addDays(lastW,S.every===7?3:10),settings.checkinDay):onOrAfter(t,settings.checkinDay);
  const state=lastW===t?'done':t<due?(lastW&&diffDays(lastW,t)<S.every?'done':'upcoming'):t===due?'due':'overdue';
  return {state,due,lastW,hasPhoto};
}
function checkinText(st){
  if(isDaily()) return st.state==='done'?'Weighed in today ✓'+(st.hasPhoto?'':' · no photo yet'):'Weigh-in due today';
  const when=dayShort(st.due)+' '+short(st.due);
  if(st.state==='done') return 'Checked in '+short(st.lastW)+' ✓'+(st.hasPhoto?'':' · photo missing')+' · next '+when;
  if(st.state==='due') return 'Check-in due today: weigh in + photo';
  if(st.state==='overdue') return 'Check-in overdue · was due '+when;
  return (st.lastW?'Next check-in ':'First check-in ')+when+' (in '+plural(diffDays(today(),st.due),'day')+')';
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
  if(empty) synced.remove('e:'+date); else synced.touch('e:'+date);
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
  $('fLog').textContent=a.foodDays+'/'+S.win;
  $('fCheck').textContent=a.checkCount+'/'+a.expected;
  $('fCheckLbl').textContent=isDaily()?'Weigh-ins':'Check-ins';
  const p=$('pattern');
  if(a.pattern){p.hidden=false;p.innerHTML='';const b=document.createElement('b');b.textContent='Weekend pattern: ';p.append(b,`you're on plan ${Math.round(a.pattern.wk*100)}% of weekend days vs ${Math.round(a.pattern.wd*100)}% on weekdays.`);} else p.hidden=true;
  renderChart(a.pts);
  const g=curGoals();
  setStreak('sLog',streak(hasFood),'d');
  setStreak('sCal',g.calories?streak(e=>e.calories!=null&&e.calories<=g.calories):0,'d');
  setStreak('sProt',g.protein?streak(e=>e.protein!=null&&e.protein>=g.protein):0,'d');
  setStreak('sPlan',streak(e=>e.onPlan===true),'d');
  if(isDaily()){setStreak('sCheck',streak(e=>e.weight!=null),'d');$('sCheckLbl').textContent='Weigh-ins';}
  else{setStreak('sCheck',periodStreak(a.pts,S.every)*S.every/7,'wk');$('sCheckLbl').textContent='Check-ins on schedule';}
  renderRecap(a.pts);
  renderSignals();
  renderDebrief();
  renderHist(a.days);
  renderBanner();
  renderGallery();
  // home cards + tab subtitles
  const lp=a.pts[a.pts.length-1], ci=checkinStatus(a.pts), ciText=checkinText(ci);
  const t=$('hsTag'); t.textContent=v.tag; t.className='tag '+v.cls;
  $('hsTrend').textContent=lp?'Trend '+fmt(lp.t)+' lb':'No weigh-ins yet';
  $('hsNext').textContent=a.rate==null?'Trend needs a few more check-ins':(a.rate>0?'+':'')+fmt(a.rate,2)+' lb/wk on trend';
  renderToday(ci,ciText);
  renderCheckinCard(ci,ciText);
  const sName=isDaily()?'Daily weigh-ins':(S.every===7?'Weekly':'Bi-weekly')+' check-ins on '+DAY_NAMES[settings.checkinDay]+'s';
  $('progSub').textContent=sName+' · change in Settings';
  $('logHint').textContent=(hiInfo.created?'Calories and protein fill in from Apple Health each night. ':'Log food every day. ')+(isDaily()?'Weigh in daily.':'Weigh in + photo on check-in day.');
  for(const b of document.querySelectorAll('[data-sched]')) b.setAttribute('aria-pressed',b.dataset.sched===settings.schedule);
  for(const b of document.querySelectorAll('[data-day]')) b.setAttribute('aria-pressed',+b.dataset.day===settings.checkinDay);
  $('ciDayField').hidden=isDaily();
}
// Calories / protein progress bars toward today's targets (used on Home and in the Log form).
function fuelBars(box,cal,prot){
  const g=curGoals(); box.innerHTML='';
  const row=(name,val,goal,unit,overIsBad)=>{
    const r=document.createElement('div'); r.className='fuel-row';
    const pct=goal&&val!=null?Math.min(100,val/goal*100):0;
    const state=val==null?'':goal?(overIsBad?(val>goal?'over':val>=goal*0.9?'hit':''):(val>=goal?'hit':'')):'';
    const lbl=document.createElement('span'); lbl.className='fuel-name'; lbl.textContent=name;
    const num=document.createElement('span'); num.className='fuel-num num'+(state?' '+state:'');
    num.textContent=(val==null?'–':Math.round(val).toLocaleString())+(goal?' / '+goal.toLocaleString():'')+' '+unit;
    const bar=document.createElement('span'); bar.className='fuel-bar'+(state?' '+state:'');
    const fill=document.createElement('i'); fill.style.width=pct+'%'; bar.append(fill);
    r.append(lbl,num,bar); box.append(r);
  };
  row('Calories',cal,g.calories,'kcal',true);
  row('Protein',prot,g.protein,'g',false);
}
function renderToday(ci,ciText){
  const e=entries()[today()]||{};
  fuelBars($('homeFuel'),e.calories??null,e.protein??null);
  $('todayState').textContent=hasFood(e)?'Logged ✓':'Not logged yet';
  const c=$('todayCi'); c.textContent=ciText; c.className='today-ci '+ci.state;
  $('todayCard').classList.toggle('alert',ci.state==='due'||ci.state==='overdue');
}
function renderCheckinCard(ci,ciText){
  $('ciTitle').textContent=isDaily()?'Weigh-in':(sched().every===7?'Weekly':'Bi-weekly')+' check-in';
  const st=$('ciStatus'); st.textContent=ciText; st.className='ci-status '+ci.state;
  $('ciCard').classList.toggle('alert',ci.state==='due'||ci.state==='overdue');
}
function setStreak(id,n,unit){const el=$(id);el.textContent=n;const s=document.createElement('small');s.textContent=unit;el.append(s);}

// Summaries: daily fuel over the last 7 days, and check-ins over the schedule's period.
function fillRecap(box,rows){
  box.innerHTML='';
  for(const[k,val] of rows){const d=document.createElement('div');const a=document.createElement('span');a.textContent=k;const b=document.createElement('span');b.className='num';b.textContent=val;d.append(a,b);box.append(d);}
}
function renderRecap(pts){
  const S=sched(), g=curGoals(), end=today(), all=Object.values(entries());
  const inRange=(n)=>{const start=addDays(end,-(n-1));return all.filter(e=>e.date>=start&&e.date<=end);};
  const avg=(list,k)=>{const v=list.map(e=>e[k]).filter(x=>x!=null);return v.length?v.reduce((s,x)=>s+x,0)/v.length:null};
  const n=x=>x==null?'–':Math.round(x).toLocaleString();
  // Daily fuel, last 7 days
  const wk=inRange(7), withCal=wk.filter(e=>e.calories!=null), withProt=wk.filter(e=>e.protein!=null), answered=wk.filter(e=>e.onPlan!=null);
  fillRecap($('recapFood'),[
    ['Avg calories',n(avg(wk,'calories'))+(g.calories?' / '+g.calories.toLocaleString():'')],
    ['On calorie target',g.calories&&withCal.length?withCal.filter(e=>e.calories<=g.calories).length+' / '+withCal.length:'–'],
    ['Avg protein',avg(wk,'protein')==null?'–':n(avg(wk,'protein'))+(g.protein?' / '+g.protein:'')+' g'],
    ['Hit protein goal',g.protein&&withProt.length?withProt.filter(e=>e.protein>=g.protein).length+' / '+withProt.length:'–'],
    ['Avg steps',n(avg(wk,'steps'))],
    ['Days on plan',answered.length?answered.filter(e=>e.onPlan).length+' / '+answered.length:'–'],
    ['Food logged',wk.filter(hasFood).length+' / 7'],
  ]);
  // Check-ins over the schedule's period (7 days, 4 weeks or 8 weeks)
  const span=inRange(S.recap), start=addDays(end,-(S.recap-1));
  const tEnd=trendAt(pts,end), tStart=trendAt(pts,addDays(start,-1));
  const ch=tEnd&&tStart?tEnd.t-tStart.t:null;
  const weighs=pts.filter(p=>p.date>=start&&p.date<=end);
  fillRecap($('recap'),[
    ['Trend change',ch==null?'–':(ch>0?'+':'')+fmt(ch)+' lb'],
    [isDaily()?'Weigh-ins':'Check-ins',weighs.length+' / '+S.recap/S.every],
    ['Avg weight',avg(span,'weight')==null?'–':fmt(avg(span,'weight'))+' lb'],
    ['Photos',photos.filter(p=>p.date>=start&&p.date<=end).length+' / '+S.recap/S.every],
  ]);
  $('recapTitle').textContent=(isDaily()?'Weigh-ins':'Check-ins')+' · '+S.recapLabel.toLowerCase();
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
    m.textContent=[e.weight!=null&&!isDaily()?'Check-in'+(photoFor(e.date)?' + photo':''):null,e.calories!=null?e.calories.toLocaleString()+' cal':null,e.protein!=null?e.protein+' g protein':null,e.steps!=null?e.steps.toLocaleString()+' steps':null,rated].filter(Boolean).join(' · ')||(e.weight!=null?'Weight only':'Habits only');
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
// Daily fuel form: food, steps, plan, debrief. Only these fields are written; the day's
// weight (from a check-in) is left as it is.
const DAILY_FIELDS=['calories','protein','steps','onPlan','hunger','energy','sleep'];
function loadIntoForm(date){
  const e=entries()[date]||{};
  $('fDate').value=date; $('fCal').value=e.calories??''; $('fProt').value=e.protein??''; $('fSteps').value=e.steps??'';
  setPlan(e.onPlan??null);
  ratings={hunger:e.hunger??null,energy:e.energy??null,sleep:e.sleep??null}; paintRates($('formRates'),ratings);
  const exists=mode!=='example'&&!!entries()[date]&&(hasFood(e)||hasRatings(e));
  $('delBtn').hidden=!exists;
  $('formTitle').textContent=date===today()?'Today\'s fuel':'Fuel · '+short(date);
  $('saveBtn').textContent=exists?'Update day':'Save day';
  $('formMsg').textContent=''; $('formMsg').className='msg';
  updateFormFuel();
}
function updateFormFuel(){ fuelBars($('formFuel'),numOrNull('fCal'),numOrNull('fProt')); }
$('fCal').addEventListener('input',updateFormFuel); $('fProt').addEventListener('input',updateFormFuel);
// Check-in form: weight for a date (the photo for that date saves on its own when picked).
function loadCheckin(date){
  const e=entries()[date]||{};
  $('ciDate').value=date; $('ciWeight').value=mode==='example'?'':(e.weight??'');
  const has=mode!=='example'&&e.weight!=null;
  $('ciDel').hidden=!has; $('ciSave').textContent=has?'Update weight':'Save weight';
  $('ciMsg').textContent=''; $('ciMsg').className='msg';
  renderPhotoField();
}
// Tapping a day in History: switch to the Log tab with that day loaded in both cards.
function editDay(date){ location.hash='log'; loadIntoForm(date); loadCheckin(date); }
$('fDate').addEventListener('change',()=>{if($('fDate').value) loadIntoForm($('fDate').value)});
$('ciDate').addEventListener('change',()=>{if($('ciDate').value) loadCheckin($('ciDate').value)});
const numOrNull=id=>{const v=$(id).value.trim();return v===''?null:Number(v)};
// Writes fields into a day's record, deleting the record if nothing is left in it.
function saveDay(date,fields){
  if(mode==='example') mode=canStore?'mine':'memory';
  const e={...(mine[date]||{}),date,...fields};
  const empty=e.weight==null&&!hasFood(e)&&!hasRatings(e);
  if(empty){ delete mine[date]; synced.remove('e:'+date); } else { mine[date]=e; synced.touch('e:'+date); }
  render();
  return !canStore||save(KEY_ENTRIES,mine);
}
$('form').addEventListener('submit',ev=>{
  ev.preventDefault();
  const msg=$('formMsg'); msg.className='msg';
  const date=$('fDate').value;
  if(!date){msg.className='msg err';msg.textContent='Pick a date first.';return;}
  const f={calories:numOrNull('fCal'),protein:numOrNull('fProt'),steps:numOrNull('fSteps'),onPlan,...ratings};
  if(!hasFood(f)&&!hasRatings(f)){msg.className='msg err';msg.textContent='Enter calories, protein or steps, answer "Stuck to plan?", or rate the day.';return;}
  const ok=saveDay(date,f); loadIntoForm(date);
  if(!canStore) msg.textContent='Saved for this session.';
  else if(ok) msg.textContent='Saved.';
  else {msg.className='msg err';msg.textContent='Couldn\'t save. Your browser storage may be full.';}
});
$('delBtn').addEventListener('click',()=>{
  const date=$('fDate').value; if(!mine[date]) return;
  saveDay(date,Object.fromEntries(DAILY_FIELDS.map(k=>[k,null]))); loadIntoForm(date);
  $('formMsg').textContent='Cleared.';
});
$('ciForm').addEventListener('submit',ev=>{
  ev.preventDefault();
  const msg=$('ciMsg'); msg.className='msg';
  const date=$('ciDate').value, w=numOrNull('ciWeight');
  if(!date){msg.className='msg err';msg.textContent='Pick a date first.';return;}
  if(w==null||w<50||w>700){msg.className='msg err';msg.textContent='Enter your weight in pounds (50–700).';return;}
  const ok=saveDay(date,{weight:w}); loadCheckin(date);
  msg.textContent=!canStore?'Saved for this session.':ok?(photoFor(date)?'Check-in saved ✓':'Weight saved. Add your photo to finish the check-in.'):'Couldn\'t save.';
});
$('ciDel').addEventListener('click',()=>{
  const date=$('ciDate').value; if(!mine[date]||mine[date].weight==null) return;
  saveDay(date,{weight:null}); loadCheckin(date); $('ciMsg').textContent='Weight removed.';
});

/* ---------- settings: goals + check-in schedule ---------- */
function fillGoals(){$('gCal').value=goals.calories??'';$('gProt').value=goals.protein??'';$('gSteps').value=goals.steps??'';}
$('goalSave').addEventListener('click',()=>{
  goals={calories:numOrNull('gCal'),protein:numOrNull('gProt'),steps:numOrNull('gSteps')}; synced.touch('p:goals');
  render(); $('goalMsg').textContent='Saved.';
  if(canStore&&!save(KEY_GOALS,goals)) $('goalMsg').textContent='Couldn\'t save goals. Try again.';
});
// Check-in day (weekly / bi-weekly).
for(const b of document.querySelectorAll('[data-day]')){
  b.addEventListener('click',()=>{
    settings={...settings,checkinDay:+b.dataset.day}; synced.touch('p:settings');
    if(canStore) save(KEY_SETTINGS,settings);
    render();
  });
}
// The schedule buttons appear in both Progress and Settings; they share one setting.
for(const b of document.querySelectorAll('[data-sched]')){
  b.addEventListener('click',()=>{
    settings={...settings,schedule:b.dataset.sched}; synced.touch('p:settings');
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

/* ---------- progress photos ---------- */
// Photos are too big for localStorage (about 5 MB total), so they live in IndexedDB, the
// browser's larger on-device database. One photo per date, shrunk to 1280px on the long
// side as JPEG (roughly 150–300 KB) before saving. Nothing leaves the phone.
const PHOTO_DB='pinche-guey', PHOTO_STORE='photos';
let photoDBp=null, photos=[], photoURL={}; // photos: [{date,blob,w,h}] oldest first; photoURL: date -> object URL
let booted=false; // true once photos have loaded at startup (photo changes then refresh the whole UI)
function photoDB(){
  if(!photoDBp) photoDBp=new Promise((res,rej)=>{
    if(!window.indexedDB) return rej(new Error('IndexedDB unavailable'));
    const r=indexedDB.open(PHOTO_DB,1);
    r.onupgradeneeded=()=>r.result.createObjectStore(PHOTO_STORE,{keyPath:'date'});
    r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error);
  });
  return photoDBp;
}
// Runs one request in a transaction and resolves with its result when the transaction commits.
function idb(mode,fn){
  return photoDB().then(db=>new Promise((res,rej)=>{
    const tx=db.transaction(PHOTO_STORE,mode), req=fn(tx.objectStore(PHOTO_STORE));
    tx.oncomplete=()=>res(req.result); tx.onerror=tx.onabort=()=>rej(tx.error);
  }));
}
// Draws the picked image onto a canvas at a smaller size and re-encodes it as JPEG.
function compressImage(file,max=1280,quality=0.82){
  return new Promise((res,rej)=>{
    const src=URL.createObjectURL(file), img=new Image();
    img.onload=()=>{
      const k=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
      const w=Math.round(img.naturalWidth*k), h=Math.round(img.naturalHeight*k);
      const c=document.createElement('canvas'); c.width=w; c.height=h;
      c.getContext('2d').drawImage(img,0,0,w,h); URL.revokeObjectURL(src);
      c.toBlob(b=>b?res({blob:b,w,h}):rej(new Error('encode failed')),'image/jpeg',quality);
    };
    img.onerror=()=>{URL.revokeObjectURL(src);rej(new Error('decode failed'));};
    img.src=src;
  });
}
async function loadPhotos(){
  try{ photos=(await idb('readonly',st=>st.getAll())).sort((a,b)=>a.date<b.date?-1:1); }
  catch(e){ photos=[]; $('galleryMsg').textContent='Photos aren\'t available in this browser.'; }
  for(const u of Object.values(photoURL)) URL.revokeObjectURL(u);
  photoURL={}; for(const p of photos) photoURL[p.date]=URL.createObjectURL(p.blob);
  renderPhotoField(); renderGallery(); if(booted) render();
}
const photoFor=date=>photos.find(p=>p.date===date)||null;
const weightOn=date=>mine[date]?.weight??null; // real entries only, never example data
const photoCap=date=>short(date)+(weightOn(date)!=null?' · '+fmt(weightOn(date))+' lb':'');
// Log tab: photo for the date in the form, plus whether a photo is due on your schedule.
function renderPhotoField(){
  const date=$('ciDate').value, p=photoFor(date);
  $('photoThumb').hidden=!p; $('photoDel').hidden=!p;
  if(p) $('photoPrev').src=photoURL[date];
  $('photoAddLbl').textContent=p?'Replace':'Add photo';
  const last=photos.length?photos[photos.length-1].date:null;
  let msg;
  if(p) msg='Photo saved for '+short(date)+'.';
  else if(!last) msg='Take one as your starting point. Same spot, light and pose each check-in.';
  else msg='No photo for '+short(date)+' yet. Last one was '+short(last)+'.';
  $('photoMsg').textContent=msg;
}
$('photoInput').addEventListener('change',async ev=>{
  const file=ev.target.files&&ev.target.files[0]; ev.target.value=''; // reset so picking the same file again still fires
  if(!file) return;
  const date=$('ciDate').value; if(!date){$('photoMsg').textContent='Pick a date first.';return;}
  $('photoMsg').textContent='Saving photo…';
  try{
    const {blob,w,h}=await compressImage(file);
    await idb('readwrite',st=>st.put({date,blob,w,h,added:Date.now()})); synced.touch('f:'+date);
    if(navigator.storage&&navigator.storage.persist) navigator.storage.persist().catch(()=>{}); // ask the browser not to clear it
    await loadPhotos();
    $('ciMsg').className='msg';
    $('ciMsg').textContent=mine[date]&&mine[date].weight!=null?'Check-in complete ✓':'Photo saved. Add your weight to finish the check-in.';
  }catch(e){ $('photoMsg').textContent='Couldn\'t save that photo. Try a different one.'; }
});
$('photoDel').addEventListener('click',async()=>{
  const date=$('ciDate').value;
  if(!confirm('Remove the progress photo for '+short(date)+'?')) return;
  try{ await idb('readwrite',st=>st.delete(date)); synced.remove('f:'+date); await loadPhotos(); }
  catch(e){ $('photoMsg').textContent='Couldn\'t remove the photo. Try again.'; }
});
$('photoThumb').addEventListener('click',()=>openViewer($('ciDate').value));
// Progress → Visual log: first vs latest side by side, then every photo newest first.
function renderGallery(){
  const g=$('gallery'); g.innerHTML='';
  const cmp=photos.length>=2;
  $('compare').hidden=!cmp; $('cmpDelta').hidden=!cmp;
  if(cmp){
    const a=photos[0].date, b=photos[photos.length-1].date;
    $('cmpA').querySelector('img').src=photoURL[a]; $('cmpA').dataset.date=a; $('cmpACap').textContent='START · '+photoCap(a);
    $('cmpB').querySelector('img').src=photoURL[b]; $('cmpB').dataset.date=b; $('cmpBCap').textContent='LATEST · '+photoCap(b);
    const days=diffDays(a,b), wa=weightOn(a), wb=weightOn(b);
    const span=days>=14?Math.round(days/7)+' weeks':plural(days,'day');
    $('cmpDelta').textContent=(wa!=null&&wb!=null?((wb-wa)>0?'+':'')+fmt(wb-wa)+' lb over ':'')+span;
  }
  for(const p of [...photos].reverse()){
    const b=document.createElement('button'); b.type='button'; b.setAttribute('aria-label','Photo from '+short(p.date));
    const img=document.createElement('img'); img.src=photoURL[p.date]; img.alt=''; img.loading='lazy';
    const cap=document.createElement('span'); cap.textContent=short(p.date);
    b.append(img,cap); b.addEventListener('click',()=>openViewer(p.date)); g.append(b);
  }
  if(!$('galleryMsg').textContent.startsWith('Photos aren'))
    $('galleryMsg').textContent=photos.length?'':'No photos yet. Add one from the Log tab on your '+(isDaily()?'daily':settings.schedule==='weekly'?'weekly':'bi-weekly')+' weigh-in.';
}
for(const id of ['cmpA','cmpB']) $(id).addEventListener('click',()=>openViewer($(id).dataset.date));
// Full-screen viewer with previous/next.
let viewIdx=-1;
function openViewer(date){ viewIdx=photos.findIndex(p=>p.date===date); if(viewIdx<0) return; $('viewer').hidden=false; showViewer(); }
function showViewer(){
  const p=photos[viewIdx];
  $('vwImg').src=photoURL[p.date]; $('vwImg').alt='Progress photo from '+short(p.date);
  $('vwCap').textContent=photoCap(p.date)+'  ·  '+(viewIdx+1)+'/'+photos.length;
  $('vwPrev').disabled=viewIdx===0; $('vwNext').disabled=viewIdx===photos.length-1;
}
$('vwPrev').addEventListener('click',()=>{if(viewIdx>0){viewIdx--;showViewer();}});
$('vwNext').addEventListener('click',()=>{if(viewIdx<photos.length-1){viewIdx++;showViewer();}});
$('vwClose').addEventListener('click',()=>{$('viewer').hidden=true;});
$('viewer').addEventListener('click',ev=>{if(ev.target.id==='viewer') $('viewer').hidden=true;});
document.addEventListener('keydown',ev=>{if(ev.key==='Escape') $('viewer').hidden=true;});

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
    if(Object.keys(day).length) synced.touch('m:'+d); else synced.remove('m:'+d);
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
/* ---------- update check ---------- */
// GitHub Pages lets browsers keep the page for up to 10 minutes, so after a release a phone
// can still open the old version. On launch and whenever you come back to the app, ask the
// server for version.json (skipping every cache). If it's newer than this copy:
//  - during the intro (you've just opened the app): reload straight into the new version
//  - otherwise: show a small "tap to update" bar instead of interrupting you
// Reloading uses a new address (?v=…), which forces a fresh copy of the page.
function goToVersion(v){
  try{sessionStorage.setItem('cutcoach.tried',v);}catch(e){}
  location.replace(location.pathname+'?v='+v+location.hash);
}
async function checkForUpdate(){
  if(APP_VERSION==='dev') return;
  try{
    const r=await fetch('version.json?t='+Date.now(),{cache:'no-store'});
    if(!r.ok) return;
    const v=(await r.json()).v;
    if(!v||v===APP_VERSION) return;
    let tried=null; try{tried=sessionStorage.getItem('cutcoach.tried');}catch(e){}
    const introOn=!$('intro').hidden&&!$('intro').classList.contains('out');
    if(introOn&&tried!==v) goToVersion(v);   // only auto-reload once per version (no loops)
    else{ $('updateBar').hidden=false; $('updateBar').dataset.v=v; }
  }catch(e){} // offline or no version.json: just keep running this copy
}
$('updateBar').addEventListener('click',()=>goToVersion($('updateBar').dataset.v));

document.addEventListener('visibilitychange',()=>{
  if(document.hidden){hiddenAt=Date.now();return;}
  if(hiddenAt&&Date.now()-hiddenAt>10*60*1000){tick();playIntro();}
  checkForUpdate();
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

/* ---------- sync bridge (sync.js does the talking to the server) ---------- */
// sync.js only sees the app through these functions: list everything as records, apply
// a record that came from another device, and read/write photos.
const sync=window.createSync?window.createSync({
  load, save,
  localRecords(){
    const out={};
    for(const [d,e] of Object.entries(mine)) out['e:'+d]=e;
    for(const [d,m] of Object.entries(moods)) if(Object.keys(m).length) out['m:'+d]=m;
    out['p:goals']=goals; out['p:settings']=settings;
    for(const p of photos) out['f:'+p.date]={w:p.w,h:p.h};
    return out;
  },
  apply(key,data){ // data null = deleted on the other device
    const id=key.slice(2);
    if(key.startsWith('e:')){ if(data) mine[id]=data; else delete mine[id]; if(Object.keys(mine).length) mode=canStore?'mine':'memory'; if(canStore) save(KEY_ENTRIES,mine); }
    else if(key.startsWith('m:')){ moods={...moods}; if(data) moods[id]=data; else delete moods[id]; if(canStore) save(KEY_MOODS,moods); }
    else if(key==='p:goals'){ goals={...GOAL_DEFAULTS,...(data||{})}; if(canStore) save(KEY_GOALS,goals); }
    else if(key==='p:settings'){ settings={...SETTING_DEFAULTS,...(data||{})}; if(canStore) save(KEY_SETTINGS,settings); }
  },
  putPhoto:(date,blob,info)=>idb('readwrite',st=>st.put({date,blob,w:info.w,h:info.h,added:Date.now()})),
  removePhoto:date=>idb('readwrite',st=>st.delete(date)),
  photoBlob:async date=>(photoFor(date)||{}).blob||null,
  refresh(){ fillGoals(); render(); renderMood(); loadIntoForm($('fDate').value||today()); loadCheckin($('ciDate').value||today()); loadPhotos(); },
}):null;
const synced={touch:k=>{if(sync)sync.touch(k);},remove:k=>{if(sync)sync.remove(k);}};
// Settings → Sync panel, plus the dot next to the clock (steady = synced, pulsing fast =
// syncing, red-orange = problem).
function renderSync(){
  const st=sync?sync.status():{state:'unconfigured'};
  const on=st.state!=='unconfigured'&&st.state!=='loading'&&st.state!=='signedout'&&!!st.email;
  $('syncSignedOut').hidden=!(st.state==='signedout'||(st.state==='error'&&!st.email));
  $('syncSignedIn').hidden=!on;
  const when=st.lastSync?st.lastSync.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}):null;
  const text={
    unconfigured:'Sync isn\'t set up yet. Your data stays on this device. See README → Sync to connect your phone and laptop.',
    loading:'Connecting…',
    signedout:'Sign in to sync your logs, moods and photos between devices.',
    syncing:'Syncing…',
    idle:when?'Synced at '+when+'.':'Signed in.',
    error:'Sync problem: '+(st.error||'unknown error')+'.',
  }[st.state];
  $('syncStatus').textContent=(on?st.email+' · ':'')+text;
  const dot=document.querySelector('.pulse');
  dot.classList.toggle('syncing',st.state==='syncing'); dot.classList.toggle('sync-err',st.state==='error');
  dot.title=st.state==='error'?'Sync problem':st.state==='syncing'?'Syncing':on?'Synced':'Online';
}
if(sync) sync.onChange(()=>{renderSync();renderHealthImport();});
// Settings → Apple Health import. Needs sync sign-in, because the Shortcut writes to the
// same database. Checks once per signed-in account whether an import key already exists.
let hiInfo={email:null,created:null,checking:false};
function renderHealthImport(){
  const st=sync?sync.status():{state:'unconfigured'}, btn=$('hiBtn');
  if(!st.email){
    $('hiStatus').textContent='Sign in under Sync above first. The Shortcut sends your totals to the same database.';
    btn.disabled=true; btn.textContent='Create import key'; return;
  }
  if(hiInfo.email!==st.email&&!hiInfo.checking){
    hiInfo={email:null,created:null,checking:true};
    $('hiStatus').textContent='Checking…';
    sync.importKeyCreated()
      .then(c=>{hiInfo={email:st.email,created:c,checking:false};renderHealthImport();})
      .catch(e=>{hiInfo={email:st.email,created:null,checking:false};$('hiMsg').className='msg err';
        $('hiMsg').textContent=/ingest_keys/.test(e.message||'')?'Run supabase/health-import.sql in Supabase first (see README).':'Couldn\'t check: '+e.message;renderHealthImport();});
    return;
  }
  if(hiInfo.checking) return;
  btn.disabled=false;
  btn.textContent=hiInfo.created?'Reset import key':'Create import key';
  $('hiStatus').textContent=hiInfo.created
    ?'Connected. Key created '+new Date(hiInfo.created).toLocaleDateString(undefined,{month:'short',day:'numeric'})+'. Your Shortcut sends calories and protein, and they show up in that day\'s log.'
    :'Not connected yet. Create a key, then build the Shortcut using the steps that appear.';
}
$('hiBtn').addEventListener('click',async()=>{
  if(hiInfo.created&&!confirm('Make a new import key? The old one stops working, so you\'ll need to paste the new key into your Shortcut.')) return;
  const msg=$('hiMsg'); msg.className='msg'; msg.textContent='Creating key…';
  try{
    const key=await sync.newImportKey();
    $('hiKey').textContent=key;
    $('hiUrl').textContent=sync.config.url.replace(/\/+$/,'')+'/rest/v1/rpc/ingest_nutrition';
    $('hiApikey').textContent=sync.config.key;
    $('hiSetup').hidden=false; msg.textContent='';
    hiInfo={...hiInfo,created:new Date().toISOString()}; renderHealthImport();
  }catch(e){
    msg.className='msg err';
    msg.textContent=/ingest_keys/.test(e.message||'')?'Run supabase/health-import.sql in Supabase first (see README).':'Couldn\'t create the key: '+e.message;
  }
});
for(const b of document.querySelectorAll('[data-copy]')){
  b.addEventListener('click',async()=>{
    const text=$(b.dataset.copy).textContent;
    try{await navigator.clipboard.writeText(text);}
    catch(e){const r=document.createRange();r.selectNodeContents($(b.dataset.copy));const sel=getSelection();sel.removeAllRanges();sel.addRange(r);document.execCommand('copy');}
    const old=b.textContent; b.textContent='Copied ✓'; setTimeout(()=>{b.textContent=old;},1500);
  });
}
async function syncAuth(kind){
  const email=$('sEmail').value.trim(), pass=$('sPass').value;
  const msg=$('syncMsg'); msg.className='msg';
  if(!email||pass.length<6){msg.className='msg err';msg.textContent='Enter your email and a password of at least 6 characters.';return;}
  msg.textContent=kind==='in'?'Signing in…':'Creating account…';
  const err=kind==='in'?await sync.signIn(email,pass):await sync.signUp(email,pass);
  if(err&&!err.startsWith('Account created')){msg.className='msg err';msg.textContent=err;}
  else{msg.textContent=err; $('sPass').value='';}
}
$('sBtnIn').addEventListener('click',()=>syncAuth('in'));
$('sBtnUp').addEventListener('click',()=>syncAuth('up'));
$('sBtnNow').addEventListener('click',()=>sync.syncNow());
$('sBtnOut').addEventListener('click',async()=>{ if(confirm('Sign out? Your data stays on this device; it just stops syncing.')) await sync.signOut(); });

/* ---------- boot ---------- */
example=buildExample();
canStore=storageWorks();
if(canStore){
  mine=load(KEY_ENTRIES,{});
  goals={...GOAL_DEFAULTS,...load(KEY_GOALS,{})};
  settings={...SETTING_DEFAULTS,...load(KEY_SETTINGS,{})};
  moods=load(KEY_MOODS,{});
}
mode=Object.keys(mine).length?'mine':'example';
buildRates($('formRates'),(k,v)=>{ratings={...ratings,[k]:ratings[k]===v?null:v};paintRates($('formRates'),ratings);});
buildRates($('debriefRates'),(k,v)=>rateDay($('debriefCard').dataset.date,k,v));
fillGoals(); loadIntoForm(today()); loadCheckin(today()); render();
tick(); setInterval(tick,30000); // keeps the greeting, clock and check-in slot current
showQuote();
route();
playIntro();
checkForUpdate();
renderSync();
renderHealthImport();
loadPhotos().then(()=>{booted=true;render();if(sync)sync.init();});

// If the app is open in two tabs, pick up changes saved in the other one.
window.addEventListener('storage',ev=>{
  if(ev.key===KEY_ENTRIES){mine=load(KEY_ENTRIES,{});if(Object.keys(mine).length) mode='mine';}
  else if(ev.key===KEY_GOALS){goals={...GOAL_DEFAULTS,...load(KEY_GOALS,{})};fillGoals();}
  else if(ev.key===KEY_SETTINGS){settings={...SETTING_DEFAULTS,...load(KEY_SETTINGS,{})};}
  else if(ev.key===KEY_MOODS){moods=load(KEY_MOODS,{});renderMood();return;}
  else return;
  render();
});
})();
