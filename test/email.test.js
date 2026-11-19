import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test, before, after, mock } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import nodemailer from 'nodemailer';

// Real MIME messages are built in memory. No SMTP connection is made and no email is sent.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dms-resources-mail-test-'));
const config = {
  SMTP_HOST: 'smtp.example.org', SMTP_PORT: '587', SMTP_USER: 'test-user', SMTP_PASS: 'test-password',
  SMTP_FROM: 'DMS <reports@example.org>', SMTP_DEV_LOG: '0', PUBLIC_URL: 'https://resources.example.org',
  SESSION_SECRET: 'test-'.repeat(10), MAIL_DAILY_LIMIT: '7', LINKS_DAILY_LIMIT: '2', UNLIMITED_EMAILS: '',
  OPS_EMAILS: 'staff@example.org,second-staff@example.org', OPS_LINK_MINUTES: '15', DATA_DIR: dataDir,
};
Object.assign(process.env, config);
const { refreshEnv } = await import('../src/env.js');
refreshEnv();
const { initMailer, sendResources, sendScorecardReport, sendStaffLink, mailUsage } = await import('../src/mailer.js');
const mailLog = await import('../src/mail-log.js');
mailLog.initMailLog();
const access = await import('../src/access.js');
const { scoreAssessment, validateAssessment } = await import('../src/scorecard-content.js');
const { reportEmail, reportCsv, reportText } = await import('../src/scorecard-report.js');
const { resourcesEmail, staffLinkEmail } = await import('../src/email-layout.js');

const renderer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });
const delivered = [];
before(() => {
  mock.method(nodemailer, 'createTransport', (options) => {
    assert.equal(options.host, config.SMTP_HOST);
    assert.equal(options.port, 587);
    assert.equal(options.secure, false);
    assert.deepEqual(options.auth, { user: config.SMTP_USER, pass: config.SMTP_PASS });
    return { async sendMail(message) {
      const result = await renderer.sendMail(message);
      delivered.push({ message, result });
      return { ...result, accepted: [message.to] };
    } };
  });
  assert.equal(initMailer().mode, 'smtp');
});
after(() => { mock.restoreAll(); renderer.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

const answers = Array.from({ length: 20 }, (_, index) => (index < 4 ? 2 : 1));
const report = {
  ...validateAssessment({ submissionId: 'c3a2d1e0-1357-4abc-8def-123456789abc', answers, notes: {}, conversation: {} }),
  vid: 'b7e6a3f0-2468-4bcd-9abc-0123456789ab', email: 'visitor@example.org', createdAt: '2026-11-18T12:00:00.000Z',
  result: scoreAssessment(answers),
};
const originalLogo = readFileSync(new URL('../resources/dms-logo.png', import.meta.url));
const linkIn = (html) => html.match(/href="(https:\/\/resources\.example\.org\/open\/[^"]+)"/)[1];

function checkEnvelopeAndLogo({ message, result }, recipient) {
  assert.equal(message.from, config.SMTP_FROM);
  assert.equal(message.replyTo, 'info@strategydms.com');
  assert.deepEqual(result.envelope.to, [recipient]);
  assert.equal(message.cc, undefined);
  assert.equal(message.bcc, undefined);
  const images = message.attachments.filter((attachment) => attachment.cid);
  assert.equal(images.length, 1);
  assert.ok(message.html.includes(`src="cid:${images[0].cid}"`));
  assert.deepEqual(Buffer.from(images[0].content, images[0].encoding), originalLogo);
  const wire = result.message.toString();
  assert.match(wire, /Content-Type: multipart\/related;/);
  assert.match(wire, /Content-Type: text\/plain; charset=utf-8/);
  assert.match(wire, /Content-Type: text\/html; charset=utf-8/);
  assert.ok(wire.includes(`Content-ID: <${images[0].cid}>`));
}

test('the links email goes to the one address with plain links to all six resources', async () => {
  assert.deepEqual(await sendResources({ email: 'visitor@example.org' }), { sent: true, mode: 'smtp' });
  const mail = delivered.at(-1);
  checkEnvelopeAndLogo(mail, 'visitor@example.org');
  assert.equal(mail.message.subject, 'Your links to the free DMS resources');
  for (const url of ['scorecard', 'guide', 'incident-plan', 'ai-rules', 'ai-brief', 'vendor-questions'].map((page) => `https://resources.example.org/${page}`)) {
    assert.ok(mail.message.html.includes(`href="${url}"`) && mail.message.text.includes(url), url);
  }
  assert.ok(!mail.message.html.includes('/open/'), 'a forwarded copy asks the next reader for their own address');
  assert.equal(mail.message.attachments.filter((attachment) => !attachment.cid).length, 0);
});

test('the report email carries the score, both report files and a link that reopens that scorecard', async () => {
  assert.deepEqual(await sendScorecardReport(report), { sent: true, mode: 'smtp' });
  const mail = delivered.at(-1);
  checkEnvelopeAndLogo(mail, report.email);
  assert.equal(mail.message.subject, 'Your DMS AI readiness score: 24/40 — Controlled');
  const files = mail.message.attachments.filter((attachment) => !attachment.cid);
  assert.equal(files.length, 2);
  assert.equal(files.find((attachment) => attachment.filename.endsWith('.csv')).content, reportCsv(report));
  assert.equal(files.find((attachment) => attachment.filename.endsWith('.txt')).content, reportText(report));
  assert.ok(mail.message.text.includes(reportText(report)));
  const link = access.readLink(linkIn(mail.message.html).split('/open/')[1]);
  assert.deepEqual({ kind: link.kind, vid: link.vid, email: link.email }, { kind: 'scorecard', vid: report.vid, email: report.email });
  assert.ok(mail.message.text.includes(linkIn(mail.message.html)));
  assert.equal((mail.result.message.toString().match(/Content-Disposition: attachment;/g) || []).length, 2);
});

test('the staff link email goes to the staff address with a 15-minute link to /ops', async () => {
  const visit = { vid: 'a1b2c3d4-1111-4222-8333-444455556666', email: 'staff@example.org' };
  assert.deepEqual(await sendStaffLink(visit), { sent: true, mode: 'smtp' });
  const mail = delivered.at(-1);
  checkEnvelopeAndLogo(mail, 'staff@example.org');
  assert.equal(mail.message.subject, 'Your link to the DMS resources staff view');
  assert.ok(mail.message.text.includes('works for 15 minutes'));
  const link = access.readLink(linkIn(mail.message.html).split('/open/')[1]);
  assert.equal(link.kind, 'ops');
  assert.equal(link.email, 'staff@example.org');
  assert.ok(Date.now() - link.iat < 5000);
  assert.ok(staffLinkEmail({ url: 'https://x.example/open/t', minutes: 1 }).text.includes('works for 1 minute.'));
});

test('email templates escape what visitors typed', () => {
  const untrusted = '<img src=x onerror=alert(1)>';
  const altered = structuredClone(report);
  altered.result.band.action = untrusted;
  altered.result.domains[0].title = untrusted;
  altered.result.priorities[0].action = untrusted;
  const mail = reportEmail(altered, 'https://resources.example.org/scorecard?one=1&two="2"');
  assert.ok(!mail.html.includes(untrusted));
  assert.ok(mail.html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(mail.html.includes('?one=1&amp;two=&quot;2&quot;'));
  assert.ok(!reportEmail(report).html.includes('href=""'));
  assert.ok(!resourcesEmail({ siteUrl: 'https://x.example/"><script>' }).html.includes('"><script>'));
});

test('links emails have their own daily cap, so a flood of entries leaves room for reports; staff are told once', async () => {
  assert.deepEqual(mailUsage(), { sent: 3, limit: 7, links: 1, linksLimit: 2 });
  await sendResources({ email: 'second@example.org' });
  const count = delivered.length;
  await assert.rejects(sendResources({ email: 'third@example.org' }), { code: 'mail_limit' });

  // The refusal sent nothing to the visitor and one notice to both staff addresses.
  assert.equal(delivered.length, count + 1);
  const notice = delivered.at(-1).message;
  assert.equal(notice.to, 'staff@example.org, second-staff@example.org');
  assert.equal(notice.subject, 'DMS resources has reached an email limit');
  assert.ok(notice.text.includes('has sent 2 links emails in the last 24 hours') && notice.text.includes('LINKS_DAILY_LIMIT is 2'));
  assert.ok(notice.text.includes('https://resources.example.org/ops'));

  await assert.rejects(sendResources({ email: 'fourth@example.org' }), { code: 'mail_limit' });
  assert.equal(delivered.length, count + 1, 'the notice goes out once a day, not once per refusal');
  assert.deepEqual(await sendScorecardReport(report), { sent: true, mode: 'smtp' }, 'reports are still sent');
});

test('MAIL_DAILY_LIMIT stops every kind of email, survives a restart, and frees up after 24 hours', async () => {
  assert.equal(mailUsage().sent, 7, 'three earlier emails, one more links email, a notice to each of two staff and a report');
  const count = delivered.length;
  await assert.rejects(sendScorecardReport(report), { code: 'mail_limit' });
  await assert.rejects(sendStaffLink({ vid: report.vid, email: 'staff@example.org' }), { code: 'mail_limit' });
  assert.equal(delivered.length, count, 'nothing was handed to SMTP, and staff were already told today');

  assert.deepEqual(mailLog.initMailLog(), { sentInLastDay: 7 });
  await assert.rejects(sendScorecardReport(report), { code: 'mail_limit' });

  const now = Date.now;
  try {
    Date.now = () => now() + 24 * 60 * 60_000 + 1000;
    assert.equal(mailUsage().sent, 0);
    assert.deepEqual(await sendResources({ email: 'fifth@example.org' }), { sent: true, mode: 'smtp' });
  } finally { Date.now = now; }
});
