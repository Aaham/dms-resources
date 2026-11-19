import { $, api, message, busyButton, loadVisit } from './common.js';

const visit = await loadVisit();

$('send-link').addEventListener('click', async (event) => {
  message('link-message');
  try {
    const sent = await busyButton(event.currentTarget, 'Sending…', () => api('/ops/link', { method: 'POST' }));
    message('link-message', `We emailed the link to ${visit.email}. It works for ${sent.minutes} minutes, on any device.`);
  } catch (err) { message('link-message', err.message, true); }
});
