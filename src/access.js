/* =============================================================================
   Access by email address
   -----------------------------------------------------------------------------
   Entering an email address opens the resources in that browser straight away.
   Nothing is confirmed first and there is no account. The address is where the
   links and the scorecard report are sent, and it is what DMS records.

   The cookie holds two things, signed so they cannot be altered:

     email  the address this browser gave
     vid    a random id for this visit

   A saved scorecard belongs to a vid, not to an address. Typing someone
   else's address therefore shows nothing of theirs: it starts a new visit. The
   report email carries a signed link to its own vid, so the person who
   receives the report can reopen that scorecard on any device.

   Staff are the exception. Anyone can type a staff address, so /ops opens only
   from a link emailed to an address in OPS_EMAILS, and only for
   OPS_SESSION_HOURS after that link was issued.

   Links are not single-use. Mail security scanners fetch the links in incoming
   email before the reader does, which would spend a one-time link.
   ============================================================================= */

import crypto from 'node:crypto';
import { env } from './env.js';

export const COOKIE_NAME = 'dms_resources';

const DAY_MS = 24 * 60 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const normalizeEmail = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');
export const validEmail = (email) => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
export const validVisitId = (value) => typeof value === 'string' && UUID.test(value);
export const newVisitId = () => crypto.randomUUID();

export function accessReady() {
  return env.access.secret.length >= 32;
}

/* --------------------------------------------------------------------------
   Signed values. `purpose` keeps a cookie from being accepted as a link and a
   link from being accepted as a cookie.
   -------------------------------------------------------------------------- */

const signature = (purpose, body) => crypto.createHmac('sha256', env.access.secret)
  .update(`dms-resources:v2:${purpose}:${body}`).digest('base64url');
const equal = (a, b) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

function seal(purpose, claims) {
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${body}.${signature(purpose, body)}`;
}

/* Returns the claims of an unexpired token, or null. The signature is checked
   before anything is parsed. */
function unseal(purpose, token) {
  if (!accessReady() || typeof token !== 'string' || token.length > 2048) return null;
  const [body, mac, extra] = token.split('.');
  if (!body || !mac || extra !== undefined || !equal(mac, signature(purpose, body))) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
    return Number.isFinite(claims.exp) && claims.exp > Date.now() ? claims : null;
  } catch { return null; }
}

/* A cookie or an emailed link names a visit and an address. */
function unsealVisit(purpose, token) {
  const claims = unseal(purpose, token);
  if (!claims) return null;
  const email = normalizeEmail(claims.email);
  return validVisitId(claims.vid) && validEmail(email) ? { ...claims, email } : null;
}

/* --------------------------------------------------------------------------
   The cookie
   -------------------------------------------------------------------------- */

export function issueCookie({ vid, email, opsAt }) {
  const now = Date.now();
  return seal('cookie', { vid, email, iat: now, exp: now + env.access.days * DAY_MS,
    ...(Number.isFinite(opsAt) ? { opsAt } : {}) });
}

/* Returns { vid, email, opsAt } or null. */
export function readCookie(token) {
  const claims = unsealVisit('cookie', token);
  return claims ? { vid: claims.vid, email: claims.email, opsAt: Number.isFinite(claims.opsAt) ? claims.opsAt : null } : null;
}

export function cookieFrom(req) {
  const part = (req.headers.cookie || '').split(';').find((c) => c.trim().startsWith(`${COOKIE_NAME}=`));
  try { return part ? decodeURIComponent(part.trim().slice(COOKIE_NAME.length + 1)) : null; }
  catch { return null; }
}

export function cookieOptions() {
  return { httpOnly: true, secure: env.urls.public.startsWith('https://'), sameSite: 'lax', path: '/',
    maxAge: env.access.days * DAY_MS };
}

export const visitFrom = (req) => readCookie(cookieFrom(req));

/* --------------------------------------------------------------------------
   The form token
   --------------------------------------------------------------------------
   The email form's script asks for one when the page loads and sends it back
   with the address. A program that posts addresses straight to the API has no
   token. One that fetches a token first must wait FORM_MIN_MS before using it,
   and can use it once. A person never notices: typing an address takes longer
   than the wait.
   -------------------------------------------------------------------------- */

export const FORM_MIN_MS = 1500;
const FORM_MAX_MS = 2 * 60 * 60_000;

export function issueFormToken() {
  const now = Date.now();
  return seal('form', { id: crypto.randomUUID(), iat: now, exp: now + FORM_MAX_MS });
}

/* Returns { id, iat, exp } or null. */
export function readFormToken(token) {
  const claims = unseal('form', token);
  return claims && validVisitId(claims.id) && Number.isFinite(claims.iat) ? { id: claims.id, iat: claims.iat, exp: claims.exp } : null;
}

/* --------------------------------------------------------------------------
   Links sent by email
   -------------------------------------------------------------------------- */

const linkUrl = (claims) => `${env.urls.public}/open/${seal('link', claims)}`;

/* In the report email: reopens that scorecard. Lasts as long as the cookie would. */
export function scorecardLink({ vid, email }) {
  return linkUrl({ kind: 'scorecard', vid, email, exp: Date.now() + env.access.days * DAY_MS });
}

/* Opens /ops. Short-lived, because it is the only thing protecting the visitor list. */
export function staffLink({ vid, email }) {
  const now = Date.now();
  return linkUrl({ kind: 'ops', vid, email, iat: now, exp: now + env.ops.linkMinutes * 60_000 });
}

/* Returns { kind, vid, email, iat } or null. */
export function readLink(token) {
  const claims = unsealVisit('link', token);
  if (!claims || !['scorecard', 'ops'].includes(claims.kind)) return null;
  return { kind: claims.kind, vid: claims.vid, email: claims.email, iat: Number.isFinite(claims.iat) ? claims.iat : null };
}

/* --------------------------------------------------------------------------
   Staff
   -------------------------------------------------------------------------- */

export const isStaff = (email) => env.ops.emails.includes(normalizeEmail(email));

/* 'none'  not a staff address
   'link'  a staff address that has not opened a staff link recently
   'open'  arrived through a staff link issued in the last OPS_SESSION_HOURS
   The list is checked on every request, so removing an address from OPS_EMAILS
   closes /ops for that person at their next request. */
export function staffAccess(visit) {
  if (!visit || !isStaff(visit.email)) return 'none';
  return visit.opsAt && Date.now() - visit.opsAt < env.ops.sessionHours * 60 * 60_000 ? 'open' : 'link';
}

/* --------------------------------------------------------------------------
   Route guards for the API
   -------------------------------------------------------------------------- */

export function requireVisit(req, res, next) {
  if (!accessReady()) return res.status(503).json({ error: 'The resources are unavailable right now. Contact DMS at info@strategydms.com.' });
  const visit = visitFrom(req);
  if (!visit) return res.status(401).json({ error: 'Enter your email address to continue.' });
  req.visit = visit;
  next();
}

export function requireStaff(req, res, next) {
  const access = staffAccess(req.visit);
  if (access === 'none') return res.status(403).json({ error: 'This address does not have access to the staff view.' });
  if (access === 'link') return res.status(401).json({ error: 'Open a new staff link to continue.' });
  next();
}
