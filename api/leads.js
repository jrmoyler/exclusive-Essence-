/* =============================================================================
   POST /api/leads — Exclusive Essence lead capture
   -----------------------------------------------------------------------------
   Receives {name,email,phone,source,reward} from the entry gate and the footer
   newsletter form, then fans the lead out to whichever sinks are configured:

     Shopify  — Admin GraphQL customerCreate (falls back to customerUpdate on
                duplicate email) with marketing consent + tags.
     Klaviyo  — profile-import upsert (carries the name) followed by an email
                subscription job against a list.

   Zero npm dependencies: uses the Node 18+ global fetch. The Vercel project is
   built with installCommand:"" so nothing gets installed at build time.

   ENV VARS (all optional — unset sinks are simply skipped)
     SHOPIFY_STORE_DOMAIN        cbrxt0-kk.myshopify.com
     SHOPIFY_ADMIN_TOKEN         shpat_...  (custom app, scope: write_customers,
                                 plus Protected Customer Data access approved)
     SHOPIFY_ADMIN_API_VERSION   default 2026-01
     KLAVIYO_API_KEY             pk_...     (private key)
     KLAVIYO_LIST_ID             e.g. Y6nRLr — omit to upsert without subscribing
     KLAVIYO_API_REVISION        default 2025-01-15
     EE_LEAD_TAGS                default "essence-list,web-gate"
     EE_ALLOWED_ORIGINS          comma list; unset = allow any origin

   NOTE ON SMS: phone numbers are stored, but SMS marketing consent is never
   set. The gate does not present TCPA-compliant SMS opt-in language, and
   Klaviyo rejects SMS consent without a sending number provisioned for the
   region. Add explicit consent copy before enabling it.
   ========================================================================== */

'use strict';

/* Accept the common spellings — a token saved under a near-miss name is the
   single most likely reason this endpoint looks "configured but dead". */
const TOKEN_VARS = ['SHOPIFY_ADMIN_TOKEN', 'SHOPIFY_ADMIN_API_TOKEN',
                    'SHOPIFY_ACCESS_TOKEN', 'SHOPIFY_API_TOKEN',
                    'SHOPIFY_ADMIN_ACCESS_TOKEN'];
const TOKEN_VAR = TOKEN_VARS.find(k => (process.env[k] || '').trim()) || null;

const SHOP = (process.env.SHOPIFY_STORE_DOMAIN || process.env.EE_SHOPIFY_DOMAIN
              || 'cbrxt0-kk.myshopify.com').trim();
const ADMIN_TOKEN = TOKEN_VAR ? process.env[TOKEN_VAR].trim() : '';
const ADMIN_VERSION = (process.env.SHOPIFY_ADMIN_API_VERSION || '2026-01').trim();
const KLAVIYO_KEY = (process.env.KLAVIYO_API_KEY || '').trim();
const KLAVIYO_LIST = (process.env.KLAVIYO_LIST_ID || '').trim();
const KLAVIYO_REVISION = (process.env.KLAVIYO_API_REVISION || '2025-01-15').trim();
const LEAD_TAGS = (process.env.EE_LEAD_TAGS || 'essence-list,web-gate')
  .split(',').map(s => s.trim()).filter(Boolean);
const ALLOWED_ORIGINS = (process.env.EE_ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

const shopifyOn = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(SHOP) && ADMIN_TOKEN.length >= 20;
const klaviyoOn = /^pk_[A-Za-z0-9]+$/.test(KLAVIYO_KEY);

const MAX_BODY = 8 * 1024;
const TIMEOUT_MS = 8000;

/* ---------- helpers ---------------------------------------------------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

function clean(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max || 200) : '';
}

/** US-biased E.164 normalisation. Returns '' when the input can't be trusted —
 *  Shopify rejects malformed phones and would fail the whole customer create. */
function toE164(raw) {
  const s = clean(raw, 32);
  if (!s) return '';
  if (s.startsWith('+')) {
    const d = s.replace(/[^\d]/g, '');
    return d.length >= 8 && d.length <= 15 ? '+' + d : '';
  }
  const d = s.replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d[0] === '1') return '+' + d;
  return '';
}

function splitName(full) {
  const parts = clean(full, 120).split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: '', last: '' };
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

async function fetchJSON(url, options) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, Object.assign({}, options, { signal: ctrl.signal }));
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) { /* non-JSON body */ }
    return { ok: res.ok, status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

/* Best-effort per-instance throttle. Serverless instances are ephemeral and
   not shared, so this blunts bursts rather than enforcing a global limit. */
const hits = new Map();
function throttled(ip) {
  const now = Date.now();
  const windowMs = 60000, limit = 12;
  const rec = hits.get(ip);
  if (!rec || now - rec.start > windowMs) { hits.set(ip, { start: now, n: 1 }); return false; }
  rec.n += 1;
  if (hits.size > 5000) hits.clear();
  return rec.n > limit;
}

/* ---------- Shopify sink ----------------------------------------------- */

const ADMIN_URL = () => `https://${SHOP}/admin/api/${ADMIN_VERSION}/graphql.json`;

function adminQuery(query, variables) {
  return fetchJSON(ADMIN_URL(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': ADMIN_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
}

const CREATE = `mutation eeCustomerCreate($input: CustomerInput!) {
  customerCreate(input: $input) { customer { id email } userErrors { field message } }
}`;

const FIND = `query eeFindCustomer($q: String!) {
  customers(first: 1, query: $q) { edges { node { id tags } } }
}`;

const UPDATE = `mutation eeCustomerUpdate($input: CustomerInput!) {
  customerUpdate(input: $input) { customer { id } userErrors { field message } }
}`;

async function sendToShopify(lead) {
  const { first, last } = splitName(lead.name);
  const note = [
    `Captured via ${lead.source} on the Exclusive Essence site.`,
    lead.reward ? `Reward issued: ${lead.reward}.` : '',
    lead.phone && !lead.phoneE164 ? `Phone as entered: ${lead.phone}` : '',
  ].filter(Boolean).join(' ');

  const input = {
    email: lead.email,
    tags: LEAD_TAGS,
    note,
    emailMarketingConsent: {
      marketingState: 'SUBSCRIBED',
      marketingOptInLevel: 'SINGLE_OPT_IN',
      consentUpdatedAt: new Date().toISOString(),
    },
  };
  if (first) input.firstName = first;
  if (last) input.lastName = last;
  if (lead.phoneE164) input.phone = lead.phoneE164;

  let res = await adminQuery(CREATE, { input });
  if (!res.ok) throw new Error(`shopify http ${res.status}`);

  let errs = (res.json && res.json.data && res.json.data.customerCreate &&
    res.json.data.customerCreate.userErrors) || [];

  // A phone already attached to someone else must not sink the whole lead.
  if (errs.some(e => /phone/i.test(String(e.field)) || /phone/i.test(e.message)) && input.phone) {
    delete input.phone;
    res = await adminQuery(CREATE, { input });
    errs = (res.json && res.json.data && res.json.data.customerCreate &&
      res.json.data.customerCreate.userErrors) || [];
  }

  if (!errs.length) return 'created';

  // Existing customer: merge our tags in rather than clobbering theirs.
  if (errs.some(e => /taken|already/i.test(e.message))) {
    const found = await adminQuery(FIND, { q: `email:"${lead.email}"` });
    const node = found.json && found.json.data && found.json.data.customers &&
      found.json.data.customers.edges[0] && found.json.data.customers.edges[0].node;
    if (!node) return 'duplicate';
    const merged = Array.from(new Set([].concat(node.tags || [], LEAD_TAGS)));
    const upd = await adminQuery(UPDATE, { input: { id: node.id, tags: merged } });
    const uerr = (upd.json && upd.json.data && upd.json.data.customerUpdate &&
      upd.json.data.customerUpdate.userErrors) || [];
    return uerr.length ? 'duplicate' : 'updated';
  }

  throw new Error('shopify: ' + errs.map(e => e.message).join('; '));
}

/* ---------- Klaviyo sink ----------------------------------------------- */

function klaviyoHeaders() {
  return {
    'Authorization': `Klaviyo-API-Key ${KLAVIYO_KEY}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'revision': KLAVIYO_REVISION,
  };
}

async function sendToKlaviyo(lead) {
  const { first, last } = splitName(lead.name);

  // 1. Upsert the profile. The bulk-subscribe endpoint accepts only email,
  //    phone and subscriptions — names have to come through profile-import.
  const attrs = { email: lead.email };
  if (first) attrs.first_name = first;
  if (last) attrs.last_name = last;
  if (lead.phoneE164) attrs.phone_number = lead.phoneE164;
  attrs.properties = {
    'Lead Source': lead.source,
    'Reward Code': lead.reward || '',
    'Signup Site': 'exclusiveessence.store',
  };

  const imp = await fetchJSON('https://a.klaviyo.com/api/profile-import/', {
    method: 'POST',
    headers: klaviyoHeaders(),
    body: JSON.stringify({ data: { type: 'profile', attributes: attrs } }),
  });
  if (!imp.ok) throw new Error(`klaviyo import ${imp.status}`);

  if (!KLAVIYO_LIST) return 'upserted';

  // 2. Subscribe to email marketing on the configured list.
  const sub = await fetchJSON('https://a.klaviyo.com/api/profile-subscription-bulk-create-jobs/', {
    method: 'POST',
    headers: klaviyoHeaders(),
    body: JSON.stringify({
      data: {
        type: 'profile-subscription-bulk-create-job',
        attributes: {
          custom_source: lead.source,
          profiles: {
            data: [{
              type: 'profile',
              attributes: {
                email: lead.email,
                subscriptions: { email: { marketing: { consent: 'SUBSCRIBED' } } },
              },
            }],
          },
        },
        relationships: { list: { data: { type: 'list', id: KLAVIYO_LIST } } },
      },
    }),
  });
  if (!sub.ok) throw new Error(`klaviyo subscribe ${sub.status}`);
  return 'subscribed';
}

/* ---------- handler ----------------------------------------------------- */

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  // Config probe. Booleans only — never echoes a secret. Lets you confirm the
  // env vars landed without submitting a fake lead into the customer list.
  if (req.method === 'GET') {
    const out = {
      ok: true,
      service: 'ee-leads',
      shopify: { configured: shopifyOn, domain: SHOP, tokenVar: TOKEN_VAR,
                 tokenPrefix: ADMIN_TOKEN ? ADMIN_TOKEN.slice(0, 6) : null,
                 tokenLength: ADMIN_TOKEN.length, apiVersion: ADMIN_VERSION },
      klaviyo: { configured: klaviyoOn, list: KLAVIYO_LIST ? 'set' : 'unset' },
      tags: LEAD_TAGS,
    };
    // ?check=1 spends one cheap Admin call to prove the token actually works,
    // rather than waiting for a real lead to fail. Throttled like a write.
    if (shopifyOn && /[?&]check=1/.test(req.url || '')) {
      const cip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
      if (throttled(cip)) { out.shopify.auth = 'rate_limited'; }
      else {
        try {
          const r = await adminQuery('{ shop { name myshopifyDomain } }', {});
          const shop = r.json && r.json.data && r.json.data.shop;
          if (shop) { out.shopify.auth = 'ok'; out.shopify.shopName = shop.name; }
          else if (r.status === 401 || r.status === 403) out.shopify.auth = 'unauthorized (' + r.status + ')';
          else out.shopify.auth = 'error ' + r.status + ': ' +
            String(r.json && r.json.errors ? JSON.stringify(r.json.errors) : r.text).slice(0, 240);
        } catch (e) { out.shopify.auth = 'error: ' + e.message; }
      }
    }
    res.status(200).json(out);
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }

  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.length && origin && !ALLOWED_ORIGINS.includes(origin)) {
    res.status(403).json({ ok: false, error: 'origin_not_allowed' });
    return;
  }

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (throttled(ip)) {
    res.status(429).json({ ok: false, error: 'rate_limited' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    if (body.length > MAX_BODY) { res.status(413).json({ ok: false, error: 'too_large' }); return; }
    try { body = JSON.parse(body); } catch (_) { body = null; }
  }
  if (!body || typeof body !== 'object') {
    res.status(400).json({ ok: false, error: 'bad_json' });
    return;
  }

  // Honeypot: bots fill every field they see. Answer 200 so they don't retune.
  if (clean(body.company, 100)) { res.status(200).json({ ok: true, sinks: {} }); return; }

  const email = clean(body.email, 200).toLowerCase();
  if (!EMAIL_RE.test(email)) {
    res.status(400).json({ ok: false, error: 'invalid_email' });
    return;
  }

  const lead = {
    email,
    name: clean(body.name, 120),
    phone: clean(body.phone, 32),
    phoneE164: toE164(body.phone),
    source: clean(body.source, 40) || 'entry_gate',
    reward: clean(body.reward, 24),
  };

  if (!shopifyOn && !klaviyoOn) {
    // Endpoint is live but no destination is wired yet. 200 keeps the client
    // from queueing retries for a lead that has nowhere to go.
    console.warn('[leads] no sink configured — lead accepted but not forwarded');
    res.status(200).json({ ok: true, configured: false, sinks: {} });
    return;
  }

  const jobs = [];
  if (shopifyOn) jobs.push(['shopify', sendToShopify(lead)]);
  if (klaviyoOn) jobs.push(['klaviyo', sendToKlaviyo(lead)]);

  const settled = await Promise.allSettled(jobs.map(j => j[1]));
  const sinks = {};
  let anyOk = false;

  settled.forEach((r, i) => {
    const name = jobs[i][0];
    if (r.status === 'fulfilled') { sinks[name] = r.value; anyOk = true; }
    else {
      sinks[name] = 'error';
      console.error(`[leads] ${name} failed:`, r.reason && r.reason.message);
    }
  });

  // Partial success still counts — the client shouldn't re-queue a lead that
  // already landed in one system and would double up on the next attempt.
  res.status(anyOk ? 200 : 502).json({ ok: anyOk, configured: true, sinks });
};
