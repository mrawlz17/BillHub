
const DB_NAME='billhub-db', DB_VERSION=1;
let db, state=null, lastProjection=[];
let activeItem=null, editingRuleId=null, editingIncomeId=null, extraRelatedRuleId=null;

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
  version:'0.1',
  createdAt:new Date().toISOString(),
  categories:['Housing','Utilities','Vehicles','Fuel','Food','Insurance','Debt','Kids','School','Sports','Subscriptions','Taxes','Medical','Personal','Savings','Miscellaneous','Other'],
  balance:{amount:0,updatedAt:null},
  balanceHistory:[],
  bills:[],
  incomeRules:[],
  manualItems:[],
  reconciledEventIds:[],
  reserves:[],
  preferences:{forecastMonths:6}
 };
}
async function save(){await idbSet('state',state);renderAll()}
async function makeSnapshot(reason='open'){
  if(!state) return;
  let snaps=await idbGet('snapshots')||[];
  snaps.unshift({id:uid(),createdAt:new Date().toISOString(),reason,state:structuredClone(state)});
  snaps=snaps.slice(0,30);
  await idbSet('snapshots',snaps);
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
         if(dt>=start&&dt<=end)out.push({id:`income:${r.id}:${isoDate(dt)}`,ruleId:r.id,type:'income',name:r.name,category:'Income',amount:+r.amount,date:isoDate(dt),status:'upcoming',generated:true});
       }
       cur=addMonths(cur,1);
     }
   } else if(r.schedule==='biweekly'&&r.anchor){
     for(const dt of biweeklyDates(r.anchor,start,end))out.push({id:`income:${r.id}:${isoDate(dt)}`,ruleId:r.id,type:'income',name:r.name,category:'Income',amount:+r.amount,date:isoDate(dt),status:'upcoming',generated:true});
   } else if(r.schedule==='second_monday'){
     let cur=new Date(start.getFullYear(),start.getMonth(),1,12),stop=new Date(end.getFullYear(),end.getMonth(),1,12);
     while(cur<=stop){
       const dt=secondMonday(cur.getFullYear(),cur.getMonth());
       if(dt>=start&&dt<=end)out.push({id:`income:${r.id}:${isoDate(dt)}`,ruleId:r.id,type:'income',name:r.name,category:'Income',amount:+r.amount,date:isoDate(dt),status:'upcoming',generated:true});
       cur=addMonths(cur,1);
     }
   }
 }
 return out;
}
function itemKey(x){return `${x.ruleId||''}|${x.date}|${x.name}|${x.type}`}
function projectedItems(months=6){
 const checkpoint=state.balance.updatedAt?new Date(state.balance.updatedAt):new Date();
 const start=new Date(checkpoint); start.setHours(0,0,0,0);
 const end=addMonths(start,months); end.setDate(end.getDate()+5);
 let gen=[...genBillOccurrences(start,end),...genIncomeOccurrences(start,end)];
 const manuals=(state.manualItems||[]).filter(x=>new Date(x.date+'T12:00:00')>=start&&new Date(x.date+'T12:00:00')<=end);
 // manual overrides can suppress matching generated occurrence by overrideRuleId/date
 const suppressExact=new Set(manuals.filter(x=>x.overrideRuleId).map(x=>`${x.overrideRuleId}|${x.date}`));
 const suppressMonth=new Set(manuals.filter(x=>x.overrideRuleId).map(x=>`${x.overrideRuleId}|${x.overrideMonth||x.date.slice(0,7)}`));
 gen=gen.filter(x=>!suppressExact.has(`${x.ruleId}|${x.date}`)&&!suppressMonth.has(`${x.ruleId}|${x.date.slice(0,7)}`));
 const items=[...gen,...manuals].sort((a,b)=>a.date.localeCompare(b.date)||(a.type==='income'?-1:1));
 return items;
}
function projection(months=6){
 const items=projectedItems(months);
 let bal=+state.balance.amount||0, low=bal, lowDate=state.balance.updatedAt||new Date().toISOString();
 const rows=[];
 for(const x of items){
   if(x.status==='cleared'||x.status==='received'||x.status==='skipped') continue; // cleared/received already reflected; skipped has no cash effect
   bal += x.type==='income'?+x.amount:-Math.abs(+x.amount);
   rows.push({...x,projectedBalance:bal});
   if(bal<low){low=bal;lowDate=x.date}
 }
 return {items,rows,ending:bal,low,lowDate};
}
function monthSummary(months){
 const p=projection(months), startDate=state.balance.updatedAt?new Date(state.balance.updatedAt):new Date();
 let working=+state.balance.amount||0;
 const result=[];
 for(let i=0;i<months;i++){
   const mStart=new Date(startDate.getFullYear(),startDate.getMonth()+i,1,12);
   const mEnd=new Date(startDate.getFullYear(),startDate.getMonth()+i+1,0,12);
   const isFirst=i===0;
   let opening=isFirst?+state.balance.amount:working;
   let income=0,expenses=0;
   for(const x of p.items){
     const dt=new Date(x.date+'T12:00:00');
     if(dt<mStart||dt>mEnd)continue;
     if(x.status==='cleared'||x.status==='received'||x.status==='skipped')continue;
     if(x.type==='income'){income+=+x.amount;working+=+x.amount}
     else {expenses+=Math.abs(+x.amount);working-=Math.abs(+x.amount)}
   }
   result.push({month:mStart.toLocaleDateString('en-US',{month:'short',year:'numeric'}),opening,income,expenses,ending:working});
 }
 return result;
}

function statusBadge(x){
 let s=x.status||'upcoming';
 if(s==='received')s='cleared';
 return `<span class="badge ${s}">${s}</span>`;
}
function renderDashboard(){
 $('currentBalance').textContent=money(state.balance.amount);
 $('balanceUpdated').textContent=state.balance.updatedAt?`Updated ${new Date(state.balance.updatedAt).toLocaleString()}`:'Not updated';
 const p=projection(+($('forecastMonths').value||state.preferences.forecastMonths||6));
 lastProjection=p.rows;
 const pending=state.manualItems.filter(x=>x.type==='expense'&&x.status==='pending').reduce((s,x)=>s+Math.abs(+x.amount),0);
 $('pendingOutflows').textContent=money(pending);
 const ni=p.items.find(x=>x.type==='income'&&x.status!=='received'&&x.status!=='skipped');
 $('nextIncome').textContent=ni?money(ni.amount):'$0.00';
 $('nextIncomeDate').textContent=ni?`${ni.name} · ${dstr(ni.date+'T12:00:00')}`:'—';
 $('lowestBalance').textContent=money(p.low);
 $('lowestBalance').className='metric '+(p.low<0?'negative':'');
 $('lowestBalanceDate').textContent=dstr(p.lowDate);
 const months=+($('forecastMonths').value||6);
 $('monthCards').innerHTML=monthSummary(months).map(m=>`
   <div class="month-card">
    <div class="month-title">${m.month}</div>
    <div class="month-row"><span>Starting</span><span>${money(m.opening)}</span></div>
    <div class="month-row"><span>Income</span><span class="positive">+${money(m.income)}</span></div>
    <div class="month-row"><span>Obligations</span><span>-${money(m.expenses)}</span></div>
    <div class="month-row end"><span>Projected end</span><span class="${m.ending<0?'negative':''}">${money(m.ending)}</span></div>
   </div>`).join('');
 const visible=p.items.filter(x=>x.status!=='cleared'&&x.status!=='received'&&x.status!=='skipped').slice(0,40);
 $('timeline').innerHTML=visible.length?visible.map(x=>`
   <div class="timeline-item ${x.type==='income'?'income':''} ${x.status==='pending'?'pending':''}" data-id="${x.id}" data-generated="${x.generated?'1':'0'}">
    <div class="date">${dstr(x.date+'T12:00:00')}</div>
    <div><strong>${x.name}</strong>${statusBadge(x)}<div class="muted small">${x.category||''}${x.kind==='pool'?' · spending pool':''}</div></div>
    <div class="amt">${x.type==='income'?'+':'-'}${money(x.amount)}</div>
   </div>`).join(''):'<p class="muted">No upcoming items.</p>';
 document.querySelectorAll('.timeline-item').forEach(el=>el.addEventListener('click',()=>openItemDialog(el.dataset.id)));
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
 const cleared=state.manualItems.filter(x=>x.type==='expense'&&x.status==='cleared');
 const sums={};
 for(const x of cleared)sums[x.category||'Other']=(sums[x.category||'Other']||0)+Math.abs(+x.amount);
 const entries=Object.entries(sums).sort((a,b)=>b[1]-a[1]);
 $('categoryReport').innerHTML=entries.length?entries.map(([k,v])=>`<div class="report-row"><div></div><div>${k}</div><div class="amt">${money(v)}</div></div>`).join(''):'<p class="muted">No cleared spending yet.</p>';
 $('balanceHistory').innerHTML=(state.balanceHistory||[]).slice().reverse().map(h=>`<div class="history-row"><div>${dstr(h.at)}</div><div class="muted small">${h.note||'Balance checkpoint'}</div><div class="amt">${money(h.amount)}</div></div>`).join('')||'<p class="muted">No balance history yet.</p>';
}
async function renderSettings(){
 const snaps=await idbGet('snapshots')||[];
 $('snapshotStatus').innerHTML=`<div><strong>${snaps.length}</strong> local snapshots retained<br><span class="muted small">${snaps[0]?`Latest: ${new Date(snaps[0].createdAt).toLocaleString()} (${snaps[0].reason})`:'No snapshots yet'}</span></div>`;
}
function renderAll(){
 const setup=!state;
 $('setupView').classList.toggle('hidden',!setup);
 $('dashboardView').classList.toggle('hidden',setup||currentView!=='dashboardView');
 $('planView').classList.toggle('hidden',setup||currentView!=='planView');
 $('reportsView').classList.toggle('hidden',setup||currentView!=='reportsView');
 $('settingsView').classList.toggle('hidden',setup||currentView!=='settingsView');
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
}));

function itemMonth(x){return (x.overrideMonth||x.date||'').slice(0,7)}
function recurringRuleForItem(item){
 if(!item) return null;
 const id=item.ruleId||item.overrideRuleId||item.relatedRuleId;
 if(!id) return null;
 return item.type==='income' ? state.incomeRules.find(x=>x.id===id) : state.bills.find(x=>x.id===id);
}
function findProjectedItem(id){return projectedItems(12).find(x=>x.id===id)||state.manualItems.find(x=>x.id===id)}
function findMonthOverride(item){
 const rid=item.ruleId||item.overrideRuleId;
 if(!rid) return null;
 const month=item.overrideMonth||item.date.slice(0,7);
 return state.manualItems.find(x=>x.overrideRuleId===rid&&(x.overrideMonth||x.date.slice(0,7))===month)||null;
}
function materializeOccurrence(item){
 if(!item.generated){
   if(item.overrideRuleId&&!item.overrideMonth)item.overrideMonth=item.date.slice(0,7);
   return item;
 }
 const existing=findMonthOverride(item);
 if(existing)return existing;
 const manual={...item,id:uid(),generated:false,overrideRuleId:item.ruleId,overrideMonth:item.date.slice(0,7),reconciled:false};
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
function openItemDialog(id){
 const item=findProjectedItem(id);if(!item)return;
 activeItem=item;
 const rule=recurringRuleForItem(item);
 $('itemDialogTitle').textContent=item.name;
 $('itemAmount').value=(+item.amount||0).toFixed(2);
 $('itemDate').value=item.date;
 $('itemCategory').value=item.category||'Other';
 setItemStatusOptions(item);
 $('itemStatus').value=item.status==='skipped'?'upcoming':(item.status||'upcoming');
 const isPool=item.kind==='pool';
 $('itemAmountLabel').childNodes[0].nodeValue=isPool?'Remaining this period ':'Amount ';
 $('itemRuleNote').innerHTML=rule
   ? `Recurring default: <strong>${money(rule.amount)}</strong>. Saving here changes <strong>this occurrence only</strong>; future months keep the recurring default.`
   : 'This is a one-time item. Changes apply only to this entry.';
 const directRecurringId=item.ruleId||item.overrideRuleId;
 $('editRecurringFromItemBtn').classList.toggle('hidden',!directRecurringId);
 $('addCatchupBtn').classList.toggle('hidden',item.type==='income');
 $('skipMonthBtn').classList.toggle('hidden',!directRecurringId);
 $('itemDialog').showModal();
}
$('closeItemBtn').addEventListener('click',()=>{$('itemDialog').close();activeItem=null});
$('itemForm').addEventListener('submit',async e=>{
 e.preventDefault();if(!activeItem)return;
 await makeSnapshot('before month edit');
 const m=materializeOccurrence(activeItem);
 m.amount=Math.abs(+$('itemAmount').value||0);
 m.date=$('itemDate').value;
 m.category=$('itemCategory').value;
 m.status=$('itemStatus').value;
 m.clearedAt=(m.status==='cleared'||m.status==='received')?new Date().toISOString():null;
 m.reconciled=false;
 await save();$('itemDialog').close();activeItem=null;
});
$('skipMonthBtn').addEventListener('click',async()=>{
 if(!activeItem)return;
 const rule=recurringRuleForItem(activeItem);
 if(!rule)return;
 if(!confirm(`Skip ${activeItem.name} for this occurrence only? Future recurring months will remain unchanged.`))return;
 await makeSnapshot('before skip month');
 const m=materializeOccurrence(activeItem);
 m.originalAmount=m.originalAmount||m.amount;
 m.amount=0;m.status='skipped';m.clearedAt=null;m.reconciled=true;
 await save();$('itemDialog').close();activeItem=null;
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
 const rid=activeItem.ruleId||activeItem.overrideRuleId||null;
 extraRelatedRuleId=rid;
 $('extraDialogTitle').textContent='Add extra / catch-up payment';
 $('extraName').value=`${activeItem.name} – Catch-up`;
 $('extraAmount').value='';
 $('extraDate').value=activeItem.date||todayISO();
 $('extraCategory').value=activeItem.category||'Other';
 $('extraStatus').value='upcoming';
 $('itemDialog').close();$('extraDialog').showModal();
});

$('forecastMonths').addEventListener('change',()=>{state.preferences.forecastMonths=+$('forecastMonths').value;save()});
$('updateBalanceBtn').addEventListener('click',()=>{
 $('newBalanceInput').value=state.balance.amount.toFixed(2);$('reconcilePreview').classList.add('hidden');$('balanceDialog').showModal();
});
$('newBalanceInput').addEventListener('input',()=>{
 const newBal=+$('newBalanceInput').value;
 if(!Number.isFinite(newBal))return;
 const events=state.manualItems.filter(x=>(x.status==='cleared'||x.status==='received')&&!x.reconciled);
 let expected=+state.balance.amount;
 for(const x of events)expected+=x.type==='income'?+x.amount:-Math.abs(+x.amount);
 const diff=newBal-expected;
 $('reconcilePreview').classList.remove('hidden');
 $('reconcilePreview').innerHTML=`Expected after newly cleared items: <strong>${money(expected)}</strong><br>Unexplained difference: <strong class="${diff<0?'negative':'positive'}">${money(diff)}</strong><br><span class="muted">Negative becomes Misc Daily; positive becomes Uncategorized Credit.</span>`;
});
$('balanceForm').addEventListener('submit',async e=>{
 e.preventDefault();
 const newBal=+$('newBalanceInput').value;if(!Number.isFinite(newBal))return;
 const events=state.manualItems.filter(x=>(x.status==='cleared'||x.status==='received')&&!x.reconciled);
 let expected=+state.balance.amount;
 for(const x of events)expected+=x.type==='income'?+x.amount:-Math.abs(+x.amount);
 const diff=+(newBal-expected).toFixed(2);
 events.forEach(x=>x.reconciled=true);
 if(Math.abs(diff)>=0.01){
   state.manualItems.push({
     id:uid(),type:diff<0?'expense':'income',kind:'reconciliation',
     name:diff<0?'Misc Daily':'Uncategorized Credit',
     category:diff<0?'Miscellaneous':'Other',amount:Math.abs(diff),date:todayISO(),
     status:diff<0?'cleared':'received',clearedAt:new Date().toISOString(),reconciled:true,generated:false
   });
 }
 state.balance={amount:newBal,updatedAt:new Date().toISOString()};
 state.balanceHistory.push({at:state.balance.updatedAt,amount:newBal,note:'Daily balance update'});
 await makeSnapshot('before balance update');
 await save();$('balanceDialog').close();
});

$('addExtraBtn').addEventListener('click',()=>{extraRelatedRuleId=null;$('extraDialogTitle').textContent='Add one-time extra';$('extraForm').reset();$('extraDate').value=todayISO();$('extraDialog').showModal()});
$('extraForm').addEventListener('submit',async e=>{
 e.preventDefault();
 const status=$('extraStatus').value;
 state.manualItems.push({id:uid(),type:'expense',kind:extraRelatedRuleId?'catchup':'extra',name:$('extraName').value.trim(),amount:+$('extraAmount').value,date:$('extraDate').value,category:$('extraCategory').value,status,relatedRuleId:extraRelatedRuleId||null,clearedAt:status==='cleared'?new Date().toISOString():null,reconciled:false,generated:false});
 await save();$('extraDialog').close();e.target.reset();extraRelatedRuleId=null;
});

$('addBillBtn').addEventListener('click',()=>openRuleDialog(null));
function openRuleDialog(id=null){
 editingRuleId=id;
 $('ruleForm').reset();
 const r=id?state.bills.find(x=>x.id===id):null;
 $('ruleDialogTitle').textContent=r?'Edit recurring bill':'Add recurring item';
 if(r){
   $('ruleName').value=r.name;$('ruleAmount').value=r.amount;$('ruleCategory').value=r.category||'Other';
   $('ruleKind').value=r.kind||'bill';$('ruleSchedule').value=r.schedule||'monthly_day';
   $('ruleDay').value=r.day||'';$('ruleAnchor').value=r.anchor||'';
 }else{$('ruleSchedule').value='monthly_day';}
 toggleRuleFields();$('ruleDialog').showModal();
}
$('ruleSchedule').addEventListener('change',toggleRuleFields);
function toggleRuleFields(){
 const s=$('ruleSchedule').value;
 $('dayField').classList.toggle('hidden',s!=='monthly_day');
 $('anchorField').classList.toggle('hidden',s!=='biweekly');
}
$('ruleForm').addEventListener('submit',async e=>{
 e.preventDefault();await makeSnapshot(editingRuleId?'before recurring bill edit':'before recurring bill add');
 const values={name:$('ruleName').value.trim(),amount:+$('ruleAmount').value,category:$('ruleCategory').value,kind:$('ruleKind').value,schedule:$('ruleSchedule').value,day:+$('ruleDay').value||null,anchor:$('ruleAnchor').value||null,active:true};
 if(editingRuleId){const r=state.bills.find(x=>x.id===editingRuleId);if(r)Object.assign(r,values)}
 else state.bills.push({id:uid(),...values});
 await save();$('ruleDialog').close();e.target.reset();editingRuleId=null;
});
$('addIncomeBtn').addEventListener('click',()=>openIncomeDialog(null));
function openIncomeDialog(id=null){
 editingIncomeId=id;$('incomeForm').reset();
 const r=id?state.incomeRules.find(x=>x.id===id):null;
 $('incomeDialogTitle').textContent=r?'Edit recurring income':'Add income source';
 if(r){$('incomeName').value=r.name;$('incomeAmount').value=r.amount;$('incomeSchedule').value=r.schedule;$('incomeAnchor').value=r.anchor||''}
 $('incomeAnchorField').classList.toggle('hidden',$('incomeSchedule').value!=='biweekly');
 $('incomeDialog').showModal();
}
$('incomeSchedule').addEventListener('change',()=>{$('incomeAnchorField').classList.toggle('hidden',$('incomeSchedule').value!=='biweekly')});
$('incomeForm').addEventListener('submit',async e=>{
 e.preventDefault();await makeSnapshot(editingIncomeId?'before recurring income edit':'before recurring income add');
 const values={name:$('incomeName').value.trim(),amount:+$('incomeAmount').value,schedule:$('incomeSchedule').value,anchor:$('incomeAnchor').value||null,active:true};
 if(editingIncomeId){const r=state.incomeRules.find(x=>x.id===editingIncomeId);if(r)Object.assign(r,values)}
 else state.incomeRules.push({id:uid(),...values});
 await save();$('incomeDialog').close();e.target.reset();editingIncomeId=null;
});

$('seedImport').addEventListener('change',async e=>{
 const f=e.target.files[0];if(!f)return;
 try{
   const obj=JSON.parse(await f.text());
   if(!obj.version||!obj.categories)throw new Error('Not a Bill Hub seed');
   state=obj;await idbSet('state',state);await makeSnapshot('seed import');renderAll();
 }catch(err){alert('Could not import seed: '+err.message)}
});
$('startBlankBtn').addEventListener('click',async()=>{state=blankState();await idbSet('state',state);await makeSnapshot('blank setup');renderAll()});

async function deriveKey(pass,salt){
 const enc=new TextEncoder(), material=await crypto.subtle.importKey('raw',enc.encode(pass),'PBKDF2',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:150000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
function b64(buf){return btoa(String.fromCharCode(...new Uint8Array(buf)))}
function unb64(s){return Uint8Array.from(atob(s),c=>c.charCodeAt(0))}
async function encryptedExport(){
 const pass=prompt('Create a backup passphrase. You will need it to restore this backup.');
 if(!pass)return;
 const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),key=await deriveKey(pass,salt);
 const data=new TextEncoder().encode(JSON.stringify(state));
 const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,data);
 const payload={format:'billhub-encrypted-v1',salt:b64(salt),iv:b64(iv),data:b64(ct)};
 const blob=new Blob([JSON.stringify(payload)],{type:'application/json'});
 const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`BillHub_Backup_${todayISO()}.bhub`;a.click();URL.revokeObjectURL(a.href);
}
$('backupBtn').addEventListener('click',encryptedExport);$('exportBackupBtn').addEventListener('click',encryptedExport);
$('restoreBackupInput').addEventListener('change',async e=>{
 const f=e.target.files[0];if(!f)return;
 try{
   const payload=JSON.parse(await f.text());if(payload.format!=='billhub-encrypted-v1')throw new Error('Unsupported backup');
   const pass=prompt('Backup passphrase');if(!pass)return;
   const key=await deriveKey(pass,unb64(payload.salt));
   const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(payload.iv)},key,unb64(payload.data));
   const restored=JSON.parse(new TextDecoder().decode(pt));
   await makeSnapshot('before restore');state=restored;await idbSet('state',state);await makeSnapshot('restored backup');renderAll();
 }catch(err){alert('Restore failed. Check the file and passphrase.')}
});
$('restoreSnapshotBtn').addEventListener('click',async()=>{
 const snaps=await idbGet('snapshots')||[];if(!snaps.length)return alert('No local snapshots.');
 const lines=snaps.slice(0,10).map((s,i)=>`${i+1}. ${new Date(s.createdAt).toLocaleString()} — ${s.reason}`).join('\n');
 const n=+(prompt('Restore which snapshot?\n'+lines)||0);if(!n||!snaps[n-1])return;
 await makeSnapshot('before snapshot restore');state=structuredClone(snaps[n-1].state);await idbSet('state',state);renderAll();
});
$('resetBtn').addEventListener('click',async()=>{
 if(!confirm('Reset all local Bill Hub data? A snapshot will be created first.'))return;
 await makeSnapshot('before reset');await idbDel('state');state=null;renderAll();
});


async function migrateState(){
 if(!state) return false;
 let changed=false;
 // v0.1.2: the initial 8/21 balance explicitly included the Midcon 8/21 paycheck.
 const note=(state.balanceHistory||[]).map(x=>x.note||'').join(' ').toLowerCase();
 const midcon=(state.incomeRules||[]).find(x=>x.name.toLowerCase()==='midcon');
 const hasOverride=(state.manualItems||[]).some(x=>x.type==='income'&&x.overrideRuleId===midcon?.id&&x.date==='2026-08-21');
 if(midcon&&note.includes('includes 8/21 midcon')&&!hasOverride){
   state.manualItems.push({
     id:uid(),type:'income',kind:'paycheck',name:'Midcon',category:'Income',
     amount:+midcon.amount,date:'2026-08-21',status:'received',
     overrideRuleId:midcon.id,clearedAt:state.balance.updatedAt||new Date().toISOString(),
     reconciled:true,generated:false
   });
   changed=true;
 }
 // v0.1.3: August Groceries/Fuel values are remaining pool balances, not submitted payments.
 for(const x of (state.manualItems||[])){
   if(x.name==='Groceries – August pending' || x.name==='Groceries – August remaining'){
     x.name='Groceries – August remaining';
     x.status='upcoming';
     x.kind='pool';
     x.category='Food';
     x.clearedAt=null;
     x.reconciled=false;
     changed=true;
   }
   if(x.name==='Fuel – August pending' || x.name==='Fuel – August remaining'){
     x.name='Fuel – August remaining';
     x.status='upcoming';
     x.kind='pool';
     x.category='Fuel';
     x.clearedAt=null;
     x.reconciled=false;
     changed=true;
   }
 }
 // v0.2.0: August pool balances replace, rather than add to, the normal second-half allocations.
 const grocery2=(state.bills||[]).find(x=>x.name==='Groceries – second half');
 const fuel2=(state.bills||[]).find(x=>x.name==='Fuel – second half');
 for(const x of (state.manualItems||[])){
   if(x.name==='Groceries – August remaining'&&grocery2&&x.overrideRuleId!==grocery2.id){x.overrideRuleId=grocery2.id;x.overrideMonth='2026-08';changed=true}
   if(x.name==='Fuel – August remaining'&&fuel2&&x.overrideRuleId!==fuel2.id){x.overrideRuleId=fuel2.id;x.overrideMonth='2026-08';changed=true}
   if(x.overrideRuleId&&!x.overrideMonth){x.overrideMonth=(x.date||'').slice(0,7);changed=true}
 }
 // v0.2.1: month ending balance simply rolls into the next month; no reserve/carryover object.
 if((state.reserves||[]).length){state.reserves=[];changed=true}

 // T Car was not an August remaining obligation at the 8/21 checkpoint.
 const tcar=(state.bills||[]).find(x=>x.name==='T Car');
 if(tcar){
   const hasAugTCarOverride=(state.manualItems||[]).some(x=>x.overrideRuleId===tcar.id&&(x.overrideMonth||x.date?.slice(0,7))==='2026-08');
   if(!hasAugTCarOverride){
     state.manualItems.push({
       id:uid(),type:'expense',kind:'bill',name:'T Car – August',
       category:tcar.category||'Vehicles',amount:0,date:'2026-08-25',
       status:'skipped',overrideRuleId:tcar.id,overrideMonth:'2026-08',
       clearedAt:null,reconciled:true,generated:false
     });
     changed=true;
   }
 }

 if(state.version!=='0.2.1'){state.version='0.2.1';changed=true}
 if(changed) await idbSet('state',state);
 return changed;
}

if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
(async()=>{
 await openDB();state=await idbGet('state')||null;
 if(state){
   await makeSnapshot('app open');
   await migrateState();
   $('forecastMonths').value=String(state.preferences?.forecastMonths||6);
 }
 renderAll();
})();
