# DMS resources

The site for `resources.strategydms.com`. People reach it from a QR code on a flyer at a
seminar or conference, enter their email address, and get six free resources:

- **AI readiness scorecard.** The 20-statement scorecard from the webinar project, adapted
  so anyone can use it.
- **Cybersecurity and AI governance: a guide for leaders.** A short guide, as a web page
  and an 8-page PDF.
- **One-page incident plan.** A form for who decides and who to call during an incident.
  It produces one page to print.
- **AI rules for staff.** A form for the approved AI tools and the information that stays
  out of them. It produces a one-page handout.
- **Board and executive AI brief.** Seven questions about one proposed use of AI. It
  produces a one-page brief for the board or executive team.
- **AI vendor questions.** Twenty-five questions to send a vendor, with space for each
  answer and the decision. It produces a three-page record.

It is a separate project from `dms-webinar`. It shares that project's look, scorecard
content and Brevo account, and none of its routes, data or Stripe code.

```
server.js              boot: loads data, starts the server, prints what is configured
src/                   the server
  app.js               page routes, security headers, public files
  api.js               /api: the email form, scorecard, staff view
  access.js            the cookie, the links sent by email, staff access
  visitors.js          who has entered an address (DATA_DIR/visitors.jsonl)
  email-check.js       asks DNS whether an address's domain takes mail
  mail-log.js          every email sent (DATA_DIR/mail.jsonl) and the per-address limits
  scorecard-*.js       statements and scoring, saved reports, report text/CSV/email
  mailer.js            Brevo SMTP
pages/                 the HTML pages, sent only by the routes in app.js
public/                styles, scripts, fonts and logos, served to anyone under /static/
resources/             the guide PDF and the logo used in emails
scripts/               builds the guide PDF
test/                  automated tests
```

## Run it locally

```bash
nvm use            # Node 22.23.4
npm ci
npm start          # http://localhost:1026
```

`.env` already exists in this checkout with the Brevo values and staff addresses copied
from `dms-webinar/server/.env` and its own `SESSION_SECRET`. On another machine, copy
`.env.example` to `.env` and fill it in.

With the Brevo values set, entering an address locally sends a real email. Set
`SMTP_DEV_LOG=1` to print each email's recipient and subject to the server console and
send nothing.

```bash
npm test           # 41 tests; no network, no email, no port
```

## There are no accounts

A visitor enters an email address and the resources open at once. Nobody creates an
account, sets a password, confirms anything or waits for an email. Keep it that way in
new pages and emails: nothing a visitor reads says "sign in", "sign out", "log in",
"register" or "account", and a test fails if one of those appears.

The first version emailed a six-digit code and made the visitor type it in. That was
removed for three reasons:

- The owner asked for the page to work like any "enter your email for the free
  resource" page, without the feel of an account.
- The GOV.UK Design System calls email confirmation loops "disruptive", says to avoid
  them where possible, and lists slow and spam-filtered confirmation emails among their
  common problems. A visitor at a conference would have been locked out by one late
  email.
- Nielsen Norman Group's guidance on walls is that they cost effort before people can
  judge what they will get, so a page should show real content first and ask for as
  little as possible.

Sources read on November 18, 2026:
[GOV.UK, Ask users for email addresses](https://design-system.service.gov.uk/patterns/email-addresses/),
[GOV.UK, Confirm an email address](https://design-system.service.gov.uk/patterns/confirm-an-email-address/),
[NN/g, The Reciprocity Principle](https://www.nngroup.com/articles/reciprocity-principle/),
[NN/g, Login Walls Stop Users in Their Tracks](https://www.nngroup.com/articles/login-walls/),
[NN/g, Better Link Labels](https://www.nngroup.com/articles/better-link-labels/). These
are guidance and usability findings from other sites. Nobody has tested this page with
visitors.

What the email form page does because of them:

| Practice | On the page |
| --- | --- |
| Ask for as little as possible | One field. No name, no organization, no second "confirm your email" field. |
| Show real content before asking | One scorecard statement, two of the guide's steps, two of the incident plan's steps and two of the AI rules, word for word, under the form. |
| Say what happens to the address | "All six open as soon as you enter your address. We'll also email you the links." and "DMS keeps a record of your email address." |
| Label the button with what it does | "Get the free resources" |
| Warn about a likely typo, and let the visitor keep what they typed | "Did you mean name@gmail.com?" for a misspelled provider or ending such as `.con` |
| Show the address back so it can be corrected | The scorecard's last step shows where the report will go, with "Change this address". Every page's footer shows the address. |

### What the trade is

Addresses are recorded as typed. Nothing proves the person can read that inbox, so a
few will be wrong or made up. Three things limit that:

- The server asks DNS whether the address's domain exists and takes mail, and refuses
  one that does not. It cannot tell whether the mailbox exists.
- The scorecard report goes to the address, so a visitor who wants their report has a
  reason to give a real one.
- Brevo's log shows which messages bounced.

### What keeps one visitor's scorecard from another

A saved scorecard belongs to a visit: a random id held in the browser's cookie. It does
not belong to an email address. Typing someone else's address starts a new visit and
shows nothing of theirs.

The report email has an **Open your scorecard** link that carries that visit's id,
signed. The person who receives the report can open their scorecard with it on any
device for 90 days (`REMEMBER_DAYS`).

The cookie also lasts 90 days. **Use a different email**, in the footer of each page,
clears it.

### Limits

| Rule | Value |
| --- | --- |
| Addresses entered per IP address | 60 every 15 minutes (`ACCESS_REQUESTS_PER_IP`) |
| Links emails caused from one IP address | The same number a day |
| Links email, per address | One a day, five ever |
| Report email, per address | One a day, five ever |
| Staff link, per address | One every two minutes, six a day |
| Links emails, whole site | 150 in any 24 hours (`LINKS_DAILY_LIMIT`) |
| All email, whole site | 250 in any 24 hours (`MAIL_DAILY_LIMIT`) |

The per-IP limit is higher than usual for a form because people in one room on the
venue's Wi-Fi share an address. Raise it before a large event.

Past a limit, nothing is taken away from the visitor except the email. The resources
still open. A report past its limit is saved and can be downloaded, and the scorecard
says before the visitor submits that it will not be emailed.

`UNLIMITED_EMAILS` lists addresses that the three per-address rows do not apply to, so
the owner can test without waiting a day. The whole-site rows still apply. Anyone who
enters a listed address can have it emailed without those limits, so list only
addresses whose owners asked for it. In this checkout it is set in `.env`.

## Automated entries

Entering an address sends the links email, and nothing else on the site sends email so
cheaply. A program that entered thousands of addresses would use up the Brevo allowance
and send DMS mail to strangers. Brevo's help centre says an account whose form is
attacked by bots can be suspended. Spamhaus, writing about this kind of abuse, puts the
duty on "everyone that has any sort of web-based signup that results in an email being
sent".

The usual answer is a CAPTCHA. The owner asked for protection that asks nothing of a
real visitor, so the site uses checks a person never sees, and the limits above as the
backstop.

| Check | What it stops | What a visitor notices |
| --- | --- | --- |
| The form posts JSON from a script; there is no HTML form to submit | Generic form-spam crawlers | Nothing |
| A form token: the page fetches one when it loads, the server accepts it once and only 1.5 seconds or more after issuing it, for two hours | Programs posting straight to the API, replays, instant submissions | Nothing. The page waits out the 1.5 seconds if needed and renews an expired token by itself. |
| A hidden field | Programs that fill every field | Nothing. It is not displayed, not in the tab order, and hidden from screen readers. |
| The browser's `Sec-Fetch-Site` header must say the request came from this site, when the browser sends it | Requests fired from other websites | Nothing. Older browsers, such as Safari before 16.4, do not send it and are let through. |
| The address's domain must exist and take mail | Random strings after the @ | An error only if the domain is wrong |
| The limits in the table above | Whatever gets past the rest | Nothing, until a limit is reached |

Refused entries are logged with the reason, and the staff view counts them.

**What this does not stop.** Someone who writes a program for this site can fetch a
token, wait and post like the page does. They are held to the limits: 60 links emails a
day from one IP address, 150 a day in all, one a day and five ever to any one address.
OWASP's cheat sheet on credential stuffing covers the same defenses and says as much:
CAPTCHAs "are not perfect", and proxy networks "may defeat both IP block-lists and rate
limiting".

**If it happens.** When a daily limit stops emails, the site emails the staff addresses
once that day, and the staff view shows "Emails sent, last 24 hours". The next step
would be Cloudflare Turnstile in its invisible mode, which checks the browser without
showing the visitor anything. It was left out because it loads a script from Cloudflare,
and this site loads nothing from anywhere else.

Sources read on November 18, 2026:
[Spamhaus, Subscription bombing](https://www.spamhaus.org/news/article/734/subscription-bombing-coi-captcha-and-the-next-generation-of-mail-bombs),
[OWASP, Credential Stuffing Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Credential_Stuffing_Prevention_Cheat_Sheet.html),
[WebAIM, Spam-free accessible forms](https://webaim.org/blog/spam_free_accessible_forms/),
[web.dev, Fetch Metadata](https://web.dev/articles/fetch-metadata),
[Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/). Brevo's article,
[Protect your forms from bots and spam signups](https://help.brevo.com/hc/en-us/articles/19591451188114),
refused an automated read; the sentence above is from a search result's summary of it.

## Links for flyers and QR codes

| Link | Opens |
| --- | --- |
| `https://resources.strategydms.com` | The email form, then the list of resources |
| `https://resources.strategydms.com/scorecard` | The email form, then the scorecard |
| `https://resources.strategydms.com/guide` | The email form, then the guide |

Add `?event=` and a short tag to record which flyer or session a visitor came from:

```
https://resources.strategydms.com/?event=njsba-nov-2026
https://resources.strategydms.com/guide?event=chamber-breakfast
```

A tag may use lowercase letters, digits and hyphens, up to 40 characters. It appears in
the Event column of the staff view and the CSV. A tag in any other form is ignored and
the resources open as usual.

## AI readiness scorecard

`src/scorecard-content.js` is a copy of `dms-webinar/server/src/readiness-content.js`. It
is Tool 1 of Javed Sajad's DMS Nonprofit Safe AI Toolkit: 20 statements in five areas,
each scored 0, 1 or 2, with four score bands (0–10 Unmapped, 11–20 Experimental, 21–30
Controlled, 31–40 Governed).

The statements, the scale, the bands, the management actions and the discussion prompts
are the author's wording and stay exactly as written, including British spellings. A
test compares them against a hash and fails on any edit. The short next-step actions and
the list of "critical" statements are the web report's additions, as they were in the
webinar project.

What changed from the webinar version:

- Anyone can use it. The webinar version checked for a paid registration and an emailed
  code.
- A draft is kept in the browser's local storage, so it survives closing the tab. It is
  removed when the scorecard is submitted and when the visitor chooses **Use a different
  email**. The webinar version kept it for the tab only.
- The toolkit download is gone from the results page, which now links to the guide.

Submitting saves the report, then emails it with CSV and text attachments. If the email
fails, the report is still saved, and the results page says so and offers another try
after a minute. The visitor can print the results and download CSV or text.

## Guide for leaders

The text is in `pages/guide.html`: nine cybersecurity steps, nine AI governance steps,
six questions for an IT provider, six for an AI vendor, a reading list and the three DMS
tools. The reading list links were checked on November 18, 2026.

The PDF at `resources/dms-guide-for-leaders.pdf` is that same page printed by headless
Chromium with the print styles in `public/guide.css`: half-letter pages with a cover.
After changing the guide's text or styles, rebuild the PDF and commit it:

```bash
npm run build:guide-pdf
```

The script needs a Chromium that Playwright can find
(`npx playwright-core install chromium` if there is none). The server sends the committed
file, so a deploy does not need a browser. The cover date and the "Updated" line in the
page are plain text in `pages/guide.html`.

Two of the steps and the page count appear on the email form page and the resource list.
Tests fail if a sample no longer matches the guide or the PDF is no longer 8 pages.

Two steps link to the fill-in pages: "Write a one-page incident plan" to `/incident-plan`
and "Write the rules down and train staff on them" to `/ai-rules`. The note under the six
questions for an AI vendor links to `/vendor-questions`, which has all 25. In the PDF each
link is followed by its address in print.

## Incident plan and AI rules for staff

`/incident-plan` and `/ai-rules` work the same way. Each is a form and, beside it (below
it on a phone), the page the form produces. The visitor prints the page or copies it as
text.

- **The text.** The steps and rules are in `pages/incident-plan.html` and
  `pages/ai-rules.html`, inside `<article id="sheet">`. The incident plan follows the
  guide's ninth cybersecurity step. The AI rules follow the guide's AI governance steps
  on approved tools, information, checking output and decisions about people.
- **How a field reaches the page.** A form control named `lead` fills every element in
  the page marked `data-show="lead"`. `public/sheet.js` does this for every fill-in page.
  `public/ai-rules.js` adds the list of tools and the list of information.
- **Blank lines.** A line with nothing typed for it prints as a rule to write on, so a
  half-filled page is still usable. Under the buttons the page says which lines are
  blank.
- **Nothing typed is sent.** It is saved in the browser's `localStorage`, under a key
  that includes the email address, and removed by "Clear the form" and by "Use a
  different email". No route receives it and the staff view cannot show it. Both pages
  say "What you type is saved in this browser. It is not sent to DMS." A test fails if
  either script makes a request.
- **One sheet of paper.** With ordinary names and numbers the incident plan and the AI
  rules (up to eight tools) each print on one Letter or A4 page. Very long entries run
  onto a second page. This was checked in headless Chromium on November 18, 2026; no
  automated test covers it.

The incident plan's steps come from published guidance:

| Step | Source |
| --- | --- |
| Disconnect affected computers and leave them switched on | CISA #StopRansomware Guide, response checklist: isolate affected systems, and power down only if they cannot be disconnected, because that loses evidence held in memory |
| Call the bank, then report at ic3.gov | FBI and IC3 notices on business email compromise: contact the bank at once, ask it to recall the funds, and file a complaint with IC3 |
| Don't discuss the incident by email | CISA #StopRansomware Guide: use phone calls or another channel the attacker cannot read |
| Ask the lawyer about notification | Every U.S. state has a breach notification law, with different deadlines; the page asks the question and gives no deadline |
| Call the insurer first | Cyber policies commonly require prompt notice and the insurer's consent before costs are incurred; the page says "many policies", because terms differ |

The first three rows were checked against the CISA guide and the FBI notices on November
18, 2026. The last two describe general practice and were not checked against a source
that day. Someone at DMS who handles incidents should read the nine steps before the
page is promoted.

## Board and executive AI brief and AI vendor questions

`/ai-brief` and `/vendor-questions` are Tools 3 and 4 of Javed Sajad's DMS Nonprofit Safe
AI Toolkit, the toolkit the scorecard comes from. The owner supplied them as fillable PDFs
on November 18, 2026 and asked for them to be made more sensible, restyled and added.
Unlike the scorecard, their wording is not the author's word for word. Each page says
"Adapted from the DMS Nonprofit Safe AI Toolkit by Javed Sajad", and the author should
read both before they are promoted. The original wording is in
`dms-webinar/server/resources/dms-nonprofit-safe-ai-toolkit.docx`.

Both are fill-in pages and work as described above: `public/sheet.js`, nothing typed is
sent, blank lines print as rules. Two things are new in `sheet.js` for them. A choice
(radio buttons or a select) fills an element marked `data-choice`, which shows the option
chosen, or every option with an empty box when none is chosen so it can be ticked on
paper. A page can also supply its own status line.

### What changed from the toolkit

Board and executive AI brief:

- The toolkit had a list of seven questions and a separate memo of 14 fields that did
  not line up with them. The fields now sit under the question each one answers, so the
  printed brief reads as seven questions with their answers, then the decision.
- "Training and change plan" has no question of its own. It is under the decision, as
  "How staff will be trained before they use it".
- The decision "Proceed with controls" reads "Proceed with conditions", and the conditions
  have a field.
- "Data classification" is a choice of the toolkit's five data zones (Tool 2), with the
  toolkit's description of each. "Use one card per workflow" from Tool 2 is the hint
  under the proposed use.
- "Attach the use-case card" is gone, because Tool 2 is not on this site. The vendor
  question links to `/vendor-questions`.

AI vendor questions:

- Every question in the toolkit had a "Yes / No / Partial" response, including questions
  such as "How long are prompts, files, outputs, logs and backups retained?" that those
  words cannot answer. Each question now has a box for the vendor's answer and where it
  is written, and a view of it: Acceptable, Needs a change, No answer or Doesn't apply.
  The record lists the question numbers marked "Needs a change" and "No answer" under the
  decision.
- The questions are addressed to the vendor in plain words ("subprocessors" is "other
  companies that receive our information"), so they can be sent as they are. **Copy the
  questions** copies all 25 with a note asking where each answer is written.
- There are 25 questions where the toolkit had 24. Toolkit questions 12 (vulnerabilities,
  model changes and security updates) and 15 (notice of a subprocessor or location
  change) are covered by the questions on the independent security report and on notice
  of changes. Three were added: how the product was tested for accuracy and bias, which
  of the vendor's staff can read what is entered, and whether the vendor will sign an
  agreement a law, grant or contract requires.
- The data zones are a choice, as in the brief. The decision labels are the toolkit's:
  Approve, Approve with conditions, Pilot only, Reject.
- Spelling is American, as on the rest of this site.

The line "Use this tool with at least two functions represented" is left out of both.
"Do not enter client, beneficiary, employee, donor or other confidential information" is
kept where it applies, as the hints "Don't type the information itself" and "Name groups,
not individuals" in the brief. "Educational material, not legal advice" is in the footer
of each printed page.

### What the added vendor questions rest on

| Question | Source |
| --- | --- |
| How the product was tested for accuracy and bias | "Sample Questions for Potential Artificial Intelligence Partners and Vendors" (National Intellectual Property Rights Coordination Center and Michigan State University): how the vendor keeps output from being biased, and by what standard it evaluates output |
| Which of the vendor's staff can read what is entered | The same document: who has access to stored user input, and how they are vetted |
| Signing an agreement a law, grant or contract requires | HHS guidance on HIPAA and cloud computing: a covered entity needs a business associate agreement with a cloud provider that handles electronic health information for it |

The first two rows were read in the source on November 18, 2026. The HHS guidance was
checked only through a search result that quoted it, not on hhs.gov. The other 22
questions restate the toolkit's. The brief's questions are the toolkit's seven. Two
outside sources agree with them. The UK Charity Commission's post of April 2, 2024,
read that day, says trustees remain responsible for decisions and must not delegate
them to AI. MANAGE 2.4 in the NIST AI Risk Management Framework assigns responsibility
for superseding, disengaging or deactivating an AI system, which is the brief's question
on who can stop a use; that was checked in a secondary summary, not in the NIST text.

### Printing

Checked in headless Chromium on November 18, 2026; no automated test covers it. The
brief prints on one Letter or A4 page when blank and when filled with a few sentences
per answer, and on two when every field is filled to its limit. The vendor record
prints on three pages, blank or with a sentence or two per answer, and on four when
every answer is filled to its limit.

### AI use-case triage

Both pages end with the toolkit's "20-minute DMS AI Use-Case Triage", in the toolkit's
words, with a button that starts an email to info@strategydms.com. The site does not
say whether the triage is free, because the toolkit does not.

## What follows each resource

Each resource ends with the DMS tool that follows from it, under "More from DMS":

| Resource | First item | Then |
| --- | --- | --- |
| Scorecard results | AI governance assessment (airmf.strategydms.com) | Board and executive AI brief, AI rules for staff, the guide |
| Incident plan | Cybersecurity governance assessment (cybergovernance.strategydms.com) | Security awareness training (awareness.strategydms.com) |
| AI rules for staff | AI governance assessment | AI readiness scorecard |
| Board and executive AI brief | AI use-case triage (by email) | AI governance assessment, AI vendor questions |
| AI vendor questions | AI use-case triage (by email) | AI governance assessment, Board and executive AI brief |
| Guide | A link from each of two steps to the fill-in page for it, and from the questions for an AI vendor to the full list | The scorecard and the three DMS tools at the end |

The descriptions of the three DMS tools use the wording in the guide's "DMS tools" list.
The site does not record who follows a link to one of them.

## Staff view at `/ops`

The staff view lists every address entered, with first and last visit, event tags and
the latest scorecard score. **View report** opens the latest scorecard submitted from
an address, with the answers and notes. **Download CSV** exports the list.

Anyone can type a staff address into the form, so that alone opens nothing. To open the
staff view:

1. Enter an address from `OPS_EMAILS` on the site, then go to `/ops`.
2. Choose **Email me the link**. The link works for 15 minutes (`OPS_LINK_MINUTES`).
3. Open the link. `/ops` stays open in that browser for 12 hours (`OPS_SESSION_HOURS`).

Removing an address from `OPS_EMAILS` closes `/ops` for that person at their next
request. Other visitors who try `/ops` get the "Page not found" page.

Links in emails can be opened more than once until they expire. Mail security scanners
fetch the links in incoming email before the reader does, and a single-use link would
already be spent.

## Email

All four messages go through the Brevo SMTP account that the webinar and training
projects use (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`). The
sender is `DMS <noreply@send.strategydms.com>` and replies go to `info@strategydms.com`.

- **Links.** "Your links to the free DMS resources", with a link to each of the six,
  sent when an address is entered. The links are plain, so a colleague who is forwarded the email is asked for
  their own address.
- **Scorecard report.** The score, scores by area, critical gaps and next steps, with the
  report attached as CSV and text and the link that reopens the scorecard.
- **Staff view link.**
- **Limit notice.** To the staff addresses, once a day at most, when a daily limit has
  stopped emails.

The resources open whether or not the links email is sent. When it fails, the next page
says so.

At boot the server signs in to Brevo and logs `SMTP OK` or `SMTP NOT WORKING`. The
credentials were accepted on November 18, 2026. No real email has been sent from this
project yet.

**Check the Brevo plan's daily limit before an event.** Each visitor uses one email for
the links and one more if they finish the scorecard. The training project's notes record
a 300-a-day ceiling on this account, shared by every DMS project that sends through it.
`MAIL_DAILY_LIMIT` (250) stops this site before that point, and `LINKS_DAILY_LIMIT`
(150) keeps links emails from using all of it. Both are counted from the record on
disk, so a restart does not reset them. If the plan allows more, raise both.

## Data

Everything is under `DATA_DIR`:

| File | Contents |
| --- | --- |
| `visitors.jsonl` | One line per visit or address correction |
| `scorecards/<visit id>.json` | The latest scorecard submitted from that visit |
| `mail.jsonl` | One line per email sent: kind, address and time |

All three hold visitor details and are gitignored. Back them up together. The email
limits are counted from `mail.jsonl`, and cookies and links are signed, so all of them
survive a restart. Used form tokens, the per-IP counts and the count of refused entries
are in memory and start again.

The server is written for one running copy. Two copies would not share the visitor
list; that would need a database.

## What the pages tell visitors about their data

- Email form: "DMS keeps a record of your email address", with a link to the privacy
  policy on strategydms.com. True because of `visitors.jsonl`.
- Scorecard, before submitting: "DMS can view your answers and notes. We'll email your
  report to [address]." True because of the staff view and the report email.
- The four fill-in pages: "What you type is saved in this browser. It is not sent to
  DMS." True because the pages keep it in `localStorage` and make no request with it.
  The links email adds that it is saved only in the browser it was typed in, because a
  visitor who opens the link on another device finds the form empty.

The site does not say whether DMS will contact visitors afterwards, and it does not add
anyone to a mailing list. If DMS plans follow-up email, say so under the email field.

## Deploying

The server is one Node process: `npm ci`, then `npm start`. The webinar runs on Railway
and the same setup works here. Set these variables on the service:

| Variable | Value |
| --- | --- |
| `PUBLIC_URL` | `https://resources.strategydms.com` |
| `TRUST_PROXY` | `1` |
| `DATA_DIR` | The mount path of a persistent volume, for example `/data` |
| `SESSION_SECRET` | A new random value (command in `.env.example`) |
| `SMTP_*` | The Brevo values from `.env` |
| `OPS_EMAILS` | The staff addresses |
| `UNLIMITED_EMAILS` | Optional. Addresses exempt from the per-address email limits, for testing. |

Without a volume, the visitor list, every saved scorecard and the email record are erased
on each deploy, which also resets the five-ever limits.
Without `TRUST_PROXY=1`, every visitor shares one rate limit. With an `https`
`PUBLIC_URL` the cookie is marked Secure.

Then point `resources.strategydms.com` at the service and open `/api/health`, which
lists anything still missing.

## The look

The site uses the style of the DMS webinar site: navy on white, square corners, full-width
rules and no shadows. Three pieces come from that site and are defined together at the end
of `public/styles.css`:

- the bar of facts under the email form (`.specs`), with one cell for each resource;
- the navy band that holds white cards (`.band`), used for "What you get", the resource
  list and "More from DMS";
- the label with a square mark above a heading (`.eyebrow`).

The page for one resource opens on a navy cover, like the cover of the guide PDF. The label
on the cover is the figure the bar of facts and the resource list give for that resource,
such as "25 questions". The print styles leave the covers and bands out.

## Adding a resource

1. Put the page in `pages/` and its styles and script in `public/`.
2. Add a route in `src/app.js` with `requireAddress`, and add its path to `NEXT_PATHS`
   there and to the list at the top of `public/entry.js`, so a direct link returns to it
   once an address is entered.
3. Add it to the bar of facts and to "What you get" in `pages/entry.html`, with a sample
   of its real content, and to the list in `pages/resources.html` with the same label.
4. Add a link to it in `resourcesEmail` in `src/email-layout.js`, and update the count in
   "All six open as soon as you enter your address" on the form.
5. End it with a "More from DMS" section naming the DMS tool that follows from it, and
   add it to the table under "What follows each resource" above.

A page that is a form producing a printed page can reuse `public/sheet.js` and
`public/sheet.css`; add its name to `SHEETS` in `public/common.js` so "Use a different
email" clears it.

Pages may not use inline styles or inline scripts; the Content-Security-Policy blocks
both and a test checks for them.

## Browser caching

Pages are never cached. Scripts and styles under `/static/` are sent with
`Cache-Control: no-cache`: the browser asks on every page load whether its copy is
current and downloads the file again only if it changed. Fonts and logos under
`/static/assets/` may be kept for a week.

Do not give scripts a cache lifetime. On November 18, 2026 they had one hour, the form
began to require a token, and a browser that still held the earlier script was refused
with "We couldn't open the resources." A normal reload did not fix it, because a reload
does not re-download a script the browser believes is still fresh.

After changing anything in `src/`, restart the server. It reads pages and public files
from disk on each request, and its own code only at start.
