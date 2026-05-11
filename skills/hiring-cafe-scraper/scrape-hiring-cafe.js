#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const workerRoot = process.env.COMMAND_CENTER_WORKER_ROOT || path.resolve(__dirname, '..', '..');
const credentialsDir = process.env.NOCODB_MCP_CREDENTIALS_DIR || path.join(workerRoot, 'credentials');
const defaultConfigPath = path.join(credentialsDir, 'nocodb-mcp.hiring-cafe.local.json');
const configPath = process.env.NOCODB_MCP_CONFIG || defaultConfigPath;
const defaultBrowserDir = path.join(workerRoot, '.cache', 'hiring-cafe-browser');

function usage() {
  console.log(`HiringCafe scraper

Usage:
  node scrape-hiring-cafe.js [options]

Options:
  --url <url>              HiringCafe URL to scrape. Default: https://hiring.cafe/
  --limit <n>              Max jobs to collect. Default: 50
  --write                  Upsert records into NocoDB. Default is dry-run
  --dry-run                Print summary only
  --table <name>           NocoDB table title. Default: Jobs
  --config <path>          NocoDB MCP config path. Default: credentials/nocodb-mcp.hiring-cafe.local.json
  --cdp-url <url>          Attach to an existing browser CDP endpoint. Env: HIRING_CAFE_CDP_URL or BROWSER_CDP_URL
  --browser-dir <path>     Persistent browser profile dir for normal session cookies
  --headful                Show Chromium window
  --no-scroll              Do not scroll for more jobs
  --challenge-wait <ms>    Max time to wait for ordinary security checks. Default: 30000
`);
}

function parseArgs(argv) {
  const opts = {
    url: 'https://hiring.cafe/',
    limit: 50,
    write: false,
    table: 'Jobs',
    config: configPath,
    cdpUrl: process.env.HIRING_CAFE_CDP_URL || process.env.BROWSER_CDP_URL || '',
    browserDir: process.env.HIRING_CAFE_USER_DATA_DIR || defaultBrowserDir,
    headless: true,
    scroll: true,
    challengeWaitMs: Number(process.env.HIRING_CAFE_CHALLENGE_WAIT_MS || 30000),
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else if (arg === '--url') opts.url = String(argv[++i] || '').trim();
    else if (arg === '--limit') opts.limit = Math.max(1, Number(argv[++i] || 50) || 50);
    else if (arg === '--write') opts.write = true;
    else if (arg === '--dry-run') opts.write = false;
    else if (arg === '--table') opts.table = String(argv[++i] || 'Jobs').trim() || 'Jobs';
    else if (arg === '--config') opts.config = path.resolve(String(argv[++i] || ''));
    else if (arg === '--cdp-url') opts.cdpUrl = String(argv[++i] || '').trim();
    else if (arg === '--browser-dir') opts.browserDir = path.resolve(String(argv[++i] || ''));
    else if (arg === '--headful') opts.headless = false;
    else if (arg === '--no-scroll') opts.scroll = false;
    else if (arg === '--challenge-wait') opts.challengeWaitMs = Math.max(0, Number(argv[++i] || 30000) || 30000);
    else throw new Error(`Unknown option: ${arg}`);
  }
  return opts;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function readNocoConfig(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Missing NocoDB config: ${filePath}`);
  const cfg = readJson(filePath);
  if (!cfg.url || !cfg.headerName || !cfg.token) throw new Error(`Invalid NocoDB config: ${filePath}`);
  return cfg;
}

function mcporterArgs(cfg, toolName, args) {
  return [
    'call',
    '--tool', toolName,
    '--stdio', 'npx',
    '--stdio-arg', '-y',
    '--stdio-arg', 'mcp-remote',
    '--stdio-arg', cfg.url,
    '--stdio-arg', '--header',
    '--stdio-arg', `${cfg.headerName}: ${cfg.token}`,
    '--args', JSON.stringify(args || {}),
    '--output', 'json',
    '--timeout', '60000',
  ];
}

function runMcporter(cfg, toolName, args) {
  const home = process.env.USERPROFILE || process.env.HOME || process.cwd();
  const isWindows = process.platform === 'win32';
  const cliPath = path.join(home, 'AppData', 'Roaming', 'npm', 'node_modules', 'mcporter', 'dist', 'cli.js');
  const bin = isWindows ? process.execPath : 'mcporter';
  const finalArgs = isWindows ? [cliPath, ...mcporterArgs(cfg, toolName, args)] : mcporterArgs(cfg, toolName, args);
  const result = spawnSync(bin, finalArgs, {
    encoding: 'utf8',
    stdio: 'pipe',
    shell: false,
    env: { ...process.env },
  });
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) {
    const stderr = String(result.stderr || '').trim();
    const stdout = String(result.stdout || '').trim();
    throw new Error(stderr || stdout || `mcporter failed: ${toolName}`);
  }
  const out = String(result.stdout || '').trim();
  return out ? JSON.parse(out) : null;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.tables)) return value.tables;
  if (Array.isArray(value?.list)) return value.list;
  if (Array.isArray(value?.records)) return value.records;
  return [];
}

function normalizeKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function findTable(tablesPayload, title) {
  const wanted = normalizeKey(title);
  const tables = asArray(tablesPayload);
  return tables.find((table) => normalizeKey(table.title || table.name) === wanted)
    || tables.find((table) => normalizeKey(table.title || table.name).includes(wanted))
    || null;
}

function extractColumns(schemaPayload) {
  const columns = schemaPayload?.columns || schemaPayload?.fields || schemaPayload?.table?.columns || schemaPayload?.schema?.columns || [];
  return Array.isArray(columns) ? columns : [];
}

function columnName(column) {
  return String(column?.title || column?.column_name || column?.name || '').trim();
}

function createColumnMatcher(columns) {
  const byKey = new Map();
  for (const col of columns) {
    const name = columnName(col);
    if (!name) continue;
    byKey.set(normalizeKey(name), name);
  }
  return (...candidates) => {
    for (const candidate of candidates) {
      const direct = byKey.get(normalizeKey(candidate));
      if (direct) return direct;
    }
    for (const [key, name] of byKey.entries()) {
      if (candidates.some((candidate) => key.includes(normalizeKey(candidate)))) return name;
    }
    return '';
  };
}

function stableId(value) {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, 16);
}

function splitLines(text) {
  return String(text || '')
    .split(/\n+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function isActionLine(line) {
  return /^(save|hide|mark applied|view all|job posting)$/i.test(String(line || '').trim());
}

function isTimeLine(line) {
  return /^(\d+\s*(m|h|d|w)|\d+\s*(min|hour|day|week)s?|yesterday|today)$/i.test(String(line || '').trim());
}

function inferPainPoint(job) {
  const text = `${job.title} ${job.summary} ${job.skills}`.toLowerCase();
  const hits = [];
  if (/\b(ai|automation|workflow|operations|ops|process)\b/.test(text)) hits.push('Automation / operational leverage');
  if (/\b(sales|business development|lead generation|growth|marketing|seo|content)\b/.test(text)) hits.push('Growth / pipeline generation');
  if (/\b(data|analytics|sql|bi|reporting|dashboard)\b/.test(text)) hits.push('Data visibility / reporting');
  if (/\b(crm|hubspot|salesforce|customer success|support)\b/.test(text)) hits.push('CRM / customer operations');
  if (/\b(engineer|developer|devops|cloud|infrastructure|platform|api)\b/.test(text)) hits.push('Technical execution capacity');
  return hits.join('; ') || 'Hiring indicates capacity gap or priority initiative';
}

function inferOfferAngle(job) {
  const pain = inferPainPoint(job).toLowerCase();
  if (pain.includes('automation')) return 'Offer workflow automation, agentic ops, or internal tooling to reduce manual headcount pressure.';
  if (pain.includes('growth')) return 'Offer outbound systems, content/SEO operations, CRM enrichment, or campaign automation.';
  if (pain.includes('data')) return 'Offer dashboards, data pipelines, reporting automation, or analyst augmentation.';
  if (pain.includes('crm')) return 'Offer CRM cleanup, enrichment, inbox/social routing, and lifecycle automation.';
  if (pain.includes('technical')) return 'Offer implementation sprint, prototype, integration, or fractional engineering support.';
  return 'Position outreach around helping them solve the initiative behind this open role faster.';
}

function mapJobToAvailableFields(job, columns) {
  const pick = createColumnMatcher(columns);
  const fields = {};
  const set = (names, value) => {
    const field = pick(...names);
    if (!field || value === undefined || value === null || value === '') return;
    fields[field] = value;
  };

  const rawJson = JSON.stringify(job, null, 2);
  set(['Title', 'Job Title', 'Role'], job.title);
  set(['Company', 'Company Name', 'Employer'], job.company);
  set(['Location', 'Locations'], job.location);
  set(['Workplace', 'Environment', 'Remote'], job.workplace);
  set(['Commitment', 'Employment Type', 'Job Type'], job.commitment);
  set(['Salary', 'Compensation'], job.salary);
  set(['Skills', 'Tools', 'Keywords'], job.skills);
  set(['Description', 'Summary', 'Job Summary'], job.summary);
  set(['Company Summary', 'Company Description'], job.companySummary);
  set(['Posted', 'Posted At', 'Posted Ago'], job.postedAgo);
  set(['Source', 'Source Site'], 'HiringCafe');
  set(['Status'], 'New');
  set(['Job URL', 'URL', 'Posting URL', 'External URL'], job.jobUrl);
  set(['HiringCafe URL', 'Hiring Cafe URL', 'Source URL'], job.hiringCafeUrl);
  set(['External ID', 'Source ID', 'Job ID'], job.externalId);
  set(['Pain Point', 'Pain Points', 'Painpoint'], inferPainPoint(job));
  set(['Offer Angle', 'Outreach Angle', 'Service Opportunity'], inferOfferAngle(job));
  set(['Scraped At', 'Collected At', 'Imported At'], new Date().toISOString());
  set(['Raw JSON', 'Raw', 'Snapshot', 'Source JSON'], rawJson);
  return fields;
}

function getRecordFields(record) {
  return record?.fields && typeof record.fields === 'object' ? record.fields : record;
}

function getRecordId(record) {
  return record?.id ?? record?.Id ?? record?.ID;
}

async function loadPlaywright() {
  try {
    return require('playwright');
  } catch (err) {
    throw new Error('Missing Playwright. From skills/hiring-cafe-scraper run: npm install && npm run install-browser');
  }
}

async function isSecurityChallengePage(page) {
  return page.evaluate(() => {
    const title = document.title || '';
    const body = document.body?.innerText || '';
    return /just a moment|security verification/i.test(title)
      || /performing security verification|verify you are not a bot|cloudflare/i.test(body);
  }).catch(() => true);
}

async function openBrowserPage(chromium, opts) {
  if (opts.cdpUrl) {
    const browser = await chromium.connectOverCDP(opts.cdpUrl);
    const context = browser.contexts()[0] || await browser.newContext({ viewport: { width: 1440, height: 1200 } });
    const page = await context.newPage();
    return {
      page,
      close: async () => {
        await page.close().catch(() => {});
      },
    };
  }

  fs.mkdirSync(opts.browserDir, { recursive: true });
  const context = await chromium.launchPersistentContext(opts.browserDir, {
    headless: opts.headless,
    viewport: { width: 1440, height: 1200 },
    userAgent: process.env.HIRING_CAFE_USER_AGENT || undefined,
  });
  const page = await context.newPage();
  return {
    page,
    close: async () => {
      await context.close().catch(() => {});
    },
  };
}

async function scrapeHiringCafe(opts) {
  const { chromium } = await loadPlaywright();
  const browserPage = await openBrowserPage(chromium, opts);
  const { page } = browserPage;
  await page.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Normal wait only. This gives Cloudflare's ordinary interstitial time to clear without bypass logic.
  await page.waitForTimeout(Number(process.env.HIRING_CAFE_INITIAL_WAIT_MS || 8000));
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  const startedWaitingAt = Date.now();
  while (await isSecurityChallengePage(page)) {
    if (Date.now() - startedWaitingAt >= opts.challengeWaitMs) {
      await browserPage.close();
      throw new Error(
        'HiringCafe is still showing a security verification page. Use an existing logged/verified browser via --cdp-url, or run once with --headful and the same --browser-dir. No bypass logic is implemented.'
      );
    }
    await page.waitForTimeout(1000);
  }

  if (opts.scroll) {
    let lastCount = 0;
    let stableRounds = 0;
    for (let i = 0; i < 20; i += 1) {
      const count = await page.locator('a:has-text("Job Posting")').count().catch(() => 0);
      if (count >= opts.limit) break;
      stableRounds = count === lastCount ? stableRounds + 1 : 0;
      if (stableRounds >= 3) break;
      lastCount = count;
      await page.mouse.wheel(0, 1800);
      await page.waitForTimeout(900);
    }
  }

  const jobs = await page.evaluate(({ limit, pageUrl }) => {
    const actionWords = new Set(['save', 'hide', 'mark applied', 'view all', 'job posting']);
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const splitLines = (value) => String(value || '').split(/\n+/).map((x) => clean(x)).filter(Boolean);
    const isTime = (line) => /^(\d+\s*(m|h|d|w)|\d+\s*(min|hour|day|week)s?|yesterday|today)$/i.test(line);
    const isAction = (line) => actionWords.has(String(line || '').toLowerCase());
    const isLocationish = (line) => /remote|hybrid|onsite|europe|united states|poland|canada|germany|spain|france|kingdom|latin america|north america|worldwide|global/i.test(line);
    const cards = [];
    const links = Array.from(document.querySelectorAll('a')).filter((a) => clean(a.textContent).toLowerCase() === 'job posting');
    for (const link of links) {
      let node = link;
      let card = null;
      let fallbackCard = null;
      for (let depth = 0; depth < 8 && node; depth += 1) {
        const lines = splitLines(node.innerText || node.textContent || '');
        const postingLinkCount = lines.filter((line) => line.toLowerCase() === 'job posting').length;
        if (lines.length >= 6 && postingLinkCount >= 1) {
          if (!fallbackCard) fallbackCard = node;
          if (postingLinkCount === 1) {
            card = node;
            break;
          }
        }
        node = node.parentElement;
      }
      if (!card) card = fallbackCard;
      if (!card) continue;
      const lines = splitLines(card.innerText || card.textContent || '').filter((line) => !isAction(line));
      const companyImg = card.querySelector('img[alt]');
      const imgAlt = clean(companyImg && companyImg.getAttribute('alt')).replace(/^Image:\s*/i, '');
      const firstTitle = lines.find((line) => !isTime(line) && !isLocationish(line) && line.length > 3) || '';
      const title = firstTitle;
      const titleIndex = Math.max(0, lines.indexOf(title));
      const jobLocation = lines.slice(titleIndex + 1).find((line) => isLocationish(line) && !/\$|€|£|zł|\/yr|\/mo|full time|part time|contract/i.test(line)) || '';
      const workLine = lines.slice(titleIndex + 1).find((line) => /remote|hybrid|onsite|full time|part time|contract|internship|\$|€|£|zł|\/yr|\/mo/i.test(line)) || '';
      const companyLine = lines.find((line) => /:\s+/.test(line) && !line.toLowerCase().startsWith('http')) || '';
      const company = imgAlt || (companyLine ? companyLine.split(':')[0].trim() : '');
      const companySummary = companyLine.includes(':') ? companyLine.slice(companyLine.indexOf(':') + 1).trim() : '';
      const afterCompanyIndex = companyLine ? lines.indexOf(companyLine) : titleIndex + 2;
      const contentLines = lines.slice(Math.max(0, afterCompanyIndex + 1)).filter((line) => !isTime(line));
      const summary = contentLines.slice(0, 2).join(' ').slice(0, 1600);
      const skills = contentLines.slice(2).join(', ').slice(0, 1200);
      const href = link.href || '';
      const salary = (workLine.match(/([$€£zł][^ ]+(?:[-–][^ ]+)?(?:\/(?:yr|mo|hr))?)/i) || [])[1] || '';
      const workplace = (workLine.match(/\b(Remote|Hybrid|Onsite)\b/i) || [])[1] || '';
      const commitment = (workLine.match(/\b(Full Time|Part Time|Contract|Internship|Temporary)\b/i) || [])[1] || '';
      const postedAgo = lines.find((line) => isTime(line)) || '';
      const key = href || `${company}|${title}|${jobLocation}`;
      cards.push({
        title,
        company,
        location: jobLocation,
        workplace,
        commitment,
        salary,
        companySummary,
        summary,
        skills,
        postedAgo,
        jobUrl: href,
        hiringCafeUrl: pageUrl,
        externalId: key,
        rawLines: lines,
      });
    }
    const seen = new Set();
    return cards.filter((job) => {
      const key = job.jobUrl || `${job.company}|${job.title}|${job.location}`;
      if (!job.title || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, limit);
  }, { limit: opts.limit, pageUrl: page.url() });

  const finalUrl = page.url();
  await browserPage.close();
  if (!jobs.length) {
    throw new Error(`No HiringCafe jobs were extracted from ${finalUrl}. The page loaded, but the current selectors did not find job cards.`);
  }
  return jobs.map((job) => ({
    ...job,
    externalId: stableId(job.externalId || job.jobUrl || `${job.company}|${job.title}`),
  }));
}

function indexExistingRecords(records) {
  const map = new Map();
  for (const record of records) {
    const fields = getRecordFields(record) || {};
    const keys = [
      fields['External ID'],
      fields['Source ID'],
      fields['Job ID'],
      fields['Job URL'],
      fields['URL'],
      fields['Posting URL'],
      fields['External URL'],
    ].map((x) => String(x || '').trim()).filter(Boolean);
    for (const key of keys) if (!map.has(key)) map.set(key, record);
  }
  return map;
}

async function main() {
  const opts = parseArgs(process.argv);
  const jobs = await scrapeHiringCafe(opts);
  console.log(JSON.stringify({ scraped: jobs.length, write: opts.write, sample: jobs.slice(0, 3) }, null, 2));
  if (!opts.write) return;

  const cfg = readNocoConfig(opts.config);
  const table = findTable(runMcporter(cfg, 'getTablesList', {}), opts.table);
  if (!table?.id) throw new Error(`Could not find NocoDB table: ${opts.table}`);
  const schema = runMcporter(cfg, 'getTableSchema', { tableId: table.id });
  const columns = extractColumns(schema);
  if (!columns.length) throw new Error(`Could not read schema for table ${opts.table} (${table.id})`);

  const existingPayload = runMcporter(cfg, 'queryRecords', { tableId: table.id, pageSize: 1000 });
  const existingByKey = indexExistingRecords(asArray(existingPayload));
  let created = 0;
  let updated = 0;

  for (const job of jobs) {
    const fields = mapJobToAvailableFields(job, columns);
    const existing = existingByKey.get(job.externalId) || existingByKey.get(job.jobUrl);
    if (existing) {
      runMcporter(cfg, 'updateRecords', { tableId: table.id, records: [{ id: getRecordId(existing), fields }] });
      updated += 1;
    } else {
      runMcporter(cfg, 'createRecords', { tableId: table.id, records: [{ fields }] });
      created += 1;
    }
  }
  console.log(JSON.stringify({ ok: true, scraped: jobs.length, created, updated, table: table.title || table.name || opts.table }, null, 2));
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
