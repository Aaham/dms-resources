import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { inject } from './http.js';

// The real app and routes, with injected HTTP, fake mail and a fake DNS answer. Nothing here opens a port or contacts Brevo.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dms-resources-test-'));
Object.assign(process.env, { DATA_DIR: dataDir, SESSION_SECRET: 'test-'.repeat(10), REMEMBER_DAYS: '90',
  OPS_EMAILS: 'staff@example.org', OPS_SESSION_HOURS: '12', OPS_LINK_MINUTES: '15', PUBLIC_URL: 'http://localhost:1026',
  SMTP_DEV_LOG: '1', MAIL_DAILY_LIMIT: '250', LINKS_DAILY_LIMIT: '150', TRUST_PROXY: '0', ACCESS_REQUESTS_PER_IP: '200',
  UNLIMITED_EMAILS: 'tester@example.org' });
const { refreshEnv } = await import('../src/env.js');
refreshEnv();
const access = await import('../src/access.js');
const visitors = await import('../src/visitors.js');
const mailLog = await import('../src/mail-log.js');
const { createApp, GUIDE_PDF } = await import('../src/app.js');
const { dailyCounter } = await import('../src/api.js');
const { readReport, saveReport } = await import('../src/scorecard-store.js');
const { DOMAINS } = await import('../src/scorecard-content.js');
visitors.initVisitors();
mailLog.initMailLog();

const links = [];      // addresses the links email went to
const reports = [];    // reports emailed
const opsLinks = [];   // visits a staff link was emailed for
let failMail = false;
const app = createApp({
  checkDomain: async (domain) => domain !== 'no-such-domain.example',
  sendLinks: async ({ email }) => {
    if (failMail) throw new Error('Test SMTP outage');
    links.push(email);
    await mailLog.recordMail('links', email);
    return { sent: true };
  },
  sendReport: async (report) => {
    if (failMail) throw new Error('Test SMTP outage');
    reports.push(structuredClone(report));
    await mailLog.recordMail('report', report.email);
    return { sent: true };
  },
  sendOpsLink: async (visit) => {
    if (failMail) throw new Error('Test SMTP outage');
    opsLinks.push(visit);
    await mailLog.recordMail('staff', visit.email);
    return { sent: true };
  },
});
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const cookieOf = (response) => response.headers.get('set-cookie').split(';')[0];
const cookieFor = (email, vid = crypto.randomUUID()) => `${access.COOKIE_NAME}=${access.issueCookie({ vid, email })}`;
function request(route, { method = 'GET', body, cookie, headers = {} } = {}) {
  return inject(app, { path: route, method,
    headers: { ...(cookie ? { cookie } : {}), ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}), ...headers },
    ...(method !== 'GET' ? { body: JSON.stringify(body || {}) } : {}) });
}
const payload = (answers = Array(20).fill(2)) => ({ answers, submissionId: crypto.randomUUID(), notes: {}, conversation: {} });
async function at(offsetMs, task) {
  const now = Date.now;
  Date.now = () => now() + offsetMs;
  try { return await task(); } finally { Date.now = now; }
}
const DAY = 24 * 60 * 60_000;
const formToken = async () => (await request('/api/form-token')).json.token;
// What the page does: ask for a token, wait out its 1.5 seconds, send it with the address.
async function enter(email, extra = {}, cookie, headers) {
  const token = await formToken();
  return at(2000, () => request('/api/access', { method: 'POST', body: { email, token, ...extra }, cookie, headers }));
}
const tokenFrom = (url) => url.slice(url.lastIndexOf('/') + 1);

test('before an address is entered, / is the email form and every resource redirects to it', async () => {
  const home = await request('/');
  assert.equal(home.status, 200);
  assert.ok(home.text.includes('id="email-form"'));
  assert.equal(home.headers.get('cache-control'), 'no-store');
  for (const route of ['/scorecard', '/guide', '/guide.pdf', '/incident-plan', '/ai-rules', '/ai-brief', '/vendor-questions', '/ops']) {
    const response = await request(route);
    assert.equal(response.status, 302, route);
    assert.equal(response.headers.get('location'), `/?next=${encodeURIComponent(route)}`);
    assert.ok(!/multi-factor|Call the insurer|A person decides|human decision|train or improve/.test(response.text), 'no resource text is sent with the redirect');
  }
});

test('nothing a visitor reads calls this signing in or an account', () => {
  const account = /\bsign(ed|ing)?[ -]?(in|out|up)\b|\blog(ged|ging)?[ -]?(in|out)\b|\blogin\b|\bregist(er|ration)\b|\byour account\b|\bpassword\b/i;
  const files = [...fs.readdirSync(new URL('../pages', import.meta.url)).map((name) => `../pages/${name}`),
    ...fs.readdirSync(new URL('../public', import.meta.url)).filter((name) => name.endsWith('.js')).map((name) => `../public/${name}`),
    '../src/email-layout.js', '../src/api.js'];
  for (const file of files) {
    let source = fs.readFileSync(new URL(file, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');   // comments are for developers
    // The guide's own text is about other services ("before staff sign up"); only the page around it is checked.
    if (file.endsWith('guide.html')) source = source.replace(/<main[\s\S]*<\/main>/, '');
    // So is the list of information to keep out of AI tools, which names passwords.
    if (file.endsWith('ai-rules.html')) source = source.replace(/<fieldset id="never">[\s\S]*?<\/fieldset>/, '');
    const found = source.match(account);
    assert.equal(found, null, `${file} says “${found?.[0]}”`);
  }
});

test('the samples on the email form are the real statement, steps, rules and questions', () => {
  const page = (name) => fs.readFileSync(new URL(`../pages/${name}.html`, import.meta.url), 'utf8');
  const [scorecard, ...samples] = page('entry').split('<figure class="sample">').slice(1);
  const statement = scorecard.match(/<blockquote>(.*?)<\/blockquote>/)[1];
  assert.ok(DOMAINS.flatMap((d) => d.questions).some((q) => q.statement === statement));

  // Each of the next four samples shows two headings with the text under them, word for word.
  // In the brief, that text is the hint beside the field.
  const sources = ['guide', 'incident-plan', 'ai-rules', 'ai-brief', 'vendor-questions'].map(page);
  assert.equal(samples.length, sources.length);
  samples.slice(0, 4).forEach((sample, index) => {
    const parts = [...sample.matchAll(/<h4>(.*?)<\/h4>\s*<p>(.*?)<\/p>/g)];
    assert.equal(parts.length, 2);
    for (const [, title, text] of parts) {
      assert.ok(sources[index].includes(`<h3>${title}</h3>`), title);
      assert.ok(sources[index].includes(`>${text}</p>`), `the text under “${title}” matches the page`);
    }
  });
  // The last shows three of the vendor questions.
  const asked = [...samples[4].matchAll(/<li>(.*?)<\/li>/g)];
  assert.equal(asked.length, 3);
  for (const [, text] of asked) assert.ok(sources[4].includes(`>${text}</li>`), text);

  // The counts the form page and the links email give.
  const [guide, plan, rules, brief, vendor] = sources;
  assert.equal(brief.match(/<ol class="sheet__steps">[\s\S]*?<\/ol>/)[0].match(/<li>/g).length, 7);
  assert.equal(brief.match(/<legend>\d\. /g).length, 7);
  const questions = [...vendor.matchAll(/<li class="q" data-q="([a-z]+)">/g)].map((found) => found[1]);
  assert.equal(questions.length, 25);
  assert.equal(new Set(questions).size, 25, 'each question has its own name, which its saved answer is kept under');
  assert.ok(vendor.includes('all 25 questions') && page('entry').includes('Twenty-five questions') && brief.includes('Twenty-five questions'));
  assert.ok(page('resources').includes('25 questions') && page('guide').includes('have all 25'));
  assert.equal((guide.match(/<ul class="steps">[\s\S]*?<\/ul>/g) || []).join('').match(/<li>/g).length, 18);
  assert.equal(plan.match(/<ol class="sheet__steps">[\s\S]*?<\/ol>/)[0].match(/<li>/g).length, 9);
  assert.equal(rules.match(/<div class="sheet__rules">[\s\S]*?<\/div>/)[0].match(/<section>/g).length, 6);
});

test('an event tag on the link survives the redirect, and a malformed one is dropped', async () => {
  assert.equal((await request('/guide?event=NJ-Expo-2026')).headers.get('location'), '/?next=%2Fguide&event=nj-expo-2026');
  assert.equal((await request('/scorecard?event=<script>')).headers.get('location'), '/?next=%2Fscorecard');
});

test('scripts and styles are re-checked on every load; only fonts and logos may be kept', async () => {
  for (const file of ['entry.js', 'common.js', 'scorecard.js', 'sheet.js', 'ai-brief.js', 'vendor-questions.js', 'styles.css', 'scorecard.css', 'sheet.css', 'assets/fonts.css']) {
    const response = await request(`/static/${file}`);
    assert.equal(response.status, 200, file);
    assert.equal(response.headers.get('cache-control'), 'no-cache', `${file} must never be used stale`);
    assert.ok(response.headers.get('etag'), `${file} can be re-checked cheaply`);
  }
  for (const file of ['assets/dms-logo.png', 'assets/fonts/archivo-400-900.woff2']) {
    assert.equal((await request(`/static/${file}`)).headers.get('cache-control'), 'public, max-age=604800', file);
  }
  // Every file a page asks for is there, at the path the page uses.
  for (const page of fs.readdirSync(new URL('../pages', import.meta.url))) {
    const html = fs.readFileSync(new URL(`../pages/${page}`, import.meta.url), 'utf8');
    const files = [...html.matchAll(/(?:href|src)="(\/static\/[^"]+)"/g)].map((m) => m[1]);
    assert.ok(files.length > 0, page);
    for (const file of new Set(files)) assert.equal((await request(file)).status, 200, `${page} asks for ${file}`);
    assert.ok(!/(?:href|src)="\/(?:assets\/|[a-z-]+\.(?:js|css)")/.test(html), `${page} asks for a file outside /static/`);
  }
  // The script that sends the form token is the one the form page loads.
  assert.ok((await request('/static/entry.js')).text.includes("api('/form-token')"));
  assert.equal((await request('/entry.js')).status, 404, 'nothing is served from the old path');
});

test('the resources exist only behind the email form, not among the public files', async () => {
  for (const route of ['/guide.html', '/pages/guide.html', '/entry.html', '/static/guide.html', '/static/entry.html',
    '/incident-plan.html', '/static/incident-plan.html', '/ai-rules.html', '/static/ai-rules.html',
    '/ai-brief.html', '/static/ai-brief.html', '/vendor-questions.html', '/static/vendor-questions.html', '/temp/', '/static/temp/',
    '/resources/dms-guide-for-leaders.pdf', '/static/dms-guide-for-leaders.pdf', '/.env', '/static/.env', '/src/env.js', '/static/../.env']) {
    assert.equal((await request(route)).status, 404, route);
  }
  for (const file of fs.readdirSync(new URL('../public', import.meta.url)).filter((name) => name.endsWith('.js'))) {
    const source = fs.readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8');
    assert.ok(!/Make one person accountable|Call the insurer before|A person decides about people|human decision|train or improve|Red flags/.test(source), `${file} holds a resource’s text`);
  }
});

let visitorCookie;
test('entering an address opens the resources at once, records the visit and emails the links', async () => {
  for (const bad of ['not-an-address', '', 'two@@example.org', 'spaces in@example.org']) {
    const response = await enter(bad);
    assert.equal(response.status, 400, bad);
    assert.match(response.json.error, /correct format, like name@example\.com/);
    assert.equal(response.headers.get('set-cookie'), null);
  }
  const typo = await enter('visitor@no-such-domain.example');
  assert.equal(typo.status, 400);
  assert.match(typo.json.error, /can’t find “no-such-domain\.example”/);
  assert.equal(links.length, 0);
  assert.equal(visitors.listVisitors().length, 0, 'a rejected address is not recorded');

  const response = await enter(' Visitor@Example.org ', { event: 'NJ-Expo-2026' });
  assert.equal(response.status, 200);
  assert.deepEqual(response.json, { email: 'visitor@example.org', emailed: 'sent' });
  assert.deepEqual(links, ['visitor@example.org']);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /^dms_resources=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\/(;|$)/);
  assert.match(cookie, /Max-Age=7776000/);
  assert.ok(!/Secure/.test(cookie), 'not Secure on an http PUBLIC_URL');
  visitorCookie = cookieOf(response);

  assert.deepEqual((await request('/api/access', { cookie: visitorCookie })).json, { email: 'visitor@example.org', staff: false });
  const [recorded] = visitors.listVisitors();
  assert.equal(recorded.email, 'visitor@example.org');
  assert.equal(recorded.visits, 1);
  assert.deepEqual(recorded.events, ['nj-expo-2026']);
  const lines = fs.readFileSync(path.join(dataDir, 'visitors.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(lines.map((line) => line.type), ['visit']);
  assert.equal(lines[0].event, 'nj-expo-2026');
  const mail = fs.readFileSync(path.join(dataDir, 'mail.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(mail.map((line) => [line.kind, line.email]), [['links', 'visitor@example.org']]);
});

test('with an address entered, the resource list and all six resources open', async () => {
  const home = await request('/', { cookie: visitorCookie });
  assert.equal(home.status, 200);
  for (const route of ['/scorecard', '/guide', '/guide.pdf', '/incident-plan', '/ai-rules', '/ai-brief', '/vendor-questions']) assert.ok(home.text.includes(`href="${route}"`), route);
  for (const [route, heading] of [['/incident-plan', '<h1>One-page incident plan</h1>'], ['/ai-rules', '<h1>AI rules for staff</h1>'],
    ['/ai-brief', '<h1>Board and executive AI brief</h1>'], ['/vendor-questions', '<h1>AI vendor questions</h1>']]) {
    const page = await request(route, { cookie: visitorCookie });
    assert.equal(page.status, 200, route);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.ok(page.text.includes(heading), route);
  }
  assert.ok((await request('/scorecard', { cookie: visitorCookie })).text.includes('AI readiness scorecard'));
  const guide = await request('/guide', { cookie: visitorCookie });
  assert.equal(guide.status, 200);
  assert.ok(guide.text.includes('Make one person accountable'));
  const pdf = await request('/guide.pdf', { cookie: visitorCookie });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.match(pdf.headers.get('content-disposition'), /attachment; filename="DMS guide for leaders\.pdf"/);
  assert.deepEqual(pdf.buffer, fs.readFileSync(GUIDE_PDF));
});

test('what a visitor types into a fill-in page is not sent anywhere', () => {
  // All four pages say so. Their scripts make no request of their own, and the forms have nowhere to post to.
  for (const file of ['sheet.js', 'incident-plan.js', 'ai-rules.js', 'ai-brief.js', 'vendor-questions.js']) {
    const source = fs.readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8');
    assert.equal(source.match(/\bfetch\(|\bapi\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource/), null, file);
    const shared = (source.match(/import \{([^}]*)\} from '\.\/common\.js'/)?.[1] || '').split(',').map((name) => name.trim());
    assert.ok(!shared.includes('api'), `${file} does not import the API helper`);
  }
  for (const name of ['incident-plan', 'ai-rules', 'ai-brief', 'vendor-questions']) {
    const html = fs.readFileSync(new URL(`../pages/${name}.html`, import.meta.url), 'utf8');
    assert.ok(html.includes('What you type is saved in this browser. It is not sent to DMS.'), name);
    assert.ok(!/<form[^>]*\b(action|method)=/.test(html), `${name}: the form posts nowhere`);
  }
});

test('?next= leads only to a page on this site', async () => {
  assert.equal((await request('/?next=/guide', { cookie: visitorCookie })).headers.get('location'), '/guide');
  assert.equal((await request('/?next=/incident-plan', { cookie: visitorCookie })).headers.get('location'), '/incident-plan');
  assert.equal((await request('/?next=/ai-rules', { cookie: visitorCookie })).headers.get('location'), '/ai-rules');
  assert.equal((await request('/?next=/ai-brief', { cookie: visitorCookie })).headers.get('location'), '/ai-brief');
  assert.equal((await request('/?next=/vendor-questions', { cookie: visitorCookie })).headers.get('location'), '/vendor-questions');
  assert.equal((await request('/?next=/scorecard', { cookie: visitorCookie })).headers.get('location'), '/scorecard');
  for (const next of ['https://evil.example', '//evil.example', '/api/access', 'javascript:alert(1)']) {
    const response = await request(`/?next=${encodeURIComponent(next)}`, { cookie: visitorCookie });
    assert.equal(response.status, 200, next);
    assert.equal(response.headers.get('location'), null);
  }
});

test('the links go to an address once a day and five times ever, however often it is entered', async () => {
  const before = links.length;
  const again = await enter('visitor@example.org', {}, visitorCookie);
  assert.deepEqual(again.json, { email: 'visitor@example.org', emailed: 'recent' });
  assert.equal(access.readCookie(cookieOf(again).split('=')[1]).vid, access.readCookie(visitorCookie.split('=')[1]).vid,
    'the same browser keeps its visit');
  assert.equal((await enter('visitor@example.org')).json.emailed, 'recent', 'a second device the same day');
  assert.equal(links.length, before);
  assert.equal(visitors.listVisitors().find((v) => v.email === 'visitor@example.org').visits, 2);

  for (let day = 1; day <= 4; day++) {
    await at(day * DAY + 60_000, async () => assert.equal((await enter('visitor@example.org')).json.emailed, 'sent', `day ${day}`));
  }
  assert.equal(links.filter((email) => email === 'visitor@example.org').length, 5);
  for (const day of [5, 40, 400]) {
    await at(day * DAY + 60_000, async () => {
      const response = await enter('visitor@example.org');
      assert.equal(response.status, 200, 'the resources still open');
      assert.equal(response.json.emailed, 'recent', `day ${day}: five is the most one address is ever sent`);
    });
  }
  assert.equal(links.filter((email) => email === 'visitor@example.org').length, 5);
});

test('the per-IP count of links emails covers the last 24 hours', async () => {
  const counter = dailyCounter();
  for (let i = 0; i < 3; i++) counter.add('203.0.113.7');
  counter.add('203.0.113.8');
  assert.equal(counter.count('203.0.113.7'), 3);
  assert.equal(counter.count('203.0.113.8'), 1);
  assert.equal(counter.count('203.0.113.9'), 0);
  await at(23 * 60 * 60_000, () => { counter.add('203.0.113.7'); assert.equal(counter.count('203.0.113.7'), 4); });
  await at(DAY + 1000, () => assert.equal(counter.count('203.0.113.7'), 1, 'only the one added an hour before'));
});

test('an address in UNLIMITED_EMAILS is emailed every time, for testing', async () => {
  const before = links.length;
  for (let i = 0; i < 7; i++) assert.equal((await enter('Tester@example.org')).json.emailed, 'sent');
  assert.equal(links.length, before + 7);
});

test('entries that did not come from the page are refused, and cost a person nothing', async () => {
  const post = (body) => request('/api/access', { method: 'POST', body });
  const refusedBefore = links.length;
  const none = await post({ email: 'bot@example.org' });
  assert.equal(none.status, 400);
  assert.equal(none.json.code, 'token');
  assert.equal((await post({ email: 'bot@example.org', token: 'made-up' })).status, 400);
  assert.equal((await post({ email: 'bot@example.org', token: visitorCookie.split('=')[1] })).status, 400, 'a cookie is not a form token');

  const quick = await formToken();
  assert.equal((await post({ email: 'bot@example.org', token: quick })).status, 400, 'used the instant it was issued');
  await at(1400, async () => assert.equal((await post({ email: 'bot@example.org', token: quick })).status, 400));

  const filled = await formToken();
  await at(2000, async () => {
    const response = await post({ email: 'bot@example.org', token: filled, hp: 'http://spam.example' });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('set-cookie'), null);
  });

  const stale = await formToken();
  await at(2 * 60 * 60_000 + 1000, async () => assert.equal((await post({ email: 'bot@example.org', token: stale })).status, 400, 'two hours old'));

  assert.equal(links.length, refusedBefore, 'nothing was emailed');
  assert.ok(!visitors.listVisitors().some((v) => v.email === 'bot@example.org'), 'and nothing was recorded');

  // A person: a mistyped address does not spend the token, and an untouched hidden field is fine.
  const token = await formToken();
  await at(2000, async () => {
    assert.equal((await post({ email: 'person@', token, hp: '' })).status, 400);
    const ok = await post({ email: 'person@example.org', token, hp: '' });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.emailed, 'sent');
    assert.equal((await post({ email: 'person2@example.org', token })).status, 400, 'a token opens the resources once');
  });
});

test('when the links email fails the resources still open, and the page is told', async () => {
  failMail = true;
  const response = await enter('unlucky@example.org');
  failMail = false;
  assert.equal(response.status, 200);
  assert.deepEqual(response.json, { email: 'unlucky@example.org', emailed: 'failed' });
  assert.equal((await request('/guide', { cookie: cookieOf(response) })).status, 200);
  assert.equal((await enter('unlucky@example.org')).json.emailed, 'sent', 'a failed send does not count as sent today');
});

test('pages carry a Content-Security-Policy that allows no inline script or style', async () => {
  const response = await request('/');
  const csp = response.headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/);
  assert.ok(!csp.includes('unsafe-inline'));
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('x-powered-by'), null);
  for (const page of fs.readdirSync(new URL('../pages', import.meta.url))) {
    const html = fs.readFileSync(new URL(`../pages/${page}`, import.meta.url), 'utf8');
    assert.ok(!/\sstyle="/.test(html) && !/<style[\s>]/.test(html), `${page} has an inline style`);
    assert.ok(!/<script(?![^>]*\ssrc=)/.test(html), `${page} has an inline script`);
  }
});

test('the cookie is signed, lasts 90 days and cannot be altered or swapped for a link', async () => {
  const vid = crypto.randomUUID();
  const token = access.issueCookie({ vid, email: 'reader@example.org' });
  assert.deepEqual(access.readCookie(token), { vid, email: 'reader@example.org', opsAt: null });
  assert.equal(access.readCookie(`${token}x`), null);
  const forged = Buffer.from(JSON.stringify({ vid, email: 'staff@example.org', exp: Date.now() + 1e9, opsAt: Date.now() })).toString('base64url');
  assert.equal(access.readCookie(`${forged}.${token.split('.')[1]}`), null);
  assert.equal(access.readCookie(tokenFrom(access.scorecardLink({ vid, email: 'reader@example.org' }))), null, 'a link is not a cookie');
  assert.equal(access.readLink(token), null, 'a cookie is not a link');
  assert.equal(access.cookieFrom({ headers: { cookie: 'dms_resources=%E0%A4%A' } }), null);
  await at(89 * 24 * 60 * 60_000, () => assert.equal(access.readCookie(token).email, 'reader@example.org'));
  await at(90 * 24 * 60 * 60_000 + 1, () => assert.equal(access.readCookie(token), null));
  assert.equal((await request('/api/access', { cookie: 'dms_resources=nonsense' })).status, 401);
});

test('requests from another site and non-JSON requests are refused', async () => {
  assert.equal((await request('/api/scorecard/report', { method: 'POST', cookie: visitorCookie, body: payload(), headers: { origin: 'https://evil.example' } })).status, 403);
  for (const site of ['cross-site', 'same-site', 'none']) {
    assert.equal((await request('/api/access', { method: 'DELETE', cookie: visitorCookie, headers: { 'sec-fetch-site': site } })).status, 403, site);
  }
  assert.equal((await request('/api/access', { method: 'POST', headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await enter('same@example.org', {}, undefined, { 'sec-fetch-site': 'same-origin', origin: 'http://localhost' })).status, 200);
  assert.equal((await enter('public@example.org', {}, undefined, { origin: 'http://localhost:1026' })).status, 200, 'PUBLIC_URL counts as this site');
});

test('every scorecard and staff route needs an address first', async () => {
  for (const route of ['/api/access', '/api/scorecard/definition', '/api/scorecard/report', '/api/scorecard/export', '/api/ops/visitors', '/api/ops/visitors.csv']) {
    assert.equal((await request(route)).status, 401, route);
  }
  assert.equal((await request('/api/scorecard/report', { method: 'POST', body: payload() })).status, 401);
  assert.equal((await request('/api/ops/link', { method: 'POST' })).status, 401);
});

let firstCookie;
let firstReport;
test('the server scores the answers and emails the report to the address this browser entered', async () => {
  firstCookie = cookieOf(await enter('first@example.org', { event: 'nj-expo-2026' }));
  const body = { ...payload(Array(20).fill(1)), email: 'attacker@example.org', vid: crypto.randomUUID(), total: 40, result: { total: 40 },
    notes: { visibility: '=HYPERLINK("https://evil.example")', data: '<img src=x onerror=alert(1)>' },
    conversation: { workflow: 'Draft volunteer orientation emails', date: '2026-11-18' } };
  const responses = await Promise.all([request('/api/scorecard/report', { method: 'POST', cookie: firstCookie, body }),
    request('/api/scorecard/report', { method: 'POST', cookie: firstCookie, body })]);
  assert.equal(responses[0].status, 200);
  assert.equal(responses[1].status, 200);
  firstReport = responses[0].json.report;
  assert.equal(firstReport.id, responses[1].json.report.id);
  assert.equal(firstReport.result.total, 20);
  assert.equal(firstReport.result.band.name, 'Experimental');
  assert.equal(firstReport.email, 'first@example.org');
  assert.equal(firstReport.vid, access.readCookie(firstCookie.split('=')[1]).vid);
  assert.equal(firstReport.delivery.status, 'sent');
  assert.equal(firstReport.delivery.to, 'first@example.org');
  assert.equal(reports.length, 1, 'a double submission sends one email');
  assert.equal(reports[0].email, 'first@example.org');
  const edited = await request('/api/scorecard/report', { method: 'POST', cookie: firstCookie, body: { ...body, answers: Array(20).fill(0) } });
  assert.equal(edited.status, 409);
  assert.equal((await request('/api/scorecard/report', { method: 'POST', cookie: firstCookie, body: { ...payload(), answers: Array(19).fill(2) } })).status, 400);
});

test('one address is emailed one report a day and five ever; later reports are saved but not sent', async () => {
  const cookie = cookieOf(await enter('capped@example.org'));
  const submit = async () => (await request('/api/scorecard/report', { method: 'POST', cookie, body: payload() })).json;
  const sentBefore = reports.length;

  assert.deepEqual((await request('/api/scorecard/report', { cookie })).json, { report: null, mail: { allowed: true } });
  const first = await submit();
  assert.equal(first.report.delivery.status, 'sent');
  assert.deepEqual(first.mail, { allowed: false, reason: 'daily' }, 'the page is told before it promises another email');

  // The same day: a second submission, and a second browser that typed the same address.
  const second = await submit();
  assert.equal(second.report.delivery.status, 'limited');
  assert.equal(second.report.delivery.reason, 'daily');
  assert.equal(second.report.result.total, 40, 'the report is still saved and scored');
  const other = cookieOf(await enter('capped@example.org'));
  assert.equal((await request('/api/scorecard/report', { method: 'POST', cookie: other, body: payload() })).json.report.delivery.status, 'limited');
  const again = await request('/api/scorecard/report/email', { method: 'POST', cookie });
  assert.equal(again.status, 429);
  assert.match(again.json.error, /already emailed a report to this address today/);
  assert.equal(reports.length, sentBefore + 1);

  for (let day = 1; day <= 4; day++) {
    await at(day * DAY + 60_000, async () => assert.equal((await submit()).report.delivery.status, 'sent', `day ${day}`));
  }
  assert.equal(reports.length, sentBefore + 5);
  for (const day of [5, 40, 80]) {
    await at(day * DAY + 60_000, async () => {
      const late = await submit();
      assert.equal(late.report.delivery.status, 'limited', `day ${day}`);
      assert.equal(late.report.delivery.reason, 'lifetime');
      assert.deepEqual(late.mail, { allowed: false, reason: 'lifetime' });
      assert.match((await request('/api/scorecard/report/email', { method: 'POST', cookie })).json.error, /five reports to this address/);
    });
  }
  assert.equal(reports.length, sentBefore + 5);
});

test('an address in UNLIMITED_EMAILS gets every report, and can ask for it again straight away', async () => {
  const cookie = cookieOf(await enter('tester@example.org'));
  const sentBefore = reports.length;
  for (let i = 0; i < 7; i++) {
    const response = (await request('/api/scorecard/report', { method: 'POST', cookie, body: payload() })).json;
    assert.equal(response.report.delivery.status, 'sent');
    assert.deepEqual(response.mail, { allowed: true });
  }
  assert.equal((await request('/api/scorecard/report/email', { method: 'POST', cookie })).json.report.delivery.status, 'sent');
  assert.equal(reports.length, sentBefore + 8);
});

test('the guide PDF has the eight pages the form page and the resource list say it has', () => {
  const pdf = fs.readFileSync(GUIDE_PDF).toString('latin1');
  assert.equal((pdf.match(/\/Type\s*\/Page\b(?!s)/g) || []).length, 8);
  assert.ok(fs.readFileSync(new URL('../pages/entry.html', import.meta.url), 'utf8').includes('8-page PDF'));
  assert.ok(fs.readFileSync(new URL('../pages/resources.html', import.meta.url), 'utf8').includes('(8 pages)'));
});

test('typing someone else’s address shows nothing of theirs', async () => {
  const impostor = cookieOf(await enter('first@example.org'));
  assert.equal((await request('/api/scorecard/report', { cookie: impostor })).json.report, null);
  assert.equal((await request('/api/scorecard/export', { cookie: impostor })).status, 404);
  assert.equal((await request('/api/scorecard/report/email', { method: 'POST', cookie: impostor })).status, 404);
  assert.equal((await request('/api/scorecard/report', { cookie: firstCookie })).json.report.id, firstReport.id, 'the first browser still has it');
  assert.equal((await request('/api/scorecard/report', { cookie: cookieFor('other@example.org') })).json.report, null);
});

test('the link in the report email reopens that scorecard on another device', async () => {
  const url = access.scorecardLink(firstReport);
  assert.ok(url.startsWith('http://localhost:1026/open/'));
  const opened = await request(new URL(url).pathname);
  assert.equal(opened.status, 302);
  assert.equal(opened.headers.get('location'), '/scorecard');
  assert.equal(opened.headers.get('cache-control'), 'no-store');
  const cookie = cookieOf(opened);
  assert.equal((await request('/api/scorecard/report', { cookie })).json.report.id, firstReport.id);
  assert.equal((await request(new URL(url).pathname)).status, 302, 'a mail scanner fetching the link first does not spend it');

  for (const bad of ['/open/nonsense', `/open/${tokenFrom(url)}x`, `/open/${firstCookie.split('=')[1]}`]) {
    const response = await request(bad);
    assert.equal(response.headers.get('location'), '/?link=expired', bad);
    assert.equal(response.headers.get('set-cookie'), null);
  }
  await at(90 * 24 * 60 * 60_000 + 1000, async () => {
    assert.equal((await request(new URL(url).pathname)).headers.get('location'), '/?link=expired');
  });
});

test('exports are private, include notes and escape spreadsheet formulas', async () => {
  const csv = await request('/api/scorecard/export?format=csv', { cookie: firstCookie });
  assert.equal(csv.status, 200);
  assert.equal(csv.headers.get('cache-control'), 'no-store');
  assert.match(csv.headers.get('content-disposition'), /attachment; filename="dms-ai-readiness-\d{4}-\d{2}-\d{2}\.csv"/);
  assert.ok(csv.text.includes("'=HYPERLINK"));
  assert.ok(csv.text.includes('Draft volunteer orientation emails'));
  assert.ok((await request('/api/scorecard/export?format=txt', { cookie: firstCookie })).text.includes('Score: 20 / 40'));
  assert.equal((await request('/api/scorecard/export?format=json', { cookie: firstCookie })).json.result.total, 20);
  assert.equal((await request('/api/scorecard/export?format=exe', { cookie: firstCookie })).status, 400);
});

test('a mistyped address can be corrected before the report is sent, keeping the same visit', async () => {
  const typed = await enter('secnod@example.org');
  let cookie = cookieOf(typed);
  const vid = access.readCookie(cookie.split('=')[1]).vid;
  assert.equal((await request('/api/access', { method: 'PATCH', cookie, body: { email: 'nope' } })).status, 400);
  assert.equal((await request('/api/access', { method: 'PATCH', cookie, body: { email: 'x@no-such-domain.example' } })).status, 400);
  const fixed = await request('/api/access', { method: 'PATCH', cookie, body: { email: 'Second@example.org' } });
  assert.deepEqual(fixed.json, { email: 'second@example.org' });
  cookie = cookieOf(fixed);
  assert.equal(access.readCookie(cookie.split('=')[1]).vid, vid);
  const listed = visitors.listVisitors().map((v) => v.email);
  assert.ok(listed.includes('second@example.org') && !listed.includes('secnod@example.org'), 'the typo leaves the visitor list');

  failMail = true;
  const response = await request('/api/scorecard/report', { method: 'POST', cookie, body: payload() });
  failMail = false;
  assert.equal(response.status, 200);
  assert.equal(response.json.report.delivery.status, 'failed');
  assert.equal(response.json.report.email, 'second@example.org');
  assert.equal((await readReport(vid)).result.total, 40, 'the report is saved although the email failed');
  assert.equal((await request('/api/scorecard/report/email', { method: 'POST', cookie })).status, 429);
  const report = await readReport(vid);
  report.delivery.attemptedAt = new Date(Date.now() - 61_000).toISOString();
  await saveReport(vid, report);
  const retry = await request('/api/scorecard/report/email', { method: 'POST', cookie, body: { email: 'attacker@example.org' } });
  assert.equal(retry.json.report.delivery.status, 'sent');
  assert.equal(retry.json.report.id, report.id);
  assert.equal(reports.at(-1).email, 'second@example.org');
});

test('typing a staff address does not open /ops; only a link emailed to that address does', async () => {
  const visitor = await request('/ops', { cookie: visitorCookie });
  assert.equal(visitor.status, 404);
  assert.ok(!visitor.text.includes('Visitors'));
  assert.equal((await request('/api/ops/visitors', { cookie: visitorCookie })).status, 403);
  assert.equal((await request('/api/ops/link', { method: 'POST', cookie: visitorCookie })).status, 404);
  assert.equal(opsLinks.length, 0);

  const typed = cookieOf(await enter('Staff@example.org'));
  const gate = await request('/ops', { cookie: typed });
  assert.equal(gate.status, 200);
  assert.ok(gate.text.includes('id="send-link"') && !gate.text.includes('id="rows"'), 'the page that offers the link, not the list');
  assert.equal((await request('/api/ops/visitors', { cookie: typed })).status, 401);
  assert.equal((await request('/api/ops/scorecard?email=first@example.org', { cookie: typed })).status, 401);
  assert.deepEqual((await request('/api/access', { cookie: typed })).json, { email: 'staff@example.org', staff: false });

  const sent = await request('/api/ops/link', { method: 'POST', cookie: typed });
  assert.deepEqual(sent.json, { ok: true, email: 'staff@example.org', minutes: 15 });
  const twice = await request('/api/ops/link', { method: 'POST', cookie: typed });
  assert.equal(twice.status, 429);
  assert.match(twice.json.error, /in the last two minutes/);
  assert.equal(opsLinks.length, 1);
  const url = access.staffLink(opsLinks[0]);
  const opened = await request(new URL(url).pathname);
  assert.equal(opened.headers.get('location'), '/ops');
  const staff = cookieOf(opened);
  assert.ok((await request('/ops', { cookie: staff })).text.includes('id="rows"'));
  assert.deepEqual((await request('/api/access', { cookie: staff })).json, { email: 'staff@example.org', staff: true });
  assert.equal((await request('/api/ops/visitors', { cookie: staff })).status, 200);

  await at(16 * 60_000, async () => {
    assert.equal((await request(new URL(url).pathname)).headers.get('location'), '/?link=expired', 'the link lasts 15 minutes');
    assert.equal((await request('/api/ops/visitors', { cookie: staff })).status, 200, 'the view it opened stays open');
  });
  await at(12 * 60 * 60_000 + 1000, async () => {
    assert.equal((await request('/api/ops/visitors', { cookie: staff })).status, 401);
    assert.ok((await request('/ops', { cookie: staff })).text.includes('id="send-link"'));
    assert.equal((await request('/guide', { cookie: staff })).status, 200, 'the resources stay open');
  });

  const forged = access.issueCookie({ vid: crypto.randomUUID(), email: 'visitor@example.org', opsAt: Date.now() });
  assert.equal((await request('/api/ops/visitors', { cookie: `dms_resources=${forged}` })).status, 403, 'not a staff address');
});

test('staff see every address with its latest score, and can open and download a report', async () => {
  const opened = await request(new URL(access.staffLink({ vid: crypto.randomUUID(), email: 'staff@example.org' })).pathname);
  const staff = cookieOf(opened);
  assert.equal((await enter('=cmd@example.org', { event: 'webinar' })).status, 200);
  const corrupt = crypto.randomUUID();
  await visitors.recordVisit({ vid: corrupt, email: 'corrupt@example.org' });
  await saveReport(corrupt, { email: 'corrupt@example.org', result: {} });

  const overview = (await request('/api/ops/visitors', { cookie: staff })).json;
  const row = (email) => overview.visitors.find((v) => v.email === email);
  assert.equal(overview.count, overview.visitors.length);
  assert.equal(overview.completed, overview.visitors.filter((v) => v.scorecard.status === 'completed').length);
  assert.deepEqual(overview.visitors.filter((v) => v.scorecard.status === 'completed').map((v) => v.email).sort(),
    ['capped@example.org', 'first@example.org', 'second@example.org', 'tester@example.org']);
  assert.equal(overview.mail.limit, 250);
  assert.equal(overview.mail.linksLimit, 150);
  assert.ok(overview.mail.sent >= overview.mail.links && overview.mail.links > 0);
  assert.ok(overview.refused >= 7, 'the refused entries are counted for staff');
  assert.deepEqual(row('first@example.org').scorecard, { status: 'completed', score: 20, max: 40, level: 'Experimental', completedAt: firstReport.createdAt });
  assert.deepEqual(row('first@example.org').events, ['nj-expo-2026']);
  assert.equal(row('first@example.org').visits, 2, 'the impostor’s visit is counted under the address they typed');
  assert.equal(row('first@example.org').vids, undefined, 'visit ids stay on the server');
  assert.equal(row('second@example.org').scorecard.score, 40);
  assert.deepEqual(row('visitor@example.org').scorecard, { status: 'not_completed' });
  assert.deepEqual(row('corrupt@example.org').scorecard, { status: 'unavailable' });

  const csv = await request('/api/ops/visitors.csv', { cookie: staff });
  assert.match(csv.headers.get('content-disposition'), /attachment; filename="dms-resources-visitors-\d{4}-\d{2}-\d{2}\.csv"/);
  assert.ok(csv.text.startsWith('﻿"Email","First visit","Last visit","Visits","Event","AI scorecard","Score","Out of","Level","Scorecard completed"'));
  assert.ok(csv.text.includes(`"'=cmd@example.org"`), 'an address that starts like a formula is neutralized');
  assert.ok(csv.text.includes('"first@example.org"') && csv.text.includes('"Experimental"'));

  const report = await request('/api/ops/scorecard?email=FIRST@example.org', { cookie: staff });
  assert.equal(report.status, 200);
  assert.equal(report.json.report.id, firstReport.id);
  assert.equal(report.json.definition.domains.length, 5);
  assert.ok((await request('/api/ops/scorecard/export?email=first@example.org&format=csv', { cookie: staff })).text.includes('Experimental'));
  assert.equal((await request('/api/ops/scorecard/export?email=first@example.org&format=json', { cookie: staff })).status, 400);
  assert.equal((await request('/api/ops/scorecard?email=visitor@example.org', { cookie: staff })).status, 404, 'no scorecard yet');
  assert.equal((await request('/api/ops/scorecard?email=stranger@example.org', { cookie: staff })).status, 404, 'never entered');
});

test('the visitor list and the email record are rebuilt from their files after a restart', () => {
  const before = visitors.listVisitors();
  assert.deepEqual(visitors.initVisitors(), { visitors: before.length });
  assert.deepEqual(visitors.listVisitors(), before);

  const lines = fs.readFileSync(path.join(dataDir, 'mail.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const inLastDay = lines.filter((line) => Date.parse(line.at) > Date.now() - DAY).length;
  assert.deepEqual(mailLog.initMailLog(), { sentInLastDay: inLastDay });
  assert.equal(mailLog.mailInLastDay(), inLastDay);
  assert.deepEqual(mailLog.allowance('links', 'visitor@example.org'), { allowed: false, reason: 'lifetime' }, 'five ever survives a restart');
  assert.deepEqual(mailLog.allowance('report', 'capped@example.org'), { allowed: false, reason: 'lifetime' });
  assert.deepEqual(mailLog.allowance('report', 'never@example.org'), { allowed: true });
  assert.deepEqual(mailLog.allowance('links', 'tester@example.org'), { allowed: true });
});

test('“Use a different email” clears the cookie, and health reports a working configuration', async () => {
  const out = await request('/api/access', { method: 'DELETE', cookie: visitorCookie });
  assert.equal(out.status, 200);
  assert.match(out.headers.get('set-cookie'), /^dms_resources=;/);
  const health = await request('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.json.ok, true);
  assert.deepEqual(health.json.problems, []);
  assert.equal((await request('/api/nothing-here', { cookie: visitorCookie })).status, 404);
  assert.equal((await request('/nothing-here')).status, 404);
});
