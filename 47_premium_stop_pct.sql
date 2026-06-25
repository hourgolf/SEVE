-- 47_premium_stop_pct.sql — per-channel PREMIUM-STOP override (ORB underlying-stop finding, 2026-06-25).
-- The worker applies a −50% catastrophic premium stop to EVERY channel (policy.PREMIUM_STOP_PCT=50) plus
-- any spec premium stop. The orb-ustop-sweep showed that on the ORB spec a ~0.30% UNDERLYING-move stop
-- (underlying_stop_pct) BEATS the −50% premium stop (+$33→+$52.6/t, stop-rate 64→43%) — the premium stop
-- fires on theta/noise, the underlying stop on a real adverse move. This lets a channel turn the premium
-- stop OFF and run the underlying stop instead.
--
-- NULL (default) → policy default 50 = byte-identical with every existing channel. 0 → premium stop OFF.
alter table strategist_config add column if not exists premium_stop_pct numeric;
