# Custom Domain Checks: DNS and SSL health checks for GitHub Pages custom domains

DNS, CAA and SSL certificate checks for the custom domain on a GitHub Pages site (or any domain), as a GitHub
Action you can run today and a GitHub App you can self-host.

[Custom domain troubleshooting in the docs](https://customdomain.ai/gh/checks) · [Releases](https://github.com/CUSTOM-DOMAIN-APP/custom-domain-checks/releases) · [Changelog](./CHANGELOG.md)

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

## For platforms that host other people's domains

These checks look at one repository's domain. If your product connects your customers' own domains,
CustomDomain™ checks every live domain hourly and writes the records at the customer's DNS provider where the
provider allows it: [custom domains for SaaS](https://customdomain.ai/custom-domains-for-saas).

<!-- facts:start -->
## Facts and sources

Read from the live endpoints on 2026-10-30. Every number in this README traces to a row here or to a source named
where it is used. If one does not, open an issue with the file and line.

| Fact | Value | Source |
|---|---|---|
| DNS providers known | 189 | [`/v1/providers/census`](https://api.customdomain.ai/v1/providers/census) |
| Automatic path | 73: 66 by scoped API key, 6 by provider sign-in (OAuth), 1 by one-click setup (Domain Connect) | census `mode` |
| Exact records and provider steps | 116 | census `mode` |
| Going live | No TXT ownership record. A domain goes `live` when every record resolves. Statuses: `pending`, `propagating`, `live`, `failed` | [Connections](https://docs.customdomain.ai/docs/concepts/connections) |
| HTTPS on the CustomDomain™ edge | Growth and up. On Starter and Startup, domains point at your servers and you serve TLS | [`/v1/plans`](https://api.customdomain.ai/v1/plans) |
| Plans | Starter $10 a month, 10 domains a year, hard cap. Startup $149 a month, 600 a year. Growth $649 a month, 600 a year. Premium and Enterprise by contract, 12,000 a year. 14 day trial on Starter, Startup and Growth | [`/v1/plans`](https://api.customdomain.ai/v1/plans) |
| Free to start | A new workspace connects its first ten domains free. No card needed to sign up | [Plans and quotas](https://docs.customdomain.ai/docs/billing/plans-and-quotas) |
| REST API | 163 operations on 140 paths, OpenAPI 3.1.0 | [`/v1/openapi.json`](https://api.customdomain.ai/v1/openapi.json) |
| MCP server | `customdomain-mcp` 0.6.0, 20 tools. Buying a domain through MCP is off on the hosted service | [`mcp.json`](https://mcp.customdomain.ai/.well-known/agent/mcp.json) |

Check the provider split yourself:

```sh
curl -s https://api.customdomain.ai/v1/providers/census \
  | python3 -c 'import json,sys,collections; d=json.load(sys.stdin); print(d["count"], collections.Counter(p["mode"] for p in d["providers"]))'
# 189 Counter({'manual': 116, 'api': 66, 'oauth': 6, 'dc': 1})
```
<!-- facts:end -->

## Related

- [customdomain-sdk](https://github.com/CUSTOM-DOMAIN-APP/customdomain-sdk): the JavaScript and TypeScript client for letting your users connect their own domain
- [customdomain-mcp](https://github.com/CUSTOM-DOMAIN-APP/customdomain-mcp): the hosted MCP server for AI agents
- [awesome-custom-domains](https://github.com/CUSTOM-DOMAIN-APP/awesome-custom-domains): the map of the whole space
- [docs](https://github.com/CUSTOM-DOMAIN-APP/docs): source of [docs.customdomain.ai](https://docs.customdomain.ai/docs)

## Support and license

Questions go to [GitHub Discussions](https://github.com/CUSTOM-DOMAIN-APP/docs/discussions) and corrections to
[this repository's issues](https://github.com/CUSTOM-DOMAIN-APP/custom-domain-checks/issues). Account and billing:
connect@customdomain.ai. Report security issues privately to security@customdomain.ai, never in a public issue
([policy](https://app.customdomain.ai/security)).

[MIT](./LICENSE). CustomDomain™ is a product of EverJust Company.
