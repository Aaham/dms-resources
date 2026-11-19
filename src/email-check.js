/* =============================================================================
   Can this address's domain receive email?
   -----------------------------------------------------------------------------
   Addresses are not confirmed before the resources open, so a mistyped domain
   would otherwise be recorded as a visitor and the scorecard report would be
   sent nowhere. This asks DNS whether the domain exists and takes mail.

   It answers false only when DNS says so plainly: the domain has no mail
   record and no address record, or it publishes a "null MX" (RFC 7505). A slow
   or failing lookup answers true, because a DNS problem on our side must not
   turn a real visitor away. It cannot tell whether the mailbox itself exists.
   ============================================================================= */

import dns from 'node:dns/promises';

const HOUR_MS = 60 * 60_000;
const MISSING = new Set(['ENOTFOUND', 'ENODATA']);
const cache = new Map(); // domain -> { ok, at }

async function lookup(domain, resolver) {
  try {
    const records = await resolver.resolveMx(domain);
    if (records.length) return records.some((record) => record.exchange && record.exchange !== '.');
  } catch (err) {
    if (!MISSING.has(err.code)) return null;
  }
  // No mail record: mail falls back to the domain's address record.
  for (const method of ['resolve4', 'resolve6']) {
    try {
      if ((await resolver[method](domain)).length) return true;
    } catch (err) {
      if (!MISSING.has(err.code)) return null;
    }
  }
  return false;
}

export async function domainAcceptsMail(domain, { resolver = dns, timeoutMs = 2500 } = {}) {
  const cached = cache.get(domain);
  if (cached && Date.now() - cached.at < HOUR_MS) return cached.ok;

  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
  const answer = await Promise.race([lookup(domain, resolver).catch(() => null), timeout]);
  clearTimeout(timer);

  if (answer === null) return true; // undecided: do not cache, do not block
  if (cache.size > 5000) cache.clear();
  cache.set(domain, { ok: answer, at: Date.now() });
  return answer;
}
