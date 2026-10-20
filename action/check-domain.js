// CustomDomain™ Checks as a GitHub Action step.
// Runs the same DNS and TLS health checks as the GitHub App (healthChecks and
// renderReport, required from ../server.js, so the two never drift apart) against
// one domain, writes the report to the job summary, annotates every problem, and
// fails the step according to the fail-on input.
// Zero runtime dependencies: Node 20 or later, core modules only.
'use strict';
const fs = require('fs');
const path = require('path');
const { healthChecks, renderReport, ghReq } = require('../server.js');

const input = (name, fallback = '') => {
  const v = process.env[`CDC_${name.toUpperCase().replace(/-/g, '_')}`];
  return v === undefined || v.trim() === '' ? fallback : v.trim();
};

// Workflow command escaping, as the Actions toolkit does it.
const escData = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escProp = (s) => escData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function readCnameFile(file) {
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
  const full = path.resolve(workspace, file);
  if (!fs.existsSync(full)) return '';
  // GitHub Pages reads the first line of CNAME; anything after it is ignored.
  return fs.readFileSync(full, 'utf8').trim().split(/\s+/)[0] || '';
}

function normalizeDomain(d) {
  return d.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
}

async function readPages(token) {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) return null;
  try {
    const r = await ghReq('GET', `/repos/${repo}/pages`, token);
    return r.status === 200 ? r.body : null;
  } catch {
    return null;
  }
}

async function main() {
  const cnameFile = input('cname-file', 'CNAME');
  const pagesChecks = input('github-pages', 'true').toLowerCase() !== 'false';
  const failOn = input('fail-on', 'fail').toLowerCase();
  if (!['fail', 'warn', 'never'].includes(failOn)) {
    console.log(`::error title=Custom Domain Checks::fail-on must be fail, warn or never, not "${escData(failOn)}"`);
    process.exit(1);
  }
  const owner = (input('pages-owner') || process.env.GITHUB_REPOSITORY_OWNER || '').toLowerCase();

  let domain = input('domain');
  let source = 'domain input';
  if (!domain) {
    domain = readCnameFile(cnameFile);
    source = `${cnameFile} file`;
  }
  domain = normalizeDomain(domain);
  if (!domain || !domain.includes('.')) {
    console.log(`::error title=Custom Domain Checks::No domain to check. Set the domain input, or commit a ${escData(cnameFile)} file (check out the repository first).`);
    process.exit(1);
  }

  // The Pages settings add the verification state and the "Enforce HTTPS" switch.
  // They need a token that can read Pages; without them those two checks fall back
  // to what DNS and HTTP show.
  const pages = pagesChecks ? await readPages(input('token')) : null;
  const meta = { source, pages, pagesChecks };
  if (pagesChecks && !owner) {
    console.log('::warning title=Custom Domain Checks::No Pages owner known: set pages-owner so the record target can be checked.');
  }

  const rows = await healthChecks(domain, owner, meta);
  const { summary, text, conclusion } = renderReport(domain, meta, rows);

  for (const r of rows) {
    if (r.level === 'pass') continue;
    const cmd = r.level === 'fail' ? 'error' : 'warning';
    console.log(`::${cmd} title=${escProp(`${domain}: ${r.name}`)}::${escData(r.note)}`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Domain health: ${domain}\n\n${summary}\n\n${text}\n`);
  } else {
    console.log(`${summary}\n\n${text}`);
  }

  const failures = rows.filter((r) => r.level === 'fail').length;
  const warnings = rows.filter((r) => r.level === 'warn').length;
  setOutput('domain', domain);
  setOutput('conclusion', conclusion);
  setOutput('failures', failures);
  setOutput('warnings', warnings);
  console.log(`${domain}: ${failures} failed, ${warnings} to review, ${rows.length - failures - warnings} passed (${conclusion}).`);

  if ((failOn === 'fail' && failures) || (failOn === 'warn' && (failures || warnings))) process.exit(1);
}

main().catch((e) => {
  console.log(`::error title=Custom Domain Checks::${escData(e && e.stack ? e.stack : e)}`);
  process.exit(1);
});
