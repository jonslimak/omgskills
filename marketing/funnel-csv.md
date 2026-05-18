# X Ads Funnel CSV Setup

Use this while X Ads API access is pending.

## Export From X Ads

1. Open https://ads.x.com/
2. Go to Analytics or Campaigns.
3. Set the date range.
4. Export campaign performance as CSV.
5. Include at least: date, campaign, spend, impressions, clicks.

Recommended ad URL format:

```text
https://omgskills.com/?utm_source=x&utm_medium=paid_social&utm_campaign=<campaign-name>&utm_content=<ad-or-creative>
```

The `utm_campaign` value should match the campaign name in the CSV when possible.

## Run Report

```bash
node scripts/funnel-report-csv.mjs --x-csv ~/Downloads/x-ads-export.csv --days 7
```

Optional fixed range:

```bash
node scripts/funnel-report-csv.mjs --x-csv ~/Downloads/x-ads-export.csv --start 2026-05-12 --end 2026-05-18
```

The report joins:

- X CSV: spend, impressions, clicks
- Humblytics: paid X sessions and download clicks
- TelemetryDeck: installs, launches, and first-use app actions

## Notes

- Secrets stay in local `.env`.
- The app currently cannot read X Ads API directly until X enables Ads API access.
- App installs are aggregate by day, not campaign-specific, until we add a web-to-app attribution bridge.
