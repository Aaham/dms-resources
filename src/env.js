/* =============================================================================
   Environment
   -----------------------------------------------------------------------------
   Reads .env once, coerces types, and reports what is and is not configured.
   Nothing here throws: the server starts with values missing, the boot banner
   and /api/health list what is blank, and the affected routes answer 503.
   ============================================================================= */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

/* Load .env from the project directory, not the shell's working directory, so
   `node /path/to/server.js` started from elsewhere still finds it. */
export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(projectRoot, '.env'), quiet: true });

const str = (key, fallback = '') => (process.env[key] ?? fallback).toString().trim();
const bool = (key, fallback = false) => {
  const raw = str(key);
  return raw ? ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase()) : fallback;
};
const int = (key, fallback) => {
  const n = Number.parseInt(str(key), 10);
  return Number.isFinite(n) ? n : fallback;
};
const list = (key) => str(key).split(',').map((s) => s.trim()).filter(Boolean);

function readEnv() {
  return {
    urls: {
      public: str('PUBLIC_URL', 'http://localhost:1026').replace(/\/+$/, ''),
    },

    server: {
      port: int('PORT', 1026),
      trustProxy: bool('TRUST_PROXY', false),
      dataDir: path.resolve(projectRoot, str('DATA_DIR', './data')),
    },

    /* Entering an email address opens the resources in that browser. There is
       no account: the cookie only remembers the address and which saved
       scorecard belongs to this browser. */
    access: {
      // Signs the cookie and the links in emails. The variable keeps its first name.
      secret: str('SESSION_SECRET'),
      days: Math.max(1, int('REMEMBER_DAYS', 90)),
      /* Counted per IP address. A room of people on one Wi-Fi network shares an
         address, so this is looser than a typical form limit. The one-a-day
         limit per address and MAIL_DAILY_LIMIT bound what one machine can send. */
      requestsPerIp: Math.max(1, int('ACCESS_REQUESTS_PER_IP', 60)),
    },

    mail: {
      host: str('SMTP_HOST'),
      port: int('SMTP_PORT', 587),
      user: str('SMTP_USER'),
      pass: str('SMTP_PASS'),
      from: str('SMTP_FROM', 'DMS <noreply@send.strategydms.com>'),
      devLog: str('SMTP_DEV_LOG') === '1',
      // Every email this site sends in any 24 hours, of any kind. 0 turns the cap off.
      dailyLimit: Math.max(0, int('MAIL_DAILY_LIMIT', 250)),
      /* Links emails only. They are the one email a bare form entry can cause,
         so they get a smaller share: a flood of entries cannot use up what the
         scorecard reports need. */
      linksDailyLimit: Math.max(0, int('LINKS_DAILY_LIMIT', 150)),
      /* Addresses the per-address limits do not apply to, for testing. Anyone
         who enters one of these can have it emailed without those limits, so
         keep the list to addresses whose owners asked to be on it. */
      unlimited: list('UNLIMITED_EMAILS').map((e) => e.toLowerCase()),
    },

    /* Staff who may open /ops. Typing a staff address is not enough: the staff
       view opens only from a link emailed to that address. Empty means /ops
       is off. */
    ops: {
      emails: list('OPS_EMAILS').map((e) => e.toLowerCase()),
      sessionHours: Math.max(1, int('OPS_SESSION_HOURS', 12)),
      linkMinutes: Math.max(1, int('OPS_LINK_MINUTES', 15)),
    },
  };
}

/* A live binding, so tests can change the configuration between cases.
   Nothing in production calls refreshEnv(). */
export let env = readEnv();

export function refreshEnv() {
  env = readEnv();
  return env;
}

export function mailConfigured() {
  return env.mail.devLog || Boolean(env.mail.host && env.mail.user && env.mail.pass);
}

/* One report, used by /api/health and the boot banner. `problems` stop people
   opening the resources; `warnings` do not. */
export function readiness() {
  const problems = [];
  const warnings = [];

  if (!env.access.secret) {
    problems.push('SESSION_SECRET is not set, so nobody can open the resources.');
  } else if (env.access.secret.length < 32) {
    problems.push('SESSION_SECRET is shorter than 32 characters, so nobody can open the resources.');
  }

  if (!mailConfigured()) {
    warnings.push('SMTP is not configured: no links or reports are emailed, and nobody can open /ops.');
  } else if (env.mail.devLog) {
    warnings.push('SMTP_DEV_LOG=1: emails are printed to the console and nothing is sent.');
  }

  if (!env.ops.emails.length) warnings.push('OPS_EMAILS is empty, so /ops is off.');
  if (!env.mail.dailyLimit) warnings.push('MAIL_DAILY_LIMIT is 0, so there is no cap on emails sent per day.');
  if (env.mail.unlimited.length) warnings.push(`UNLIMITED_EMAILS: ${env.mail.unlimited.length} address(es) are exempt from the per-address email limits.`);
  if (!env.server.trustProxy && env.urls.public.startsWith('https://')) {
    warnings.push('TRUST_PROXY is off with an https PUBLIC_URL. Behind a proxy, set TRUST_PROXY=1 or every visitor shares one rate limit.');
  }

  return { ready: problems.length === 0, problems, warnings };
}
