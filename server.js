/* DMS resources: boot. The app itself is in src/app.js. */

import fs from 'node:fs';
import { env, readiness } from './src/env.js';
import { createApp, GUIDE_PDF } from './src/app.js';
import { initVisitors } from './src/visitors.js';
import { initMailer, verifyMailer } from './src/mailer.js';
import { initMailLog } from './src/mail-log.js';

const loaded = initVisitors();
const mailLog = initMailLog();
const mail = initMailer();
const status = readiness();
const app = createApp();

app.listen(env.server.port, () => {
  const line = '─'.repeat(64);
  console.log(`\n${line}`);
  console.log(`  DMS resources  ·  http://localhost:${env.server.port}  ·  public URL ${env.urls.public}`);
  console.log(`  ${loaded.visitors} visitor(s) on file in ${env.server.dataDir}`);
  console.log(`  Email: ${mail.mode}; ${mailLog.sentInLastDay} sent in the last 24 hours` +
    `${env.mail.dailyLimit ? ` of ${env.mail.dailyLimit} allowed` : ''}` +
    `${env.mail.linksDailyLimit ? `, links emails capped at ${env.mail.linksDailyLimit}` : ''}`);
  console.log(`  A browser stays open for ${env.access.days} day(s) after an address is entered`);
  console.log(env.ops.emails.length
    ? `  /ops: on, ${env.ops.emails.length} staff address(es), by emailed link`
    : '  /ops: off (OPS_EMAILS is empty)');
  if (!fs.existsSync(GUIDE_PDF)) console.log('  ! The guide PDF is missing. Run `npm run build:guide-pdf`.');
  console.log(line);
  if (status.problems.length) {
    console.log('  NOBODY CAN OPEN THE RESOURCES YET:');
    status.problems.forEach((p) => console.log(`    · ${p}`));
  } else {
    console.log('  Ready.');
  }
  status.warnings.forEach((w) => console.log(`  ! ${w}`));
  console.log(`${line}\n`);

  /* After listen(), so a slow or unreachable Brevo delays this line and not the
     boot. A refused password otherwise shows up only as emails that never
     arrive. */
  if (mail.mode === 'smtp') {
    verifyMailer()
      .then(() => console.log('  SMTP OK: Brevo accepted the credentials.'))
      .catch((err) => console.error(`  SMTP NOT WORKING: ${err.message}\n  No links or reports will be emailed until this is fixed.`));
  }
});
