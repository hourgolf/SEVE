/** Reporting agenda from the frozen September 16 review. Installs no collectors or trading policy. */
export const RESEARCH_AGENDA = {
  version: 'seve-channel-tests-v1', frozenAt: '2026-09-17T01:58:22.016Z', prospectiveFrom: '2026-09-17',
  firstReview: 'After 10 consecutive eligible sessions; retain missed and zero-signal sessions. Extend when precision or paired observations are insufficient.',
  owner: 'Research review; existing observers only. Additional native collection requires its own approved release.',
  fixed: ['native stop', 'entry and contract', 'quantity', 'account route', 'mandatory event/kill/EOD horizon'],
  exclusions: 'Quarantine quote contradictions across every arm. Keep missing paths visible. New manager/spec identity starts a new cohort. Historical results are exploratory.',
  studies: [
    { channels: ['vb-curl-reversal-iwm', 'vb-curl-reversal-qqq'], question: 'Calibrate actual exits against LOCK20/30, then compare LOCK30/30 on the same executable path.', fixed: 'Two contracts, native 30% stop, 15:25 ET cutoff, exact immutable native spec. Separate actual/native reconciliation from challenger/native benefit.' },
    { channels: ['vb-vwap-revert-qqq'], question: 'Compare entries 2–3 versus at least 3 directional ATR from VWAP.', fixed: 'Native exit and size; first/later entry, side and session strata. An association does not prove a skip-first entry rule.' },
    { channels: ['pb-ride'], question: 'Compare entries before versus after 10:30 ET.', fixed: 'Native +12/−30, side and policy era; no timing gate is applied.' },
    { channels: ['grind-smart-entries'], question: 'Track deterioration in initial favorable movement and adverse excursion.', fixed: 'Current native version, side, clock, premium, efficiency, relative volume and directional VWAP distance. No optimized cutoff.' },
    { channels: ['vb-vwap-revert', 'vb-or-fail-qqq', 'vb-or-fail-iwm', 'vb-gap-drift-qqq'], question: 'Compare frozen native target versus +50% on the true first archived candidate.', fixed: 'One-contract normalized bid/ask replay, native 30% stop, 15:25 cutoff. Missing first candidates stay missing. Affordability, concurrent admission and portfolio displacement remain unidentified.' },
  ],
} as const;
export const plannedStudyFor = (slug: string) => RESEARCH_AGENDA.studies.find(study => (study.channels as readonly string[]).includes(slug));
