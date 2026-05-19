#!/usr/bin/env node

function usage() {
  console.log(`Command Center prospecting job client

Usage:
  node command-center-prospecting.js [options]

Options:
  --source <id>        Source id. Default: hiring-cafe
  --url <url>          Source URL. Default: https://hiring.cafe/
  --query <text>       HiringCafe search query when no URL is supplied
  --limit <n>          Max items. Default: 50
  --scrape-limit <n>   Max raw cards to inspect before filtering
  --remote-only        Keep only remote jobs
  --keywords <csv>     Keep jobs matching keywords, e.g. "ops,tech"
  --keyword-mode <m>   Keyword mode: any or all. Default: any
  --max-age-days <n>   Keep jobs posted within N days
  --write              Ask Command Center to write to NocoDB
  --dry-run            Scrape only, no NocoDB write
  --table <name>       NocoDB table. Default: Jobs
  --cdp-url <url>      Browser CDP endpoint to pass through
  --headful            Ask server to show browser window
  --headless           Ask server to run headless
  --no-default-profile Do not use Command Center host's default Chrome profile
  --chrome-profile <p> Chrome profile directory. Default: Default
  --cdp-port <n>       Stable Chrome debugging port. Default: 9333
  --poll               Poll until completed/failed
  --poll-ms <n>        Poll interval. Default: 5000
`);
}

function parseArgs(argv) {
  const opts = {
    source: 'hiring-cafe',
    url: 'https://hiring.cafe/',
    urlProvided: false,
    query: '',
    limit: 50,
    scrapeLimit: 0,
    remoteOnly: false,
    keywords: '',
    keywordMode: 'any',
    maxAgeDays: 0,
    write: false,
    table: 'Jobs',
    cdp_url: process.env.HIRING_CAFE_CDP_URL || process.env.BROWSER_CDP_URL || '',
    headful: true,
    useDefaultChromeProfile: true,
    chromeProfileDirectory: process.env.HIRING_CAFE_CHROME_PROFILE_DIRECTORY || 'Default',
    remoteDebuggingPort: Number(process.env.HIRING_CAFE_REMOTE_DEBUGGING_PORT || 9333) || 9333,
    poll: false,
    pollMs: 5000,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else if (arg === '--source') opts.source = String(argv[++i] || 'hiring-cafe');
    else if (arg === '--url') {
      opts.url = String(argv[++i] || 'https://hiring.cafe/');
      opts.urlProvided = true;
    }
    else if (arg === '--query') opts.query = String(argv[++i] || '');
    else if (arg === '--limit') opts.limit = Math.max(1, Number(argv[++i] || 50) || 50);
    else if (arg === '--scrape-limit') opts.scrapeLimit = Math.max(1, Number(argv[++i] || 0) || 0);
    else if (arg === '--remote-only') opts.remoteOnly = true;
    else if (arg === '--keywords') opts.keywords = String(argv[++i] || '');
    else if (arg === '--keyword-mode') opts.keywordMode = String(argv[++i] || 'any').toLowerCase() === 'all' ? 'all' : 'any';
    else if (arg === '--max-age-days') opts.maxAgeDays = Math.max(0, Number(argv[++i] || 0) || 0);
    else if (arg === '--write') opts.write = true;
    else if (arg === '--dry-run') opts.write = false;
    else if (arg === '--table') opts.table = String(argv[++i] || 'Jobs');
    else if (arg === '--cdp-url') opts.cdp_url = String(argv[++i] || '');
    else if (arg === '--headful') opts.headful = true;
    else if (arg === '--headless') opts.headful = false;
    else if (arg === '--no-default-profile') opts.useDefaultChromeProfile = false;
    else if (arg === '--chrome-profile') opts.chromeProfileDirectory = String(argv[++i] || 'Default');
    else if (arg === '--cdp-port') opts.remoteDebuggingPort = Math.max(1024, Number(argv[++i] || 9333) || 9333);
    else if (arg === '--poll') opts.poll = true;
    else if (arg === '--poll-ms') opts.pollMs = Math.max(1000, Number(argv[++i] || 5000) || 5000);
    else throw new Error(`Unknown option: ${arg}`);
  }
  return opts;
}

async function request(method, url, body) {
  const token = String(process.env.COMMAND_CENTER_TOKEN || '').trim();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(json.error || text || `HTTP ${res.status}`);
  return json;
}

async function main() {
  const opts = parseArgs(process.argv);
  const baseUrl = String(process.env.COMMAND_CENTER_URL || 'http://host.docker.internal:3000').replace(/\/+$/, '');
  const payload = {
    source: opts.source,
    ...(opts.urlProvided ? { url: opts.url } : {}),
    query: opts.query,
    limit: opts.limit,
    scrape_limit: opts.scrapeLimit || undefined,
    remote_only: opts.remoteOnly,
    keywords: opts.keywords,
    keyword_mode: opts.keywordMode,
    max_age_days: opts.maxAgeDays || undefined,
    write: opts.write,
    table: opts.table,
    cdp_url: opts.cdp_url,
    headful: opts.headful,
    use_default_chrome_profile: opts.useDefaultChromeProfile,
    chrome_profile_directory: opts.chromeProfileDirectory,
    remote_debugging_port: opts.remoteDebuggingPort,
  };
  const created = await request('POST', `${baseUrl}/api/prospecting/jobs`, payload);
  console.log(JSON.stringify(created, null, 2));
  if (!opts.poll) return;

  const id = created?.job?.id;
  if (!id) throw new Error('Command Center did not return a job id.');
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, opts.pollMs));
    const next = await request('GET', `${baseUrl}/api/prospecting/jobs/${encodeURIComponent(id)}`);
    console.log(JSON.stringify(next, null, 2));
    const status = String(next?.job?.status || '').toLowerCase();
    if (status === 'completed' || status === 'failed') break;
  }
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
