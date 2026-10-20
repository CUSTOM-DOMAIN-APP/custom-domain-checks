# Changelog

Versions of the custom-domain-checks GitHub App service. The version lives in `package.json`, each version
has a `vX.Y.Z` tag, and each tag has a [GitHub release](https://github.com/CUSTOM-DOMAIN-APP/custom-domain-checks/releases)
whose notes are its entry below.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- A GitHub Action (`action.yml`, composite, running `action/check-domain.js`). It checks the domain from the
  `domain` input or the repository's `CNAME` file with the same `healthChecks` and `renderReport` the App uses,
  required from `server.js` rather than copied, then writes the report to the job summary, annotates every check
  that did not pass, sets `domain`, `conclusion`, `failures` and `warnings` outputs, and fails the step according
  to `fail-on`.

### Changed

- `server.js` exports `healthChecks`, `renderReport` and `ghReq`, and only listens when run directly
  (`node server.js`, as the Dockerfile does).
- The Pages checks can be turned off for a domain (`pagesChecks: false`, the Action's `github-pages: false`).
- The check run text now says DNS records are written at 62 providers and guided at the rest, from the census of
  2026-10-20, instead of "across 63 providers".

### Fixed

- HTTPS enforcement no longer warns on every domain without Pages settings to read (a `customdomain.yml` domain,
  or a `CNAME` file domain whose Pages API call failed): when there are no settings, the observed HTTP to HTTPS
  redirect decides.

## [0.1.1] (2026-09-26)

### Changed

- What the App writes into repositories now uses the CustomDomain™ brand: the check run summary
  ("Domain health checks by CustomDomain™"), the closing line of the check run text and the tracking
  issue ("Run continuously by CustomDomain™ Checks"), the DNS resolution failure hint, and the
  description of the `domain-health` label it creates.
- Unchanged on purpose: the App name in the registration manifest (`Custom Domain Checks`) and the
  registration pages that refer to the App by that name, because the name is fixed when the App is
  registered on GitHub.

The hosted instance picks this up when it is redeployed.

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

[0.1.1]: https://github.com/CUSTOM-DOMAIN-APP/custom-domain-checks/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/CUSTOM-DOMAIN-APP/custom-domain-checks/releases/tag/v0.1.0
