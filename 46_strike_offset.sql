-- 46_strike_offset.sql — per-channel MONEYNESS lever (strike-moneyness-finding, 2026-06-25).
-- The desk has always traded ATM 0DTE (hardcoded Math.round(close)). The isolation probe showed one
-- strike ITM is a large, structural, all-windows lift on the filtered-momentum book (BREAK ALT/V3:
-- same trades +$66-81/t) — more delta + intrinsic captures the directional edge the ATM structure
-- (max theta + a too-tight −50% premium stop) was bleeding.
--
-- Additive, DEFAULT 0 = ATM (byte-identical with every existing channel). −1 = one strike ITM,
-- +1 = one strike OTM. The worker applies it IDENTICALLY in decide (the OCC) and execute (the booked
-- row.strike) so the order and the row agree. Single-leg channels only.
alter table strategist_config add column if not exists strike_offset integer not null default 0;
