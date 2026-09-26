# Changelog

Versions of the custom-domain-checks GitHub App service. The version lives in `package.json`, each version
has a `vX.Y.Z` tag, and each tag has a [GitHub release](https://github.com/CUSTOM-DOMAIN-APP/custom-domain-checks/releases)
whose notes are its entry below.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] (2026-09-26)

The first tagged release. `server.js` is unchanged since the service was written on 2026-07-15; this release
gives it a version and records what it does.

### The service

- A GitHub App that finds a repository's custom domain from its GitHub Pages configuration, a `CNAME` file or
  a `customdomain.yml` list.
- Nine health signals: DNS resolution, record type, target correctness, whether Pages is serving, domain
  verification, CAA compatibility with Let's Encrypt, certificate validity and expiry, HTTPS enforcement, and
  DNS hygiene.
- A **Domain health** check run on every push, with a pass, warn or fail per signal and the record to change,
  plus a **Re-check** button.
- One deduplicated `domain-health` issue that is updated in place and closed when the domain recovers.
- Webhooks verified with a constant-time HMAC-SHA256 comparison, queued, and answered `202` at once.
- App registration through the GitHub App Manifest flow at `/github-app/register`, and a health endpoint at
  `/github-app/health`.

### Status

- The hosted service is deployed and answers `https://customdomain.ai/github-app/health` with
  `{"ok":true,"provisioned":false,"app":null}`: the public App is not registered yet, so running your own
  instance is the way to install it today.

### This repository

- `package.json` with the version (private, no dependencies), this changelog, and the README and AGENTS.md
  in the shared CustomDomain™ structure.

[0.1.0]: https://github.com/CUSTOM-DOMAIN-APP/custom-domain-checks/releases/tag/v0.1.0
