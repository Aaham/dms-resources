/* Renders pages/guide.html to resources/dms-guide-for-leaders.pdf.

   Run `npm run build:guide-pdf` after any change to pages/guide.html or
   public/guide.css, then commit the PDF. The server sends that file as it is,
   so a deploy does not need a browser.

   Needs a Chromium that Playwright can find. If none is installed:
     npx playwright-core install chromium

   Links in the PDF that point at this site are written with GUIDE_PUBLIC_URL
   (default https://resources.strategydms.com), not the local address the page
   is rendered from. */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'resources', 'dms-guide-for-leaders.pdf');
const publicUrl = (process.env.GUIDE_PUBLIC_URL || 'https://resources.strategydms.com').replace(/\/+$/, '');

const app = express();
app.get('/guide', (_req, res) => res.sendFile(path.join(root, 'pages', 'guide.html')));
// The page's script only shows the visitor's address in the footer, which the PDF leaves out.
app.get('/static/guide.js', (_req, res) => res.type('text/javascript').send(''));
app.use('/static', express.static(path.join(root, 'public')));
const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/guide`, { waitUntil: 'networkidle' });
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(async (origin) => {
    for (const link of document.querySelectorAll('a[href^="/"]')) link.setAttribute('href', origin + link.getAttribute('href'));
    await document.fonts.ready;
  }, publicUrl);
  await page.pdf({ path: output, preferCSSPageSize: true, printBackground: true, tagged: true });
} finally {
  await browser.close();
  server.close();
}

console.log(`Wrote ${path.relative(root, output)}`);
