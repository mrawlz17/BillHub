const APP_VERSION='0.4.0';
const FORECAST_MONTHS=6;
const DB_NAME='billhub-db', DB_VERSION=1;
let db, state=null, lastProjection=[];
let activeItem=null, editingRuleId=null, editingIncomeId=null, extraRelatedRuleId=null;
let activeMonthKey=null, pendingRestore=null, undoState=null, toastTimer=null;
let updateInfo={status:'checking',latest:null,checkedAt:null,error:null};

const $=id=>document.getElementById(id);
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(n||0));
const localDate=d=>{
  if(typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)) return new Date(d+'T12:00:00');
  return new Date(d);
};
const dstr=d=>localDate(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
const isoDate=d=>{
  const x=new Date(d); x.setHours(12,0,0,0);
  return x.toISOString().slice(0,10);
};
const todayISO=()=>isoDate(new Date());
const uid=()=>crypto.randomUUID();
const nowISO=()=>new Date().toISOString();

function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{
      const x=req.result;
      if(!x.objectStoreNames.contains('kv')) x.createObjectStore('kv');
    };
    req.onsuccess=()=>{db=req.result;resolve(db)};
    req.onerror=()=>reject(req.error);
  });
}
function idbGet(k){return new Promise((res,rej)=>{const r=db.transaction('kv').objectStore('kv').get(k);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function idbSet(k,v){return new Promise((res,rej)=>{const t=db.transaction('kv','readwrite');t.objectStore('kv').put(v,k);t.oncomplete=()=>res();t.onerror=()=>rej(t.error)})}
function idbDel(k){return new Promise((res,rej)=>{const t=db.transaction('kv','readwrite');t.objectStore('kv').delete(k);t.oncomplete=()=>res();t.onerror=()=>rej(t.error)})}

function blankState(){
 return {
  version:APP_VERSION,
  createdAt:nowISO(),
  categories:['Housing','Utilities','Vehicles','Fuel','Food','Insurance','Debt','Kids','School','Sports','Subscriptions','Taxes','Medical','Personal','Savings','Miscellaneous','Other'],
  balance:{amount:0,updatedAt:null},
  balanceHistory:[],
  bills:[],
  incomeRules:[],
  manualItems:[],
  reconciledEventIds:[],
  reserves:[],
  preferences:{},
  activity:[],
  backupMeta:{lastExportAt:null,lastExportVersion:null}
 };
}
async function save(){
  if(state) await idbSet('state',state);
  renderAll();
}

function logActivity(action,detail=''){
  if(!state)return;
  state.activity=state.activity||[];
  state.activity.unshift({id:uid(),at:nowISO(),action,detail});
  state.activity=state.activity.slice(0,60);
}
function prepareUndo(label){
  if(!state)return;
  undoState={label,state:structuredClone(state)};
}
function showToast(text,allowUndo=false){
  clearTimeout(toastTimer);
  $('toastText').textContent=text;
  $('toastUndoBtn').classList.toggle('hidden',!allowUndo||!undoState);
  $('toast').classList.remove('hidden');
  toastTimer=setTimeout(()=>$('toast').classList.add('hidden'),5000);
}
async function commitAction(label,detail,mutator,{toast=true}={}){
  prepareUndo(label);
  await mutator();
  logActivity(label,detail);
  await idbSet('state',state);
  renderAll();
  if(toast)showToast(label,true);
}
async function undoLastAction(){
  if(!undoState)return;
  const label=undoState.label;
  state=structuredClone(undoState.state);
  undoState=null;
  logActivity('Undo',`Reverted: ${label}`);
  await idbSet('state',state);
  renderAll();
  showToast(`Undid: ${label}`,false);
}

function addMonths(date,n){const d=new Date(date);d.setMonth(d.getMonth()+n);return d}
function secondMonday(year,month){
  const d=new Date(year,month,1,12);
  const dow=d.getDay();
  const firstMonday=1+((1-dow+7)%7);
  return new Date(year,month,firstMonday+7,12);
}
function safeDay(year,month,day){
  const last=new Date(year,month+1,0).getDate();
  return new Date(year,month,Math.min(day,last),12);
}
function biweeklyDates(anchor,start,end){
  let a=new Date(anchor+'T12:00:00');
  while(a>start) a=new Date(a.getTime()-14*86400000);
  while(a<start) a=new Date(a.getTime()+14*86400000);
  const arr=[]; for(let d=new Date(a);d<=end;d=new Date(d.getTime()+14*86400000))arr.push(new Date(d));
  return arr;
}

function genBillOccurrences(start,end){
 const out=[];
 for(const b of state.bills.filter(x=>x.active!==false)){
   if(b.schedule==='monthly_day'){
     let cur=new Date(start.getFullYear(),start.getMonth(),1,12);
     const stop=new Date(end.getFullYear(),end.getMonth(),1,12);
     while(cur<=stop){
       const dt=safeDay(cur.getFullYear(),cur.getMonth(),b.day||1);
       if(dt>=start && dt<=end)out.push({id:`rule:${b.id}:${isoDate(dt)}`,ruleId:b.id,type:'expense',kind:b.kind||'bill',name:b.name,category:b.category,amount:+b.amount,date:isoDate(dt),status:'upcoming',generated:true});
       cur=addMonths(cur,1);
     }
   }else if(b.schedule==='biweekly'&&b.anchor){
     for(const dt of biweeklyDates(b.anchor,start,end))out.push({id:`rule:${b.id}:${isoDate(dt)}`,ruleId:b.id,type:'expense',kind:b.kind||'pool',name:b.name,category:b.category,amount:+b.amount,date:isoDate(dt),status:'upcoming',generated:true});
   }else if(b.schedule==='second_monday'){
     let cur=new Date(start.getFullYear(),start.getMonth(),1,12);
     const stop=new Date(end.getFullYear(),end.getMonth(),1,12);
     while(cur<=stop){
       const dt=secondMonday(cur.getFullYear(),cur.getMonth());
       if(dt>=start&&dt<=end)out.push({id:`rule:${b.id}:${isoDate(dt)}`,ruleId:b.id,type:'expense',kind:b.kind||'bill',name:b.name,category:b.category,amount:+b.amount,date:isoDate(dt),status:'upcoming',generated:true});
       cur=addMonths(cur,1);
     }
   }
 }
 return out;
}
function genIncomeOccurrences(start,end){
 const out=[];
 for(const r of state.incomeRules.filter(x=>x.active!==false)){
   if(r.schedule==='twice_monthly'){
     let cur=new Date(start.getFullYear(),start.getMonth(),1,12), stop=new Date(end.getFullYear(),end.getMonth(),1,12);
     while(cur<=stop){
       for(const day of [10,25]){
         const dt=safeDay(cur.getFullYear(),cur.getMonth(),day);
         if(dt>=start&&dt<=end)out.push({id:`income:${r.id}:${isoDate(dt)}`,ruleId:r.id,type:'income',kind:'paycheck',name:r.name,category:'Income',amount:+r.amount,date:isoDate(dt),status:'upcoming',generated:true});
       }
       cur=addMonths(cur,1);
     }
   } else if(r.schedule==='biweekly'&&r.anchor){
     for(const dt of biweeklyDates(r.anchor,start,end))out.push({id:`income:${r.id}:${isoDate(dt)}`,ruleId:r.id,type:'income',kind:'paycheck',name:r.name,category:'Income',amount:+r.amount,date:isoDate(dt),status:'upcoming',generated:true});
   } else if(r.schedule==='second_monday'){
     let cur=new Date(start.getFullYear(),start.getMonth(),1,12),stop=new Date(end.getFullYear(),end.getMonth(),1,12);
     while(cur<=stop){
       const dt=secondMonday(cur.getFullYear(),cur.getMonth());
       if(dt>=start&&dt<=end)out.push({id:`income:${r.id}:${isoDate(dt)}`,ruleId:r.id,type:'income',kind:'paycheck',name:r.name,category:'Income',amount:+r.amount,date:isoDate(dt),status:'upcoming',generated:true});
       cur=addMonths(cur,1);
     }
   }
 }
 return out;
}

function projectedItems(months=FORECAST_MONTHS){
 const checkpoint=state.balance.updatedAt?new Date(state.balance.updatedAt):new Date();
 const start=new Date(checkpoint); start.setHours(0,0,0,0);
 const end=addMonths(start,months); end.setDate(end.getDate()+5);
 let gen=[...genBillOccurrences(start,end),...genIncomeOccurrences(start,end)];
 const manuals=(state.manualItems||[]).filter(x=>new Date(x.date+'T12:00:00')>=start&&new Date(x.date+'T12:00:00')<=end);
 const suppressExact=new Set(manuals.filter(x=>x.overrideRuleId).map(x=>`${x.overrideRuleId}|${x.date}`));
 const suppressMonth=new Set(manuals.filter(x=>x.overrideRuleId).map(x=>`${x.overrideRuleId}|${x.overrideMonth||x.date.slice(0,7)}`));
 const suppressNameMonth=new Set(manuals.filter(x=>x.overrideRuleName).map(x=>`${x.overrideRuleName}|${x.overrideMonth||x.date.slice(0,7)}`));
 gen=gen.filter(x=>
   !suppressExact.has(`${x.ruleId}|${x.date}`) &&
   !suppressMonth.has(`${x.ruleId}|${x.date.slice(0,7)}`) &&
   !suppressNameMonth.has(`${x.name}|${x.date.slice(0,7)}`)
 );
 return [...gen,...manuals].sort((a,b)=>a.date.localeCompare(b.date)||(a.type==='income'?-1:1));
}
function projection(months=FORECAST_MONTHS){
 const items=projectedItems(months);
 let bal=+state.balance.amount||0, low=bal, lowDate=state.balance.updatedAt||nowISO();
 const rows=[];
 for(const x of items){
   if(x.status==='cleared'||x.status==='received'||x.status==='skipped') continue;
   bal += x.type==='income'?+x.amount:-Math.abs(+x.amount);
   rows.push({...x,projectedBalance:bal});
   if(bal<low){low=bal;lowDate=x.date}
 }
 return {items,rows,ending:bal,low,lowDate};
}
function monthBuckets(months=FORECAST_MONTHS){
 const items=projectedItems(months);
 const startDate=state.balance.updatedAt?new Date(state.balance.updatedAt):new Date();
 let working=+state.balance.amount||0;
 const result=[];
 for(let i=0;i<months;i++){
   const mStart=new Date(startDate.getFullYear(),startDate.getMonth()+i,1,12);
   const mEnd=new Date(startDate.getFullYear(),startDate.getMonth()+i+1,0,12);
   const opening=working;
   let income=0,expenses=0;
   const monthItems=[];
   for(const x of items){
     const dt=new Date(x.date+'T12:00:00');
     if(dt<mStart||dt>mEnd)continue;
     if(x.status==='cleared'||x.status==='received'||x.status==='skipped')continue;
     if(x.type==='income'){income+=+x.amount;working+=+x.amount}
     else {expenses+=Math.abs(+x.amount);working-=Math.abs(+x.amount)}
     monthItems.push({...x,projectedAfter:working});
   }
   const key=`${mStart.getFullYear()}-${String(mStart.getMonth()+1).padStart(2,'0')}`;
   const incomeCounts={};
   for(const x of monthItems.filter(x=>x.type==='income'))incomeCounts[x.name]=(incomeCounts[x.name]||0)+1;
   const threePaySources=(state.incomeRules||[])
     .filter(r=>r.schedule==='biweekly' && (incomeCounts[r.name]||0)>=3)
     .map(r=>r.name);
   result.push({
     key,
     label:mStart.toLocaleDateString('en-US',{month:'short',year:'numeric'}),
     longLabel:mStart.toLocaleDateString('en-US',{month:'long',year:'numeric'}),
     opening,income,expenses,net:income-expenses,ending:working,items:monthItems,
     incomeCounts,threePaySources
   });
 }
 return result;
}

function statusBadge(x){
 let s=x.status||'upcoming';
 if(s==='received')s='cleared';
 return `<span class="badge ${s}">${s}</span>`;
}
function entryTags(x){
 const tags=[];
 if(x.kind==='catchup')tags.push(['CATCH-UP','catchup']);
 else if(x.kind==='extra')tags.push(['EXTRA','extra']);
 else if(x.kind==='reconciliation')tags.push(['RECONCILE','reconcile']);
 if(x.overrideRuleId && x.kind!=='catchup')tags.push(['OVERRIDE','override']);
 if(x.kind==='pool')tags.push(['POOL','pool']);
 if(x.status==='skipped')tags.push(['SKIPPED','skipped']);
 if(!tags.length)return '';
 return `<span class="entry-badges">${tags.map(([t,c])=>`<span class="entry-tag ${c}">${t}</span>`).join('')}</span>`;
}
function cashItemHTML(x,{showAfter=true}={}){
 return `<div class="month-cash-item ${x.type==='income'?'income':''} ${x.status==='pending'?'pending':''}" data-id="${x.id}">
   <div class="cash-date">${new Date(x.date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}</div>
   <div class="cash-main">
     <strong>${x.name}</strong>${statusBadge(x)}${entryTags(x)}
     <div class="muted small">${x.category||''}${x.dueDay?` · due ${x.dueDay}${ordinal(x.dueDay)}`:''}</div>
   </div>
   <div class="cash-money">
     <div class="amt ${x.type==='income'?'positive':''}">${x.type==='income'?'+':'-'}${money(x.amount)}</div>
     ${showAfter?`<div class="muted small">after ${money(x.projectedAfter??x.projectedBalance)}</div>`:''}
   </div>
   <div class="cash-chevron">›</div>
 </div>`;
}
function monthMathHTML(m){
 return `<div><span>Starting</span><strong>${money(m.opening)}</strong></div>
   <div><span>Income</span><strong class="positive">+${money(m.income)}</strong></div>
   <div><span>Outflow</span><strong>-${money(m.expenses)}</strong></div>
   <div><span>Ending</span><strong class="${m.ending<0?'negative':''}">${money(m.ending)}</strong></div>`;
}

function renderDashboard(){
 $('currentBalance').textContent=money(state.balance.amount);
 $('balanceUpdated').textContent=state.balance.updatedAt?`Updated ${new Date(state.balance.updatedAt).toLocaleString()}`:'Not updated';
 const p=projection(FORECAST_MONTHS);
 const buckets=monthBuckets(FORECAST_MONTHS);
 lastProjection=p.rows;
 const pending=(state.manualItems||[]).filter(x=>x.type==='expense'&&x.status==='pending').reduce((s,x)=>s+Math.abs(+x.amount),0);
 $('pendingOutflows').textContent=money(pending);
 const ni=p.items.find(x=>x.type==='income'&&x.status!=='received'&&x.status!=='skipped');
 $('nextIncome').textContent=ni?money(ni.amount):'$0.00';
 $('nextIncomeDate').textContent=ni?`${ni.name} · ${dstr(ni.date)}`:'—';
 $('lowestBalance').textContent=money(p.low);
 $('lowestBalance').className='metric '+(p.low<0?'negative':'');
 $('lowestBalanceDate').textContent=dstr(p.lowDate);

 const current=buckets[0];
 if(current){
   $('thisMonthTitle').innerHTML=`<span>${current.longLabel}</span>${current.threePaySources.length?`<span class="payday-badge">3-paycheck month · ${current.threePaySources.join(', ')}</span>`:''}`;
   $('thisMonthStats').innerHTML=monthMathHTML(current);
   $('viewCurrentMonthBtn').dataset.monthKey=current.key;
 }

 const nextRows=p.rows.slice(0,8).map(x=>({...x,projectedAfter:x.projectedBalance}));
 $('nextUpList').innerHTML=nextRows.length?nextRows.map(x=>cashItemHTML(x)).join(''):'<p class="muted">No upcoming projected activity.</p>';
 document.querySelectorAll('#nextUpList .month-cash-item').forEach(el=>el.addEventListener('click',()=>openItemDialog(el.dataset.id)));

 $('monthCards').innerHTML=buckets.map(m=>`
   <div class="forecast-row" data-month-key="${m.key}" role="button" tabindex="0" aria-label="Open ${m.longLabel} details">
     <div class="forecast-month">
       <div class="forecast-month-line"><strong>${m.label}</strong>${m.threePaySources.length?`<span class="payday-badge">3× ${m.threePaySources.join(', ')}</span>`:''}</div>
       <span class="muted small">${m.net>=0?'+':''}${money(m.net)} net</span>
     </div>
     <div class="forecast-stat forecast-start"><span class="forecast-stat-label">Start</span><strong>${money(m.opening)}</strong></div>
     <div class="forecast-stat forecast-income"><span class="forecast-stat-label">Income</span><strong class="positive">+${money(m.income)}</strong></div>
     <div class="forecast-stat forecast-out"><span class="forecast-stat-label">Out</span><strong>-${money(m.expenses)}</strong></div>
     <div class="forecast-stat forecast-end ${m.ending<0?'negative':''}"><span class="forecast-stat-label">End</span><strong>${money(m.ending)}</strong></div>
   </div>`).join('');
 document.querySelectorAll('[data-month-key]').forEach(el=>{
   const open=()=>openMonthDetail(el.dataset.monthKey);
   el.addEventListener('click',open);
   el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open()}});
 });
}
function renderPlan(){
 const sortedBills=[...state.bills].sort((a,b)=>{
   const rank=x=>x.schedule==='monthly_day'?(x.day||99):x.schedule==='second_monday'?8:50;
   return rank(a)-rank(b)||a.name.localeCompare(b.name);
 });
 $('billsList').innerHTML=sortedBills.length?sortedBills.map(b=>`
  <div class="list-row" data-rule-id="${b.id}">
   <div>${b.schedule==='monthly_day'?`${b.day}${ordinal(b.day)}`:b.schedule==='biweekly'?'2 weeks':'2nd Mon'}</div>
   <div><strong>${b.name}</strong><div class="muted small">${b.category} · ${b.kind==='pool'?'Spending pool':'Recurring bill'}</div></div>
   <div class="amt">${money(b.amount)}</div>
  </div>`).join(''):'<p class="muted">No recurring bills yet.</p>';
 $('incomeList').innerHTML=state.incomeRules.length?state.incomeRules.map(r=>`
  <div class="list-row" data-income-id="${r.id}">
   <div>${r.schedule==='twice_monthly'?'10 / 25':r.schedule==='biweekly'?'2 weeks':'2nd Mon'}</div>
   <div><strong>${r.name}</strong><div class="muted small">${r.schedule.replaceAll('_',' ')}</div></div>
   <div class="amt">${money(r.amount)}</div>
  </div>`).join(''):'<p class="muted">No income sources yet.</p>';
 document.querySelectorAll('[data-rule-id]').forEach(el=>el.addEventListener('click',()=>openRuleDialog(el.dataset.ruleId)));
 document.querySelectorAll('[data-income-id]').forEach(el=>el.addEventListener('click',()=>openIncomeDialog(el.dataset.incomeId)));
}
function ordinal(n){const s=['th','st','nd','rd'],v=n%100;return (s[(v-20)%10]||s[v]||s[0])}
function renderReports(){
 const activity=(state.activity||[]).slice(0,15);
 $('recentActivity').innerHTML=activity.length?activity.map(a=>`
   <div class="activity-row">
     <div class="activity-time">${new Date(a.at).toLocaleDateString('en-US',{month:'short',day:'numeric'})}<br>${new Date(a.at).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}</div>
     <div class="activity-main"><strong>${a.action}</strong>${a.detail?`<div class="activity-detail">${a.detail}</div>`:''}</div>
   </div>`).join(''):'<p class="muted">No activity recorded yet.</p>';
 $('undoLastActionBtn').disabled=!undoState;
 $('undoLastActionBtn').title=undoState?`Undo: ${undoState.label}`:'Nothing to undo in this session';

 const cleared=(state.manualItems||[]).filter(x=>x.type==='expense'&&x.status==='cleared');
 const sums={};
 for(const x of cleared)sums[x.category||'Other']=(sums[x.category||'Other']||0)+Math.abs(+x.amount);
 const entries=Object.entries(sums).sort((a,b)=>b[1]-a[1]);
 $('categoryReport').innerHTML=entries.length?entries.map(([k,v])=>`<div class="report-row"><div></div><div>${k}</div><div class="amt">${money(v)}</div></div>`).join(''):'<p class="muted">No cleared spending yet.</p>';
 $('balanceHistory').innerHTML=(state.balanceHistory||[]).slice().reverse().map(h=>`<div class="history-row"><div>${dstr(h.at)}</div><div class="muted small">${h.note||'Balance checkpoint'}</div><div class="amt">${money(h.amount)}</div></div>`).join('')||'<p class="muted">No balance history yet.</p>';
}
function daysSince(iso){return iso?Math.floor((Date.now()-new Date(iso).getTime())/86400000):null}
function renderSettings(){
 const last=state.backupMeta?.lastExportAt||null;
 const age=daysSince(last);
 $('backupStatus').innerHTML=`<div class="backup-status-grid">
   <div><div class="muted small">Last manual backup</div><strong>${last?new Date(last).toLocaleString():'No backup recorded'}</strong></div>
   <div class="backup-age ${age!==null&&age>=14?'backup-warning':''}">${last?(age===0?'Today':`${age} day${age===1?'':'s'} ago`):'Backup recommended'}</div>
 </div>${age!==null&&age>=14?'<div class="muted small backup-warning" style="margin-top:8px">Backup recommended — your last recorded export is more than 14 days old.</div>':''}`;
 $('appVersion').textContent=`v${APP_VERSION}`;
 const pill=$('updateStatus'), detail=$('updateDetail'), apply=$('applyUpdateBtn');
 pill.className='update-pill';
 if(updateInfo.status==='available'){
   pill.textContent=`v${updateInfo.latest} available`;pill.classList.add('available');
   detail.textContent='A newer hosted Bill Hub version is available. Updating reloads the app shell and keeps IndexedDB financial data intact.';
   apply.classList.remove('hidden');
 }else if(updateInfo.status==='ok'){
   pill.textContent='Up to date';pill.classList.add('ok');
   detail.textContent=`Installed v${APP_VERSION}. Last checked ${new Date(updateInfo.checkedAt).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}.`;
   apply.classList.add('hidden');
 }else if(updateInfo.status==='error'){
   pill.textContent='Check unavailable';pill.classList.add('error');
   detail.textContent='Bill Hub could not reach the hosted version file. You can retry or use Force refresh app.';
   apply.classList.add('hidden');
 }else{
   pill.textContent='Checking…';
   detail.textContent='Bill Hub checks the hosted app for a newer version. Updating never clears IndexedDB financial data.';
   apply.classList.add('hidden');
 }
}
function renderAll(){
 const setup=!state;
 $('setupView').classList.toggle('hidden',!setup);
 $('dashboardView').classList.toggle('hidden',setup||currentView!=='dashboardView');
 $('planView').classList.toggle('hidden',setup||currentView!=='planView');
 $('reportsView').classList.toggle('hidden',setup||currentView!=='reportsView');
 $('settingsView').classList.toggle('hidden',setup||currentView!=='settingsView');
 document.querySelector('.bottomnav').classList.toggle('hidden',setup);
 $('backupBtn').classList.toggle('hidden',setup);
 if(!state)return;
 fillCategorySelects();
 renderDashboard();renderPlan();renderReports();renderSettings();
}
function fillCategorySelects(){
 const opts=state.categories.map(c=>`<option>${c}</option>`).join('');
 ['extraCategory','ruleCategory','itemCategory'].forEach(id=>$(id).innerHTML=opts);
}
let currentView='dashboardView';
document.querySelectorAll('.bottomnav button').forEach(b=>b.addEventListener('click',()=>{
 currentView=b.dataset.view;document.querySelectorAll('.bottomnav button').forEach(x=>x.classList.toggle('active',x===b));renderAll();
 if(currentView==='settingsView' && (!updateInfo.checkedAt || Date.now()-new Date(updateInfo.checkedAt).getTime()>15*60000))checkForUpdate();
}));

function openMonthDetail(key){
 const m=monthBuckets(FORECAST_MONTHS).find(x=>x.key===key);if(!m)return;
 activeMonthKey=key;
 $('monthDetailTitle').textContent=m.longLabel;
 $('monthDetailSub').innerHTML=`${m.net>=0?'+':''}${money(m.net)} net ${m.threePaySources.length?` · <span class="positive">3-paycheck month · ${m.threePaySources.join(', ')}</span>`:''}`;
 $('monthDetailMath').innerHTML=monthMathHTML(m);
 $('monthDetailItems').innerHTML=m.items.length?m.items.map(x=>cashItemHTML(x)).join(''):'<div class="empty-month">No projected activity.</div>';
 $('monthDetailItems').querySelectorAll('.month-cash-item').forEach(el=>el.addEventListener('click',()=>{
   $('monthDetailDialog').close();openItemDialog(el.dataset.id);
 }));
 $('monthDetailDialog').showModal();focusDialogTitle('monthDetailTitle');
}
$('closeMonthDetailBtn').addEventListener('click',()=>{$('monthDetailDialog').close();activeMonthKey=null});
$('viewCurrentMonthBtn').addEventListener('click',e=>openMonthDetail(e.currentTarget.dataset.monthKey));

function itemMonth(x){return (x.overrideMonth||x.date||'').slice(0,7)}
function recurringRuleForItem(item){
 if(!item) return null;
 const id=item.ruleId||item.overrideRuleId||item.relatedRuleId;
 if(!id) return null;
 return item.type==='income' ? state.incomeRules.find(x=>x.id===id) : state.bills.find(x=>x.id===id);
}
function findProjectedItem(id){return projectedItems(FORECAST_MONTHS).find(x=>x.id===id)||(state.manualItems||[]).find(x=>x.id===id)}
function findMonthOverride(item){
 const rid=item.ruleId||item.overrideRuleId;
 if(!rid) return null;
 const month=item.overrideMonth||item.date.slice(0,7);
 return (state.manualItems||[]).find(x=>x.overrideRuleId===rid&&(x.overrideMonth||x.date.slice(0,7))===month)||null;
}
function materializeOccurrence(item){
 if(!item.generated){
   if(item.overrideRuleId&&!item.overrideMonth)item.overrideMonth=item.date.slice(0,7);
   return item;
 }
 const existing=findMonthOverride(item);
 if(existing)return existing;
 const manual={...item,id:uid(),generated:false,overrideRuleId:item.ruleId,overrideRuleName:item.name,overrideMonth:item.date.slice(0,7),reconciled:false};
 delete manual.ruleId;
 state.manualItems.push(manual);
 return manual;
}
function setItemStatusOptions(item){
 if(item.type==='income'){
   $('itemStatus').innerHTML='<option value="upcoming">Upcoming</option><option value="received">Received</option>';
 }else{
   $('itemStatus').innerHTML='<option value="upcoming">Upcoming</option><option value="pending">Pending / submitted</option><option value="cleared">Cleared</option>';
 }
}
function focusDialogTitle(id){
 requestAnimationFrame(()=>{
   const el=$(id);
   if(el){try{el.focus({preventScroll:true})}catch(_){el.focus()}}
 });
}
function canDeleteItem(item){
 if(!item || item.generated)return false;
 if(item.overrideRuleId)return false;
 return ['catchup','extra','reconciliation'].includes(item.kind)||!item.relatedRuleId;
}
function itemContextText(item,rule){
 if(item.kind==='catchup')return `One-time catch-up payment${rule?` tied to ${rule.name}`:''}. Deleting it removes only this entry.`;
 if(item.kind==='extra')return 'One-time extra. Deleting it removes only this entry.';
 if(item.kind==='reconciliation')return 'Balance-reconciliation entry created from an unexplained bank-balance difference.';
 if(item.overrideRuleId)return `${new Date((item.overrideMonth||item.date.slice(0,7))+'-01T12:00:00').toLocaleDateString('en-US',{month:'long',year:'numeric'})} only — month-specific override${rule?` for ${rule.name}`:''}. Future months keep the recurring default.`;
 if(rule)return `Recurring default: ${money(rule.amount)}. Saving here changes this occurrence only; future months keep the recurring default.`;
 return 'This is a one-time item. Changes apply only to this entry.';
}
function openItemDialog(id){
 const item=findProjectedItem(id);if(!item)return;
 activeItem=item;
 const rule=recurringRuleForItem(item);
 $('itemDialogTitle').textContent=item.name;
 $('itemTypeSummary').innerHTML=entryTags(item);
 $('itemAmount').value=(+item.amount||0).toFixed(2);
 $('itemDate').value=item.date;
 $('itemCategory').value=item.category||'Other';
 setItemStatusOptions(item);
 $('itemStatus').value=item.status==='skipped'?'upcoming':(item.status||'upcoming');
 const isPool=item.kind==='pool';
 $('itemAmountLabel').childNodes[0].nodeValue=isPool?'Remaining this period ':'Amount ';
 $('itemRuleNote').textContent=itemContextText(item,rule);
 const directRecurringId=item.ruleId||item.overrideRuleId;
 $('editRecurringFromItemBtn').classList.toggle('hidden',!directRecurringId);
 $('editRecurringFromItemBtn').textContent=item.type==='income'?'Edit recurring income':'Edit recurring bill';
 $('addCatchupBtn').classList.toggle('hidden',item.type==='income');
 $('skipMonthBtn').classList.toggle('hidden',!directRecurringId);
 $('deleteItemBtn').classList.toggle('hidden',!canDeleteItem(item));
 $('itemDialog').showModal();focusDialogTitle('itemDialogTitle');
}
$('closeItemBtn').addEventListener('click',()=>{$('itemDialog').close();activeItem=null});
$('itemForm').addEventListener('submit',async e=>{
 e.preventDefault();if(!activeItem)return;
 const originalName=activeItem.name;
 await commitAction('Month entry updated',`${originalName} · ${$('itemDate').value}`,async()=>{
   const m=materializeOccurrence(activeItem);
   m.amount=Math.abs(+$('itemAmount').value||0);
   m.date=$('itemDate').value;
   m.category=$('itemCategory').value;
   m.status=$('itemStatus').value;
   m.clearedAt=(m.status==='cleared'||m.status==='received')?nowISO():null;
   m.reconciled=false;
 });
 $('itemDialog').close();activeItem=null;
});
$('skipMonthBtn').addEventListener('click',async()=>{
 if(!activeItem)return;
 const rule=recurringRuleForItem(activeItem);if(!rule)return;
 if(!confirm(`Skip ${activeItem.name} for this occurrence only? Future recurring months will remain unchanged.`))return;
 const name=activeItem.name;
 await commitAction('Month skipped',name,async()=>{
   const m=materializeOccurrence(activeItem);
   m.originalAmount=m.originalAmount||m.amount;
   m.amount=0;m.status='skipped';m.clearedAt=null;m.reconciled=true;
 });
 $('itemDialog').close();activeItem=null;
});
$('deleteItemBtn').addEventListener('click',async()=>{
 if(!activeItem||!canDeleteItem(activeItem))return;
 const name=activeItem.name;
 if(!confirm(`Delete “${name}”? This removes only this one-time/manual entry.`))return;
 await commitAction('Entry deleted',name,async()=>{
   state.manualItems=(state.manualItems||[]).filter(x=>x.id!==activeItem.id);
 });
 $('itemDialog').close();activeItem=null;
});
$('editRecurringFromItemBtn').addEventListener('click',()=>{
 if(!activeItem)return;
 const id=activeItem.ruleId||activeItem.overrideRuleId;
 const type=activeItem.type;
 $('itemDialog').close();
 if(type==='income')openIncomeDialog(id);else openRuleDialog(id);
});
$('addCatchupBtn').addEventListener('click',()=>{
 if(!activeItem)return;
 const rid=activeItem.ruleId||activeItem.overrideRuleId||activeItem.relatedRuleId||null;
 extraRelatedRuleId=rid;
 $('extraForm').reset();
 $('extraDialogTitle').textContent='Add extra / catch-up payment';
 $('extraName').value=`${activeItem.name} – Catch-up`;
 $('extraDate').value=activeItem.date||todayISO();
 $('extraCategory').value=activeItem.category||'Other';
 $('extraStatus').value='upcoming';
 $('itemDialog').close();$('extraDialog').showModal();focusDialogTitle('extraDialogTitle');
});

$('updateBalanceBtn').addEventListener('click',()=>{
 $('newBalanceInput').value=state.balance.amount.toFixed(2);$('reconcilePreview').classList.add('hidden');$('balanceDialog').showModal();focusDialogTitle('balanceDialogTitle');
});
$('newBalanceInput').addEventListener('input',()=>{
 const newBal=+$('newBalanceInput').value;if(!Number.isFinite(newBal))return;
 const events=(state.manualItems||[]).filter(x=>(x.status==='cleared'||x.status==='received')&&!x.reconciled);
 let expected=+state.balance.amount;
 for(const x of events)expected+=x.type==='income'?+x.amount:-Math.abs(+x.amount);
 const diff=newBal-expected;
 $('reconcilePreview').classList.remove('hidden');
 $('reconcilePreview').innerHTML=`Expected after newly cleared items: <strong>${money(expected)}</strong><br>Unexplained difference: <strong class="${diff<0?'negative':'positive'}">${money(diff)}</strong><br><span class="muted">Negative becomes Misc Daily; positive becomes Uncategorized Credit.</span>`;
});
$('balanceForm').addEventListener('submit',async e=>{
 e.preventDefault();
 const newBal=+$('newBalanceInput').value;if(!Number.isFinite(newBal))return;
 const oldBal=+state.balance.amount;
 await commitAction('Balance updated',`${money(oldBal)} → ${money(newBal)}`,async()=>{
   const events=(state.manualItems||[]).filter(x=>(x.status==='cleared'||x.status==='received')&&!x.reconciled);
   let expected=+state.balance.amount;
   for(const x of events)expected+=x.type==='income'?+x.amount:-Math.abs(+x.amount);
   const diff=+(newBal-expected).toFixed(2);
   events.forEach(x=>x.reconciled=true);
   if(Math.abs(diff)>=0.01){
     state.manualItems.push({
       id:uid(),type:diff<0?'expense':'income',kind:'reconciliation',
       name:diff<0?'Misc Daily':'Uncategorized Credit',
       category:diff<0?'Miscellaneous':'Other',amount:Math.abs(diff),date:todayISO(),
       status:diff<0?'cleared':'received',clearedAt:nowISO(),reconciled:true,generated:false
     });
   }
   state.balance={amount:newBal,updatedAt:nowISO()};
   state.balanceHistory.push({at:state.balance.updatedAt,amount:newBal,note:'Daily balance update'});
 });
 $('balanceDialog').close();
});

$('addExtraBtn').addEventListener('click',()=>{
 extraRelatedRuleId=null;$('extraDialogTitle').textContent='Add one-time extra';$('extraForm').reset();$('extraDate').value=todayISO();$('extraDialog').showModal();focusDialogTitle('extraDialogTitle');
});
$('extraForm').addEventListener('submit',async e=>{
 e.preventDefault();
 const status=$('extraStatus').value;
 const name=$('extraName').value.trim();
 const kind=extraRelatedRuleId?'catchup':'extra';
 await commitAction(kind==='catchup'?'Catch-up added':'Extra added',name,async()=>{
   state.manualItems.push({id:uid(),type:'expense',kind,name,amount:+$('extraAmount').value,date:$('extraDate').value,category:$('extraCategory').value,status,relatedRuleId:extraRelatedRuleId||null,clearedAt:status==='cleared'?nowISO():null,reconciled:false,generated:false});
 });
 $('extraDialog').close();e.target.reset();extraRelatedRuleId=null;
});

$('addBillBtn').addEventListener('click',()=>openRuleDialog(null));
function openRuleDialog(id=null){
 editingRuleId=id;$('ruleForm').reset();
 const r=id?state.bills.find(x=>x.id===id):null;
 $('ruleDialogTitle').textContent=r?'Edit recurring bill':'Add recurring item';
 if(r){
   $('ruleName').value=r.name;$('ruleAmount').value=r.amount;$('ruleCategory').value=r.category||'Other';
   $('ruleKind').value=r.kind||'bill';$('ruleSchedule').value=r.schedule||'monthly_day';
   $('ruleDay').value=r.day||'';$('ruleAnchor').value=r.anchor||'';
 }else{$('ruleSchedule').value='monthly_day';}
 toggleRuleFields();$('ruleDialog').showModal();focusDialogTitle('ruleDialogTitle');
}
$('ruleSchedule').addEventListener('change',toggleRuleFields);
function toggleRuleFields(){
 const s=$('ruleSchedule').value;
 $('dayField').classList.toggle('hidden',s!=='monthly_day');
 $('anchorField').classList.toggle('hidden',s!=='biweekly');
}
$('ruleForm').addEventListener('submit',async e=>{
 e.preventDefault();
 const values={name:$('ruleName').value.trim(),amount:+$('ruleAmount').value,category:$('ruleCategory').value,kind:$('ruleKind').value,schedule:$('ruleSchedule').value,day:+$('ruleDay').value||null,anchor:$('ruleAnchor').value||null,active:true};
 const label=editingRuleId?'Recurring bill updated':'Recurring bill added';
 await commitAction(label,values.name,async()=>{
   if(editingRuleId){const r=state.bills.find(x=>x.id===editingRuleId);if(r)Object.assign(r,values)}
   else state.bills.push({id:uid(),...values});
 });
 $('ruleDialog').close();e.target.reset();editingRuleId=null;
});
$('addIncomeBtn').addEventListener('click',()=>openIncomeDialog(null));
function openIncomeDialog(id=null){
 editingIncomeId=id;$('incomeForm').reset();
 const r=id?state.incomeRules.find(x=>x.id===id):null;
 $('incomeDialogTitle').textContent=r?'Edit recurring income':'Add income source';
 if(r){$('incomeName').value=r.name;$('incomeAmount').value=r.amount;$('incomeSchedule').value=r.schedule;$('incomeAnchor').value=r.anchor||''}
 $('incomeAnchorField').classList.toggle('hidden',$('incomeSchedule').value!=='biweekly');
 $('incomeDialog').showModal();focusDialogTitle('incomeDialogTitle');
}
$('incomeSchedule').addEventListener('change',()=>{$('incomeAnchorField').classList.toggle('hidden',$('incomeSchedule').value!=='biweekly')});
$('incomeForm').addEventListener('submit',async e=>{
 e.preventDefault();
 const values={name:$('incomeName').value.trim(),amount:+$('incomeAmount').value,schedule:$('incomeSchedule').value,anchor:$('incomeAnchor').value||null,active:true};
 const label=editingIncomeId?'Recurring income updated':'Recurring income added';
 await commitAction(label,values.name,async()=>{
   if(editingIncomeId){const r=state.incomeRules.find(x=>x.id===editingIncomeId);if(r)Object.assign(r,values)}
   else state.incomeRules.push({id:uid(),...values});
 });
 $('incomeDialog').close();e.target.reset();editingIncomeId=null;
});

async function importSeedFile(f){
 if(!f)return;
 try{
   let obj=JSON.parse(await f.text());
   if(!obj.version||!obj.categories)throw new Error('Not a Bill Hub seed');
   obj=migrateData(obj);
   state=obj;undoState=null;logActivity('Private seed imported',f.name);
   await idbSet('state',state);renderAll();showToast('Private seed imported',false);
 }catch(err){alert('Could not import seed: '+err.message)}
}
$('seedImport').addEventListener('change',e=>importSeedFile(e.target.files[0]));
$('startBlankBtn').addEventListener('click',async()=>{
 state=blankState();logActivity('Blank setup created','New local Bill Hub data');await idbSet('state',state);renderAll();
});

async function deriveKey(pass,salt){
 const enc=new TextEncoder(), material=await crypto.subtle.importKey('raw',enc.encode(pass),'PBKDF2',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:150000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
function b64(buf){return btoa(String.fromCharCode(...new Uint8Array(buf)))}
function unb64(s){return Uint8Array.from(atob(s),c=>c.charCodeAt(0))}
async function encryptedExport(){
 if(!state)return;
 const pass=prompt('Create a backup passphrase. You will need it to restore this backup.');
 if(!pass)return;
 const exportedAt=nowISO();
 state.backupMeta=state.backupMeta||{};
 state.backupMeta.lastExportAt=exportedAt;
 state.backupMeta.lastExportVersion=APP_VERSION;
 logActivity('Backup exported','Encrypted manual backup created');
 await idbSet('state',state);
 renderAll();
 const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),key=await deriveKey(pass,salt);
 const data=new TextEncoder().encode(JSON.stringify(state));
 const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,data);
 const payload={format:'billhub-encrypted-v1',salt:b64(salt),iv:b64(iv),data:b64(ct)};
 const blob=new Blob([JSON.stringify(payload)],{type:'application/json'});
 const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`BillHub_Backup_${todayISO()}.bhub`;a.click();
 setTimeout(()=>URL.revokeObjectURL(a.href),1000);
 showToast('Encrypted backup created',false);
}
$('backupBtn').addEventListener('click',encryptedExport);
$('exportBackupBtn').addEventListener('click',encryptedExport);

async function readEncryptedBackup(f){
 const payload=JSON.parse(await f.text());if(payload.format!=='billhub-encrypted-v1')throw new Error('Unsupported backup');
 const pass=prompt('Backup passphrase');if(!pass)throw new Error('Canceled');
 const key=await deriveKey(pass,unb64(payload.salt));
 const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(payload.iv)},key,unb64(payload.data));
 const raw=JSON.parse(new TextDecoder().decode(pt));
 const sourceVersion=raw.version||'Unknown';
 const restored=migrateData(raw);
 restored.__restoreSourceVersion=sourceVersion;
 return restored;
}
function showRestorePreview(restored,fileName,fileModifiedAt=null){
 pendingRestore={state:restored,fileName};
 const created=restored.backupMeta?.lastExportAt||(fileModifiedAt?new Date(fileModifiedAt).toISOString():null)||restored.createdAt||null;
 $('restorePreviewBody').innerHTML=`
   <div class="restore-label">Backup file</div><div class="restore-value">${fileName}</div>
   <div class="restore-label">Backup created</div><div class="restore-value">${created?new Date(created).toLocaleString():'Unknown'}</div>
   <div class="restore-label">Backup app version</div><div class="restore-value">v${restored.__restoreSourceVersion||restored.version||'Unknown'}</div>
   <div class="restore-label">Balance checkpoint</div><div class="restore-value">${money(restored.balance?.amount||0)}</div>
   <div class="restore-label">Recurring bills</div><div class="restore-value">${(restored.bills||[]).length}</div>
   <div class="restore-label">Income sources</div><div class="restore-value">${(restored.incomeRules||[]).length}</div>`;
 $('restorePreviewDialog').showModal();focusDialogTitle('restorePreviewTitle');
}
async function handleRestoreFile(f,input){
 if(!f)return;
 try{showRestorePreview(await readEncryptedBackup(f),f.name,f.lastModified)}
 catch(err){if(err.message!=='Canceled')alert('Restore failed. Check the file and passphrase.')}
 finally{if(input)input.value=''}
}
$('restoreBackupInput').addEventListener('change',e=>handleRestoreFile(e.target.files[0],e.target));
$('setupRestoreBackupInput').addEventListener('change',e=>handleRestoreFile(e.target.files[0],e.target));
$('cancelRestoreBtn').addEventListener('click',()=>{$('restorePreviewDialog').close();pendingRestore=null});
$('confirmRestoreBtn').addEventListener('click',async()=>{
 if(!pendingRestore)return;
 const fileName=pendingRestore.fileName;
 if(state)prepareUndo('Restore backup');
 state=structuredClone(pendingRestore.state);
 delete state.__restoreSourceVersion;
 state.activity=state.activity||[];
 logActivity('Backup restored',fileName);
 await idbSet('state',state);
 pendingRestore=null;$('restorePreviewDialog').close();renderAll();showToast('Backup restored',!!undoState);
});

$('resetBtn').addEventListener('click',()=>{
 $('resetConfirmInput').value='';$('confirmResetBtn').disabled=true;$('resetDialog').showModal();focusDialogTitle('resetDialogTitle');
});
$('cancelResetBtn').addEventListener('click',()=>{$('resetDialog').close()});
$('backupBeforeResetBtn').addEventListener('click',encryptedExport);
$('resetConfirmInput').addEventListener('input',()=>{$('confirmResetBtn').disabled=$('resetConfirmInput').value.trim().toUpperCase()!=='DELETE'});
$('confirmResetBtn').addEventListener('click',async()=>{
 if($('resetConfirmInput').value.trim().toUpperCase()!=='DELETE')return;
 await idbDel('state');
 try{await idbDel('snapshots')}catch(_){ }
 state=null;undoState=null;$('resetDialog').close();renderAll();showToast('Local Bill Hub data deleted',false);
});

$('undoLastActionBtn').addEventListener('click',undoLastAction);
$('toastUndoBtn').addEventListener('click',undoLastAction);

function parseVersion(v){return String(v||'0').split('.').map(x=>parseInt(x,10)||0)}
function compareVersions(a,b){
 const A=parseVersion(a),B=parseVersion(b),n=Math.max(A.length,B.length);
 for(let i=0;i<n;i++){if((A[i]||0)>(B[i]||0))return 1;if((A[i]||0)<(B[i]||0))return -1}
 return 0;
}
async function checkForUpdate(){
 updateInfo.status='checking';if(state)renderSettings();
 try{
   const r=await fetch(`./version.json?t=${Date.now()}`,{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);
   const j=await r.json();if(!j.version)throw new Error('Missing version');
   updateInfo={status:compareVersions(j.version,APP_VERSION)>0?'available':'ok',latest:j.version,checkedAt:nowISO(),error:null};
 }catch(err){updateInfo={status:'error',latest:null,checkedAt:nowISO(),error:err.message}}
 if(state)renderSettings();
}
async function forceRefreshApp(){
 const btn=$('forceRefreshBtn');btn.disabled=true;btn.textContent='Refreshing…';
 try{
   if('caches' in window){for(const k of await caches.keys())await caches.delete(k)}
   if('serviceWorker' in navigator){for(const r of await navigator.serviceWorker.getRegistrations())try{await r.update()}catch(_){ }}
 }finally{window.location.reload()}
}
$('checkUpdateBtn').addEventListener('click',checkForUpdate);
$('applyUpdateBtn').addEventListener('click',forceRefreshApp);
$('forceRefreshBtn').addEventListener('click',forceRefreshApp);
document.addEventListener('visibilitychange',()=>{
 if(document.visibilityState==='visible' && (!updateInfo.checkedAt||Date.now()-new Date(updateInfo.checkedAt).getTime()>15*60000))checkForUpdate();
});

function migrateData(s){
 if(!s)return s;
 // v0.4.0 intentionally performs only generic schema normalization.
 // Financial rules, amounts, names, statuses, and month overrides are never rewritten by app migration code.
 s.categories=s.categories||blankState().categories;
 s.balance=s.balance||{amount:0,updatedAt:null};
 s.balanceHistory=s.balanceHistory||[];
 s.bills=s.bills||[];
 s.incomeRules=s.incomeRules||[];
 s.manualItems=s.manualItems||[];
 s.reconciledEventIds=s.reconciledEventIds||[];
 s.reserves=[];
 s.preferences=s.preferences||{};
 if('forecastMonths' in s.preferences)delete s.preferences.forecastMonths;
 s.activity=s.activity||[];
 s.backupMeta=s.backupMeta||{lastExportAt:null,lastExportVersion:null};
 s.version=APP_VERSION;
 return s;
}

if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
(async()=>{
 await openDB();
 try{await idbDel('snapshots')}catch(_){ }
 state=await idbGet('state')||null;
 if(state){
   const beforeVersion=state.version;
   state=migrateData(state);
   if(beforeVersion!==state.version)await idbSet('state',state);
 }
 renderAll();
 checkForUpdate();
})();
