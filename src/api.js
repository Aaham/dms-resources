/* =============================================================================
   /api
   -----------------------------------------------------------------------------
   Access:
     GET    /api/form-token              a token the email form sends back with the address
     POST   /api/access                  enter an email address; opens the resources
     GET    /api/access                  the address this browser is using
     PATCH  /api/access                  correct that address
     DELETE /api/access                  forget this browser

   Scorecard, for a browser that has entered an address:
     GET    /api/scorecard/definition    statements, scale and score bands
     GET    /api/scorecard/report        this visit's latest report, or null
     POST   /api/scorecard/report        submit answers; saves, then emails
     POST   /api/scorecard/report/email  email the saved report again
     GET    /api/scorecard/export        ?format=csv|txt|json

   Staff:
     POST   /api/ops/link                email a staff link to a staff address
     GET    /api/ops/visitors            every address entered, with scores
     GET    /api/ops/visitors.csv
     GET    /api/ops/scorecard           ?email=  that address's latest report
     GET    /api/ops/scorecard/export    ?email=&format=csv|txt

     GET    /api/health                  what is not configured

   No route here sends CORS headers. Access is a cookie, so the API is
   same-origin only, and state-changing requests from another site are refused.

   WHAT STANDS BETWEEN A PROGRAM AND THE BREVO ALLOWANCE
   Entering an address is the one thing here that sends an email without the
   visitor doing any work first. These checks stop automated entries without
   asking a person to do anything:

     form token   an entry must carry a token this server issued at least
                  1.5 seconds earlier, and each token works once
     hidden field an entry that fills the field people cannot see is refused
     same site    a browser that says the request came from another site is refused
     per IP       ACCESS_REQUESTS_PER_IP entries every 15 minutes, and the same
                  number of links emails a day
     per address  one links email a day and five ever (mail-log.js)
     site-wide    LINKS_DAILY_LIMIT and MAIL_DAILY_LIMIT (mailer.js)

   The first three turn away programs that were not written for this site. A
   program written for it can pass them; the limits below them are what bound
   how much it can send, and staff are emailed when a daily limit is reached.
   ============================================================================= */

import crypto from 'node:crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { env, readiness } from './env.js';
import { COOKIE_NAME, FORM_MIN_MS, accessReady, issueCookie, cookieOptions, visitFrom, newVisitId, requireVisit, requireStaff,
  staffAccess, isStaff, normalizeEmail, validEmail, issueFormToken, readFormToken } from './access.js';
import { recordVisit, recordEmailChange, listVisitors, visitsFor } from './visitors.js';
import { allowance, isUnlimited } from './mail-log.js';
import { domainAcceptsMail } from './email-check.js';
import { DEFINITION, validateAssessment, scoreAssessment } from './scorecard-content.js';
import { readReport, saveReport, withReportLock } from './scorecard-store.js';
import { reportCsv, reportText } from './scorecard-report.js';
import { visitorsCsv } from './csv.js';
import { sendResources, sendScorecardReport, sendStaffLink, mailUsage } from './mailer.js';

const DAY_MS = 24 * 60 * 60_000;
const fail = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });

/* Counts things per key over the last 24 hours, in memory. */
export function dailyCounter() {
  const times = new Map();
  const recent = (key) => (times.get(key) || []).filter((t) => Date.now() - t < DAY_MS);
  return {
    count: (key) => recent(key).length,
    add(key) {
      if (times.size > 20000) times.clear();
      times.set(key, [...recent(key), Date.now()]);
    },
  };
}

const usable = (report) => report && Number.isInteger(report.result?.total) && report.result.total >= 0 &&
  report.result.total <= 40 && report.result.band?.name && Number.isFinite(Date.parse(report.createdAt));

/* The latest scorecard among an address's visits. `unreadable` is true when a
   saved file exists but cannot be used, so the staff view can say so. */
async function latestReport(vids) {
  let latest = null;
  let unreadable = false;
  for (const vid of vids) {
    try {
      const report = await readReport(vid);
      if (!report) continue;
      if (!usable(report)) throw new Error('unexpected report shape');
      if (!latest || report.createdAt > latest.createdAt) latest = report;
    } catch (err) {
      unreadable = true;
      console.error('[ops] a saved scorecard could not be read:', err.message);
    }
  }
  return { latest, unreadable };
}

export async function visitorOverview() {
  return Promise.all(listVisitors().map(async ({ vids, ...visitor }) => {
    const { latest, unreadable } = await latestReport(vids);
    const scorecard = latest
      ? { status: 'completed', score: latest.result.total, max: 40, level: latest.result.band.name, completedAt: latest.createdAt }
      : { status: unreadable ? 'unavailable' : 'not_completed' };
    return { ...visitor, scorecard };
  }));
}

// Mail and DNS are injected so tests can run the real routes without contacting Brevo or a resolver.
export function createApiRouter({ sendLinks = sendResources, sendReport = sendScorecardReport,
  sendOpsLink = sendStaffLink, checkDomain = domainAcceptsMail } = {}) {
  const router = express.Router();
  const usedTokens = new Map();        // form token id -> when it expires
  const linksByIp = dailyCounter();    // links emails caused from one IP address
  const refused = dailyCounter();      // entries turned away as automated, by reason

  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(req.method)) {
      /* PUBLIC_URL is accepted as well as the request's own origin, because
         behind a proxy with TRUST_PROXY left off the request looks like http
         and would never match the https origin the browser sends. */
      const origin = req.get('origin');
      const ownOrigin = !origin || origin === env.urls.public || origin === `${req.protocol}://${req.get('host')}`;
      /* Current browsers say where a request came from. One that names anywhere
         but this site is refused; older ones (Safari before 16.4) send nothing
         and pass. */
      const site = req.get('sec-fetch-site');
      if ((site && site !== 'same-origin') || !ownOrigin) {
        return res.status(403).json({ error: 'Open this page on the DMS resources site to continue.' });
      }
      if (!req.is('application/json')) return res.status(415).json({ error: 'Send the request as JSON.' });
    }
    next();
  });
  router.use(express.json({ limit: '32kb' }));

  const limiter = (limit, minutes = 15, keyGenerator) => rateLimit({ windowMs: minutes * 60_000, limit,
    standardHeaders: 'draft-7', legacyHeaders: false, ...(keyGenerator ? { keyGenerator } : {}),
    message: { error: 'Too many attempts. Wait a few minutes and try again.' } });
  const accessLimit = limiter(env.access.requestsPerIp);
  const tokenLimit = limiter(env.access.requestsPerIp * 4);
  const reportLimit = limiter(20, 60, (req) => req.visit.vid);

  router.get('/health', (_req, res) => {
    const status = readiness();
    res.status(status.ready ? 200 : 503).json({ ok: status.ready, problems: status.problems, warnings: status.warnings });
  });

  /* ------------------------------------------------------------------------
     Access
     ------------------------------------------------------------------------ */

  router.get('/form-token', tokenLimit, (_req, res) => {
    if (!accessReady()) throw fail(503, 'The resources are unavailable right now. Contact DMS at info@strategydms.com.');
    res.json({ token: issueFormToken(), waitMs: FORM_MIN_MS });
  });

  /* The page's script handles a 'token' refusal by fetching a new token and
     trying again, so a person whose page sat open for hours never sees it. */
  function checkFormToken(req) {
    const now = Date.now();
    for (const [id, exp] of usedTokens) if (exp <= now) usedTokens.delete(id);
    const refuse = (reason) => {
      refused.add(reason);
      refused.add('any');
      console.warn(`[access] refused an entry from ${req.ip}: ${reason}`);
      return fail(400, 'We couldn’t open the resources. Reload the page and try again.', 'token');
    };
    if (typeof req.body?.hp === 'string' && req.body.hp.trim()) throw refuse('hidden field filled');
    const token = readFormToken(req.body?.token);
    if (!token) throw refuse('no valid form token');
    if (usedTokens.has(token.id)) throw refuse('form token already used');
    if (now - token.iat < FORM_MIN_MS) throw refuse('form token used too soon');
    return token;
  }

  async function readAddress(value) {
    const email = normalizeEmail(value);
    if (!validEmail(email)) throw fail(400, 'Enter an email address in the correct format, like name@example.com.');
    const domain = email.slice(email.lastIndexOf('@') + 1);
    if (!(await checkDomain(domain))) {
      throw fail(400, `We can’t find “${domain}”. Check the part of your email address after the @.`);
    }
    return email;
  }

  /* 'sent'    the links were emailed just now
     'recent'  this address has had them today, or five times already
     'failed'  they could not be sent: a send error or a daily limit
     'off'     email is in console mode */
  async function emailLinks(email, ip) {
    if (!allowance('links', email).allowed) return 'recent';
    if (!isUnlimited(email) && linksByIp.count(ip) >= env.access.requestsPerIp) {
      console.warn(`[access] ${ip} has caused ${env.access.requestsPerIp} links emails today; none sent to ${email}.`);
      return 'failed';
    }
    try {
      const result = await sendLinks({ email });
      if (result.sent) linksByIp.add(ip);
      return result.sent ? 'sent' : 'off';
    } catch (err) {
      console.error('[access] the links email was not sent:', err.message);
      return 'failed';
    }
  }

  router.post('/access', accessLimit, async (req, res) => {
    if (!accessReady()) throw fail(503, 'The resources are unavailable right now. Contact DMS at info@strategydms.com.');
    const token = checkFormToken(req);
    const email = await readAddress(req.body?.email);
    usedTokens.set(token.id, token.exp);   // spent only once the address is accepted, so a typo can be fixed and sent again

    // The same browser entering the same address again keeps its visit, and with it any saved scorecard.
    const current = visitFrom(req);
    const vid = current?.email === email ? current.vid : newVisitId();
    res.cookie(COOKIE_NAME, issueCookie({ vid, email }), cookieOptions());
    // The resources open either way; a failed write is logged for staff, not shown to the visitor.
    try { await recordVisit({ vid, email, event: req.body?.event }); }
    catch (err) { console.error(`[visitors] COULD NOT RECORD the visit by ${email}:`, err.message); }

    res.json({ email, emailed: await emailLinks(email, req.ip) });
  });

  router.delete('/access', (_req, res) => {
    res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
    res.json({ ok: true });
  });

  router.use(requireVisit);
  router.get('/access', (req, res) => res.json({ email: req.visit.email, staff: staffAccess(req.visit) === 'open' }));

  /* Corrects a mistyped address before the report is sent to it. The visit, and
     so the answers and any saved scorecard, stays the same. */
  router.patch('/access', accessLimit, async (req, res) => {
    const email = await readAddress(req.body?.email);
    if (email !== req.visit.email) {
      res.cookie(COOKIE_NAME, issueCookie({ vid: req.visit.vid, email }), cookieOptions());
      try { await recordEmailChange(req.visit.vid, email); }
      catch (err) { console.error(`[visitors] COULD NOT RECORD the change to ${email}:`, err.message); }
    }
    res.json({ email });
  });

  /* ------------------------------------------------------------------------
     Scorecard
     ------------------------------------------------------------------------ */

  router.get('/scorecard/definition', (_req, res) => res.json(DEFINITION));

  /* `mail` tells the page whether a report can be emailed to this address now,
     so it never promises an email the limits will stop. */
  const withMail = (report, email) => ({ report, mail: allowance('report', email) });
  router.get('/scorecard/report', async (req, res) => res.json(withMail(await readReport(req.visit.vid), req.visit.email)));

  /* The report is saved before the email is attempted and again after, so a
     failed or interrupted send leaves a saved report the visitor can download.
     An address is emailed one report a day and five ever; past that the
     report is saved and not sent. */
  async function deliver(report) {
    report.delivery = { status: 'pending', attemptedAt: new Date().toISOString(), to: report.email };
    await saveReport(report.vid, report);
    const rule = allowance('report', report.email);
    try {
      if (!rule.allowed) {
        report.delivery = { ...report.delivery, status: 'limited', reason: rule.reason };
      } else {
        const result = await sendReport(report);
        report.delivery = { ...report.delivery, status: result.sent ? 'sent' : 'development',
          ...(result.sent ? { sentAt: new Date().toISOString() } : {}) };
      }
    } catch (err) {
      console.error('[scorecard] report email failed:', err.message);
      report.delivery.status = 'failed';
    }
    await saveReport(report.vid, report);
    return report;
  }

  router.post('/scorecard/report', reportLimit, async (req, res) => {
    const input = validateAssessment(req.body);
    const { vid, email } = req.visit;
    const report = await withReportLock(vid, async () => {
      const existing = await readReport(vid);
      if (existing?.submissionId === input.submissionId) {
        if (JSON.stringify(existing.answers) !== JSON.stringify(input.answers) ||
            JSON.stringify(existing.notes) !== JSON.stringify(input.notes) ||
            JSON.stringify(existing.conversation) !== JSON.stringify(input.conversation)) {
          throw fail(409, 'These answers have changed. Save them as a new report.');
        }
        return existing;
      }
      // The recipient and every score come from the server, never the request.
      return deliver({ ...input, id: crypto.randomUUID(), vid, email,
        version: DEFINITION.version, createdAt: new Date().toISOString(), result: scoreAssessment(input.answers) });
    });
    res.json(withMail(report, email));
  });

  router.post('/scorecard/report/email', async (req, res) => {
    const { vid, email } = req.visit;
    const report = await withReportLock(vid, async () => {
      const existing = await readReport(vid);
      if (!existing) throw fail(404, 'Complete the scorecard first.');
      const rule = allowance('report', email);
      if (!rule.allowed) {
        throw fail(429, rule.reason === 'lifetime'
          ? 'We’ve emailed five reports to this address, which is the most we send to one address. You can download your report here.'
          : 'We’ve already emailed a report to this address today. You can download your report here.');
      }
      if (!isUnlimited(email) && existing.delivery?.attemptedAt && Date.now() - Date.parse(existing.delivery.attemptedAt) < 60_000) {
        throw fail(429, 'Wait a minute before sending the report again.');
      }
      // The address may have been corrected since the report was saved.
      return deliver({ ...existing, vid, email });
    });
    res.json(withMail(report, email));
  });

  function sendExport(res, report, format) {
    res.set('Content-Disposition', `attachment; filename="dms-ai-readiness-${report.createdAt.slice(0, 10)}.${format}"`);
    res.type({ csv: 'text/csv', txt: 'text/plain', json: 'application/json' }[format]);
    res.send(format === 'csv' ? reportCsv(report) : format === 'txt' ? reportText(report) : JSON.stringify(report, null, 2));
  }

  router.get('/scorecard/export', async (req, res) => {
    const report = await readReport(req.visit.vid);
    if (!report) throw fail(404, 'Complete the scorecard first.');
    const format = req.query.format || 'csv';
    if (!['csv', 'txt', 'json'].includes(format)) throw fail(400, 'Choose CSV, text or JSON.');
    sendExport(res, report, format);
  });

  /* ------------------------------------------------------------------------
     Staff view
     ------------------------------------------------------------------------ */

  /* Anyone can type a staff address, so the staff view opens only from a link
     sent to that address. Another address gets the same answer as a route that
     does not exist. */
  router.post('/ops/link', async (req, res) => {
    if (!isStaff(req.visit.email)) throw fail(404, 'Not found.');
    const rule = allowance('staff', req.visit.email);
    if (!rule.allowed) {
      throw fail(429, rule.reason === 'wait'
        ? 'We emailed you a link in the last two minutes. Check your inbox, or try again shortly.'
        : 'We’ve emailed six links to this address today. Use the latest one, or try again tomorrow.');
    }
    try { await sendOpsLink(req.visit); }
    catch (err) {
      console.error('[ops] the staff link email failed:', err.message);
      throw fail(502, 'We couldn’t send the link. Check the mail settings and try again.');
    }
    res.json({ ok: true, email: req.visit.email, minutes: env.ops.linkMinutes });
  });

  router.use('/ops', requireStaff);

  router.get('/ops/visitors', async (_req, res) => {
    const visitors = await visitorOverview();
    res.json({ count: visitors.length,
      completed: visitors.filter((v) => v.scorecard.status === 'completed').length,
      mail: mailUsage(), refused: refused.count('any'), visitors });
  });

  router.get('/ops/visitors.csv', async (_req, res) => {
    res.set('Content-Disposition', `attachment; filename="dms-resources-visitors-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.type('text/csv');
    res.send(visitorsCsv(await visitorOverview()));
  });

  router.use('/ops/scorecard', async (req, _res, next) => {
    const email = normalizeEmail(req.query.email);
    const vids = validEmail(email) ? visitsFor(email) : [];
    if (!vids.length) throw fail(404, 'Choose an email address from the visitor list.');
    const { latest } = await latestReport(vids);
    if (!latest) throw fail(404, 'No scorecard has been submitted from this address.');
    req.scorecardReport = latest;
    next();
  });

  router.get('/ops/scorecard', (req, res) => res.json({ report: req.scorecardReport, definition: DEFINITION }));

  router.get('/ops/scorecard/export', (req, res) => {
    const format = req.query.format || 'csv';
    if (!['csv', 'txt'].includes(format)) throw fail(400, 'Choose CSV or text.');
    sendExport(res, req.scorecardReport, format);
  });

  router.use((_req, res) => res.status(404).json({ error: 'Not found.' }));

  router.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'We could not read that request. Try again.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'These notes are too long. Shorten them and try again.' });
    if (err.status && (err.status < 500 || err.status === 502 || err.status === 503)) {
      return res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
    }
    console.error('[api] request failed:', err.message);
    res.status(500).json({ error: 'Something went wrong on our side. Try again.' });
  });

  return router;
}
