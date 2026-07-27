# LAB canary backend foundation — 2026-07-26

## Outcome

The repository now contains a roster-neutral, fail-closed foundation for a
paper-only LAB executable cohort beside the existing RC5.3 control fleet.

This preparation does **not**:

- select or activate LAB channels;
- change the current six RC5.3 roots;
- mutate strategist, account, or release rows;
- apply a migration;
- change Railway or Vercel configuration;
- authorize a deployment or an order;
- seal take-profit, ratchet, re-entry, scale-in, or scale-out behavior.

## Fixed now

- Admission domains are explicit: `rc5-control` and `lab-canary`.
- LAB source quantity is exactly two contracts so integer manager allocations
  and staged manager evidence remain available.
- LAB has its own family, underlying, same-OCC, same-clock, and total capacity.
- A same OCC may exist in RC5 and LAB because the paper accounts and position
  identities are distinct. That overlap must emit a cross-domain covariance
  receipt; it is not treated as independent portfolio evidence.
- Every sealed LAB policy epoch can carry release id, configuration hash,
  admission domain, cohort id/start, evidence era, source quantity, and shadow
  book version. The same stamp is available on signals and position
  `entry_features`.
- `LAB_CANARY_ENABLED` defaults off. Turning it on before a roster and
  configuration are sealed causes startup refusal.
- RC5.3 policy identities are unchanged because release attribution is optional
  and absent from the current runtime path.

## Deliberately unsealed

The foundation contains no candidate slugs. It exposes the management
primitives needed for the next design pass but selects none of them:

- premium catastrophe stop;
- fixed take profit;
- giveback ratchet;
- bank/runner split;
- timed flatten;
- re-entry;
- scaled entry;
- scaled exit.

This is intentional. Those choices define a new executable configuration era
and must not be inferred from Virtual Bench rankings or copied from RC5.3.

## Tomorrow after market close

1. Finish the T+1 exact replay and record completeness/censoring.
2. Re-run candidate ranking with SPY `vb-macd-state` eligible and IWM treated as
   optional rather than required.
3. Select two or three LAB roots and freeze family/underlying priorities.
4. Decide each executable manager profile, premium/debit cap, and exact
   two-contract allocation.
5. Generate channel, manager, configuration-epoch, and policy-epoch identities.
6. Set the LAB cohort id and start date. Historical VB and T+1 rows remain in
   their existing eras.
7. Run the sealed release validator and foundation receipt.
8. Review the resulting diff and startup receipt before any database, Railway,
   merge, deployment, or activation action.

## Configuration-theory agenda

The next discussion should separate four questions that were previously bundled
under “ride”:

1. **Evidence continuity:** which close paths preserve full downstream manager
   and mark evidence, including operator closes.
2. **Profit harvesting:** fixed target, full-position ratchet, bank/runner, or
   staged scale-out.
3. **Opportunity lifecycle:** whether a completed exit ends the opportunity or
   permits a new, separately identified re-entry.
4. **Position construction:** whether scale-in stages are independently
   pre-registered and risk-capped rather than quote-dependent pyramids.

Sentinel should report each as a distinct claim. Bollinger-band or other alpha
features belong to the channel/version identity; they must not be mixed with
manager-policy conclusions.
