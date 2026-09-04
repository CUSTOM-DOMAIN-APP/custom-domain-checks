# Custom Domain Checks

GitHub App: continuous DNS and TLS health checks for custom domains, including GitHub Pages.

**Status:** Service deployed · public App listing not yet published · public repo

[![License](https://img.shields.io/badge/license-MIT-1c1917?style=flat)](LICENSE)

|  |  |
|---|---|
| **What it is** | A GitHub App that grades the DNS and TLS behind a repository's custom domain |
| **Who it's for** | Anyone running a custom domain on GitHub Pages, and platforms that host tenant domains |
| **Live at** | [customdomain.ai/github-app/health](https://customdomain.ai/github-app/health) · product: [customdomain.ai/custom-domains-for-saas](https://customdomain.ai/custom-domains-for-saas) |
| **Stack** | Node 20 · zero runtime dependencies · Docker · one file, `server.js` |
| **Status** | Service deployed and answering; the App itself is not yet registered, so `/github-app/health` reports `provisioned: false` |

Point this at a repository with a custom domain and it runs a **Domain health** check on every
push, then opens one tracking issue when the domain breaks and closes it when the domain is
fixed. It is built by the team behind [Custom Domain](https://customdomain.ai), which does the
same job continuously for platforms hosting their users' domains.

## The problem

A custom domain is configured once and then silently rots. Registrars expire. Nameservers get
switched during an unrelated email migration. Someone tidies up a zone and takes the apex A
records with them. A certificate lapses because the CAA record that was added last year quietly
forbids the issuer. None of this produces a build failure, so the first signal is usually a
person telling you the site is down.

The specific one that costs the most is domain verification. An unverified GitHub Pages custom
domain can be claimed by someone else after the repository is deleted or Pages is turned off,
which turns a dangling CNAME into a subdomain takeover on a name your readers still trust. It
is a single TXT record and a click, and almost nobody has done it.

## What it does

- Discovers the domain from the Pages configuration, a `CNAME` file, or a `customdomain.yml` list
- Grades nine signals: DNS resolution, record type, target correctness, whether Pages is actually serving, domain verification, CAA compatibility with Let's Encrypt, certificate validity and expiry, HTTPS enforcement, and DNS hygiene
- Writes a **Domain health** check run on every push, with a pass, warn or fail per signal and the exact record to change
- Opens one deduplicated issue labelled `domain-health` when something is wrong, updates it in place, and closes it when the domain recovers
- Offers a **Re-check** button on the check run, so you can re-run after fixing DNS without another push
- Warns 30 days before a certificate expires, rather than after

## Quickstart

Run the service yourself. It needs a writable volume for the credentials the App registration
writes back:

```bash
docker build -t custom-domain-checks .
docker run -p 8787:8787 -v "$(pwd)/secrets:/secrets" custom-domain-checks
```

Then open `http://localhost:8787/github-app/register` and click Create. That posts a GitHub App
Manifest, and the callback stores the app id, private key and webhook secret in `/secrets`.
Install the created app on any repository with a custom domain. Liveness is one call:

```bash
curl -s https://customdomain.ai/github-app/health
# {"ok":true,"provisioned":false,"app":null}
```

`provisioned` reports whether credentials have been exchanged yet. The hosted deployment answers
but has not been registered as a public App, so there is no `github.com/apps/...` listing to
install today. Self-hosting is the working path.

## How it works

`server.js` is a plain `http` server with four routes: the manifest registration page, its
callback, a health endpoint, and the webhook receiver. Webhook deliveries are verified against
`X-Hub-Signature-256` with a constant-time HMAC-SHA256 comparison, queued, and answered `202`
immediately, so GitHub never waits on DNS lookups.

Draining the queue mints an RS256 app JWT, exchanges it for a cached installation token, and
runs the probes: `dns.resolveCname` / `resolve4` / `resolve6` / `resolveCaa` / `resolveMx` for
records, a real TLS handshake for certificate validity and expiry, an HTTP request to port 80 to
confirm the redirect to HTTPS, and the Pages API for `protected_domain_state` and
`https_enforced`. Results are rendered once and reported twice: as a check run against the head
SHA, and as the tracking issue.

It subscribes to `push`, `check_suite`, `check_run`, `page_build`, `installation` and
`installation_repositories`, and asks for `checks:write`, `issues:write`, `contents:read`,
`pages:read` and `metadata:read`. Nothing else.

## Repository layout

```
server.js     the whole service: routes, webhook verification, probes, reporting
Dockerfile    node:20-alpine, runs as the node user, /secrets volume, port 8787
AGENTS.md     product facts and API shapes for coding agents
LICENSE       MIT
```

## Configuration

Credentials normally arrive through the manifest exchange and are written to
`$STATE_DIR/app-credentials.json` with mode `0600`. Preloading them by environment is supported
for deployments that provision secrets out of band.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | No | `8787` | Listen port |
| `STATE_DIR` | No | `/secrets` | Where the exchanged App credentials are stored |
| `APP_ID` | No | — | Preloads the App id instead of registering through the manifest flow |
| `WEBHOOK_SECRET` | No | — | Preloads the webhook signing secret |
| `CLIENT_ID` | No | — | Preloads the App client id |
| `PRIVATE_KEY_PATH` | No | — | Path to the App private key, read at boot if no credentials file exists |

Never commit any of these values, and keep `/secrets` off the image.

## Limitations

- The public App listing is not published, so installation today means running your own instance.
- The Pages-specific checks (record targets, serving, verification) only run when the domain came from Pages. Domains listed in `customdomain.yml` get the transport checks: CAA, certificate, HTTPS enforcement and hygiene.
- Checks are event-driven, not scheduled. A domain that breaks between pushes is caught on the next push, `check_suite`, or **Re-check**.
- State is a single JSON file on a volume. It is one process, not a cluster.

## License

MIT. See [LICENSE](LICENSE).
