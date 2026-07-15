# Custom Domain Checks (GitHub App)

Continuous DNS and TLS health checks for custom domains on GitHub Pages sites, by [Custom Domain](https://customdomain.ai).

Install it on any repository with a custom domain and it runs a **Domain health** check on every push, plus a single tracking issue when your domain breaks. It grades nine signals:

1. DNS resolution
2. Record type (CNAME for subdomains, A/AAAA or ALIAS for apex)
3. Target correctness (CNAME to `<owner>.github.io`, or the four `185.199.108-111.153` apex IPs)
4. Served by GitHub Pages
5. Domain verification (the takeover-protection TXT record and `protected_domain_state`)
6. CAA compatibility with Let's Encrypt
7. TLS certificate validity and expiry
8. HTTPS enforcement
9. DNS hygiene (MX-on-CNAME conflicts, domain length)

Zero runtime dependencies: Node core modules and `fetch` only. The service verifies webhook signatures (HMAC SHA-256, constant-time), mints an app JWT (RS256), exchanges installation tokens, and reports through the Checks and Issues APIs.

## Install

**[Install Custom Domain Checks →](https://github.com/apps/custom-domain-checks)**

## Run it yourself

```bash
docker build -t custom-domain-checks .
docker run -p 8787:8787 -v $(pwd)/secrets:/secrets custom-domain-checks
```

The service registers itself through the GitHub App Manifest flow: visit `/github-app/register`, click Create, and the callback stores the app id, private key, and webhook secret in `/secrets`.

Maintained by [CustomDomain.ai](https://customdomain.ai).
