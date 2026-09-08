/** Dedicated clock: fixed history recovery never waits for a bar, current
 * roster membership or an open desk row, and never holds legacy cycle locks.
 * The cadence is a target after completed I/O, not an execution-latency SLA.
 */
type Source = "cycle" | "sweep";
export function makeFixedEntryRuntimeClock(input:{now():number;
  recoverAll(source:Source):Promise<{complete:boolean;unresolved:readonly unknown[]}>;
  failure():void}) {
  let running = false,stopped=false,queuedCycle = false,nextAt = Infinity,promptUntil = -Infinity;
  const kick = (source:Source) => {
    const now = input.now();
    if (stopped || !Number.isFinite(now)) return;
    if (source==="cycle") queuedCycle=true;
    // Routine lifecycle callbacks inside an active pass are already covered
    // by its follow-up result. They cannot keep an expired burst at 500ms.
    if(!running)nextAt=Math.min(nextAt,now);
    // Repeated callbacks inside one burst cannot extend it indefinitely.
    if (!running && now>=promptUntil+5_000) promptUntil=now+30_000;
  };
  const poll = async () => {
    const started=input.now();
    if(stopped || running || !Number.isFinite(started) || started<nextAt) return;
    running=true;nextAt=Infinity;
    const source:Source=queuedCycle?"cycle":"sweep";queuedCycle=false;
    let active=false;
    try {const result=await input.recoverAll(source);active=result.complete && result.unresolved.length>0;}
    catch {input.failure();}
    finally {
      const now=input.now();
      const delay=active && now<promptUntil?500:5_000;
      // A progress callback may have kicked while recovery was in flight. It
      // still waits 500ms; callbacks do not create an unbounded immediate loop.
      nextAt=Math.max(now+500,Math.min(nextAt,now+delay));running=false;
    }
  };
  return {kick,poll,stop:()=>{stopped=true;nextAt=Infinity;}};
}
