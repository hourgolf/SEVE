-- 38_take_profit.sql — per-channel TAKE-PROFIT compound policy (compound-vs-ride-verdict, 2026-06-16).
--
-- Exit at +take_profit_pct% of premium, then RE-ENTER on the next signal when flat → compounding.
-- For channels with NO convex tail (PB: ridden −EV at the faithful gate, compound +EV — see
-- `npm run compound-vs-ride-probe`: PB ride −$3,646 → +30% compound +$2,701) compounding beats
-- riding. 0 = off (ride to the −50% stop / 15:25 flatten — unchanged for every existing channel).
--
-- The worker applies it on BOTH the bar-close path (decide.ts) AND the ~10s fast-exit sweep
-- (execute.ts premiumExitReason) so the +pct target reacts sub-minute like the −50% stop (the
-- compound edge is a pop-harvest). Mirrors the engine's premiumExit.profitPct (mid-based) → parity.
--
-- Additive + fail-safe: default 0 keeps every channel byte-identical until explicitly set.

ALTER TABLE strategist_config ADD COLUMN IF NOT EXISTS take_profit_pct numeric NOT NULL DEFAULT 0;

-- Re-tool PB (pb-ride) from ride-to-close to +30% take-profit-and-redeploy (the validated config).
-- Reversible: set take_profit_pct = 0 to restore riding. Inert until the worker that reads it deploys.
UPDATE strategist_config c SET take_profit_pct = 30
FROM strategists s WHERE c.strategist_id = s.id AND s.slug = 'pb-ride';
