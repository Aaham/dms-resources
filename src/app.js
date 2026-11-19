/* =============================================================================
   The Express app: headers, the API, the pages and the public files
   -----------------------------------------------------------------------------
   Pages:
     GET /             the email form, or the resource list once an address is entered
     GET /scorecard    AI readiness scorecard        (address entered)
     GET /guide        guide for leaders             (address entered)
     GET /guide.pdf    the same guide as a PDF       (address entered)
     GET /incident-plan  one-page incident plan to fill in   (address entered)
     GET /ai-rules       AI rules for staff to fill in       (address entered)
     GET /ai-brief       board and executive AI brief to fill in  (address entered)
     GET /vendor-questions  AI vendor questions to send and record  (address entered)
     GET /open/:token  a link from an email: reopens a scorecard, or opens /ops
     GET /ops          visitor list and scorecards   (staff, through an emailed link)

   The gated pages live in pages/, outside the public directory, and are sent
   only when the request carries the cookie. A browser without it is redirected
   to / with ?next= and lands on the page it asked for once an address is
   entered. An ?event= tag on the link is carried through the redirect.

   Everything in public/ (styles, scripts, fonts, logos) is served to anyone,
   under /static/. The scripts hold no resource content: the text of the guide
   and of the four fill-in pages is in pages/, and the scorecard's statements
   come from the API. The email form page shows a sample of each resource.
   What a visitor types into a fill-in page (the incident plan, the AI rules,
   the AI brief, the vendor questions) stays in their browser; no route here
   receives it.
   ============================================================================= */

import path from 'node:path';
import express from 'express';
import { env, projectRoot } from './env.js';
import { COOKIE_NAME, visitFrom, staffAccess, isStaff, readLink, issueCookie, cookieOptions } from './access.js';
import { cleanEvent } from './visitors.js';
import { createApiRouter } from './api.js';

const pagesDir = path.join(projectRoot, 'pages');
const publicDir = path.join(projectRoot, 'public');
export const GUIDE_PDF = path.join(projectRoot, 'resources', 'dms-guide-for-leaders.pdf');

// The only places the email form may send someone afterwards.
const NEXT_PATHS = new Set(['/scorecard', '/guide', '/incident-plan', '/ai-rules', '/ai-brief', '/vendor-questions', '/ops']);

function sendPage(res, name, status = 200) {
  res.status(status).set('Cache-Control', 'no-store').sendFile(path.join(pagesDir, name));
}

function requireAddress(req, res, next) {
  const visit = visitFrom(req);
  if (!visit) {
    const query = new URLSearchParams({ next: req.path });
    const event = cleanEvent(req.query.event);
    if (event) query.set('event', event);
    return res.redirect(302, `/?${query}`);
  }
  req.visit = visit;
  next();
}

export function createApp(deps = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (env.server.trustProxy) app.set('trust proxy', 1);

  /* The site loads nothing from another origin: fonts are self-hosted and
     there are no trackers, so the policy can be 'self' throughout. */
  app.use((_req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    });
    if (env.urls.public.startsWith('https://')) res.set('Strict-Transport-Security', 'max-age=31536000');
    next();
  });

  app.use('/api', createApiRouter(deps));

  app.get('/', (req, res) => {
    if (!visitFrom(req)) return sendPage(res, 'entry.html');
    if (NEXT_PATHS.has(req.query.next)) return res.redirect(302, req.query.next);
    sendPage(res, 'resources.html');
  });

  app.get('/scorecard', requireAddress, (_req, res) => sendPage(res, 'scorecard.html'));
  app.get('/guide', requireAddress, (_req, res) => sendPage(res, 'guide.html'));
  app.get('/incident-plan', requireAddress, (_req, res) => sendPage(res, 'incident-plan.html'));
  app.get('/ai-rules', requireAddress, (_req, res) => sendPage(res, 'ai-rules.html'));
  app.get('/ai-brief', requireAddress, (_req, res) => sendPage(res, 'ai-brief.html'));
  app.get('/vendor-questions', requireAddress, (_req, res) => sendPage(res, 'vendor-questions.html'));
  app.get('/guide.pdf', requireAddress, (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.download(GUIDE_PDF, 'DMS guide for leaders.pdf');
  });

  /* A link from an email. Opening it puts that visit's cookie in this browser.
     The link stays valid until it expires, so a mail scanner that fetches it
     first does not spend it. */
  app.get('/open/:token', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const link = readLink(req.params.token);
    if (!link) return res.redirect(302, '/?link=expired');
    if (link.kind === 'ops') {
      if (!isStaff(link.email)) return sendPage(res, 'not-found.html', 404);
      res.cookie(COOKIE_NAME, issueCookie({ vid: link.vid, email: link.email, opsAt: link.iat }), cookieOptions());
      return res.redirect(302, '/ops');
    }
    res.cookie(COOKIE_NAME, issueCookie({ vid: link.vid, email: link.email }), cookieOptions());
    res.redirect(302, '/scorecard');
  });

  app.get('/ops', requireAddress, (req, res) => {
    const access = staffAccess(req.visit);
    // Other visitors get the same answer as for a page that does not exist.
    if (access === 'none') return sendPage(res, 'not-found.html', 404);
    sendPage(res, access === 'open' ? 'ops.html' : 'staff-link.html');
  });

  /* Scripts and styles are checked with the server on every page load, and
     re-downloaded only when they have changed. A browser running an old script
     against a newer server is how the email form broke for the owner on
     2026-11-18: the old script did not send the form token. Fonts and logos do
     not change, so a browser may keep those for a week. */
  app.use('/static', express.static(publicDir, {
    index: false,
    setHeaders(res, file) {
      const kept = path.relative(publicDir, file).split(path.sep)[0] === 'assets' && !file.endsWith('.css');
      res.set('Cache-Control', kept ? 'public, max-age=604800' : 'no-cache');
    },
  }));

  app.use((_req, res) => sendPage(res, 'not-found.html', 404));

  app.use((err, _req, res, _next) => {
    console.error('[server] unhandled:', err);
    res.status(500).type('text/plain').send('Something went wrong on our side. Try again.');
  });

  return app;
}
