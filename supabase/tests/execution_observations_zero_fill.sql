BEGIN;
SET LOCAL statement_timeout='30s';
CREATE TEMP TABLE execution_observations_test (LIKE public.execution_observations INCLUDING CONSTRAINTS) ON COMMIT DROP;
alter table pg_temp.execution_observations_test
  drop constraint execution_observations_check1,
  add constraint execution_observations_check1 check (
    (event_kind = 'decision'
      and client_order_id is null and broker_order_id is null
      and broker_status is null and filled_qty is null and fill_price is null)
    or
    (event_kind = 'broker_result'
      and client_order_id is not null and broker_status is not null
      and filled_qty is not null
      and (fill_price is not null or filled_qty = 0))
  ) not valid;

ALTER TABLE pg_temp.execution_observations_test VALIDATE CONSTRAINT execution_observations_check1;
DO $test$
DECLARE base jsonb; c record; rejected boolean; passed integer:=0;
BEGIN
 SELECT to_jsonb(e) INTO STRICT base FROM public.execution_observations e LIMIT 1;
 FOR c IN SELECT * FROM (VALUES
 ('zero-fill-null','{"event_kind":"broker_result","client_order_id":"test","broker_status":"canceled","filled_qty":0,"fill_price":null}'::jsonb,false),
 ('positive-fill-priced','{"event_kind":"broker_result","client_order_id":"test","broker_status":"filled","filled_qty":4,"fill_price":1.09}'::jsonb,false),
 ('positive-fill-null','{"event_kind":"broker_result","client_order_id":"test","broker_status":"filled","filled_qty":4,"fill_price":null}'::jsonb,true),
 ('negative-fill','{"event_kind":"broker_result","client_order_id":"test","broker_status":"canceled","filled_qty":-1,"fill_price":1}'::jsonb,true),
 ('negative-price','{"event_kind":"broker_result","client_order_id":"test","broker_status":"filled","filled_qty":1,"fill_price":-1}'::jsonb,true),
 ('zero-fill-existing-price','{"event_kind":"broker_result","client_order_id":"test","broker_status":"canceled","filled_qty":0,"fill_price":0}'::jsonb,false),
 ('missing-status','{"event_kind":"broker_result","client_order_id":"test","broker_status":null,"filled_qty":0,"fill_price":null}'::jsonb,true),
 ('clean-decision','{"event_kind":"decision","client_order_id":null,"broker_order_id":null,"broker_status":null,"filled_qty":null,"fill_price":null}'::jsonb,false),
 ('dirty-decision','{"event_kind":"decision","client_order_id":null,"broker_order_id":null,"broker_status":null,"filled_qty":0,"fill_price":null}'::jsonb,true)
 ) t(name,patch,should_reject)
 LOOP
  rejected:=false;
  BEGIN
   INSERT INTO pg_temp.execution_observations_test SELECT * FROM jsonb_populate_record(null::pg_temp.execution_observations_test,base||c.patch);
  EXCEPTION WHEN check_violation THEN rejected:=true;
  END;
  IF rejected<>c.should_reject THEN RAISE EXCEPTION 'Regression failed: %',c.name; END IF;
  passed:=passed+1;
 END LOOP;
 IF passed<>9 THEN RAISE EXCEPTION 'Incomplete regression'; END IF;
END $test$;
SELECT '9/9 real PostgreSQL constraint cases passed; temporary table only' AS result;
ROLLBACK;