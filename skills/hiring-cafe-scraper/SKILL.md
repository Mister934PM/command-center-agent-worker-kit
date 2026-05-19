---
name: hiring-cafe-scraper
description: Scrape HiringCafe job opportunities into the Hiring Cafe NocoDB base Jobs table for prospecting and outreach research.
---

# HiringCafe Scraper

Use this skill when a Command Center operative needs to collect job opportunities from `hiring.cafe` into NocoDB.

## Preferred Command Center API

Command Center should own NocoDB writes. For sources that do not fight automation, a configured worker can trigger a backend scrape job and poll status:

```powershell
node .\skills\hiring-cafe-scraper\command-center-prospecting.js --limit 50 --write --poll
```

This uses the Command Center host's regular Chrome profile and stable CDP port `9333` by default. Do not pass a new port per run; reusing the same port keeps one verified HiringCafe browser session alive instead of opening a fresh Chrome window every job.

For targeted prospecting, avoid broad scrapes. Use a HiringCafe search query plus backend filters:

```powershell
node .\skills\hiring-cafe-scraper\command-center-prospecting.js --query "operations OR technology" --remote-only --keywords "ops,tech" --keyword-mode any --max-age-days 7 --limit 25 --write --poll
```

Use `--dry-run` first when testing a new search profile:

```powershell
node .\skills\hiring-cafe-scraper\command-center-prospecting.js --query "operations OR technology" --remote-only --keywords "ops,tech" --max-age-days 7 --limit 10 --dry-run --poll
```

HiringCafe specifically works best through the operative's regular OpenClaw browser profile. Extract jobs in that browser, save JSON, then import through Command Center:

```powershell
node .\skills\hiring-cafe-scraper\import-prospecting-records.js --input .\hiring-cafe-jobs.json --write
```

Use the local scraper below only as a fallback/diagnostic path.

HiringCafe normally shows a Cloudflare/interstitial page for 5-10 seconds even for a human browser. Treat that as expected behavior; do not report failure until the configured wait expires.

## Boundary

- Do not bypass CAPTCHA or anti-bot controls.
- The scraper may use a normal browser session and wait for the ordinary Cloudflare interstitial to clear.
- If a CAPTCHA or hard block appears, stop and report it.

## Commands

From the worker root:

```powershell
node .\skills\hiring-cafe-scraper\scrape-hiring-cafe.js --limit 50 --write
```

Useful options:

```powershell
node .\skills\hiring-cafe-scraper\scrape-hiring-cafe.js --url "https://hiring.cafe/?search=founder%20sales" --limit 100 --write
node .\skills\hiring-cafe-scraper\scrape-hiring-cafe.js --cdp-url "http://127.0.0.1:9222" --limit 50 --write
node .\skills\hiring-cafe-scraper\scrape-hiring-cafe.js --dry-run --limit 20
node .\skills\hiring-cafe-scraper\scrape-hiring-cafe.js --headful --dry-run --limit 5
node .\skills\hiring-cafe-scraper\scrape-hiring-cafe.js --table "Jobs"
```

Prefer `--cdp-url` when Hermes/OpenClaw already has a browser exposed through Chrome DevTools Protocol. Use `--headful` only as the standalone fallback for the first run if HiringCafe keeps showing the security verification page. Complete the normal browser check if prompted, keep the same `--browser-dir`, then run the normal headless write command.

## Requirements

- Worker-local NocoDB config: `credentials\nocodb-mcp.hiring-cafe.local.json`
- `mcporter` available as in the NocoDB MCP helper.
- Playwright installed in the scraper skill folder. It is used as the control client for both CDP attach mode and standalone fallback mode.

If Playwright is missing, install it locally in the skill folder:

```powershell
cd .\skills\hiring-cafe-scraper
npm install
npm run install-browser
```
