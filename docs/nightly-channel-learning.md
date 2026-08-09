# Nightly channel learning

SEVE's nightly learning loop connects three decisions that previously required separate manual reviews:

1. Is tonight's evidence complete enough to trust?
2. What single channel-specific paper experiment is justified next?
3. Does the executed trail and portfolio replay support one more contract?

It runs after the profitability ledger, Decision Atlas, weekly readout, and channel briefs. The command is:

```sh
npm run nightly-channel-learning -- \
  --atlas-file <run>/atlas/atlas.json \
  --snapshot-file <run>/atlas/snapshot.json \
  --briefs-file <run>/briefs/briefs.json \
  --shadow-catchup-manifest <run>/shadow/gate-shadow-catchup-manifest.json \
  --out-dir <run>/learning
```

`npm run nightly-decision-atlas` invokes it automatically. `capture-forward` passes the exact gate-shadow manifest after the current session is rebuilt and independently verified.

## 1. Evidence reconciliation

The reconciler checks logical opportunities, persisted execution trails, native virtual paths, manager paths, and configuration stamps by channel. Every-opportunity gates such as cost and stale-chain blocks can be compared row-for-row. Dark, collision, and re-entry signals are sequential bar streams; only the bounded gate-shadow preflight may decide which of those become logical trades.

If the preflight finds missing rows, the output is an exact `virtual_trades`-only recovery proposal with signal ids, session, content hash, `eventInserts: 0`, and an independent-readback requirement. It never performs the write automatically.

## 2. Channel experiment lifecycle

Each channel receives at most one changing variable. Entry, exit, manager, size, promotion posture, and retirement posture remain independent experiments. Every plan freezes the other decisions, requires at least five independent sessions and ten paired logical opportunities, and uses the typical paired result as its primary outcome. Downside, displacement, outlier dependence, and session stability are safeguards.

Stages are:

- `control_only`: no justified change; keep collecting.
- `draft`: the evidence points to an axis, but the challenger or cohort is not frozen.
- `preregistered`: a reviewable one-variable plan exists; it has no runtime authority.
- `collecting`: signals carry the exact preregistration stamp and the cohort is still below the floor.
- `ready_to_score`: the frozen cohort reached the evidence floor.

Configuration drift or a baseline mismatch returns the plan to `draft` instead of silently pooling contaminated evidence.

## 3. Execution and capacity readiness

The execution audit checks decision-to-broker trace continuity, fill-to-position/opportunity linkage, logical trade identity, and configuration stamping. The capacity review then consumes the existing chronological 1–6 contract portfolio replay. A paper size step is marked ready only when:

- the current lot is represented;
- the channel has at least five sessions and ten logical opportunities;
- the one-contract step is inside the replay-supported ceiling;
- replayed portfolio result does not deteriorate; and
- the larger lot does not displace positive peer expectancy.

Cross-account same-OCC positions are allowed and retain independent exits. Overlap is reported, not treated as an automatic veto.

## Outputs and authority

Each run writes deterministic local JSON and concise Markdown:

- `packet`: one headline, three counts, and next actions;
- `evidence`: source coverage and exact recovery proposals;
- `experiments`: one-variable preregistrations and collection state;
- `execution-capacity`: execution integrity and one-contract replay decisions;
- `receipt`: hashes for every input and output.
- `dashboard-briefs`: existing channel briefs enriched with one compact
  data/test/size status strip for separately approved publication.

These artifacts perform zero production reads and zero production writes. They cannot place orders, change configuration, alter the roster, activate schedules, route accounts, select a manager, or change sizing. Recovery publication and every paper experiment remain separately approved operations.
