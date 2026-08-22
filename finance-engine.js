(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.FlowMapFinance=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const RESOLVED_OUTFLOW=new Set(['cleared','skipped']);
  const RESOLVED_INCOME=new Set(['received','skipped']);
  const VALID_EXPENSE_STATUSES=new Set(['upcoming','pending','cleared','skipped']);
  const VALID_INCOME_STATUSES=new Set(['upcoming','received','skipped']);

  function localDate(d){
    if(d instanceof Date)return new Date(d.getTime());
    if(typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d))return new Date(d+'T12:00:00');
    return new Date(d);
  }
  function isoDate(d){
    const x=localDate(d);x.setHours(12,0,0,0);return x.toISOString().slice(0,10);
  }
  function addMonths(date,n){const d=localDate(date);d.setMonth(d.getMonth()+n);return d}
  function safeDay(year,month,day){const last=new Date(year,month+1,0).getDate();return new Date(year,month,Math.min(day,last),12)}
  function secondMonday(year,month){const d=new Date(year,month,1,12),dow=d.getDay(),firstMonday=1+((1-dow+7)%7);return new Date(year,month,firstMonday+7,12)}
  function biweeklyDates(anchor,start,end){
    let a=localDate(anchor);a.setHours(12,0,0,0);
    const s=localDate(start),e=localDate(end);s.setHours(12,0,0,0);e.setHours(12,0,0,0);
    // Calendar-day arithmetic is deliberate. Millisecond increments drift by one
    // hour across daylight-saving transitions and can drop a boundary payday.
    while(a>s){a=new Date(a);a.setDate(a.getDate()-14);a.setHours(12,0,0,0)}
    while(a<s){a=new Date(a);a.setDate(a.getDate()+14);a.setHours(12,0,0,0)}
    const arr=[];
    for(let d=new Date(a);d<=e;){
      arr.push(new Date(d));
      d=new Date(d);d.setDate(d.getDate()+14);d.setHours(12,0,0,0);
    }
    return arr;
  }
  function checkpointDate(state){
    const d=state?.balance?.updatedAt?new Date(state.balance.updatedAt):new Date();
    d.setHours(0,0,0,0);return d;
  }
  function forecastEnd(start,months){return new Date(start.getFullYear(),start.getMonth()+months,0,23,59,59,999)}
  function monthKey(date){const d=localDate(date);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`}
  function cents(n){return Math.round((Number(n)||0)*100)}
  function fromCents(n){return n/100}
  function num(n){const x=Number(n);return Number.isFinite(x)?x:0}
  function clone(x){return JSON.parse(JSON.stringify(x))}
  function stableStringify(value){
    if(value===null||typeof value!=='object')return JSON.stringify(value);
    if(Array.isArray(value))return '['+value.map(stableStringify).join(',')+']';
    return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stableStringify(value[k])).join(',')+'}';
  }

  function isIncome(x){return x?.type==='income'}
  function isResolved(x){return isIncome(x)?RESOLVED_INCOME.has(x?.status):RESOLVED_OUTFLOW.has(x?.status)}
  function isUnresolvedOutflow(x){return !!x&&!isIncome(x)&&!RESOLVED_OUTFLOW.has(x.status)}
  function isUnresolvedIncome(x){return !!x&&isIncome(x)&&!RESOLVED_INCOME.has(x.status)}
  function cashDeltaCents(x){if(isResolved(x))return 0;return isIncome(x)?Math.abs(cents(x.amount)):-Math.abs(cents(x.amount))}

  function genBillOccurrences(state,start,end){
    const out=[];
    for(const b of (state?.bills||[]).filter(x=>x.active!==false)){
      if(b.schedule==='monthly_day'){
        let cur=new Date(start.getFullYear(),start.getMonth(),1,12),stop=new Date(end.getFullYear(),end.getMonth(),1,12);
        while(cur<=stop){
          const dt=safeDay(cur.getFullYear(),cur.getMonth(),b.day||1);
          if(dt>=start&&dt<=end)out.push({id:`rule:${b.id}:${isoDate(dt)}`,ruleId:b.id,type:'expense',kind:b.kind||'bill',name:b.name,category:b.category,amount:num(b.amount),date:isoDate(dt),status:'upcoming',generated:true});
          cur=addMonths(cur,1);
        }
      }else if(b.schedule==='biweekly'&&b.anchor){
        for(const dt of biweeklyDates(b.anchor,start,end))out.push({id:`rule:${b.id}:${isoDate(dt)}`,ruleId:b.id,type:'expense',kind:b.kind||'pool',name:b.name,category:b.category,amount:num(b.amount),date:isoDate(dt),status:'upcoming',generated:true});
      }else if(b.schedule==='second_monday'){
        let cur=new Date(start.getFullYear(),start.getMonth(),1,12),stop=new Date(end.getFullYear(),end.getMonth(),1,12);
        while(cur<=stop){
          const dt=secondMonday(cur.getFullYear(),cur.getMonth());
          if(dt>=start&&dt<=end)out.push({id:`rule:${b.id}:${isoDate(dt)}`,ruleId:b.id,type:'expense',kind:b.kind||'bill',name:b.name,category:b.category,amount:num(b.amount),date:isoDate(dt),status:'upcoming',generated:true});
          cur=addMonths(cur,1);
        }
      }
    }
    return out;
  }

  function genIncomeOccurrences(state,start,end){
    const out=[];
    for(const r of (state?.incomeRules||[]).filter(x=>x.active!==false)){
      if(r.schedule==='twice_monthly'){
        let cur=new Date(start.getFullYear(),start.getMonth(),1,12),stop=new Date(end.getFullYear(),end.getMonth(),1,12);
        while(cur<=stop){
          for(const day of [10,25]){
            const dt=safeDay(cur.getFullYear(),cur.getMonth(),day);
            if(dt>=start&&dt<=end)out.push({id:`income:${r.id}:${isoDate(dt)}`,ruleId:r.id,type:'income',kind:'paycheck',name:r.name,category:'Income',amount:num(r.amount),date:isoDate(dt),status:'upcoming',generated:true});
          }
          cur=addMonths(cur,1);
        }
      }else if(r.schedule==='biweekly'&&r.anchor){
        for(const dt of biweeklyDates(r.anchor,start,end))out.push({id:`income:${r.id}:${isoDate(dt)}`,ruleId:r.id,type:'income',kind:'paycheck',name:r.name,category:'Income',amount:num(r.amount),date:isoDate(dt),status:'upcoming',generated:true});
      }else if(r.schedule==='second_monday'){
        let cur=new Date(start.getFullYear(),start.getMonth(),1,12),stop=new Date(end.getFullYear(),end.getMonth(),1,12);
        while(cur<=stop){
          const dt=secondMonday(cur.getFullYear(),cur.getMonth());
          if(dt>=start&&dt<=end)out.push({id:`income:${r.id}:${isoDate(dt)}`,ruleId:r.id,type:'income',kind:'paycheck',name:r.name,category:'Income',amount:num(r.amount),date:isoDate(dt),status:'upcoming',generated:true});
          cur=addMonths(cur,1);
        }
      }
    }
    return out;
  }

  function suppressionSets(manuals){
    return {
      exact:new Set(manuals.filter(x=>x.overrideRuleId).map(x=>`${x.overrideRuleId}|${x.date}`)),
      month:new Set(manuals.filter(x=>x.overrideRuleId).map(x=>`${x.overrideRuleId}|${x.overrideMonth||String(x.date||'').slice(0,7)}`)),
      nameMonth:new Set(manuals.filter(x=>x.overrideRuleName).map(x=>`${x.overrideRuleName}|${x.overrideMonth||String(x.date||'').slice(0,7)}`))
    };
  }
  function suppressesGenerated(x,s){
    const mk=String(x.date||'').slice(0,7);
    return s.exact.has(`${x.ruleId}|${x.date}`)||s.month.has(`${x.ruleId}|${mk}`)||s.nameMonth.has(`${x.name}|${mk}`);
  }

  function projectedItems(state,months=6,additionalItems=[]){
    const start=checkpointDate(state),end=forecastEnd(start,months);
    let generated=[...genBillOccurrences(state,start,end),...genIncomeOccurrences(state,start,end)];
    const manuals=(state?.manualItems||[]).flatMap(x=>{
      if(!x?.date)return [];
      const dt=localDate(x.date);
      const carry=(isUnresolvedOutflow(x)||isUnresolvedIncome(x))&&dt<start;
      if(dt>end||(!carry&&dt<start))return [];
      return [{...x,...(carry?{forecastDate:isoDate(start),carriedOverdue:true}:{})}];
    });
    const extras=(additionalItems||[]).filter(x=>{
      if(!x?.date)return false;const dt=localDate(x.date);return dt>=start&&dt<=end;
    });
    const suppress=suppressionSets(manuals);
    generated=generated.filter(x=>!suppressesGenerated(x,suppress));
    return [...generated,...manuals,...extras].sort((a,b)=>{
      const ad=a.forecastDate||a.date,bd=b.forecastDate||b.date;
      if(ad!==bd)return ad.localeCompare(bd);
      if(a.type!==b.type)return a.type==='income'?-1:1;
      return String(a.id).localeCompare(String(b.id));
    });
  }

  function projection(state,months=6,additionalItems=[]){
    const items=projectedItems(state,months,additionalItems);
    let bal=cents(state?.balance?.amount),low=bal,lowDate=state?.balance?.updatedAt||new Date().toISOString();
    const rows=[];
    for(const x of items){
      const delta=cashDeltaCents(x);if(delta===0)continue;
      bal+=delta;
      rows.push({...x,projectedBalance:fromCents(bal)});
      if(bal<low){low=bal;lowDate=x.forecastDate||x.date}
    }
    return {items,rows,ending:fromCents(bal),low:fromCents(low),lowDate};
  }

  function monthBuckets(state,months=6,additionalItems=[]){
    const items=projectedItems(state,months,additionalItems);
    const startDate=checkpointDate(state);
    let working=cents(state?.balance?.amount);
    const result=[];
    for(let i=0;i<months;i++){
      const mStart=new Date(startDate.getFullYear(),startDate.getMonth()+i,1,0,0,0,0);
      const mEnd=new Date(startDate.getFullYear(),startDate.getMonth()+i+1,0,23,59,59,999);
      const opening=working;let income=0,expenses=0;const monthItems=[];
      for(const x of items){
        const dt=localDate(x.forecastDate||x.date);
        if(dt<mStart||dt>mEnd)continue;
        const delta=cashDeltaCents(x);if(delta===0)continue;
        working+=delta;
        if(delta>0)income+=delta;else expenses+=-delta;
        monthItems.push({...x,projectedAfter:fromCents(working)});
      }
      const key=`${mStart.getFullYear()}-${String(mStart.getMonth()+1).padStart(2,'0')}`;
      const incomeCounts={};
      for(const x of monthItems.filter(isIncome))incomeCounts[x.name]=(incomeCounts[x.name]||0)+1;
      const threePaySources=(state?.incomeRules||[]).filter(r=>r.schedule==='biweekly'&&(incomeCounts[r.name]||0)>=3).map(r=>r.name);
      result.push({
        key,
        label:mStart.toLocaleDateString('en-US',{month:'short',year:'numeric'}),
        longLabel:mStart.toLocaleDateString('en-US',{month:'long',year:'numeric'}),
        opening:fromCents(opening),income:fromCents(income),expenses:fromCents(expenses),
        net:fromCents(income-expenses),ending:fromCents(working),items:monthItems,incomeCounts,threePaySources
      });
    }
    return result;
  }

  function dueRecurringOccurrences(state,cutoffISO,{includeIncome=true}={}){
    const start=checkpointDate(state),cutoff=localDate(cutoffISO);cutoff.setHours(0,0,0,0);
    if(!(cutoff>start))return [];
    const end=new Date(cutoff);end.setHours(23,59,59,999);
    let generated=[...genBillOccurrences(state,start,end),...(includeIncome?genIncomeOccurrences(state,start,end):[])].filter(x=>x.date<cutoffISO);
    const manuals=state?.manualItems||[],s=suppressionSets(manuals);
    return generated.filter(x=>!suppressesGenerated(x,s));
  }

  function reconciliationCandidates(state,diff,cutoffISO,maxItems=3){
    const target=Math.abs(cents(diff));if(!target)return [];
    const cutoff=localDate(cutoffISO||isoDate(new Date()));cutoff.setHours(23,59,59,999);
    const wantIncome=diff>0;
    const pool=projectedItems(state,6).filter(x=>{
      if(isResolved(x))return false;
      if(wantIncome!==isIncome(x))return false;
      const due=localDate(x.date);
      // Pending outflows can clear before their nominal date. Other unresolved
      // items become candidates once their expected/due date is reached.
      return (!wantIncome&&x.status==='pending')||due<=cutoff;
    }).map(x=>({...x,_cents:Math.abs(cents(x.amount))})).filter(x=>x._cents>0&&x._cents<=target);
    const results=[];const limit=Math.max(1,Math.min(3,maxItems||3));
    function walk(start,left,chosen){
      if(results.length>=5)return;
      if(left===0){results.push(chosen.slice());return}
      if(chosen.length>=limit)return;
      for(let i=start;i<pool.length;i++){
        const v=pool[i]._cents;if(v>left)continue;
        chosen.push(pool[i]);walk(i+1,left-v,chosen);chosen.pop();
        if(results.length>=5)return;
      }
    }
    walk(0,target,[]);
    return results.map(group=>group.map(({_cents,...x})=>x));
  }

  function pendingTotal(state){
    return fromCents((state?.manualItems||[]).filter(x=>!isIncome(x)&&x.status==='pending').reduce((sum,x)=>sum+Math.abs(cents(x.amount)),0));
  }
  function clearedSpendingByCategory(state){
    const sums={};
    for(const x of state?.manualItems||[]){
      if(x.type!=='expense'||x.status!=='cleared'||x.kind==='savings_transfer')continue;
      const c=x.category||'Other';sums[c]=(sums[c]||0)+Math.abs(cents(x.amount));
    }
    return Object.fromEntries(Object.entries(sums).map(([k,v])=>[k,fromCents(v)]));
  }

  function protectedCore(state){
    return {
      categories:state?.categories||[],balance:state?.balance||null,balanceHistory:state?.balanceHistory||[],
      bills:state?.bills||[],incomeRules:state?.incomeRules||[],manualItems:state?.manualItems||[],
      reconciledEventIds:state?.reconciledEventIds||[],goals:state?.goals||[],preferences:state?.preferences||{}
    };
  }
  function protectedFingerprint(state){return stableStringify(protectedCore(state))}

  function integrityCheck(state,months=6){
    const checks=[];
    const add=(id,label,ok,detail='',severity='fail')=>checks.push({id,label,ok:!!ok,detail,severity});
    if(!state){add('state','Local state exists',false,'No FlowMap state loaded.');return summarize(checks)}

    const balance=Number(state?.balance?.amount);
    add('balance','Balance checkpoint is valid',Number.isFinite(balance),Number.isFinite(balance)?`$${balance.toFixed(2)}`:'Balance is not numeric.');

    const collections=[['bill',state.bills||[]],['income',state.incomeRules||[]],['manual',state.manualItems||[]],['goal',state.goals||[]]];
    const ids=[];for(const [kind,arr] of collections)for(const x of arr)if(x?.id)ids.push(`${kind}:${x.id}`);
    const rawIds=collections.flatMap(([,arr])=>arr.map(x=>x?.id).filter(Boolean));
    add('unique-ids','Record IDs are unique',new Set(rawIds).size===rawIds.length,new Set(rawIds).size===rawIds.length?`${rawIds.length} IDs checked.`:'Duplicate record IDs found.');

    const invalidAmounts=[];
    for(const [kind,arr] of collections.slice(0,3))for(const x of arr){
      const a=Number(x?.amount);if(!Number.isFinite(a)||a<0)invalidAmounts.push(`${kind}:${x?.name||x?.id||'unknown'}`);
    }
    add('amounts','Amounts are numeric and non-negative',invalidAmounts.length===0,invalidAmounts.length?`Invalid: ${invalidAmounts.slice(0,4).join(', ')}`:'All financial amounts are valid.');

    const invalidStatus=[];
    for(const x of state.manualItems||[]){
      const valid=isIncome(x)?VALID_INCOME_STATUSES:VALID_EXPENSE_STATUSES;
      if(!valid.has(x.status||'upcoming'))invalidStatus.push(`${x.name||x.id}:${x.status}`);
    }
    add('statuses','Manual-item statuses are valid',invalidStatus.length===0,invalidStatus.length?`Invalid: ${invalidStatus.slice(0,4).join(', ')}`:'Status/type combinations are valid.');

    const billIds=new Set((state.bills||[]).map(x=>x.id)),incomeIds=new Set((state.incomeRules||[]).map(x=>x.id));
    const orphanOverrides=(state.manualItems||[]).filter(x=>x.overrideRuleId&&!((isIncome(x)?incomeIds:billIds).has(x.overrideRuleId)));
    add('overrides','Month overrides point to existing rules',orphanOverrides.length===0,orphanOverrides.length?`${orphanOverrides.length} orphaned override(s).`:'No orphaned overrides.','warn');

    let p,b;
    try{p=projection(state,months);b=monthBuckets(state,months)}catch(err){add('engine','Forecast engine completes',false,err.message);return summarize(checks)}
    add('engine','Forecast engine completes',true,`${p.rows.length} active cash-flow events evaluated.`);

    let carryOK=true,carryDetail='Every month opens at the prior month ending.';
    for(let i=1;i<b.length;i++)if(cents(b[i].opening)!==cents(b[i-1].ending)){carryOK=false;carryDetail=`Mismatch ${b[i-1].key} → ${b[i].key}.`;break}
    add('carry','Month carry-forward reconciles',carryOK,carryDetail);

    const bucketEnding=b.length?b[b.length-1].ending:balance;
    add('ending','Ledger and monthly forecast end at the same balance',cents(bucketEnding)===cents(p.ending),`Ledger ${fromCents(cents(p.ending)).toFixed(2)} · Months ${fromCents(cents(bucketEnding)).toFixed(2)}.`);

    const rowLows=[cents(balance),...p.rows.map(r=>cents(r.projectedBalance))];const expectedLow=Math.min(...rowLows);
    add('low','Lowest-balance calculation reconciles',expectedLow===cents(p.low),`Lowest ${fromCents(expectedLow).toFixed(2)}.`);

    const items=projectedItems(state,months);
    const occurrenceKeys=items.filter(x=>!x.scenario).map(x=>`${x.type}|${x.ruleId||x.overrideRuleId||x.id}|${x.date}|${x.generated?'g':'m'}`);
    const exactKeys=items.map(x=>String(x.id));
    add('duplicates','Projected event IDs are unique',new Set(exactKeys).size===exactKeys.length,new Set(exactKeys).size===exactKeys.length?`${exactKeys.length} projected IDs checked.`:'Duplicate projected IDs found.');

    const pending=fromCents((state.manualItems||[]).filter(x=>!isIncome(x)&&x.status==='pending').reduce((s,x)=>s+Math.abs(cents(x.amount)),0));
    add('pending','Pending total reconciles to pending records',cents(pendingTotal(state))===cents(pending),`${pending.toFixed(2)} pending.`);

    const savingsInSpending=(state.manualItems||[]).filter(x=>x.kind==='savings_transfer'&&x.type==='expense'&&x.status==='cleared');
    const category=clearedSpendingByCategory(state);const reported=cents(category.Savings||0);
    const nonTransferSavings=(state.manualItems||[]).filter(x=>x.category==='Savings'&&x.kind!=='savings_transfer'&&x.type==='expense'&&x.status==='cleared').reduce((s,x)=>s+Math.abs(cents(x.amount)),0);
    add('savings','Savings transfers are excluded from spending',reported===nonTransferSavings,savingsInSpending.length?`${savingsInSpending.length} cleared transfer(s) excluded correctly.`:'No cleared savings transfers to exclude.');

    const largeReconciliations=(state.manualItems||[]).filter(x=>x.kind==='reconciliation'&&Math.abs(num(x.amount))>=500);
    add('reconcile','No unusually large reconciliation entries',largeReconciliations.length===0,
      largeReconciliations.length?`${largeReconciliations.length} reconciliation entr${largeReconciliations.length===1?'y':'ies'} at or above $500 should be reviewed.`:'No reconciliation entry is $500 or larger.','warn');

    const history=state.balanceHistory||[];let historyOK=true,historyDetail='No balance history recorded.';
    if(history.length&&state.balance?.updatedAt){
      const last=history[history.length-1];historyOK=cents(last.amount)===cents(state.balance.amount);historyDetail=historyOK?'Latest history amount matches the checkpoint.':'Latest balance-history amount does not match the current checkpoint.';
    }
    add('history','Latest balance history matches current checkpoint',historyOK,historyDetail,'warn');

    const unresolvedPast=(state.manualItems||[]).filter(x=>!isResolved(x)&&x.date&&localDate(x.date)<checkpointDate(state));
    const projectedIds=new Set(items.map(x=>x.id));
    const missingPast=unresolvedPast.filter(x=>!projectedIds.has(x.id));
    add('overdue','Unresolved overdue items remain in forecast',missingPast.length===0,missingPast.length?`${missingPast.length} overdue item(s) missing.`:`${unresolvedPast.length} overdue unresolved item(s) retained.`);

    return summarize(checks);
  }
  function summarize(checks){
    const failures=checks.filter(x=>!x.ok&&x.severity!=='warn'),warnings=checks.filter(x=>!x.ok&&x.severity==='warn');
    return {ok:failures.length===0,status:failures.length?'fail':warnings.length?'review':'pass',checks,passed:checks.filter(x=>x.ok).length,total:checks.length,failures,warnings,runAt:new Date().toISOString()};
  }

  return {
    VERSION:'1.0.0',
    localDate,isoDate,addMonths,safeDay,secondMonday,biweeklyDates,monthKey,cents,fromCents,
    isIncome,isResolved,isUnresolvedOutflow,isUnresolvedIncome,cashDeltaCents,
    genBillOccurrences,genIncomeOccurrences,projectedItems,projection,monthBuckets,dueRecurringOccurrences,
    pendingTotal,reconciliationCandidates,clearedSpendingByCategory,protectedCore,protectedFingerprint,integrityCheck,stableStringify,clone
  };
});
