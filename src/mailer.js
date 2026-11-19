/* =============================================================================
   Email, over Brevo SMTP
   -----------------------------------------------------------------------------
   Four messages: the links to the resources, the scorecard report, the staff
   view link, and a notice to staff when a daily limit is reached. Each of the
   first three goes to one address and is never copied to anyone else.

   The links and the report go to an address as it was typed, which nothing
   has confirmed. mail-log.js limits how often one address is emailed.

   The Brevo account is shared with other DMS projects and has a daily sending
   limit. Two site-wide caps protect it, both counted from the record on disk,
   so a restart does not reset them:

     MAIL_DAILY_LIMIT   every email, of any kind, in any 24 hours
     LINKS_DAILY_LIMIT  links emails only

   The links email is the only one a bare form entry can cause. Its smaller cap
   means a flood of entries cannot use up the share the reports need.
   ============================================================================= */

import nodemailer from 'nodemailer';
import { env } from './env.js';
import { resourcesEmail, staffLinkEmail, limitNoticeEmail } from './email-layout.js';
import { reportEmail } from './scorecard-report.js';
import { scorecardLink, staffLink } from './access.js';
import { recordMail, mailInLastDay } from './mail-log.js';

// The Brevo sender is a no-reply address. The other DMS apps set the same Reply-To.
const REPLY_TO = 'info@strategydms.com';
let transport = null;

export function initMailer() {
  const { host, user, pass, devLog } = env.mail;
  transport = null;

  if (devLog) return { ready: true, mode: 'console' };
  if (!host || !user || !pass) return { ready: false, mode: 'off' };

  transport = nodemailer.createTransport({
    host,
    port: env.mail.port,
    secure: env.mail.port === 465,
    auth: { user, pass },
    // Bounded so a stalled SMTP server cannot hold a request open.
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });
  return { ready: true, mode: 'smtp' };
}

export function mailReady() {
  return env.mail.devLog || Boolean(transport);
}

/* Opens a connection and authenticates without sending anything. */
export async function verifyMailer() {
  if (!transport) return false;
  await transport.verify();
  return true;
}

/* What the staff view shows, so a busy day or a flood is visible before a cap is reached. */
export function mailUsage() {
  return { sent: mailInLastDay(), limit: env.mail.dailyLimit, links: mailInLastDay('links'), linksLimit: env.mail.linksDailyLimit };
}

/* Tells staff, at most once a day, that a daily limit has stopped emails. It is
   sent past the cap it reports; the cap is set below Brevo's own limit. */
async function notifyStaff(reason) {
  if (!transport || !env.ops.emails.length || mailInLastDay('notice') > 0) return;
  const to = env.ops.emails;
  try {
    for (const email of to) await recordMail('notice', email);
    await transport.sendMail({ ...limitNoticeEmail({ reason, usage: mailUsage(), siteUrl: env.urls.public }),
      from: env.mail.from, replyTo: REPLY_TO, to: to.join(', ') });
  } catch (err) {
    console.error('[mail] the limit notice to staff failed:', err.message);
  }
}

const limitError = (message) => Object.assign(new Error(message), { code: 'mail_limit' });

async function send(kind, email, message, label) {
  if (env.mail.devLog) {
    console.log(`[mail] development log, nothing sent. To: ${email}. Subject: ${message.subject}`);
    return { sent: false, mode: 'console' };
  }
  if (!transport) throw Object.assign(new Error('Email is not configured.'), { code: 'mail_not_configured' });
  if (env.mail.dailyLimit && mailInLastDay() >= env.mail.dailyLimit) {
    console.error(`[mail] MAIL_DAILY_LIMIT of ${env.mail.dailyLimit} reached; ${label} to ${email} was not sent.`);
    await notifyStaff('all');
    throw limitError('The daily email limit has been reached.');
  }
  if (kind === 'links' && env.mail.linksDailyLimit && mailInLastDay('links') >= env.mail.linksDailyLimit) {
    console.error(`[mail] LINKS_DAILY_LIMIT of ${env.mail.linksDailyLimit} reached; ${label} to ${email} was not sent.`);
    await notifyStaff('links');
    throw limitError('The daily limit for links emails has been reached.');
  }
  const delivery = await transport.sendMail({ ...message, from: env.mail.from, replyTo: REPLY_TO, to: email });
  if (!delivery.accepted?.length) throw new Error(`The ${label} was not accepted for delivery.`);
  try { await recordMail(kind, email); }
  catch (err) { console.error(`[mail] COULD NOT RECORD the ${label} to ${email}:`, err.message); }
  return { sent: true, mode: 'smtp' };
}

export function sendResources({ email }) {
  return send('links', email, resourcesEmail({ siteUrl: env.urls.public }), 'links email');
}

export function sendScorecardReport(report) {
  return send('report', report.email, reportEmail(report, scorecardLink(report)), 'scorecard report');
}

export function sendStaffLink({ vid, email }) {
  return send('staff', email, staffLinkEmail({ url: staffLink({ vid, email }), minutes: env.ops.linkMinutes }), 'staff view link');
}
