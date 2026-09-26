// CustomDomain™ Checks: GitHub App webhook service
// Zero runtime dependencies (Node >= 20, core modules + global fetch only).
// Verifies webhooks, discovers a repo's custom domain (GitHub Pages cname,
// CNAME file, or customdomain.yml), runs 9 DNS/TLS health checks, and reports
// via the Checks API plus a single deduped "Domain health" tracking issue.
// It also serves the App Manifest registration flow at /github-app/register
// and /github-app/manifest-callback so the app can be created with one click.
'use strict';
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const dns = require('dns').promises;
const tls = require('tls');

const PORT = parseInt(process.env.PORT || '8787', 10);
const STATE_DIR = process.env.STATE_DIR || '/secrets';
const CRED_PATH = `${STATE_DIR}/app-credentials.json`;
const PRODUCT = 'https://customdomain.ai';
const ORG = 'CUSTOM-DOMAIN-APP';
const GH = 'api.github.com';
const PAGES_A = new Set(['185.199.108.153', '185.199.109.153', '185.199.110.153', '185.199.111.153']);
const PAGES_AAAA = new Set(['2606:50c0:8000::153', '2606:50c0:8001::153', '2606:50c0:8002::153', '2606:50c0:8003::153']);

// Credentials: written by the manifest-callback exchange, or preloaded via env.
let CRED = { app_id: process.env.APP_ID || '', webhook_secret: process.env.WEBHOOK_SECRET || '', pem: '', slug: 'custom-domain-checks', client_id: process.env.CLIENT_ID || '' };
try {
  if (fs.existsSync(CRED_PATH)) CRED = { ...CRED, ...JSON.parse(fs.readFileSync(CRED_PATH, 'utf8')) };
  else if (process.env.PRIVATE_KEY_PATH && fs.existsSync(process.env.PRIVATE_KEY_PATH)) CRED.pem = fs.readFileSync(process.env.PRIVATE_KEY_PATH, 'utf8');
} catch (e) { /* not provisioned yet */ }
const ready = () => Boolean(CRED.app_id && CRED.webhook_secret && CRED.pem);
const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------- GitHub API ----------
const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function appJwt() {
  const now = Math.floor(Date.now() / 1000);
  const h = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const p = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: Number(CRED.app_id) }));
  const s = crypto.createSign('RSA-SHA256').update(`${h}.${p}`).sign(CRED.pem);
  return `${h}.${p}.${b64url(s)}`;
}
function ghReq(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      host: GH, path, method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'custom-domain-checks',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => { let p = null; try { p = buf ? JSON.parse(buf) : null; } catch { p = buf; } resolve({ status: res.statusCode, body: p }); });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('gh timeout')));
    if (data) req.write(data);
    req.end();
  });
}
const tokenCache = new Map();
async function instToken(id) {
  const c = tokenCache.get(id);
  if (c && c.exp > Date.now() + 60000) return c.token;
  const r = await ghReq('POST', `/app/installations/${id}/access_tokens`, appJwt());
  if (r.status !== 201) throw new Error(`token ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  tokenCache.set(id, { token: r.body.token, exp: Date.parse(r.body.expires_at) });
  return r.body.token;
}

// ---------- domain discovery ----------
async function discoverDomains(owner, repo, token) {
  const out = new Map();
  const pages = await ghReq('GET', `/repos/${owner}/${repo}/pages`, token);
  if (pages.status === 200 && pages.body && pages.body.cname) out.set(pages.body.cname.toLowerCase(), { source: 'GitHub Pages', pages: pages.body });
  if (!out.size) {
    const f = await ghReq('GET', `/repos/${owner}/${repo}/contents/CNAME`, token);
    if (f.status === 200 && f.body && f.body.content) {
      const d = Buffer.from(f.body.content, 'base64').toString('utf8').trim().toLowerCase().split(/\s+/)[0];
      if (d && d.includes('.')) out.set(d, { source: 'CNAME file', pages: pages.status === 200 ? pages.body : null });
    }
  }
  const y = await ghReq('GET', `/repos/${owner}/${repo}/contents/customdomain.yml`, token);
  if (y.status === 200 && y.body && y.body.content) {
    const text = Buffer.from(y.body.content, 'base64').toString('utf8');
    for (const m of text.matchAll(/^\s*-\s*([a-z0-9.-]+\.[a-z]{2,})\s*$/gim)) {
      const d = m[1].toLowerCase();
      if (!out.has(d)) out.set(d, { source: 'customdomain.yml', pages: null });
    }
  }
  return out;
}

// ---------- health probes ----------
const q = async (fn, ...a) => { try { return await fn(...a); } catch { return null; } };
const isApex = (h) => h.split('.').length <= 2;
function tlsProbe(host) {
  return new Promise((resolve) => {
    const s = tls.connect({ host, port: 443, servername: host, timeout: 10000 }, () => {
      const cert = s.getPeerCertificate(); const authorized = s.authorized; s.end();
      resolve({ ok: true, authorized, validTo: cert && cert.valid_to ? Date.parse(cert.valid_to) : null });
    });
    s.on('error', () => resolve({ ok: false }));
    s.on('timeout', () => { s.destroy(); resolve({ ok: false }); });
  });
}
function httpRedirectProbe(host) {
  return new Promise((resolve) => {
    const req = http.request({ host, port: 80, path: '/', method: 'GET', timeout: 8000, headers: { Host: host, 'User-Agent': 'custom-domain-checks' } }, (res) => {
      const loc = res.headers.location || '';
      resolve({ status: res.statusCode, toHttps: [301, 302, 308].includes(res.statusCode) && loc.startsWith('https://') });
      res.resume();
    });
    req.on('error', () => resolve({ status: 0, toHttps: false }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, toHttps: false }); });
    req.end();
  });
}
function servedByPages(host) {
  return new Promise((resolve) => {
    const req = https.request({ host, port: 443, path: '/', method: 'HEAD', servername: host, timeout: 10000, headers: { 'User-Agent': 'custom-domain-checks' } }, (res) => {
      const srv = (res.headers.server || '').toLowerCase();
      resolve({ ok: srv.includes('github') || Boolean(res.headers['x-github-request-id']) });
      res.resume();
    });
    req.on('error', () => resolve({ ok: false }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false }); });
    req.end();
  });
}
async function caaAuthorizesLE(host) {
  let labels = host.split('.');
  while (labels.length >= 2) {
    const caa = await q(dns.resolveCaa.bind(dns), labels.join('.'));
    if (caa && caa.length) return caa.some((r) => (r.issue || r.issuewild || '').includes('letsencrypt.org'));
    labels = labels.slice(1);
  }
  return true;
}

async function healthChecks(domain, owner, meta) {
  const rows = [];
  const add = (name, level, note) => rows.push({ name, level, note });
  const apex = isApex(domain);
  const cname = await q(dns.resolveCname.bind(dns), domain);
  const a = await q(dns.resolve4.bind(dns), domain);
  const aaaa = await q(dns.resolve6.bind(dns), domain);

  // 1. resolution
  if (!cname && !a && !aaaa) { add('DNS resolution', 'fail', `\`${domain}\` does not resolve. Create the records at your DNS provider, or connect it in one click via [CustomDomain™](${PRODUCT}/one-click-dns-setup).`); }
  else add('DNS resolution', 'pass', 'Domain resolves.');

  const isPages = meta.source !== 'customdomain.yml';
  if (isPages && (a || aaaa || cname)) {
    // 2 + 3. record type + target correctness
    if (apex) {
      if (cname && cname.length) add('Record type (apex)', 'fail', 'An apex domain must not use a CNAME. Use the four GitHub Pages A records, or your provider\'s ALIAS/ANAME to `' + owner.toLowerCase() + '.github.io`.');
      else if (a && a.length) {
        const set = new Set(a);
        const exact = a.length === 4 && [...PAGES_A].every((ip) => set.has(ip));
        const anyPages = a.some((ip) => PAGES_A.has(ip));
        const strays = a.filter((ip) => !PAGES_A.has(ip));
        if (exact) add('A records (apex)', 'pass', 'Exactly the four GitHub Pages IPs.');
        else if (anyPages && strays.length) add('A records (apex)', 'fail', `Non-Pages IPs mixed in (${strays.join(', ')}). Remove stray A records.`);
        else if (anyPages) add('A records (apex)', 'warn', `Partial set (${a.join(', ')}). Add all four: 185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153.`);
        else add('A records (apex)', 'fail', `Apex points to non-GitHub IPs (${a.join(', ')}). Point A records at the four 185.199.108-111.153 addresses.`);
      }
    } else {
      const target = (cname && cname[0] || '').toLowerCase();
      if (!cname || !cname.length) add('CNAME target', a ? 'warn' : 'fail', `Subdomains should use a CNAME to \`${owner.toLowerCase()}.github.io\`.`);
      else if (target.endsWith('.github.io')) add('CNAME target', 'pass', `CNAME to \`${target}\`.`);
      else add('CNAME target', 'fail', `CNAME points at \`${target}\`, not \`${owner.toLowerCase()}.github.io\`.`);
    }
    // 4. serving
    const served = await servedByPages(domain);
    add('Served by GitHub Pages', served.ok ? 'pass' : 'warn', served.ok ? 'The domain serves the Pages site.' : 'The domain did not return a GitHub Pages response (site may be building, or traffic is served elsewhere).');
    // 5. TXT verification (security headline)
    const state = meta.pages && meta.pages.protected_domain_state;
    const txt = await q(dns.resolveTxt.bind(dns), `_github-pages-challenge-${owner.toLowerCase()}.${domain}`);
    if (state === 'verified') add('Domain verification', 'pass', 'Domain is verified against takeover.');
    else add('Domain verification', 'warn', `Domain is not verified (state: ${state || 'unknown'}). An unverified custom domain can be taken over after the repo is deleted or Pages is disabled. [Verify it](https://docs.github.com/pages/configuring-a-custom-domain-for-your-github-pages-site/verifying-your-custom-domain-for-github-pages)${txt && txt.length ? ' (challenge TXT is present, finish verification in repo settings)' : ''}.`);
  }
  // 6. CAA
  const caaOk = await caaAuthorizesLE(domain);
  add('CAA compatibility', caaOk ? 'pass' : 'fail', caaOk ? 'No CAA record blocks certificate issuance.' : `A CAA record blocks Let's Encrypt. Add: \`${domain}. CAA 0 issue "letsencrypt.org"\`.`);
  // 7. certificate
  const cert = await tlsProbe(domain);
  if (!cert.ok) add('TLS certificate', 'warn', 'Could not complete a TLS handshake yet (certificate may still be issuing).');
  else if (!cert.authorized) add('TLS certificate', 'fail', 'The certificate did not validate (chain or hostname mismatch).');
  else if (cert.validTo) {
    const days = Math.round((cert.validTo - Date.now()) / 86400000);
    if (days < 0) add('TLS certificate', 'fail', 'The certificate has expired.');
    else if (days < 30) add('TLS certificate', 'warn', `Certificate expires in ${days} days.`);
    else add('TLS certificate', 'pass', `Certificate valid, expires in ${days} days.`);
  }
  // 8. HTTPS enforcement
  const enforced = meta.pages && meta.pages.https_enforced;
  const redir = await httpRedirectProbe(domain);
  if (enforced && redir.toHttps) add('HTTPS enforcement', 'pass', 'HTTP redirects to HTTPS.');
  else add('HTTPS enforcement', 'warn', `HTTP is not redirecting to HTTPS. ${isPages ? 'Enable "Enforce HTTPS" in Settings, Pages.' : 'Configure a redirect from HTTP to HTTPS.'}`);
  // 9. hygiene: MX-on-CNAME + domain length
  if (!apex) {
    const mx = await q(dns.resolveMx.bind(dns), domain);
    if (cname && cname.length && mx && mx.length) add('DNS hygiene', 'warn', 'MX records coexist with a CNAME on this host. A CNAME cannot coexist with other record types, which can silently break mail.');
  }
  if (domain.length >= 64) add('Domain length', 'warn', 'The domain is 64+ characters, which can prevent certificate issuance.');
  return rows;
}

function renderReport(domain, meta, rows) {
  const icon = (l) => (l === 'pass' ? '✅' : l === 'warn' ? '⚠️' : '❌');
  const fails = rows.filter((r) => r.level === 'fail').length;
  const warns = rows.filter((r) => r.level === 'warn').length;
  const verdict = fails ? `${fails} issue${fails > 1 ? 's' : ''} to fix` : warns ? `Looks good, ${warns} thing${warns > 1 ? 's' : ''} to review` : 'All checks passed';
  const table = ['| | Check | Detail |', '|---|---|---|', ...rows.map((r) => `| ${icon(r.level)} | ${r.name} | ${r.note} |`)].join('\n');
  const summary = `**${verdict}** for \`${domain}\` (detected via ${meta.source}). Domain health checks by [CustomDomain™](${PRODUCT}).`;
  const text = `${table}\n\n---\n\nRun continuously by **CustomDomain™ Checks**. Tired of debugging DNS and TLS by hand? [Connect and monitor customer domains automatically](${PRODUCT}/custom-domains-for-saas) across 63 providers, with verification and certificates handled for you.`;
  const conclusion = fails ? 'failure' : warns ? 'neutral' : 'success';
  return { summary, text, conclusion };
}

// ---------- report surfaces ----------
async function runForRepo(inst, owner, repo, headSha) {
  const token = await instToken(inst);
  const domains = await discoverDomains(owner, repo, token);
  if (!domains.size) { log(`no custom domain: ${owner}/${repo}`); return; }
  for (const [domain, meta] of domains) {
    const rows = await healthChecks(domain, owner, meta);
    const { summary, text, conclusion } = renderReport(domain, meta, rows);
    if (headSha) {
      const cr = await ghReq('POST', `/repos/${owner}/${repo}/check-runs`, token, {
        name: `Domain health: ${domain}`, head_sha: headSha, status: 'completed', conclusion,
        completed_at: new Date().toISOString(), details_url: `${PRODUCT}/custom-domains-for-saas`,
        output: { title: `Domain health: ${domain}`, summary, text },
        actions: [{ label: 'Re-check', description: 'Run the domain health checks again', identifier: 'recheck' }],
      });
      log(`check-run ${owner}/${repo} ${domain} -> ${cr.status} ${conclusion}`);
    }
    // persistent tracking issue only when something is actually wrong
    const bad = rows.some((r) => r.level === 'fail') || rows.some((r) => r.level === 'warn' && /expires in \d+ days/.test(r.note));
    const title = `Domain health: ${domain}`;
    const search = await ghReq('GET', `/repos/${owner}/${repo}/issues?state=open&labels=domain-health&per_page=20`, token);
    const existing = Array.isArray(search.body) ? search.body.find((i) => i.title === title) : null;
    if (bad) {
      const body = `${summary}\n\n${text}`;
      if (existing) await ghReq('PATCH', `/repos/${owner}/${repo}/issues/${existing.number}`, token, { body, state: 'open' });
      else {
        await ghReq('POST', `/repos/${owner}/${repo}/labels`, token, { name: 'domain-health', color: '0B7285', description: 'CustomDomain™ health checks' }).catch(() => {});
        await ghReq('POST', `/repos/${owner}/${repo}/issues`, token, { title, body, labels: ['domain-health'] });
      }
    } else if (existing) {
      await ghReq('PATCH', `/repos/${owner}/${repo}/issues/${existing.number}`, token, { state: 'closed' });
    }
  }
}

// ---------- webhook processing ----------
const queue = [];
let draining = false;
async function drain() {
  if (draining) return; draining = true;
  while (queue.length) {
    const { event, payload } = queue.shift();
    try {
      if (!ready()) { log('skip: app not provisioned'); continue; }
      const inst = payload.installation && payload.installation.id;
      if (!inst) continue;
      if (event === 'installation' && payload.action === 'created') {
        for (const r of payload.repositories || []) await runForRepo(inst, r.full_name.split('/')[0], r.name, null).catch((e) => log('err', e.message));
      } else if (event === 'installation_repositories') {
        for (const r of payload.repositories_added || []) await runForRepo(inst, r.full_name.split('/')[0], r.name, null).catch((e) => log('err', e.message));
      } else if (event === 'push') {
        await runForRepo(inst, payload.repository.owner.name || payload.repository.owner.login, payload.repository.name, payload.after).catch((e) => log('err', e.message));
      } else if (event === 'check_suite' && payload.action === 'requested') {
        await runForRepo(inst, payload.repository.owner.login, payload.repository.name, payload.check_suite.head_sha).catch((e) => log('err', e.message));
      } else if (event === 'page_build') {
        await runForRepo(inst, payload.repository.owner.login, payload.repository.name, payload.repository.default_branch && null).catch((e) => log('err', e.message));
      } else if (event === 'check_run' && payload.action === 'requested_action') {
        const [o, rp] = payload.repository.full_name.split('/');
        await runForRepo(inst, o, rp, payload.check_run.head_sha).catch((e) => log('err', e.message));
      }
    } catch (e) { log('drain err', e.message); }
  }
  draining = false;
}

// ---------- manifest registration flow ----------
const manifest = {
  name: 'Custom Domain Checks',
  url: PRODUCT,
  description: 'Continuous DNS and TLS health checks for custom domains on GitHub Pages. A "Domain health" check on every push, plus a tracking issue when your domain breaks: wrong CNAME target, stale apex IPs, unverified domain (takeover risk), CAA blocking Let\'s Encrypt, expiring certificate, or HTTPS not enforced. By customdomain.ai.',
  public: true,
  hook_attributes: { url: `${PRODUCT}/github-app/webhook`, active: true },
  redirect_url: `${PRODUCT}/github-app/manifest-callback`,
  setup_url: `${PRODUCT}/github-app/installed`,
  setup_on_update: true,
  default_permissions: { checks: 'write', contents: 'read', pages: 'read', issues: 'write', metadata: 'read' },
  default_events: ['push', 'check_suite', 'check_run', 'page_build', 'installation', 'installation_repositories'],
};
let regState = '';
function registerPage() {
  regState = crypto.randomBytes(16).toString('hex');
  const m = JSON.stringify(manifest).replace(/"/g, '&quot;');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Install Custom Domain Checks</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#faf9f7;color:#1c1917;max-width:560px;margin:12vh auto;padding:0 24px;line-height:1.6}h1{font-size:1.6rem}a.btn,button{background:#1c1917;color:#fafaf9;border:0;border-radius:8px;padding:14px 22px;font-size:1rem;font-weight:600;cursor:pointer;text-decoration:none;display:inline-block}p{color:#57534e}code{background:#f5f5f4;padding:2px 6px;border-radius:4px}</style></head>
<body><h1>Create the Custom Domain Checks GitHub App</h1>
<p>This registers the app under the <code>${ORG}</code> organization. After you click Create on GitHub, you are returned here and the app is ready to install on any repository with a custom domain.</p>
<form action="https://github.com/organizations/${ORG}/settings/apps/new?state=${regState}" method="post">
<input type="hidden" name="manifest" value="${m}">
<button type="submit">Create app on GitHub &rarr;</button>
</form>
<p style="margin-top:2rem;font-size:.85rem">It runs continuous DNS and TLS health checks on GitHub Pages custom domains. Learn more at <a href="${PRODUCT}">customdomain.ai</a>.</p></body></html>`;
}
async function exchangeManifest(code) {
  const r = await ghReq('POST', `/app-manifests/${code}/conversions`, '');
  if (r.status !== 201) throw new Error(`conversion ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
  const c = { app_id: String(r.body.id), slug: r.body.slug, client_id: r.body.client_id, client_secret: r.body.client_secret, webhook_secret: r.body.webhook_secret, pem: r.body.pem };
  fs.writeFileSync(CRED_PATH, JSON.stringify(c, null, 2), { mode: 0o600 });
  CRED = { ...CRED, ...c };
  log(`app registered: id=${c.app_id} slug=${c.slug}`);
  return c;
}

// ---------- HTTP server ----------
const send = (res, code, body, type = 'text/plain') => { res.writeHead(code, { 'Content-Type': type }); res.end(body); };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, PRODUCT);
  if (req.method === 'GET' && u.pathname === '/github-app/health') return send(res, 200, JSON.stringify({ ok: true, provisioned: ready(), app: CRED.app_id || null }), 'application/json');
  if (req.method === 'GET' && u.pathname === '/github-app/register') return send(res, 200, registerPage(), 'text/html');
  if (req.method === 'GET' && u.pathname === '/github-app/manifest-callback') {
    const code = u.searchParams.get('code'); const state = u.searchParams.get('state');
    if (!code) return send(res, 400, 'missing code');
    if (regState && state !== regState) return send(res, 400, 'state mismatch');
    exchangeManifest(code).then((c) =>
      send(res, 200, `<!doctype html><meta charset=utf-8><body style="font-family:sans-serif;max-width:560px;margin:12vh auto;padding:0 24px"><h1>App created ✓</h1><p><strong>Custom Domain Checks</strong> is live (app id ${c.app_id}). Install it on your repositories:</p><p><a href="https://github.com/apps/${c.slug}/installations/new" style="background:#1c1917;color:#fff;padding:14px 22px;border-radius:8px;text-decoration:none;font-weight:600">Install the app &rarr;</a></p></body>`, 'text/html'),
    ).catch((e) => send(res, 500, 'exchange failed: ' + e.message));
    return;
  }
  if (req.method === 'GET' && u.pathname === '/github-app/installed') { res.writeHead(302, { Location: `${PRODUCT}/custom-domains-for-saas` }); return res.end(); }
  if (req.method === 'POST' && u.pathname === '/github-app/webhook') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      const sig = req.headers['x-hub-signature-256'] || '';
      const expected = 'sha256=' + crypto.createHmac('sha256', CRED.webhook_secret).update(raw).digest('hex');
      const ok = CRED.webhook_secret && sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
      if (!ok) return send(res, 401, 'bad signature');
      let payload; try { payload = JSON.parse(raw.toString('utf8')); } catch { return send(res, 400, 'bad json'); }
      queue.push({ event: req.headers['x-github-event'], payload });
      setImmediate(drain);
      return send(res, 202, 'queued');
    });
    return;
  }
  return send(res, 404, 'not found');
});
server.listen(PORT, () => log(`custom-domain-checks listening on :${PORT} (provisioned=${ready()})`));
