const APP_VERSION='0.7.3';
const DATA_SCHEMA_VERSION=1;
const Finance=window.FlowMapFinance;
const FORECAST_MONTHS=6;
// Keep the legacy DB name so existing local data survives the FlowMap rebrand.
const DB_NAME='billhub-db', DB_VERSION=1;
let db, state=null, lastProjection=[];
let activeItem=null, editingRuleId=null, editingIncomeId=null, extraRelatedRuleId=null;
let activeMonthKey=null, pendingRestore=null, undoState=null, toastTimer=null, openFutureMonthKey=null;
let activeGoalId=null, activeGoalTransferId=null, currentPlanPane='goalsPane', whatIfScenario=null;
let updateGuardNotice=null;
let updateInfo={status:'checking',latest:null,checkedAt:null,error:null};
let balanceAllocationDraft={};

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
const minBalanceFloor=()=>{
  const raw=state?.preferences?.minimumBalance;
  const n=raw===undefined||raw===null||raw===''?500:Number(raw);
  return Number.isFinite(n)&&n>=0?n:500;
};
const goals=()=>Array.isArray(state?.goals)?state.goals:[];

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

function financialCoreV1(s){
  if(!s)return null;
  return {
    categories:s.categories||[],
    balance:s.balance||null,
    balanceHistory:s.balanceHistory||[],
    bills:s.bills||[],
    incomeRules:s.incomeRules||[],
    manualItems:s.manualItems||[],
    reconciledEventIds:s.reconciledEventIds||[]
  };
}
function protectedCore(s){
  if(!s)return null;
  return {
    ...financialCoreV1(s),
    goals:Array.isArray(s.goals)?s.goals:[],
    preferences:s.preferences||{}
  };
}
function protectedCoreJSON(s){return JSON.stringify(protectedCore(s))}
function protectedCoreStable(s){return Finance.protectedFingerprint(s)}
async function armUpdateGuard(reason='refresh'){
  if(!state)return;
  const snapshot=structuredClone(state);
  await idbSet('updateGuard',{
    guardVersion:3,
    createdAt:nowISO(),
    fromVersion:APP_VERSION,
    reason,
    core:protectedCoreStable(snapshot),
    state:snapshot
  });
}
async function verifyUpdateGuard(current){
  const guard=await idbGet('updateGuard');
  if(!guard)return current;
  // v0.5 protected the original financial core; v0.6 protected goals/settings with
  // insertion-order JSON; v0.7+ uses a canonical fingerprint so harmless key order
  // differences cannot trigger a false rollback.
  const currentCore=guard.guardVersion>=3
    ?protectedCoreStable(current)
    :guard.guardVersion===2
      ?protectedCoreJSON(current)
      :JSON.stringify(financialCoreV1(current));
  const unchanged=currentCore===guard.core;
  if(!unchanged){
    await idbSet('state',guard.state);
    await idbDel('updateGuard');
    updateGuardNotice='FlowMap blocked an update because protected data changed. Your pre-update data was restored.';
    return structuredClone(guard.state);
  }
  await idbDel('updateGuard');
  updateGuardNotice='Update verified — financial and planning data unchanged.';
  return current;
}

function blankState(){
 return {
  version:APP_VERSION,
  schemaVersion:DATA_SCHEMA_VERSION,
  createdAt:nowISO(),
  categories:['Housing','Utilities','Vehicles','Fuel','Food','Insurance','Debt','Kids','School','Sports','Subscriptions','Taxes','Medical','Personal','Savings','Miscellaneous','Other'],
  balance:{amount:0,updatedAt:null},
  balanceHistory:[],
  bills:[],
  incomeRules:[],
  manualItems:[],
  reconciledEventIds:[],
  reserves:[],
  goals:[],
  preferences:{minimumBalance:500},
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

function genBillOccurrences(start,end){return Finance.genBillOccurrences(state,start,end)}
function genIncomeOccurrences(start,end){return Finance.genIncomeOccurrences(state,start,end)}

function isResolvedItem(x){return Finance.isResolved(x)}
function isUnresolvedOutflow(x){return Finance.isUnresolvedOutflow(x)}
function isUnresolvedIncome(x){return Finance.isUnresolvedIncome(x)}
function isOverdueItem(x){
 if(!x||isResolvedItem(x)||!x.date)return false;
 const checkpoint=state.balance.updatedAt?new Date(state.balance.updatedAt):new Date();
 const start=new Date(checkpoint);start.setHours(0,0,0,0);
 return new Date(x.date+'T12:00:00')<start;
}

// Before a balance checkpoint moves past a recurring due date, preserve the
// generated occurrence as a month-specific ledger item. This applies to both
// outflows and expected income. Passing time never resolves money by itself.
function materializeDueRecurringItems(cutoffISO){
 const due=Finance.dueRecurringOccurrences(state,cutoffISO,{includeIncome:true});
 if(!due.length)return 0;
 const manuals=state.manualItems||[];
 for(const x of due){
   const m={...x,id:uid(),generated:false,overrideRuleId:x.ruleId,overrideRuleName:x.name,overrideMonth:x.date.slice(0,7),overrideOccurrenceDate:x.date,reconciled:false,materializedDueAt:nowISO()};
   delete m.ruleId;
   manuals.push(m);
 }
 state.manualItems=manuals;
 return due.length;
}

function projectedItems(months=FORECAST_MONTHS,additionalItems=[]){return Finance.projectedItems(state,months,additionalItems)}
function projection(months=FORECAST_MONTHS,additionalItems=[]){return Finance.projection(state,months,additionalItems)}
function monthBuckets(months=FORECAST_MONTHS,additionalItems=[]){return Finance.monthBuckets(state,months,additionalItems)}

function statusBadge(x){
 let s=x.status||'upcoming';
 if(s==='received')s='cleared';
 return `<span class="badge ${s}">${s}</span>`;
}
function entryTags(x){
 const tags=[];
 if(isOverdueItem(x))tags.push(['OVERDUE','overdue']);
 if(x.kind==='catchup')tags.push(['CATCH-UP','catchup']);
 else if(x.kind==='extra')tags.push(['EXTRA','extra']);
 else if(x.kind==='reconciliation')tags.push(['RECONCILE','reconcile']);
 else if(x.kind==='savings_transfer')tags.push(['TRANSFER','transfer']);
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

function forecastBounds(months=FORECAST_MONTHS){
 const checkpoint=state.balance.updatedAt?new Date(state.balance.updatedAt):new Date();
 const start=new Date(checkpoint);start.setHours(12,0,0,0);
 const end=new Date(start.getFullYear(),start.getMonth()+months,0,12);
 return {start,end,minISO:isoDate(start),maxISO:isoDate(end)};
}
function goalMonthCount(targetISO){
 const checkpoint=state.balance.updatedAt?new Date(state.balance.updatedAt):new Date();
 const target=localDate(targetISO);
 const diff=(target.getFullYear()-checkpoint.getFullYear())*12+(target.getMonth()-checkpoint.getMonth())+1;
 return Math.max(1,Math.min(60,diff));
}
function goalTransferDates(targetISO){
 const checkpoint=state.balance.updatedAt?new Date(state.balance.updatedAt):new Date();
 checkpoint.setHours(12,0,0,0);
 const target=localDate(targetISO);
 if(target<checkpoint)return [];
 const dates=[];
 const count=goalMonthCount(targetISO);
 for(let i=0;i<count;i++){
   const y=checkpoint.getFullYear(),m=checkpoint.getMonth()+i;
   const last=new Date(y,m+1,0,12);
   const candidate=(last>target)?target:last;
   if(candidate>=checkpoint)dates.push(isoDate(candidate));
 }
 return [...new Set(dates)];
}
function goalBaseItems(targetISO){
 const months=goalMonthCount(targetISO);
 return projectedItems(months+1).filter(x=>x.date<=targetISO && !['cleared','received','skipped'].includes(x.status));
}
function sortedPlanningEvents(items,transfers=[]){
 const base=items.map(x=>({date:x.date,type:x.type,amount:+x.amount,order:x.type==='income'?0:1}));
 const tx=transfers.map(x=>({date:x.date,type:'expense',amount:+x.amount,order:2}));
 return [...base,...tx].sort((a,b)=>a.date.localeCompare(b.date)||a.order-b.order);
}
function futureMinimumAfter(items,transfers,candidateISO,targetISO){
 let bal=+state.balance.amount||0;
 const events=sortedPlanningEvents(items,transfers).filter(x=>x.date<=targetISO);
 let idx=0;
 while(idx<events.length && events[idx].date<=candidateISO){
   const x=events[idx++];bal+=x.type==='income'?x.amount:-Math.abs(x.amount);
 }
 let low=bal,lowDate=candidateISO;
 for(;idx<events.length;idx++){
   const x=events[idx];bal+=x.type==='income'?x.amount:-Math.abs(x.amount);
   if(bal<low){low=bal;lowDate=x.date}
 }
 return {low,lowDate,ending:bal};
}
function goalTransferStats(goal){
 const related=(state.manualItems||[]).filter(x=>x.kind==='savings_transfer'&&x.relatedGoalId===goal.id&&x.status!=='skipped');
 const completed=related.filter(x=>x.status==='cleared').reduce((sum,x)=>sum+Math.abs(+x.amount),0);
 const scheduled=related.filter(x=>x.status!=='cleared'&&(!goal.targetDate||x.date<=goal.targetDate)).reduce((sum,x)=>sum+Math.abs(+x.amount),0);
 return {completed,scheduled,items:related};
}
function savingsPlanForGoal(goal){
 const target=Math.max(0,+goal.targetAmount||0),startingSaved=Math.max(0,+goal.savedAmount||0),tx=goalTransferStats(goal);
 const saved=startingSaved+tx.completed,committed=saved+tx.scheduled;
 const remaining=Math.max(0,target-committed),floor=minBalanceFloor();
 const targetISO=goal.targetDate;
 const checkpointISO=state.balance.updatedAt?isoDate(new Date(state.balance.updatedAt)):todayISO();
 if(target<=saved)return {floor,saved,scheduled:tx.scheduled,remaining:0,plannedTotal:0,short:0,schedule:[],status:'funded',months:0};
 if(!targetISO||targetISO<checkpointISO){
   return {floor,saved,scheduled:tx.scheduled,remaining,plannedTotal:0,short:remaining,schedule:[],status:'past',months:0};
 }
 if(remaining<=0)return {floor,saved,scheduled:tx.scheduled,remaining:0,plannedTotal:0,short:0,schedule:[],status:'scheduled',months:goalTransferDates(targetISO).length};
 const items=goalBaseItems(targetISO),dates=goalTransferDates(targetISO),schedule=[];
 let left=remaining;
 for(const date of dates){
   const future=futureMinimumAfter(items,schedule,date,targetISO);
   const safe=Math.max(0,Math.floor((future.low-floor+1e-9)*100)/100);
   const amount=Math.min(left,safe);
   if(amount>=0.01){
     schedule.push({date,amount});
     left=Math.max(0,Math.round((left-amount)*100)/100);
   }
   if(left<=0.009)break;
 }
 const plannedTotal=Math.round((remaining-left)*100)/100;
 return {floor,saved,scheduled:tx.scheduled,remaining,plannedTotal,short:left,schedule,status:left<=0.009?'ontrack':'short',months:dates.length};
}
function goalStatusLabel(plan){
 if(plan.status==='funded')return ['Funded','goal-funded'];
 if(plan.status==='scheduled')return ['Fully scheduled','goal-ontrack'];
 if(plan.status==='past')return ['Past target','goal-danger'];
 if(plan.status==='ontrack')return ['On track','goal-ontrack'];
 return [`Short ${money(plan.short)}`,'goal-warning'];
}
function renderGoals(){
 const floor=minBalanceFloor();
 $('goalFloorNote').innerHTML=`<span class="floor-dot"></span>Planning floor <strong>${money(floor)}</strong> <span class="muted">· adjustable in Settings</span>`;
 const list=goals();
 if(!list.length){
   $('goalsList').innerHTML=`<div class="empty-planning"><strong>No savings goals yet.</strong><span>Create a goal and FlowMap will test it against your cash flow without changing your balance.</span></div>`;
   return;
 }
 $('goalsList').innerHTML=list.map(g=>{
   const plan=savingsPlanForGoal(g),target=Math.max(0,+g.targetAmount||0),saved=plan.saved,scheduled=plan.scheduled;
   const leftToGoal=Math.max(0,target-saved-scheduled),pct=target?Math.min(100,((saved+scheduled)/target)*100):0;
   const [status,statusClass]=goalStatusLabel(plan);
   const monthly=plan.months?leftToGoal/plan.months:leftToGoal;
   const next=plan.schedule[0]||null;
   const rows=plan.schedule.length?plan.schedule.map(x=>`<div class="goal-plan-row"><span>${dstr(x.date)}</span><strong>+${money(x.amount)}</strong></div>`).join(''):'<div class="muted small goal-plan-empty">No additional safe transfer is recommended yet at the current minimum.</div>';
   const canSchedule=g.targetDate>=(state.balance.updatedAt?isoDate(new Date(state.balance.updatedAt)):todayISO()) && target>saved;
   return `<article class="goal-card">
     <div class="goal-head">
       <div><h3>${escapeHTML(g.name||'Savings goal')}</h3><div class="muted small">Target ${dstr(g.targetDate)}</div></div>
       <span class="goal-status ${statusClass}">${status}</span>
     </div>
     <div class="goal-progress"><span style="width:${pct}%"></span></div>
     <div class="goal-metrics goal-metrics-four">
       <div><span>Saved</span><strong>${money(saved)}</strong></div>
       <div><span>Scheduled</span><strong>${money(scheduled)}</strong></div>
       <div><span>Target</span><strong>${money(target)}</strong></div>
       <div><span>Left</span><strong>${money(leftToGoal)}</strong></div>
     </div>
     ${plan.status==='funded'?'<div class="goal-callout safe">Goal funded.</div>':plan.status==='scheduled'?`<div class="goal-callout safe">The remaining goal amount is already scheduled. Those transfers are included in your real forecast.</div>`:plan.status==='past'?'<div class="goal-callout danger">Target date has passed.</div>':plan.status==='ontrack'?`<div class="goal-callout safe">Current cash flow can support the remaining ${money(leftToGoal)} while staying at or above ${money(floor)}.</div>`:`<div class="goal-callout warn">Current plan can safely support ${money(plan.plannedTotal)} more by the target date, leaving ${money(plan.short)} unfunded at the ${money(floor)} floor.</div>`}
     ${leftToGoal>0&&plan.months?`<div class="goal-insights"><div><span>Average needed</span><strong>${money(monthly)}/mo</strong></div><div><span>Next safe transfer</span><strong>${next?`${money(next.amount)} · ${dstr(next.date)}`:'Not yet'}</strong></div></div>`:''}
     <details class="goal-plan-details"><summary>Safe-to-save plan</summary><div class="goal-plan-list">${rows}</div><p class="muted small">Recommendations are planning only. Use Schedule Transfer to put one into the real cash-flow forecast.</p></details>
     <div class="goal-card-actions">${canSchedule?`<button type="button" class="goal-transfer-btn" data-goal-id="${g.id}">Schedule Transfer</button>`:''}<button type="button" class="secondary goal-edit-btn" data-goal-id="${g.id}">Edit Goal</button></div>
   </article>`;
 }).join('');
 document.querySelectorAll('.goal-edit-btn').forEach(b=>b.addEventListener('click',()=>openGoalDialog(b.dataset.goalId)));
 document.querySelectorAll('.goal-transfer-btn').forEach(b=>b.addEventListener('click',()=>openGoalTransferDialog(b.dataset.goalId)));
}
function escapeHTML(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function scenarioItemFromForm(){
 return {id:'scenario:whatif',type:'expense',kind:'extra',name:$('whatIfName').value.trim()||'Purchase',category:$('whatIfCategory').value||'Miscellaneous',amount:+$('whatIfAmount').value,date:$('whatIfDate').value,status:'upcoming',scenario:true};
}
function renderWhatIfResult(){
 const box=$('whatIfResult');
 if(!whatIfScenario){box.classList.add('hidden');box.innerHTML='';return}
 const base=monthBuckets(FORECAST_MONTHS),test=monthBuckets(FORECAST_MONTHS,[whatIfScenario]);
 const tested=projection(FORECAST_MONTHS,[whatIfScenario]),floor=minBalanceFloor();
 let cls='safe',headline=`Stays above ${money(floor)} minimum`;
 if(tested.low<0){cls='danger';headline=`Goes negative by ${money(Math.abs(tested.low))}`}
 else if(tested.low<floor){cls='warn';headline=`Falls ${money(floor-tested.low)} below your minimum`}
 const rows=test.map((m,i)=>`<div class="whatif-row"><strong>${m.label}</strong><span>${money(base[i].ending)}</span><span class="${m.ending<floor?'whatif-below':''}">${money(m.ending)}</span></div>`).join('');
 box.innerHTML=`<div class="whatif-status ${cls}"><strong>${headline}</strong><span>Lowest balance ${money(tested.low)} · ${dstr(tested.lowDate)}</span></div>
   <div class="whatif-comparison"><div class="whatif-row whatif-head"><strong>Month</strong><span>Current</span><span>With purchase</span></div>${rows}</div>
   <div class="whatif-actions"><button type="button" id="clearWhatIfBtn" class="secondary">Clear Scenario</button><button type="button" id="addWhatIfBtn">Add to Plan</button></div>`;
 box.classList.remove('hidden');
 $('clearWhatIfBtn').addEventListener('click',()=>{whatIfScenario=null;renderWhatIfResult()});
 $('addWhatIfBtn').addEventListener('click',addWhatIfToPlan);
}
function renderWhatIf(){
 const bounds=forecastBounds();
 $('whatIfDate').min=bounds.minISO;$('whatIfDate').max=bounds.maxISO;
 if(!$('whatIfDate').value)$('whatIfDate').value=bounds.minISO;
 if(!$('whatIfCategory').dataset.initialized){
   if(state.categories.includes('Miscellaneous'))$('whatIfCategory').value='Miscellaneous';
   $('whatIfCategory').dataset.initialized='1';
 }
 renderWhatIfResult();
}
async function addWhatIfToPlan(){
 if(!whatIfScenario)return;
 const item={...whatIfScenario,id:uid(),scenario:undefined};delete item.scenario;
 await commitAction('Scenario added to plan',`${item.name} · ${money(item.amount)}`,async()=>{state.manualItems=state.manualItems||[];state.manualItems.push(item)});
 whatIfScenario=null;$('whatIfAmount').value='';renderWhatIfResult();
}

function renderDashboard(){
 $('currentBalance').textContent=money(state.balance.amount);
 $('balanceUpdated').textContent=state.balance.updatedAt?`Updated ${new Date(state.balance.updatedAt).toLocaleString()}`:'Not updated';
 const p=projection(FORECAST_MONTHS);
 const buckets=monthBuckets(FORECAST_MONTHS);
 lastProjection=p.rows;
 const pending=Finance.pendingTotal(state);
 $('pendingOutflows').textContent=money(pending);
 const ni=p.items.find(x=>x.type==='income'&&x.status!=='received'&&x.status!=='skipped');
 $('nextIncome').textContent=ni?money(ni.amount):'$0.00';
 $('nextIncomeDate').textContent=ni?`${ni.name} · ${dstr(ni.date)}`:'—';
 const floor=minBalanceFloor();
 $('lowestBalance').textContent=money(p.low);
 $('lowestBalance').className='metric '+(p.low<0?'negative':p.low<floor?'below-floor':'');
 $('lowestBalanceDate').textContent=dstr(p.lowDate);
 const floorGap=p.low-floor;
 $('lowestBalanceFloor').textContent=floorGap>=0?`${money(floorGap)} above ${money(floor)} minimum`:`${money(Math.abs(floorGap))} below ${money(floor)} minimum`;
 $('lowestBalanceFloor').className=`muted small floor-status ${floorGap<0?'below-floor-text':'safe-floor-text'}`;

 $('monthCards').innerHTML=buckets.map((m,index)=>{
   const current=index===0;
   const open=current||openFutureMonthKey===m.key;
   const titleBadge=current?'<span class="current-pill">Current</span>':(m.threePaySources.length?`<span class="payday-badge">3× ${m.threePaySources.join(', ')}</span>`:'');
   const toggleAttrs=current?'':`data-toggle-month="${m.key}" role="button" tabindex="0" aria-expanded="${open}"`;
   return `<section class="forecast-accordion ${current?'current-month':''} ${open?'open':''}">
     <div class="forecast-summary ${current?'':'forecast-toggle'}" ${toggleAttrs}>
       <div class="forecast-summary-top">
         <div class="forecast-title-line"><strong>${m.longLabel}</strong>${titleBadge}</div>
         <div class="forecast-net ${m.net<0?'negative':'positive'}">${m.net>=0?'+':''}${money(m.net)}</div>
       </div>
       <div class="forecast-summary-math">
         <div><span>Start</span><strong>${money(m.opening)}</strong></div>
         <div><span>Income</span><strong class="positive">+${money(m.income)}</strong></div>
         <div><span>Outflow</span><strong>-${money(m.expenses)}</strong></div>
         <div><span>End</span><strong class="${m.ending<0?'negative':''}">${money(m.ending)}</strong></div>
       </div>
       ${current?'':`<span class="forecast-caret" aria-hidden="true">${open?'−':'+'}</span>`}
     </div>
     <div class="forecast-body ${open?'':'hidden'}">
       <div class="month-cash-list">${m.items.length?m.items.map(x=>cashItemHTML(x)).join(''):'<div class="empty-month">No remaining activity.</div>'}</div>
     </div>
   </section>`;
 }).join('');

 document.querySelectorAll('#monthCards .month-cash-item').forEach(el=>el.addEventListener('click',()=>openItemDialog(el.dataset.id)));
 document.querySelectorAll('#monthCards [data-toggle-month]').forEach(el=>{
   const toggle=()=>{
     const key=el.dataset.toggleMonth;
     openFutureMonthKey=openFutureMonthKey===key?null:key;
     renderDashboard();
   };
   el.addEventListener('click',toggle);
   el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle()}});
 });
}
function renderPlan(){
 document.querySelectorAll('.plan-tab').forEach(b=>{
   const active=b.dataset.planPane===currentPlanPane;
   b.classList.toggle('active',active);b.setAttribute('aria-selected',String(active));
 });
 document.querySelectorAll('.plan-pane').forEach(p=>p.classList.toggle('hidden',p.id!==currentPlanPane));
 renderGoals();renderWhatIf();
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

 const sums=Finance.clearedSpendingByCategory(state);
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
 const floor=minBalanceFloor();
 const floorInput=$('minimumBalanceInput');
 if(document.activeElement!==floorInput)floorInput.value=String(floor);
 $('minimumBalanceStatus').textContent=`Warnings trigger below ${money(floor)}. This setting does not move money or change your balance.`;
 $('appVersion').textContent=`v${APP_VERSION}`;
 const pill=$('updateStatus'), detail=$('updateDetail'), apply=$('applyUpdateBtn');
 pill.className='update-pill';
 if(updateInfo.status==='available'){
   pill.textContent=`v${updateInfo.latest} available`;pill.classList.add('available');
   detail.textContent='A newer FlowMap version is available. Your financial data is protected during the update.';
   apply.classList.remove('hidden');
 }else if(updateInfo.status==='ok'){
   pill.textContent='Up to date';pill.classList.add('ok');
   detail.textContent=`Installed v${APP_VERSION}. Last checked ${new Date(updateInfo.checkedAt).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}.`;
   apply.classList.add('hidden');
 }else if(updateInfo.status==='error'){
   pill.textContent='Check unavailable';pill.classList.add('error');
   detail.textContent='FlowMap could not check for updates. Retry or use Force Refresh.';
   apply.classList.add('hidden');
 }else{
   pill.textContent='Checking…';
   detail.textContent='FlowMap checks for updates. Financial data is protected during refreshes.';
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
 ['extraCategory','ruleCategory','itemCategory','whatIfCategory'].forEach(id=>$(id).innerHTML=opts);
}
let currentView='dashboardView';
document.querySelectorAll('.bottomnav button').forEach(b=>b.addEventListener('click',()=>{
 currentView=b.dataset.view;document.querySelectorAll('.bottomnav button').forEach(x=>x.classList.toggle('active',x===b));renderAll();
 if(currentView==='settingsView' && (!updateInfo.checkedAt || Date.now()-new Date(updateInfo.checkedAt).getTime()>15*60000))checkForUpdate();
}));

document.querySelectorAll('.plan-tab').forEach(b=>b.addEventListener('click',()=>{
 currentPlanPane=b.dataset.planPane||'goalsPane';renderPlan();
}));

$('whatIfForm').addEventListener('submit',e=>{
 e.preventDefault();
 const item=scenarioItemFromForm();
 if(!Number.isFinite(item.amount)||item.amount<=0)return;
 const bounds=forecastBounds();
 if(!item.date||item.date<bounds.minISO||item.date>bounds.maxISO){
   alert(`Choose a date between ${dstr(bounds.minISO)} and ${dstr(bounds.maxISO)} for the six-month scenario.`);return;
 }
 whatIfScenario=item;renderWhatIfResult();
});

$('saveMinimumBalanceBtn').addEventListener('click',async()=>{
 const value=+$('minimumBalanceInput').value;
 if(!Number.isFinite(value)||value<0){alert('Enter a minimum balance of $0 or more.');return}
 await commitAction('Minimum balance updated',money(value),async()=>{
   state.preferences=state.preferences||{};state.preferences.minimumBalance=Math.round(value*100)/100;
 });
});

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

function itemMonth(x){return (x.overrideMonth||x.date||'').slice(0,7)}
function recurringRuleForItem(item){
 if(!item) return null;
 const id=item.ruleId||item.overrideRuleId||item.relatedRuleId;
 if(!id) return null;
 return item.type==='income' ? state.incomeRules.find(x=>x.id===id) : state.bills.find(x=>x.id===id);
}
function findProjectedItem(id){return projectedItems(FORECAST_MONTHS).find(x=>x.id===id)||(state.manualItems||[]).find(x=>x.id===id)}
function findOccurrenceOverride(item){
 const rid=item.ruleId||item.overrideRuleId;
 if(!rid) return null;
 const rule=recurringRuleForItem(item);
 const multi=!!rule&&['biweekly','twice_monthly'].includes(rule.schedule);
 const month=item.overrideMonth||item.date.slice(0,7);
 return (state.manualItems||[]).find(x=>{
   if(x.overrideRuleId!==rid)return false;
   const sourceDate=x.overrideOccurrenceDate||x.originalOccurrenceDate||x.date;
   if(sourceDate===item.date)return true;
   // Legacy month-only matching remains only for one-occurrence-per-month rules.
   return !multi&&(x.overrideMonth||x.date.slice(0,7))===month;
 })||null;
}
function materializeOccurrence(item){
 if(!item.generated){
   // projectedItems() returns copies. Always resolve a manual occurrence back to
   // the stored IndexedDB state record before editing it, otherwise the UI can
   // appear to save a change that disappears on the next render.
   const stored=(state.manualItems||[]).find(x=>x.id===item.id)||item;
   if(stored.overrideRuleId&&!stored.overrideMonth)stored.overrideMonth=stored.date.slice(0,7);
   return stored;
 }
 const existing=findOccurrenceOverride(item);
 if(existing)return existing;
 const manual={...item,id:uid(),generated:false,overrideRuleId:item.ruleId,overrideRuleName:item.name,overrideMonth:item.date.slice(0,7),overrideOccurrenceDate:item.date,reconciled:false};
 delete manual.ruleId;
 state.manualItems.push(manual);
 return manual;
}
function setItemStatusOptions(item){
 if(item.type==='income'){
   $('itemStatus').innerHTML='<option value="upcoming">Expected</option><option value="received">Received</option><option value="skipped">Skip / not received</option>';
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
 return ['catchup','extra','reconciliation','savings_transfer'].includes(item.kind)||!item.relatedRuleId;
}
function itemContextText(item,rule){
 if(item.kind==='catchup')return `One-time catch-up payment${rule?` tied to ${rule.name}`:''}. Deleting it removes only this entry.`;
 if(item.kind==='extra')return 'One-time extra. Deleting it removes only this entry.';
 if(item.kind==='reconciliation')return 'Balance-reconciliation entry created from an unexplained bank-balance difference.';
 if(item.kind==='savings_transfer'){const g=goals().find(x=>x.id===item.relatedGoalId);return `Savings transfer${g?` for ${g.name}`:''}. It reduces checking in the forecast but is not counted as spending.`}
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
 balanceAllocationDraft={};
 $('newBalanceInput').value=state.balance.amount.toFixed(2);
 $('reconcilePreview').classList.add('hidden');
 $('poolAllocationBox').classList.add('hidden');
 $('poolAllocationBox').innerHTML='';
 $('balanceDialog').showModal();focusDialogTitle('balanceDialogTitle');
});
function reconcileDelta(newBal){
 const events=(state.manualItems||[]).filter(x=>(x.status==='cleared'||x.status==='received')&&!x.reconciled);
 let expected=+state.balance.amount;
 for(const x of events)expected+=x.type==='income'?+x.amount:-Math.abs(+x.amount);
 return {events,expected,diff:+(newBal-expected).toFixed(2)};
}
function reconcileMatches(diff){
 return Finance.reconciliationCandidates(state,diff,todayISO(),3);
}
function reconcileMatchText(matches){
 if(!matches.length)return '';
 const group=matches[0];
 return group.map(x=>`${x.name} ${money(x.amount)}`).join(' + ');
}
function poolShortName(item){
 const raw=String(item?.name||item?.category||'Spending pool');
 return raw.split(' – ')[0].split(' - ')[0].trim()||'Spending pool';
}
function balancePoolCandidates(){
 return Finance.availableSpendingPools(state);
}
function balanceAllocationPlan(diff){
 const decrease=Math.max(0,-Number(diff||0));
 const byId={};
 let total=0;
 for(const pool of balancePoolCandidates()){
   const raw=Number(balanceAllocationDraft[pool.id]||0);
   const amount=Number.isFinite(raw)?Math.max(0,Math.round(raw*100)/100):0;
   byId[pool.id]=amount;total+=amount;
 }
 total=Math.round(total*100)/100;
 const misc=Math.round((decrease-total)*100)/100;
 return {decrease,total,misc,byId,valid:total<=decrease+0.009};
}
function renderBalanceAllocationInputs(diff){
 const box=$('poolAllocationBox'),pools=balancePoolCandidates();
 if(!(diff<-.009)||!pools.length){
   box.classList.add('hidden');box.innerHTML='';return;
 }
 const decrease=Math.abs(diff);
 box.classList.remove('hidden');
 box.innerHTML=`<div class="pool-allocation-head"><strong>Allocate this decrease</strong><span>${money(decrease)} bank decrease</span></div>
   <div class="pool-allocation-help">All active spending pools for this month are listed below. Enter any part of the bank decrease that came from a pool and FlowMap will reduce it automatically. Anything left becomes Misc Daily.</div>
   <div class="pool-allocation-list">${pools.map(pool=>`
     <div class="pool-allocation-row">
       <div class="pool-allocation-name"><strong>${escapeHTML(poolShortName(pool))}</strong><span>${escapeHTML(pool.name)} · ${money(pool.amount)} remaining</span></div>
       <input class="pool-allocation-input" data-pool-id="${pool.id}" type="number" min="0" max="${Math.min(+pool.amount||0,decrease).toFixed(2)}" step="0.01" inputmode="decimal" placeholder="$0.00" value="${balanceAllocationDraft[pool.id]||''}" aria-label="Amount spent from ${escapeHTML(poolShortName(pool))}" />
     </div>`).join('')}</div>
   <div id="poolAllocationSummary" class="pool-allocation-summary"></div>`;
 updateBalanceAllocationSummary(diff);
}
function updateBalanceAllocationSummary(diff){
 const summary=$('poolAllocationSummary');if(!summary)return;
 const plan=balanceAllocationPlan(diff);
 summary.innerHTML=`<span>Allocated to pools</span><strong>${money(plan.total)}</strong>
   <span class="misc-label">Misc Daily</span><strong class="${plan.valid?'':'invalid'}">${money(Math.max(0,plan.misc))}</strong>
   ${plan.valid?'':`<span class="invalid">Allocation exceeds bank decrease</span><strong class="invalid">${money(Math.abs(plan.misc))} over</strong>`}`;
}
function renderBalanceReconcilePreview({rebuildPools=false}={}){
 const newBal=+$('newBalanceInput').value;if(!Number.isFinite(newBal))return;
 const {expected,diff}=reconcileDelta(newBal);
 if(rebuildPools)renderBalanceAllocationInputs(diff);
 const plan=balanceAllocationPlan(diff);
 const residualDiff=diff<0?+(diff+plan.total).toFixed(2):diff;
 const large=Math.abs(residualDiff)>=500,matches=plan.valid?reconcileMatches(residualDiff):[],matchText=reconcileMatchText(matches);
 $('reconcilePreview').classList.remove('hidden');
 let disposition='';
 if(diff<0){
   if(plan.total>0) disposition=plan.misc>0?`After pool allocation, <strong>${money(plan.misc)}</strong> becomes Misc Daily.`:'The full bank decrease is allocated to spending pools.';
   else disposition=`Creates Misc Daily of <strong>${money(Math.abs(diff))}</strong>.`;
 }else if(diff>0) disposition=`Creates Uncategorized Credit of <strong>${money(diff)}</strong>.`;
 else disposition='No unexplained difference.';
 $('reconcilePreview').innerHTML=`Expected balance: <strong>${money(expected)}</strong><br>Difference: <strong class="${diff<0?'negative':diff>0?'positive':''}">${money(diff)}</strong><br><span class="muted">${disposition}</span>${!plan.valid?'<div class="reconcile-warning">Pool allocations cannot exceed the bank-balance decrease.</div>':matchText?`<div class="reconcile-warning">Possible match for the unallocated difference: <strong>${escapeHTML(matchText)}</strong>. Resolve the matching item${matches[0].length===1?'':'s'} first to avoid counting the same money twice.</div>`:large?'<div class="reconcile-warning">Large unallocated difference — verify received/cleared items before saving.</div>':''}`;
 updateBalanceAllocationSummary(diff);
}
$('newBalanceInput').addEventListener('input',()=>{
 balanceAllocationDraft={};
 renderBalanceReconcilePreview({rebuildPools:true});
});
$('poolAllocationBox').addEventListener('input',e=>{
 const input=e.target.closest('.pool-allocation-input');if(!input)return;
 const n=Number(input.value);
 balanceAllocationDraft[input.dataset.poolId]=Number.isFinite(n)?Math.max(0,n):0;
 renderBalanceReconcilePreview();
});
$('balanceForm').addEventListener('submit',async e=>{
 e.preventDefault();
 const newBal=+$('newBalanceInput').value;if(!Number.isFinite(newBal))return;
 const preview=reconcileDelta(newBal);
 const plan=balanceAllocationPlan(preview.diff);
 if(!plan.valid){alert('Pool allocations cannot exceed the bank-balance decrease.');return}
 const pools=balancePoolCandidates();
 for(const pool of pools){
   const amount=plan.byId[pool.id]||0;
   if(amount>(+pool.amount||0)+0.009){alert(`${poolShortName(pool)} allocation cannot exceed ${money(pool.amount)} remaining.`);return}
 }
 const residualDiff=preview.diff<0?+(preview.diff+plan.total).toFixed(2):preview.diff;
 const matches=reconcileMatches(residualDiff),matchText=reconcileMatchText(matches);
 if(matchText && !confirm(`The unallocated balance difference exactly matches unresolved cash flow: ${matchText}. Saving now will create a reconciliation entry while leaving those items unresolved, which can double-count the money. Continue anyway?`))return;
 if(!matchText && Math.abs(residualDiff)>=500 && !confirm(`Large unallocated balance difference: ${money(residualDiff)}. Verify received and cleared items first. Save anyway?`))return;
 const oldBal=+state.balance.amount;
 const allocLabels=pools.filter(x=>(plan.byId[x.id]||0)>=.01).map(x=>`${poolShortName(x)} ${money(plan.byId[x.id])}`);
 const detailParts=[`${money(oldBal)} → ${money(newBal)}`,...allocLabels];
 if(residualDiff<-.009)detailParts.push(`Misc ${money(Math.abs(residualDiff))}`);
 if(residualDiff>.009)detailParts.push(`Credit ${money(residualDiff)}`);
 await commitAction('Balance updated',detailParts.join(' · '),async()=>{
   // Preserve recurring obligations/income crossed by the new checkpoint first.
   materializeDueRecurringItems(todayISO());
   const {events,diff}=reconcileDelta(newBal);
   events.forEach(x=>x.reconciled=true);

   let allocated=0;
   for(const pool of pools){
     const amount=Math.round((plan.byId[pool.id]||0)*100)/100;
     if(amount<.01)continue;
     const occurrence=materializeOccurrence(pool);
     const remaining=Math.max(0,Math.round((Math.abs(+occurrence.amount||0)-amount)*100)/100);
     occurrence.amount=remaining;
     if(remaining<.01){
       occurrence.amount=0;occurrence.status='cleared';occurrence.clearedAt=nowISO();occurrence.reconciled=true;
     }else{
       occurrence.clearedAt=null;
       if(occurrence.status==='cleared'||occurrence.status==='skipped')occurrence.status='upcoming';
     }
     state.manualItems.push({
       id:uid(),type:'expense',kind:'pool_spend',
       name:`${poolShortName(pool)} spend`,category:pool.category||'Other',amount,
       date:todayISO(),status:'cleared',clearedAt:nowISO(),reconciled:true,generated:false,
       relatedPoolId:occurrence.id,sourcePoolName:pool.name
     });
     allocated+=amount;
   }

   const finalResidual=diff<0?+(diff+allocated).toFixed(2):diff;
   if(Math.abs(finalResidual)>=0.01){
     state.manualItems.push({
       id:uid(),type:finalResidual<0?'expense':'income',kind:'reconciliation',
       name:finalResidual<0?'Misc Daily':'Uncategorized Credit',
       category:finalResidual<0?'Miscellaneous':'Other',amount:Math.abs(finalResidual),date:todayISO(),
       status:finalResidual<0?'cleared':'received',clearedAt:nowISO(),reconciled:true,generated:false
     });
   }
   state.balance={amount:newBal,updatedAt:nowISO()};
   const noteParts=['Daily balance update',...allocLabels];
   if(finalResidual<-.009)noteParts.push(`Misc ${money(Math.abs(finalResidual))}`);
   state.balanceHistory.push({at:state.balance.updatedAt,amount:newBal,note:noteParts.join(' · ')});
 });
 balanceAllocationDraft={};
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

$('addGoalBtn').addEventListener('click',()=>openGoalDialog(null));
function openGoalDialog(id=null){
 activeGoalId=id;$('goalForm').reset();
 const g=id?goals().find(x=>x.id===id):null;
 $('goalDialogTitle').textContent=g?'Edit savings goal':'Add savings goal';
 $('deleteGoalBtn').classList.toggle('hidden',!g);
 if(g){
   $('goalName').value=g.name||'';$('goalTargetAmount').value=g.targetAmount||'';$('goalTargetDate').value=g.targetDate||'';$('goalSavedAmount').value=g.savedAmount||0;
 }else{
   $('goalSavedAmount').value='0';
 }
 $('goalTargetDate').min=state.balance.updatedAt?isoDate(new Date(state.balance.updatedAt)):todayISO();
 $('goalDialog').showModal();focusDialogTitle('goalDialogTitle');
}
$('cancelGoalBtn').addEventListener('click',()=>{$('goalDialog').close();activeGoalId=null});
$('goalForm').addEventListener('submit',async e=>{
 e.preventDefault();
 const name=$('goalName').value.trim(),targetAmount=+$('goalTargetAmount').value,targetDate=$('goalTargetDate').value,savedAmount=Math.max(0,+$('goalSavedAmount').value||0);
 if(!name||!Number.isFinite(targetAmount)||targetAmount<=0||!targetDate)return;
 const label=activeGoalId?'Savings goal updated':'Savings goal added';
 await commitAction(label,`${name} · ${money(targetAmount)}`,async()=>{
   state.goals=Array.isArray(state.goals)?state.goals:[];
   if(activeGoalId){const g=state.goals.find(x=>x.id===activeGoalId);if(g)Object.assign(g,{name,targetAmount,targetDate,savedAmount,updatedAt:nowISO()})}
   else state.goals.push({id:uid(),name,targetAmount,targetDate,savedAmount,createdAt:nowISO(),updatedAt:nowISO()});
 });
 $('goalDialog').close();activeGoalId=null;
});
$('deleteGoalBtn').addEventListener('click',async()=>{
 if(!activeGoalId)return;
 const g=goals().find(x=>x.id===activeGoalId);if(!g)return;
 if(!confirm(`Delete savings goal “${g.name}”? This does not affect your balance or cash-flow entries.`))return;
 await commitAction('Savings goal deleted',g.name,async()=>{state.goals=goals().filter(x=>x.id!==activeGoalId)});
 $('goalDialog').close();activeGoalId=null;
});

function openGoalTransferDialog(goalId){
 const g=goals().find(x=>x.id===goalId);if(!g)return;
 activeGoalTransferId=goalId;
 const plan=savingsPlanForGoal(g),suggested=plan.schedule[0]||null;
 $('goalTransferDialogTitle').textContent='Schedule savings transfer';
 $('goalTransferContext').innerHTML=`<strong>${escapeHTML(g.name)}</strong><br><span class="muted">Target ${money(g.targetAmount)} by ${dstr(g.targetDate)} · minimum ${money(minBalanceFloor())}</span>`;
 $('goalTransferAmount').value=suggested?suggested.amount.toFixed(2):'';
 const bounds=forecastBounds(Math.max(FORECAST_MONTHS,goalMonthCount(g.targetDate)));
 $('goalTransferDate').min=bounds.minISO;$('goalTransferDate').max=g.targetDate;
 $('goalTransferDate').value=suggested?suggested.date:bounds.minISO;
 $('goalTransferStatus').value='upcoming';
 $('goalTransferDialog').showModal();focusDialogTitle('goalTransferDialogTitle');
}
$('cancelGoalTransferBtn').addEventListener('click',()=>{$('goalTransferDialog').close();activeGoalTransferId=null});
$('goalTransferForm').addEventListener('submit',async e=>{
 e.preventDefault();
 const g=goals().find(x=>x.id===activeGoalTransferId);if(!g)return;
 const amount=+$('goalTransferAmount').value,date=$('goalTransferDate').value,status=$('goalTransferStatus').value;
 if(!Number.isFinite(amount)||amount<=0||!date)return;
 if(date>g.targetDate){alert('Choose a transfer date on or before the goal target date.');return}
 await commitAction('Savings transfer scheduled',`${g.name} · ${money(amount)}`,async()=>{
   state.manualItems=state.manualItems||[];
   state.manualItems.push({id:uid(),type:'transfer',kind:'savings_transfer',name:`${g.name} Savings`,category:'Savings',amount,date,status,relatedGoalId:g.id,clearedAt:null,reconciled:false,generated:false});
 });
 $('goalTransferDialog').close();activeGoalTransferId=null;
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
   if(!obj.categories)throw new Error('Not FlowMap private data');
   obj=normalizeStateInMemory(obj);
   state=obj;undoState=null;logActivity('Private data imported',f.name);
   await idbSet('state',state);renderAll();showToast('Private data imported',false);
 }catch(err){alert('Could not import private data: '+err.message)}
}
$('seedImport').addEventListener('change',e=>importSeedFile(e.target.files[0]));
$('startBlankBtn').addEventListener('click',async()=>{
 state=blankState();logActivity('Blank setup created','New local FlowMap data');await idbSet('state',state);renderAll();
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
 logActivity('Backup exported','Manual backup created');
 await idbSet('state',state);
 renderAll();
 const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),key=await deriveKey(pass,salt);
 const data=new TextEncoder().encode(JSON.stringify(state));
 const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,data);
 const payload={format:'flowmap-encrypted-v1',app:'FlowMap',version:APP_VERSION,salt:b64(salt),iv:b64(iv),data:b64(ct)};
 const blob=new Blob([JSON.stringify(payload)],{type:'application/json'});
 const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`FlowMap_Backup_${todayISO()}.bhub`;a.click();
 setTimeout(()=>URL.revokeObjectURL(a.href),1000);
 showToast('Backup created',false);
}
$('backupBtn').addEventListener('click',encryptedExport);
$('exportBackupBtn').addEventListener('click',encryptedExport);

async function readEncryptedBackup(f){
 const payload=JSON.parse(await f.text());if(!['flowmap-encrypted-v1','billhub-encrypted-v1'].includes(payload.format))throw new Error('Unsupported backup');
 const pass=prompt('Backup passphrase');if(!pass)throw new Error('Canceled');
 const key=await deriveKey(pass,unb64(payload.salt));
 const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(payload.iv)},key,unb64(payload.data));
 const raw=JSON.parse(new TextDecoder().decode(pt));
 const sourceVersion=raw.backupMeta?.lastExportVersion||raw.version||'Unknown';
 const restored=normalizeStateInMemory(raw);
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
   <div class="restore-label">Income sources</div><div class="restore-value">${(restored.incomeRules||[]).length}</div>
   <div class="restore-label">Savings goals</div><div class="restore-value">${(restored.goals||[]).length}</div>
   <div class="restore-label">Minimum balance</div><div class="restore-value">${money(restored.preferences?.minimumBalance??500)}</div>`;
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
 state=null;undoState=null;$('resetDialog').close();renderAll();showToast('Local FlowMap data deleted',false);
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
async function forceRefreshApp(trigger=null){
 const btn=trigger?.currentTarget||$('forceRefreshBtn');
 const original=btn.textContent;
 btn.disabled=true;btn.textContent='Refreshing…';
 try{
   await armUpdateGuard(updateInfo.status==='available'?'app update':'force refresh');
   if('caches' in window){for(const k of await caches.keys())await caches.delete(k)}
   if('serviceWorker' in navigator){for(const r of await navigator.serviceWorker.getRegistrations())try{await r.update()}catch(_){ }}
   window.location.reload();
 }catch(err){
   btn.disabled=false;btn.textContent=original;
   alert('Refresh stopped because FlowMap could not prepare the update safely. Your data was not changed.');
 }
}
$('checkUpdateBtn').addEventListener('click',checkForUpdate);
$('applyUpdateBtn').addEventListener('click',e=>forceRefreshApp(e));
$('forceRefreshBtn').addEventListener('click',e=>forceRefreshApp(e));
document.addEventListener('visibilitychange',()=>{
 if(document.visibilityState==='visible' && (!updateInfo.checkedAt||Date.now()-new Date(updateInfo.checkedAt).getTime()>15*60000))checkForUpdate();
});

function normalizeStateInMemory(s){
 if(!s)return s;
 // Additive runtime defaults only. Financial records are never rewritten on app load.
 if(!Array.isArray(s.categories))s.categories=blankState().categories;
 if(!s.balance)s.balance={amount:0,updatedAt:null};
 if(!Array.isArray(s.balanceHistory))s.balanceHistory=[];
 if(!Array.isArray(s.bills))s.bills=[];
 if(!Array.isArray(s.incomeRules))s.incomeRules=[];
 if(!Array.isArray(s.manualItems))s.manualItems=[];
 if(!Array.isArray(s.reconciledEventIds))s.reconciledEventIds=[];
 if(!Array.isArray(s.goals))s.goals=[];
 if(!s.preferences)s.preferences={};
 if(!Array.isArray(s.activity))s.activity=[];
 if(!s.backupMeta)s.backupMeta={lastExportAt:null,lastExportVersion:null};
 if(!s.schemaVersion)s.schemaVersion=DATA_SCHEMA_VERSION;
 return s;
}

if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
(async()=>{
 await openDB();
 state=await idbGet('state')||null;
 if(state){
   state=await verifyUpdateGuard(state);
   state=normalizeStateInMemory(state);
 }
 renderAll();
 checkForUpdate();
 if(updateGuardNotice)setTimeout(()=>showToast(updateGuardNotice,false),250);
})();
