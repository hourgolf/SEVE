# Reporting producer canary

This is the read-only acceptance check for the first normal report cycles after the historical reporting release. It observes stored rows and immutable publication history. It does not invoke either producer.

## Monday daily report

Run after the normal post-close producer has had time to publish on Monday, September 21:

```sh
npm run reporting-producer-canary -- \
  --env-file /absolute/path/to/.env.local \
  --daily 2026-09-21 \
  --out /tmp/seve-reporting-canary-daily-2026-09-21.json
```

## Friday weekly report

Run after the normal weekly producer has had time to publish on Friday, September 25:

```sh
npm run reporting-producer-canary -- \
  --env-file /absolute/path/to/.env.local \
  --weekly 2026-09-25 \
  --out /tmp/seve-reporting-canary-weekly-2026-09-25.json
```

Exit `0` is a pass. Exit `2` means the scheduled report is still pending. Exit `1` means a row exists but violates the reporting contract, or the read itself failed. A pass requires the expected report date, paper mode, `seve-reporting-v3`, logical-trade unit, whole-position gross dollars, New York session timezone, modern all-account scope, and a matching immutable publication-history payload. The weekly check also requires `requestedThrough` and at least one source daily report.

The canary has SELECT authority only. It performs no report publication, production write, configuration change, roster change, or order action.
