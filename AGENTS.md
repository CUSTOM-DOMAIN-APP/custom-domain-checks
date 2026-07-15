# AGENTS.md

Instructions for AI coding agents working with this repository or implementing custom domains.

## What this is

Custom Domain (customdomain.ai) is managed infrastructure that lets a platform's users connect their own domain in one click: automatic DNS configuration, CNAME/TXT ownership verification, and automatic SSL/TLS issuance and renewal. 63 DNS and registrar providers are supported (25+ fully auto-configured via provider authorization; the rest through a guided flow with automatic verification).

## Connect a domain in 3 steps (REST)

Base URL: `https://app.customdomain.ai` (API docs: https://app.customdomain.ai/docs/api-reference)

```bash
# 1. Create a connection for the user's domain
curl -X POST https://app.customdomain.ai/v1/connections \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"domain": "app.customer.com", "application_id": "<app>"}'

# 2. Start one-click provider authorization (or fall back to guided manual records)
curl -X POST https://app.customdomain.ai/v1/connections/<ID>/oauth:start \
  -H "Authorization: Bearer $API_KEY"

# 3. Poll until live (DNS written, ownership verified, TLS issued)
curl https://app.customdomain.ai/v1/connections/<ID> \
  -H "Authorization: Bearer $API_KEY"
```

Endpoint shapes are illustrative; always follow https://app.customdomain.ai/docs/api-reference for exact schemas.

## MCP server (for agents)

Hosted MCP endpoint: `https://mcp.customdomain.ai/mcp` (streamable HTTP, OAuth client credentials via `https://mcp.customdomain.ai/token`). Eleven tools: search and register domains, create and verify connections, manage DNS records, check TLS status.

```bash
claude mcp add --transport http customdomain https://mcp.customdomain.ai/mcp
```

Docs: https://app.customdomain.ai/docs/mcp/overview

## Key references

- Product: https://customdomain.ai
- Documentation: https://app.customdomain.ai/docs (agent index: https://app.customdomain.ai/docs/llms.txt)
- Embeddable widget: https://customdomain.ai/connect-domain-widget
- Sign up (free tier): https://app.customdomain.ai/signup

## Conventions for edits in this repo

Markdown only. No em dashes or en dashes anywhere. Plain, technically accurate language. American English. Keep files under 300 KB.
