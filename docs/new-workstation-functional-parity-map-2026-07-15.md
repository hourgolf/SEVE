# New workstation functional-parity map

Status: implementation guide. The legacy rooms remain available until every row below is useful and verified in the rebuilt shell.

## Migration rule

`app/page.tsx` continues to own remote hooks. Data crosses `SurfaceProps`; workstation shells compose subscription-free leaves. A legacy component that still fetches for itself is not mounted into the rebuilt shell until its data is lifted or it is split into a pure presentation leaf.

## Workspace ownership

| New workspace | Keep now | Bring forward from legacy | Functional acceptance gate |
| --- | --- | --- | --- |
| Dashboard | account/NAV/day/open/risk telemetry, incident banner, compact open-position truth | `TodayStrip`, `DayBooksStrip`, compact P&L attribution | A trader can identify market/session state, exposure, incidents, and the day’s result without opening another room. |
| Markets | full-stage `IntradayChart`, symbol/range/overlay controls | `OptionChain`, `ContractDetail`, useful `SignalsTape` context | Chart and contract chain can be inspected together; selecting a contract does not hide open risk. |
| Positions | full-stage actionable position book, live mark, entry, peak/giveback, guarded close, exit-reason tag | useful parts of `PositionsPanel`, `NetExposurePanel`, `SessionSequencer` | Every open leg is visible and can be deliberately closed by an authenticated operator; aggregate exposure and recent exits remain visible. |
| Channels | current Studio fleet, selected-channel decision/evidence/exit consoles | the strongest `RosterTable`/`ChannelStrip` controls that are not already represented | A channel can be inspected and its per-channel entry, stop, take-profit, sizing, and posture controls can be changed without legacy. |
| Sentinel | full-stage deterministic/interpretive Sentinel evidence | `SentinelPanel`, `BriefPanel` | Current verdict, terrain, promotion/fix/leak evidence, provenance, and freshness are all visible without mixing LLM claims with deterministic health. |
| Event Tape / Review | full-stage live event tape | `AutopsyPanel`, `ForensicsPanel`, relevant `PnlPanel` windows, `EventLog` | Live execution can be separated from after-action analysis; the user can move from an event to channel/trade evidence. |
| Ops | incident/system health already present globally | `OpsPreflight`, operator auth, push/kit settings, `MasterStrip`, `MasterStopControl` | Authentication, process/stream/cron state, transport, and safety controls have one obvious home and truthful status. |

## Order of work

1. Operator auth and actionable Positions.
2. Markets: option chain and contract detail beside the chart.
3. Positions: aggregate exposure and recent-exit context.
4. Sentinel: full evidence and provenance.
5. Event Tape / Review: live versus after-action tabs.
6. Ops: consolidated preflight and settings.
7. Remove Legacy Rooms only after all six workspaces pass desktop and mobile operator drills.
