---
name: hiring-cafe-scraper
description: Scrape HiringCafe job opportunities into the Hiring Cafe NocoDB base Jobs table for prospecting and outreach research.
---

# HiringCafe Scraper

Use this skill when Hermes needs to collect job opportunities from `hiring.cafe` into NocoDB.

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
