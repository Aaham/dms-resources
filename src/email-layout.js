import { readFileSync } from 'node:fs';

// The DMS logo is embedded in each email, so it needs no public image URL.
const logo = readFileSync(new URL('../resources/dms-logo.png', import.meta.url)).toString('base64');
const logoCid = 'dms-logo@strategydms.com';

export const escapeEmailHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function emailLogoAttachment() {
  return { filename: 'dms-logo.png', content: logo, encoding: 'base64', contentType: 'image/png',
    contentDisposition: 'inline', cid: logoCid };
}

export const emailFooterText = 'Dynamic Management Services\nhttps://www.strategydms.com\ninfo@strategydms.com';

export function emailButton(url, label) {
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr>
    <td bgcolor="#0E2135" style="background-color:#0E2135;border:1px solid #0E2135;text-align:center;mso-padding-alt:15px 24px;">
      <a href="${escapeEmailHtml(url)}" style="display:inline-block;border:15px solid #0E2135;border-left-width:24px;border-right-width:24px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;line-height:20px;text-decoration:none;mso-padding-alt:0;text-underline-color:#0E2135;">${escapeEmailHtml(label)}</a>
    </td></tr></table>`;
}

export function emailLayout({ title, preheader, body }) {
  return `<!doctype html>
<html lang="en-US" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="format-detection" content="telephone=no,date=no,address=no,email=no">
  <title>${escapeEmailHtml(title)}</title>
  <style>
    body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
    img { -ms-interpolation-mode:bicubic; }
    @media screen and (max-width:480px) {
      .email-outer { padding:12px 8px !important; }
      .email-padding { padding:24px 20px !important; }
      .email-title { font-size:27px !important; line-height:34px !important; }
      .score-cell { display:block !important; width:100% !important; padding:0 0 16px !important; }
      .score-description { display:block !important; width:100% !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;width:100%;background-color:#F4F6F8;color:#0E2135;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;font-size:1px;line-height:1px;color:#F4F6F8;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeEmailHtml(preheader)}</div>
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#F4F6F8" style="width:100%;background-color:#F4F6F8;">
    <tr><td class="email-outer" align="center" style="padding:32px 12px;">
      <!--[if mso]><table role="presentation" width="640" border="0" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="width:100%;max-width:640px;background-color:#ffffff;border:1px solid #DBE1E8;color:#0E2135;font-family:Arial,Helvetica,sans-serif;">
        <tr><td class="email-padding" style="padding:24px 32px;border-top:5px solid #0E2135;border-bottom:1px solid #DBE1E8;">
          <a href="https://www.strategydms.com" style="display:inline-block;text-decoration:none;">
            <img src="cid:${logoCid}" alt="DMS, Dynamic Management Services" width="170" height="63" style="display:block;width:170px;height:63px;max-width:100%;border:0;color:#0E2135;font-family:Arial,Helvetica,sans-serif;font-size:16px;">
          </a>
        </td></tr>
        ${body}
        <tr><td class="email-padding" bgcolor="#F4F6F8" style="padding:24px 32px;background-color:#F4F6F8;border-top:1px solid #DBE1E8;">
          <p style="margin:0 0 8px;font-size:13px;font-weight:700;line-height:20px;color:#0E2135;">Dynamic Management Services</p>
          <p style="margin:0;font-size:12px;line-height:22px;color:#55637A;">
            <a href="https://www.strategydms.com" style="color:#2C4C70;text-decoration:underline;">strategydms.com</a><br>
            <a href="mailto:info@strategydms.com" style="color:#2C4C70;text-decoration:underline;">info@strategydms.com</a>
          </p>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body>
</html>`;
}

const paragraph = 'margin:0 0 16px;font-size:15px;line-height:24px;color:#55637A;';

/* Sent once a day at most to an address that has just been entered. It holds
   plain links: a new browser asks for the address again, so forwarding the
   email to a colleague brings them in under their own address. */
export function resourcesEmail({ siteUrl }) {
  const h = escapeEmailHtml;
  const resources = [
    { title: 'AI readiness scorecard', url: `${siteUrl}/scorecard`, label: 'Open the scorecard',
      text: 'Rate 20 statements about how your organization uses AI. You get a score out of 40 and suggested next steps.' },
    { title: 'Cybersecurity and AI governance: a guide for leaders', url: `${siteUrl}/guide`, label: 'Read the guide',
      text: 'Eighteen steps for leadership, with questions to ask your IT provider and your AI vendors. You can also download it as a PDF.' },
    { title: 'One-page incident plan', url: `${siteUrl}/incident-plan`, label: 'Fill in the incident plan',
      text: 'Fill in who decides and who to call if your organization is hacked, locked out of its systems or tricked into sending money, then print the page.' },
    { title: 'AI rules for staff', url: `${siteUrl}/ai-rules`, label: 'Fill in the AI rules',
      text: 'List the AI tools your staff may use and the information that must stay out of them, then print the page as a handout.' },
    { title: 'Board and executive AI brief', url: `${siteUrl}/ai-brief`, label: 'Fill in the brief',
      text: 'Answer seven questions about a new use of AI, then print a one-page brief for your board or executive team.' },
    { title: 'AI vendor questions', url: `${siteUrl}/vendor-questions`, label: 'Open the vendor questions',
      text: 'Send a vendor 25 questions before you buy or renew an AI tool, record each answer and your decision, then print the record.' },
  ];
  const newBrowser = 'The links work on any device. In a new browser, we’ll ask for your email address before they open.';
  const typed = 'What you type into the incident plan, the AI rules, the AI brief and the vendor questions is saved only in the browser you type it in.';
  const ignore = 'If you didn’t ask for these, you can ignore this email.';
  const text = ['Here are the links you asked for.', '',
    ...resources.flatMap((r) => [r.title, r.text, r.url, '']),
    newBrowser, '', typed, '', ignore, '', emailFooterText].join('\n');
  const html = emailLayout({ title: 'Your DMS resources', preheader: 'The AI readiness scorecard, the guide for leaders and four pages to fill in and print.', body: `
    <tr><td class="email-padding" style="padding:32px 32px 8px;">
      <h1 class="email-title" style="margin:0 0 16px;font-size:30px;line-height:38px;font-weight:700;letter-spacing:-0.5px;">Your DMS resources</h1>
      <p style="${paragraph}">Here are the links you asked for.</p>
    </td></tr>
    ${resources.map((r) => `<tr><td class="email-padding" style="padding:24px 32px;border-top:1px solid #DBE1E8;">
      <h2 style="margin:0 0 10px;font-size:20px;font-weight:700;line-height:27px;">${h(r.title)}</h2>
      <p style="${paragraph}">${h(r.text)}</p>
      ${emailButton(r.url, r.label)}
    </td></tr>`).join('')}
    <tr><td class="email-padding" style="padding:24px 32px 16px;border-top:1px solid #DBE1E8;">
      <p style="${paragraph}font-size:14px;line-height:23px;">${h(newBrowser)}</p>
      <p style="${paragraph}font-size:14px;line-height:23px;">${h(typed)}</p>
      <p style="${paragraph}font-size:14px;line-height:23px;">${h(ignore)}</p>
    </td></tr>` });
  return { subject: 'Your links to the free DMS resources', text, html, attachments: [emailLogoAttachment()] };
}

/* The only way into /ops. */
export function staffLinkEmail({ url, minutes }) {
  const expiry = `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  const lines = [`Use this link to open the staff view. It works for ${expiry}.`,
    'If you didn’t ask for this link, you can ignore this email.'];
  const text = [lines[0], '', url, '', lines[1], '', emailFooterText].join('\n');
  const html = emailLayout({ title: 'Staff view link', preheader: `Open the DMS resources staff view. The link works for ${expiry}.`, body: `
    <tr><td class="email-padding" style="padding:32px;">
      <h1 class="email-title" style="margin:0 0 16px;font-size:30px;line-height:38px;font-weight:700;letter-spacing:-0.5px;">Staff view link</h1>
      <p style="${paragraph}">${escapeEmailHtml(lines[0])}</p>
      ${emailButton(url, 'Open the staff view')}
      <p style="${paragraph}margin-top:24px;font-size:14px;line-height:23px;">${escapeEmailHtml(lines[1])}</p>
    </td></tr>` });
  return { subject: 'Your link to the DMS resources staff view', text, html, attachments: [emailLogoAttachment()] };
}

/* To the staff addresses, at most once a day, when a daily limit has stopped
   emails. `reason` is 'all' (MAIL_DAILY_LIMIT) or 'links' (LINKS_DAILY_LIMIT). */
export function limitNoticeEmail({ reason, usage, siteUrl }) {
  const lines = reason === 'links'
    ? [`The DMS resources site has sent ${usage.links} links emails in the last 24 hours, which is its limit for that email (LINKS_DAILY_LIMIT is ${usage.linksLimit}).`,
      'Until some of those are more than 24 hours old, new visitors are not emailed the links. They can still open every resource, and scorecard reports are still emailed.']
    : [`The DMS resources site has sent ${usage.sent} emails in the last 24 hours, which is its limit (MAIL_DAILY_LIMIT is ${usage.limit}).`,
      'Until some of those are more than 24 hours old, it sends no links, reports or staff links. Visitors can still open every resource and download their scorecard reports.'];
  lines.push('If this was not a busy event day, the form may be receiving automated entries. The staff view lists every address entered.');
  const url = `${siteUrl}/ops`;
  const text = [...lines.flatMap((line) => [line, '']), url, '', emailFooterText].join('\n');
  const html = emailLayout({ title: 'Email limit reached', preheader: lines[0], body: `
    <tr><td class="email-padding" style="padding:32px;">
      <h1 class="email-title" style="margin:0 0 16px;font-size:30px;line-height:38px;font-weight:700;letter-spacing:-0.5px;">Email limit reached</h1>
      ${lines.map((line) => `<p style="${paragraph}">${escapeEmailHtml(line)}</p>`).join('')}
      ${emailButton(url, 'Open the staff view')}
    </td></tr>` });
  return { subject: 'DMS resources has reached an email limit', text, html, attachments: [emailLogoAttachment()] };
}
