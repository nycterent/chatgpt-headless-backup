import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchConversationRaw, getToken, listConversationIds } from './lib/fetch-logic.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.join(__dirname, '.profile');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, 'backups');
const RAW_DIR = path.join(BACKUP_DIR, 'raw');
const LOGS_DIR = path.join(__dirname, 'logs');
const HEADLESS = process.env.HEADLESS !== 'false';
const COMBINE = process.env.COMBINE !== 'false';
// Delay between conversation fetches. Raise it (e.g. SLEEP_MS=3000) if you hit
// sustained 429 rate-limiting; lower it to go faster on a cooperative account.
const SLEEP_MS = Number(process.env.SLEEP_MS || 1000);

fs.mkdirSync(RAW_DIR, { recursive: true });
fs.mkdirSync(LOGS_DIR, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function launchPersistentContext(profileDir) {
  const baseOptions = {
    headless: HEADLESS,
    viewport: { width: 1280, height: 900 },
    args: [
      '--disable-blink-features=AutomationControlled',
      ...(HEADLESS ? [] : ['--window-position=-32000,-32000']),
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  };

  try {
    return await chromium.launchPersistentContext(profileDir, {
      ...baseOptions,
      channel: 'chrome',
    });
  } catch (error) {
    console.log('Could not launch channel "chrome"; retrying with bundled Chromium. You may need `npx playwright install chromium`.');
    return chromium.launchPersistentContext(profileDir, baseOptions);
  }
}

function readDoneSet() {
  return new Set(
    fs.readdirSync(RAW_DIR)
      .filter((file) => file.endsWith('.json'))
      .map((file) => file.slice(0, -'.json'.length)),
  );
}

function combineRawFiles() {
  const rawFiles = fs.readdirSync(RAW_DIR)
    .filter((file) => file.endsWith('.json'))
    .sort();
  const combined = rawFiles.map((file) => {
    const fullPath = path.join(RAW_DIR, file);
    return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  });
  const iso = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(BACKUP_DIR, `gpt-backup-raw-${iso}.json`);

  fs.writeFileSync(outputPath, JSON.stringify(combined, null, 2));
  console.log(`Combined ${combined.length} conversations -> ${outputPath}`);
}

let context;
let exitCode = 0;

try {
  context = await launchPersistentContext(PROFILE_DIR);
  const page = await context.newPage();

  page.on('console', (msg) => {
    const text = msg.text();
    if (text.startsWith('GPT-BACKUP::PROGRESS::')) {
      console.log(text.replace('GPT-BACKUP::PROGRESS::', 'progress '));
    }
  });

  await page.goto('https://chatgpt.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  const title = await page.title().catch(() => '');
  if (/just a moment|attention required/i.test(title)) {
    throw new Error('Cloudflare challenge detected after navigation — run `npm run login` to refresh cf_clearance.');
  }

  let token = await getToken(page);
  const { ids, total } = await listConversationIds(page, token);
  console.log(`Found ${ids.length} conversations (API total: ${total})`);

  const done = readDoneSet();
  console.log(`${done.size} already downloaded, fetching ${ids.length - done.size} remaining`);

  let savedNew = 0;
  const failures = [];
  let tokenRefreshed = false;

  for (let i = 0; i < ids.length; i += 1) {
    const { id } = ids[i];

    if (done.has(id)) {
      console.log(`progress ${i + 1}/${ids.length} (saved ${savedNew}, skipped ${done.size}, failed ${failures.length}) [cached]`);
      continue;
    }

    const result = await fetchConversationRaw(page, token, id);

    if (result.unauthorized) {
      if (!tokenRefreshed) {
        console.log('Token expired mid-run, refreshing...');
        try {
          token = await getToken(page);
          tokenRefreshed = true;
        } catch (error) {
          // Keep the current token so the retry below records whether auth is still failing.
        }

        const retryResult = await fetchConversationRaw(page, token, id);
        if (retryResult.raw) {
          fs.writeFileSync(path.join(RAW_DIR, `${id}.json`), JSON.stringify(retryResult.raw, null, 2));
          savedNew += 1;
        } else {
          console.log('Auth still failing after token refresh — stopping fetch loop. Run `npm run login`.');
          break;
        }
      } else {
        console.log('Persistent auth failure — stopping fetch loop. Run `npm run login`.');
        break;
      }
    } else if (result.raw) {
      fs.writeFileSync(path.join(RAW_DIR, `${id}.json`), JSON.stringify(result.raw, null, 2));
      savedNew += 1;
    } else {
      failures.push({ id, error: result.error });
      console.log(`skip ${id}: ${result.error}`);
    }

    console.log(`progress ${i + 1}/${ids.length} (saved ${savedNew}, skipped ${done.size}, failed ${failures.length})`);
    await sleep(SLEEP_MS);
  }

  if (COMBINE) {
    combineRawFiles();
  }

  console.log(`Done. total=${total} onDisk=${done.size + savedNew} newlySaved=${savedNew} failed=${failures.length}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exitCode = 1;
} finally {
  if (context) {
    await context.close();
  }
}

process.exit(exitCode);
