/** Read-only archive audit. Input SQL extracts and result files are local.
 * S3 capability is GetObject only; no order, publisher or retention path. */
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {gunzipSync} from "node:zlib";
import {GetObjectCommand,S3Client} from "@aws-sdk/client-s3";
import {quotePathCoverage,type QuoteRow} from "../lib/research/quotePathCoverage";
import {shadowSessionDate} from "../lib/research/shadowResearch";
import {researchDateBounds} from "../lib/research/completeResearchRead";

async function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error("Provide the local audit directory containing inventory.json and paths.json");
  const read = (name:string) => Object.fromEntries(JSON.parse(fs.readFileSync(path.join(dir,name),"utf8")).data.map((r:any)=>[r.kind,r.detail]));
  const inventory=read("inventory.json"), source=read("paths.json");
  const r2=new S3Client({region:"auto",endpoint:`https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials:{accessKeyId:process.env.R2_ACCESS_KEY_ID!,secretAccessKey:process.env.R2_SECRET_ACCESS_KEY!}});
  const bytes=async(key:string)=> {const r=await r2.send(new GetObjectCommand({Bucket:process.env.R2_BUCKET,Key:key}));if(!r.Body)throw Error("Empty archive object");return Buffer.from(await r.Body.transformToByteArray());};
  const hash=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");
  const previous = process.argv.includes("--include-restored-early") ? JSON.parse(fs.readFileSync(path.join(dir,"quote-path-audit.json"),"utf8")) : null;
  const paths:any[]=previous?.paths ?? [...source.positions.filter((p:any)=>!p.runner_of).map((p:any)=>({id:p.id,slug:p.slug,layer:"executed_root",session:shadowSessionDate(p.opened_at),occ:p.occ_symbol,start:p.opened_at,end:p.closed_at,peakRecorded:p.peak_mark!=null,peakTimeRecorded:p.peak_at!=null})),
    ...source.virtual.map((v:any)=>({id:v.signal_id,slug:v.slug,layer:"virtual",session:shadowSessionDate(v.signal_at),occ:v.occ,start:v.signal_at,end:v.exit_at,blocked:v.blocked,exitReason:v.exit_reason,peakRecorded:v.mfe_pct!=null}))];
  const receipts=new Map<string,any>(inventory.archives.map((a:any)=>[a.session_date_et,a]));
  const archiveResults:any[]=previous?.archives ?? [];
  const early = previous ? JSON.parse(fs.readFileSync(path.join(dir,"early-restore-selection.json"),"utf8")).files : [];
  if (previous && JSON.parse(fs.readFileSync(path.join(dir,"early-quotes/RESTORE-RECEIPT.json"),"utf8")).status !== "PASS") throw Error("Early restore not verified");
  const localByDate = new Map<string,any>(early.map((r:any)=>[path.basename(r.path).slice(0,10),r]));
  for (const session of [...new Set(paths.map(p=>p.session)),...receipts.keys(),...localByDate.keys()].filter((x,i,a)=>a.indexOf(x)===i).sort()) {
    const cohort=paths.filter(p=>p.session===session), receipt=receipts.get(session);
    if (archiveResults.some(a=>a.session===session&&a.state==="verified")) continue;
    const local = localByDate.get(session);
    if (!receipt && !local) { for(const p of cohort)p.archiveState="no_verified_archive_located"; continue; }
    try {
      let quotes:(QuoteRow&{id:string;occ_symbol:string})[], compressedHash:string;
      if (local) {
        const compressed=fs.readFileSync(path.join(dir,"early-quotes",local.root,local.path));
        if(hash(compressed)!==local.sha256 || compressed.length!==local.size)throw Error("Restored B2 file hash mismatch");
        quotes=JSON.parse(gunzipSync(compressed).toString()); compressedHash=local.sha256;
      } else {
        const compressed=await bytes(receipt.object_key), manifestBody=await bytes(receipt.manifest_key);
        if(hash(compressed)!==receipt.compressed_sha256 || hash(manifestBody)!==receipt.manifest_sha256 || compressed.length!==receipt.compressed_bytes)throw Error("Archive receipt checksum mismatch");
        const raw=gunzipSync(compressed);
        if(hash(raw)!==receipt.content_sha256)throw Error("Uncompressed checksum mismatch");
        const manifest=JSON.parse(manifestBody.toString()); quotes=JSON.parse(raw.toString());
        if(quotes.length!==receipt.row_count || manifest.rowCount!==quotes.length || manifest.sessionDateEt!==session || manifest.contentSha256!==receipt.content_sha256 || manifest.compressedSha256!==receipt.compressed_sha256 || manifest.objectKey!==receipt.object_key || manifest.manifestKey!==receipt.manifest_key)throw Error("Manifest identity or count mismatch");
        compressedHash=receipt.compressed_sha256;
      }
      const ids=new Set<string>(),byOcc=new Map<string,typeof quotes>();
      for(const q of quotes) {
        if(!q.id||ids.has(q.id)||q.captured_at.slice(0,10)!==session)throw Error("Duplicate/misdated archive row");
        ids.add(q.id); const a=byOcc.get(q.occ_symbol)??[];a.push(q);byOcc.set(q.occ_symbol,a);
      }
      const close=Date.parse(researchDateBounds(session,session).from)+16*3600_000;
      const quality={rows:quotes.length,validPrices:0,withProviderClock:0,freshOpra:0};
      for(const q of quotes){
        const valid=typeof q.bid==="number"&&Number.isFinite(q.bid)&&q.bid>0&&typeof q.ask==="number"&&Number.isFinite(q.ask)&&q.ask>=q.bid;
        if(valid)quality.validPrices++;
        const age=Date.parse(q.captured_at)-Date.parse(q.provider_quote_at??"");
        if(Number.isFinite(age))quality.withProviderClock++;
        if(valid&&q.option_feed==="opra"&&age>=0&&age<=15_000)quality.freshOpra++;
      }
      for(const p of cohort){
        p.archiveState="verified";
        if(!p.occ){p.pathState="no_selected_contract";continue;}
        const q=byOcc.get(p.occ)??[],start=Date.parse(p.start),end=Date.parse(p.end);
        if(!Number.isFinite(end)||end<start||end>close+3600_000){p.pathState="no_same_session_closed_path";continue;}
        p.pathState="measured";
        p.management=quotePathCoverage(q,start,end);
        p.postExit=end<close?quotePathCoverage(q,end,Math.min(end+30*60_000,close)):null;
      }
      archiveResults.push({session,state:"verified",...quality,paths:cohort.length,compressedSha256:compressedHash,source:local?"B2 verified logical file":"R2 receipt and manifest"});
      console.log(JSON.stringify(archiveResults.at(-1)));
    } catch(e) {
      const reason=e instanceof Error?e.name:"ArchiveReadFailure";
      archiveResults.push({session,state:"unavailable",reason});
      for(const p of cohort)p.archiveState="verification_failed";
      console.log(JSON.stringify(archiveResults.at(-1)));
    }
    fs.writeFileSync(path.join(dir,"quote-path-audit-progress.json"),JSON.stringify({at:new Date().toISOString(),archives:archiveResults},null,2));
  }
  const out={at:new Date().toISOString(),method:"Archived sampled bid/ask paths. Fresh means OPRA and provider timestamp aged 0–15 seconds at capture. Causal entry and maximum gap tests use 15/120 second ceilings; no interpolated prices. Post-exit horizon is 30 minutes, bounded by regular 16:00 ET close. No tick-completeness, fillability, strategy quality, or hot-vs-cold parity claim. B2 restores, when included, are verified against the original logical-file manifest and parsed with the same path tests.",archives:archiveResults,paths};
  fs.writeFileSync(path.join(dir,"quote-path-audit.json"),JSON.stringify(out,null,2));
  console.log(JSON.stringify({archives:archiveResults.length,verified:archiveResults.filter(a=>a.state==="verified").length,paths:paths.length}));
}
void main().catch(e=>{console.error(e instanceof Error?e.name:"AuditError");process.exitCode=1;});
