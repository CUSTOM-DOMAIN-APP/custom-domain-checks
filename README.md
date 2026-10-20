# Custom Domain Checks: DNS and SSL health checks for GitHub Pages custom domains

DNS, CAA and SSL certificate checks for the custom domain on a GitHub Pages site (or any domain), as a GitHub
Action you can run today and a GitHub App. By CustomDomain™.

**Status:** v0.1.1 · GitHub Action in this repository · App service deployed, App not registered on GitHub yet

[![release](https://img.shields.io/github/v/release/CUSTOM-DOMAIN-APP/custom-domain-checks?style=flat&color=1c1917&label=release)](https://github.com/CUSTOM-DOMAIN-APP/custom-domain-checks/releases)
[![docs](https://img.shields.io/badge/docs-docs.customdomain.ai-1c1917?style=flat)](https://docs.customdomain.ai/docs)
[![license](https://img.shields.io/badge/license-MIT-1c1917?style=flat)](./LICENSE)

[Website](https://customdomain.ai) · [Docs](https://docs.customdomain.ai/docs) · [Console](https://app.customdomain.ai) · [Service health](https://customdomain.ai/github-app/health) · [Releases](https://github.com/CUSTOM-DOMAIN-APP/custom-domain-checks/releases) · [Changelog](./CHANGELOG.md)

|  |  |
|---|---|
| **What it is** | A GitHub Action and a GitHub App that grade the DNS and TLS behind a repository's custom domain |
| **Who it's for** | Anyone running a custom domain on GitHub Pages, and platforms that host tenant domains |
| **Live at** | [customdomain.ai/github-app/health](https://customdomain.ai/github-app/health) · product: [customdomain.ai/custom-domains-for-saas](https://customdomain.ai/custom-domains-for-saas) |
| **Stack** | Node 20 · zero runtime dependencies · `server.js` for the App (Docker) · `action.yml` for the Action, reusing the same checks |
| **Status** | v0.1.1. The Action runs from this repository. The App service is deployed and answering, but the App must be registered on GitHub before anyone can install it, and it is not yet: `/github-app/health` reports `provisioned: false` (checked 2026-10-20) |

Add the Action to a workflow and every run grades the domain in the job summary, with an annotation for each
problem. Install the App on a repository and it runs a **Domain health** check on every push, then opens one
tracking issue when the domain breaks and closes it when the domain is fixed. It is built by the
team behind [CustomDomain™](https://customdomain.ai), which does the same job continuously for platforms
hosting their users' domains.

## The problem

A custom domain is configured once and then silently rots. Registrations expire. Nameservers get switched
during an unrelated email migration. Someone tidies up a zone and takes the root `A` records with them. A
certificate lapses because the CAA record that was added last year quietly forbids the issuer. None of this
produces a build failure, so the first signal is usually a person telling you the site is down.

The specific one that costs the most is domain verification. An unverified GitHub Pages custom domain can be
claimed by someone else after the repository is deleted or Pages is turned off, which turns a dangling CNAME
into a subdomain takeover on a name your readers still trust. It is a single TXT record and a click, and
almost nobody has done it.

## What it does

- Discovers the domain from the Pages configuration, a `CNAME` file, or a `customdomain.yml` list
- Grades nine signals: DNS resolution, record type, target correctness, whether Pages is actually serving, domain verification, CAA compatibility with Let's Encrypt, certificate validity and expiry, HTTPS enforcement, and DNS hygiene
- Writes a **Domain health** check run on every push, with a pass, warn or fail per signal and the exact record to change
- Opens one deduplicated issue labeled `domain-health` when something is wrong, updates it in place, and closes it when the domain recovers
- Offers a **Re-check** button on the check run, so you can re-run after fixing DNS without another push
- Warns 30 days before a certificate expires, rather than after
- Runs the same checks as a GitHub Action step, with a job summary, annotations and a failing step when something breaks

## Quickstart: the GitHub Action

The same checks run as a step in your own workflow, with nothing to register or host. `action.yml` at the root of
this repository is a composite action: it runs `action/check-domain.js`, which requires the check functions from
`server.js` rather than copying them, so the App and the Action report the same thing. It reads the domain from
the `CNAME` file in the checked-out repository (or the `domain` input), writes the report to the job summary,
adds an error or warning annotation for every check that did not pass, and fails the step on a failed check.

```yaml
# .github/workflows/domain-health.yml
name: Domain health
on:
  push:
    branches: [main]
  schedule:
    - cron: "17 6 * * *" # daily, so an expiring certificate is caught between pushes
  workflow_dispatch:

permissions:
  contents: read
  pages: read # lets the step read the verification state and the Enforce HTTPS setting

jobs:
  domain-health:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: CUSTOM-DOMAIN-APP/custom-domain-checks@main
```

Pin `@main` to a release tag or a commit SHA once one that contains `action.yml` is published.

| Input | Default | What it does |
|---|---|---|
| `domain` | empty | The domain to check. Empty reads the first line of the `CNAME` file. |
| `cname-file` | `CNAME` | Path of that file, relative to the workspace (for example `docs/CNAME`). |
| `github-pages` | `true` | Run the Pages checks: record target, Pages serving, domain verification. Set `false` for a domain served elsewhere; DNS, CAA, certificate and HTTPS checks still run. |
| `pages-owner` | the repository owner | The account whose `<owner>.github.io` the domain should point at. |
| `token` | `github.token` | Used only to read the repository's Pages settings. Without `pages: read`, verification shows as `unknown` and HTTPS enforcement is judged by the redirect alone. |
| `fail-on` | `fail` | `fail` fails the step on a failed check, `warn` also on a warning, `never` only reports. |

Outputs: `domain`, `conclusion` (`success`, `neutral` or `failure`, as the App reports it), `failures` and
`warnings`. The step runs on the runner's `node`: every GitHub-hosted runner has it, and a self-hosted runner
needs Node 20 or later.

## Run the App yourself

The App has to be registered on GitHub before it can be installed, and the hosted instance is not registered yet.
Until it is, use the Action above, or register and run your own instance. It needs a writable volume for the
credentials the App registration writes back:

```bash
docker build -t custom-domain-checks .
docker run -p 8787:8787 -v "$(pwd)/secrets:/secrets" custom-domain-checks
```

Then open `http://localhost:8787/github-app/register` and click Create. That posts a GitHub App Manifest, and
the callback stores the app id, private key and webhook secret in `/secrets`. Install the created app on any
repository with a custom domain. Liveness is one call:

```bash
curl -s https://customdomain.ai/github-app/health
# {"ok":true,"provisioned":false,"app":null}
```

`provisioned` reports whether credentials have been exchanged yet. The hosted deployment answers but has not
been registered as a public App, so there is no `github.com/apps/...` listing to install today. Self-hosting is
the working path.

## How it works

`server.js` is a plain `http` server with four routes: the manifest registration page, its callback, a health
endpoint, and the webhook receiver. Webhook deliveries are verified against `X-Hub-Signature-256` with a
constant-time HMAC-SHA256 comparison, queued, and answered `202` immediately, so GitHub never waits on DNS
lookups.

Draining the queue mints an RS256 app JWT, exchanges it for a cached installation token, and runs the probes:
`dns.resolveCname` / `resolve4` / `resolve6` / `resolveCaa` / `resolveMx` for records, a real TLS handshake
for certificate validity and expiry, an HTTP request to port 80 to confirm the redirect to HTTPS, and the
Pages API for `protected_domain_state` and `https_enforced`. Results are rendered once and reported twice: as
a check run against the head SHA, and as the tracking issue.

It subscribes to `push`, `check_suite`, `check_run`, `page_build`, `installation` and
`installation_repositories`, and asks for `checks:write`, `issues:write`, `contents:read`, `pages:read` and
`metadata:read`. Nothing else.

## Repository layout

```text
server.js      the App service: routes, webhook verification, probes, reporting; exports the checks
action.yml     the GitHub Action: inputs, outputs, a composite step that runs action/check-domain.js
action/        check-domain.js: reads the domain, runs the checks from server.js, writes summary and annotations
Dockerfile     node:20-alpine, runs as the node user, /secrets volume, port 8787
package.json   the version (private, no dependencies) and a start script
CHANGELOG.md   one entry per version, matching the tags and GitHub releases
AGENTS.md      product facts and API shapes for coding agents
LICENSE        MIT
```

## Configuration

Credentials normally arrive through the manifest exchange and are written to
`$STATE_DIR/app-credentials.json` with mode `0600`. Preloading them by environment is supported for
deployments that provision secrets out of band.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | No | `8787` | Listen port |
| `STATE_DIR` | No | `/secrets` | Where the exchanged App credentials are stored |
| `APP_ID` | No | unset | Preloads the App id instead of registering through the manifest flow |
| `WEBHOOK_SECRET` | No | unset | Preloads the webhook signing secret |
| `CLIENT_ID` | No | unset | Preloads the App client id |
| `PRIVATE_KEY_PATH` | No | unset | Path to the App private key, read at boot if no credentials file exists |

Never commit any of these values, and keep `/secrets` off the image.

## Versioning and releases

The version lives in `package.json` and follows [Semantic Versioning](https://semver.org/). Every version has
a `vX.Y.Z` tag, a [GitHub release](https://github.com/CUSTOM-DOMAIN-APP/custom-domain-checks/releases) and a
[CHANGELOG.md](./CHANGELOG.md) entry. The current version is **0.1.1**.

## Limitations

- The App is not registered on GitHub, so installing it today means registering and running your own instance. The Action needs neither.
- The Pages-specific checks (record targets, serving, verification) only run when the domain came from Pages. Domains listed in `customdomain.yml` get the transport checks: CAA, certificate, HTTPS enforcement and hygiene.
- The App's checks are event-driven, not scheduled. A domain that breaks between pushes is caught on the next push, `check_suite`, or **Re-check**. The Action runs on whatever triggers you give it, including a `schedule`.
- Run from a GitHub-hosted runner, the Action sees DNS and TLS from that runner's network. A domain that answers differently by region can pass there and fail elsewhere.
- State is a single JSON file on a volume. It is one process, not a cluster.

## Related

- [customdomain-sdk](https://github.com/CUSTOM-DOMAIN-APP/customdomain-sdk): the JavaScript and TypeScript client for letting your users connect their own domain
- [customdomain-mcp](https://github.com/CUSTOM-DOMAIN-APP/customdomain-mcp): the hosted MCP server for AI agents
- [awesome-custom-domains](https://github.com/CUSTOM-DOMAIN-APP/awesome-custom-domains): the map of the whole space
- [docs](https://github.com/CUSTOM-DOMAIN-APP/docs): source of [docs.customdomain.ai](https://docs.customdomain.ai/docs)

## Support

- **Docs:** [docs.customdomain.ai](https://docs.customdomain.ai/docs)
- **Questions and ideas:** [GitHub Discussions](https://github.com/CUSTOM-DOMAIN-APP/docs/discussions)
- **Bugs and corrections:** [open an issue](https://github.com/CUSTOM-DOMAIN-APP/custom-domain-checks/issues) on this repository
- **Service status:** [status.customdomain.ai](https://status.customdomain.ai)
- **Account and billing:** connect@customdomain.ai
- **Security:** report privately to security@customdomain.ai, never in a public issue. Policy: [app.customdomain.ai/security](https://app.customdomain.ai/security)

## License

[MIT](./LICENSE). CustomDomain™ is a product of EverJust Company.
