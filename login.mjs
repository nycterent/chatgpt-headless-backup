import { chromium } from 'playwright';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const PROFILE_DIR = fileURLToPath(new URL('./.profile/', import.meta.url));

async function launchPersistentContext(profileDir) {
  const baseOptions = {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
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

function waitForEnter() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.once('line', () => {
      rl.close();
      resolve();
    });
  });
}

let context;

try {
  context = await launchPersistentContext(PROFILE_DIR);
  const page = await context.newPage();
  await page.goto('https://chatgpt.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  console.log('Log in to ChatGPT in the opened window. When you see your chats, press ENTER here to save the session and exit.');
  await waitForEnter();
  process.exitCode = 0;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  if (context) {
    await context.close();
  }
}
