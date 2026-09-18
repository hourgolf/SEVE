'use client';
import { getSupabase } from '../supabaseClient';
import type { HistoricalSnapshot } from '../../supabase/functions/_shared/historicalAttribution';
let pending:{token:string;promise:Promise<HistoricalSnapshot>}|null=null;
/** Coalesce simultaneous reads only; never reuse a prior user's or stale completed projection. */
export async function readHistoricalAttribution():Promise<HistoricalSnapshot>{
  const {data,error}=await getSupabase().auth.getSession();
  if(error||!data.session)throw Error('Sign in to read audited historical attribution');
  const token=data.session.access_token;
  if(pending?.token===token)return pending.promise;
  const promise=(async()=>{
    const r=await fetch('/api/historical-attribution',{headers:{authorization:`Bearer ${token}`},cache:'no-store',signal:AbortSignal.timeout(60000)});
    const b=await r.json();if(!r.ok||!b.ok||b.snapshot?.schema!=='seve-historical-attribution-v1')throw Error(b.error??'Historical attribution read failed');
    return b.snapshot as HistoricalSnapshot;
  })();
  pending={token,promise};
  try{return await promise;}finally{if(pending?.promise===promise)pending=null;}
}
