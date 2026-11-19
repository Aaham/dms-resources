import { $, api, message, busyButton, rememberArrival } from './common.js';

const query = new URLSearchParams(window.location.search);
// The server checks both again; these only decide what to send and where to go.
const next = ['/scorecard', '/guide', '/incident-plan', '/ai-rules', '/ai-brief', '/vendor-questions', '/ops'].includes(query.get('next')) ? query.get('next') : '/';
const event = /^[a-z0-9][a-z0-9-]{0,39}$/.test((query.get('event') || '').toLowerCase()) ? query.get('event').toLowerCase() : '';

/* --------------------------------------------------------------------------
   Likely typos. Nothing confirms an address before the resources open, so a
   slip here would send the scorecard report to the wrong place. The visitor
   is asked once and can keep what they typed.
   -------------------------------------------------------------------------- */

const PROVIDERS = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'aol.com'];
// Real domains that sit one keystroke from a provider above.
const REAL = new Set([...PROVIDERS, 'googlemail.com', 'ymail.com', 'mail.com', 'email.com', 'live.com', 'msn.com',
  'me.com', 'mac.com', 'gmx.com', 'aon.com', 'cloud.com', 'grail.com']);
const ENDINGS = { con: 'com', cmo: 'com', ocm: 'com', comm: 'com', coom: 'com', ogr: 'org', rog: 'org', nte: 'net', ent: 'net' };

// True when one inserted, deleted, replaced or swapped character turns a into b.
function oneSlipApart(a, b) {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  const restA = a.slice(i);
  const restB = b.slice(i);
  if (a.length === b.length) {
    return restA.slice(1) === restB.slice(1) || (restA[0] === restB[1] && restA[1] === restB[0] && restA.slice(2) === restB.slice(2));
  }
  return a.length > b.length ? restA.slice(1) === restB : restA === restB.slice(1);
}

function suggestion(email) {
  const at = email.lastIndexOf('@');
  if (at < 1) return '';
  const name = email.slice(0, at);
  const domain = email.slice(at + 1).toLowerCase();
  if (REAL.has(domain)) return '';
  const dot = domain.lastIndexOf('.');
  const ending = ENDINGS[domain.slice(dot + 1)];
  const fixed = ending && dot > 0 ? `${domain.slice(0, dot)}.${ending}` : domain;
  const provider = PROVIDERS.find((p) => p === fixed || oneSlipApart(fixed, p));
  const better = provider || fixed;
  return better === domain ? '' : `${name}@${better}`;
}

/* --------------------------------------------------------------------------
   The form
   -------------------------------------------------------------------------- */

let kept = ''; // an address the visitor has confirmed as typed

/* The server accepts an address only with a token it issued a moment earlier.
   The token is asked for as the page loads, so it is ready before anyone has
   finished typing, and nobody waits for it. */
let form = null; // { token, readyAt }
async function fetchToken() {
  const { token, waitMs } = await api('/form-token');
  form = { token, readyAt: Date.now() + waitMs + 100 };
}
fetchToken().catch(() => { /* Asked for again when the form is sent. */ });

async function enter(email) {
  if (!form) await fetchToken();
  const wait = form.readyAt - Date.now();
  if (wait > 0) await new Promise((resolve) => { setTimeout(resolve, wait); });
  return api('/access', { method: 'POST', body: { email, event, token: form.token, hp: $('hp-field').value } });
}

async function send(email) {
  $('typo').hidden = true;
  $('get-resources').hidden = false;
  message('form-message');
  try {
    await busyButton($('get-resources'), 'Opening…', async () => {
      let result;
      try { result = await enter(email); }
      catch (err) {
        if (err.code !== 'token') throw err;
        form = null;   // the page sat open past the token's two hours: get a new one and send again
        result = await enter(email);
      }
      rememberArrival(result);
      window.location.replace(next);
    });
  } catch (err) {
    message('form-message', err.message, true);
    $('email').focus();
  }
}

$('email-form').addEventListener('submit', (submit) => {
  submit.preventDefault();
  const email = $('email').value.trim();
  if (!email) {
    message('form-message', 'Enter your email address.', true);
    $('email').focus();
    return;
  }
  const better = email === kept ? '' : suggestion(email);
  if (!better) { send(email); return; }
  message('form-message');
  $('typo-question').textContent = `Did you mean ${better}?`;
  $('typo-yes').textContent = `Yes, use ${better}`;
  $('typo-yes').dataset.email = better;
  $('typo-no').textContent = `No, ${email} is correct`;
  $('typo').hidden = false;
  $('get-resources').hidden = true;
  $('typo-yes').focus();
});

$('typo-yes').addEventListener('click', () => {
  $('email').value = $('typo-yes').dataset.email;
  send($('email').value);
});
$('typo-no').addEventListener('click', () => {
  kept = $('email').value.trim();
  send(kept);
});
$('email').addEventListener('input', () => { $('typo').hidden = true; $('get-resources').hidden = false; });

if (query.get('link') === 'expired') message('form-message', 'That link has expired. Enter your email address to open the resources.');
