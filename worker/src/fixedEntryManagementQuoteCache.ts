import type { TargetedOptionQuote } from "./managerShadowQuoteModel.js";
/** Refresh the exact original OCC independently. Failed quote I/O cannot hold
 * account/halt/manual/EOD observation; native freshness checks still apply.
 */
export function makeFixedManagementQuoteCache(input:{now():number;
  read(symbols:readonly string[]):Promise<Map<string,TargetedOptionQuote>>}) {
  const values=new Map<string,TargetedOptionQuote>(),running=new Set<string>(),lastStarted=new Map<string,number>();
  return (occ:string,atMs:number):{bid:number;ask:number;observedAtMs:number}|null => {
    if(!/^SPY\d{6}[CP]\d{8}$/.test(occ) || !Number.isFinite(atMs)) return null;
    if(!running.has(occ) && atMs-(lastStarted.get(occ)??-Infinity)>=1_000) {
      running.add(occ);lastStarted.set(occ,atMs);
      void Promise.resolve().then(()=>input.read([occ])).then(result=>{
        const q=result.get(occ),now=input.now();
        if(q?.occSymbol===occ && q.feed==="opra" && Number.isFinite(q.bid) && q.bid>0 && Number.isFinite(q.ask) && q.ask>=q.bid
          && Number.isFinite(q.quoteAtMs) && q.quoteAtMs<=now) values.set(occ,structuredClone(q));
        else values.delete(occ);
      }).catch(()=>{values.delete(occ);}).finally(()=>running.delete(occ));
    }
    const quote=values.get(occ);
    // Retain the provider quote clock; neither a repeated GET nor a process
    // restart can freshen an old quote by assigning its fetch completion time.
    return quote && quote.quoteAtMs<=atMs
      ? {bid:quote.bid,ask:quote.ask,observedAtMs:quote.quoteAtMs}:null;
  };
}
