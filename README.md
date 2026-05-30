# chatgpt-headless-backup

Scheduled, local, **resumable** backup of your entire ChatGPT history as raw JSON — on macOS, in the background.

It drives a persistent, logged-in Chrome profile (via Playwright) and calls the same private API the ChatGPT web app uses, writing **one JSON file per conversation** plus an optional combined archive. Runs weekly via `launchd`.

> **Why not just use ChatGPT's official export?** Settings → *Export data* emails you a one-time zip — great for a manual snapshot. This tool is for **unattended, scheduled, incremental** backups: it resumes where it left off, only fetches new conversations on later runs, and never waits on an email. Use whichever fits.

## How it works

1. `npm run login` — opens a real Chrome window once; you log in (and clear any Cloudflare check). The session is saved to a local `.profile/`.
2. `npm run backup` — launches that same profile, lists every conversation, and downloads each to `backups/raw/<id>.json`.
3. A `launchd` job re-runs it weekly.

Each conversation is written to disk **before** the next is fetched, so an interrupted run loses nothing and a re-run skips everything already saved.

## Requirements

- macOS
- Node 18+
- Google Chrome installed (the tool uses your system Chrome)

## Setup

```sh
npm install
# if Playwright can't find Chrome:  npx playwright install chromium
```

### One-time login

```sh
npm run login
```

Log in to ChatGPT in the window that opens, solve any Cloudflare check, and when your chats are visible press **ENTER** in the terminal.

### Run a backup

```sh
HEADLESS=false npm run backup
```

- Output: `backups/raw/<id>.json` per chat, plus `backups/gpt-backup-raw-<timestamp>.json` (combined; set `COMBINE=false` to skip).
- **Resumable:** re-run anytime; it skips conversations already in `backups/raw/`.
- The **first** full backup of a large account is slow — ChatGPT rate-limits (`429`), so expect seconds per chat and retries. Let it run, or run it repeatedly; it resumes each time. Later runs only fetch new chats.

### Why `HEADLESS=false`?

Cloudflare ties its clearance to the browser fingerprint. A truly headless Chrome gets challenged and blocked. `HEADLESS=false` runs a real Chrome window (pushed offscreen via `--window-position`) that reuses the fingerprint that passed Cloudflare at login. This is the reliable mode, and what the schedule uses.

## Schedule it (weekly, Sunday 03:00)

```sh
./install-schedule.sh     # writes + loads ~/Library/LaunchAgents/com.user.chatgpt-backup.plist
./uninstall-schedule.sh   # removes it
```

The installer substitutes this directory's path into the plist template. Notes:
- The Mac must be **awake** at the scheduled time; `launchd` runs the job at the next wake otherwise.
- A short offscreen Chrome window appears during the run — expected.

## Environment variables

| Var | Default | Meaning |
|---|---|---|
| `HEADLESS` | `true` | Set `false` for the reliable windowed mode (required for Cloudflare). |
| `BACKUP_DIR` | `./backups` | Where backups are written. |
| `COMBINE` | `true` | Also write a single combined JSON array at the end. |
| `BACKUP_TIMEOUT_MS` | per-request 30s | Per-fetch abort timeout (in `lib/fetch-logic.mjs`). |

## Re-login

If a backup fails with a Cloudflare or auth error, the saved session expired — run `npm run login` again.

## Privacy & safety

- `.profile/` holds your **live ChatGPT session** (cookies). Keep it local — it is gitignored, never commit it.
- Everything runs and stays **on your machine**. Nothing is sent anywhere except ChatGPT's own API.
- This uses ChatGPT's private endpoints and automates a browser; it may break when OpenAI changes things, and you are responsible for complying with OpenAI's Terms of Use. Provided as-is.

## Credit

The API flow (`/api/auth/session` → `/backend-api/conversations` → `/backend-api/conversation/{id}`) is the same one used by the open-source [ChatGPT Backup Tool](https://github.com/FredySandoval/ChatGPT-CHROME_EXTENSION) Chrome extension. This project reimplements it as a standalone, schedulable, resumable CLI.

## License

MIT — see [LICENSE](LICENSE).
