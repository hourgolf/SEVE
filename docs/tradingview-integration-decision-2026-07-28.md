# TradingView integration decision — 2026-07-28

Status: **RESEARCH DECISION · NO PURCHASE OR INTEGRATION AUTHORITY**

## Decision

Do not buy a TradingView subscription as a SEVE platform integration.

Keep the current `lightweight-charts` renderer. A personal TradingView plan may
still be useful to the operator as a separate discretionary research tool, but
it does not solve SEVE's data, archive, replay, broker-truth, or execution
requirements.

## Why

TradingView distinguishes three products:

1. Widgets use TradingView data and are intended as simple embeds.
2. Advanced Charts is a self-hosted chart using **SEVE's own datafeed**.
3. Trading Platform is a separately licensed broker product that adds trading
   integration.

Advanced Charts does not provide market data. SEVE would still need to supply
history, real-time updates, symbol resolution, session calendars, and quotes
through a custom Datafeed API or UDF endpoint. It therefore would not replace
Alpaca SIP/OPRA, Databento exact evidence, R2 archives, or Supabase hot data.

The published free Advanced Charts terms require a public implementation with
visible TradingView attribution. SEVE is a private authenticated workstation,
so the free public-site condition is not a safe assumption for this product.
A personal TradingView subscription is not the documented license path for
embedding Advanced Charts inside a private application.

Trading Platform adds order-facing features, but SEVE should not import another
broker/order surface. Its canonical authority remains:

- Alpaca paper accounts for broker state and paper execution;
- immutable SEVE execution observations and receipts for attribution;
- SIP/OPRA and exact-provider evidence for analysis;
- explicit operator authority for configuration and orders.

## What TradingView could still do

- Separate operator-side charting and manual idea generation.
- A future public research page using a permitted widget.
- A later Advanced Charts licensing conversation if SEVE needs professional
  drawings, indicator authoring, multi-chart layouts, or saved chart studies
  badly enough to justify a SEVE-owned datafeed and private-use terms.

## Revisit trigger

Revisit only if at least two of these become real operator requirements:

- persistent drawings and annotations;
- a large built-in technical-indicator catalog;
- synchronized multi-chart layouts;
- chart-study templates shared across operators;
- a materially better mobile technical-analysis workflow.

Even then, TradingView remains presentation and research only. It must have
zero readiness, Sentinel-health, configuration, broker-reconciliation, risk,
or automatic order authority.

## Current official references

- Advanced Charts introduction:
  https://www.tradingview.com/charting-library-docs/latest/introduction/
- Connecting a custom datafeed:
  https://www.tradingview.com/charting-library-docs/latest/connecting_data/
- Product distinctions and licensing FAQ:
  https://www.tradingview.com/charting-library-docs/latest/resources/Frequently-Asked-Questions/
- Installation and private repository access:
  https://www.tradingview.com/charting-library-docs/latest/getting_started/quick-start/
