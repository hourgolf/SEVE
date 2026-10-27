-- MACD's atomic admission snapshot reads this complete, all-session predicate.
-- Keep malformed intent records and protocol records without an original intent
-- visible to the existing fail-closed validators. Do not narrow by date/channel.
-- Single concurrent statement: apply outside an explicit transaction. The
-- Supabase CLI supports this; a transaction-wrapping runner must run it alone.
-- No admission function, freshness bound, policy, roster or order data changes.
create index concurrently if not exists execution_observations_fixed_custody_id_idx
on public.execution_observations (id)
where reason = 'fixed_entry_protocol:intent'
   or payload->>'fixed_entry_protocol' = 'fixed-entry-intent-v1';
