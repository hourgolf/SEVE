import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireDeskOperator } from '@/lib/auth/serverOperator';
import { loadHistoricalAttribution } from '@/supabase/functions/_shared/loadHistoricalAttribution';
export const dynamic='force-dynamic';
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'cache-control':'private, no-store, max-age=0'}});
/** Authenticated SELECT-only projection; no producer dispatch and no source writes. */
export async function GET(req:Request){
  const operator=await requireDeskOperator(req);if(!operator.ok)return operator.response;
  const url=process.env.SUPABASE_URL??process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)return json({ok:false,error:'Historical attribution read is not configured'},503);
  try {
    const sb=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
    return json({ok:true,snapshot:await loadHistoricalAttribution(sb)});
  }catch(e){return json({ok:false,error:e instanceof Error?e.message:'Historical attribution unavailable'},502);}
}
