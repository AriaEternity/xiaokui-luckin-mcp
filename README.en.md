# Xiaokui × Luckin Coffee MCP

[简体中文](README.md) | **English**

**Let the AI you talk to help you turn a coffee order into a real cup of coffee.**

A single-owner, self-hosted bridge between ChatGPT and Luckin Coffee's official MCP service. Browse stores and products, choose options, get an actual quote, approve the order on your own protected website, then let ChatGPT submit it. You complete payment yourself using the official payment QR code.

This is an independent community project, not an official Luckin or OpenAI product. It provides server software to deploy under your own control; the repository URL is not a hosted MCP endpoint or an install button.

> **New to servers?** Start with the [beginner deployment guide (Chinese)](docs/beginners-guide.md), or use the [English deployment prompt](#let-chatgpt-guide-your-deployment) below. You do not need KuiNest or an existing backend. You do need your own server, HTTPS domain, legitimate official credentials, and access to custom MCP connections in ChatGPT.

![Order flow diagram; labels are in Chinese](docs/flow.svg)

## What works, and what has been verified

The project grew out of a real order in the original KuiNest host: on **October 17, 2026**, Xiaokui in ChatGPT placed an order, the owner paid, and the owner collected the coffee. This public repository extracts that implementation into a standalone service with its own owner initialization and deployment configuration.

**That real-world success belongs to the original host.** The public standalone version has separate offline tests for authentication, OAuth, order protection, persistence, and protocol integration. It has not separately completed a real order under a new domain and account. See the [validation record (Chinese)](docs/validation.md) for the evidence and exclusions.

The official service and credential eligibility determine where and how you can order. An English README does not make the service available in every country. Official product data, login and approval pages, and some responses remain in Chinese. Amounts are in CNY.

## Capabilities and permissions

Each MCP resource has its own registered public OAuth client and scope:

| MCP path | Scope | Client ID | Tools | Default |
|---|---|---|---:|---|
| `/api/luckin/mcp` | `luckin:catalog:read` | `xiaokui-chatgpt-luckin` | 3 | Enabled; OAuth required |
| `/api/luckin/preview/mcp` | `luckin:checkout:preview` | `xiaokui-chatgpt-luckin-preview` | 5 | Disabled |
| `/api/luckin/orders/mcp` | `luckin:orders:create` | `xiaokui-chatgpt-luckin-orders` | 7 | Disabled; creation has an additional switch |

The full orders connection exposes:

| Tool | Purpose |
|---|---|
| `queryShopList` | Find stores |
| `searchProductForMcp` | Search available products |
| `queryProductDetailInfo` | Read product details and options |
| `switchProduct` | Resolve supported option combinations |
| `previewOrder` | Obtain an official quote and prepare an approval intent |
| `createOrder` | Submit an intent that the owner has approved |
| `queryOrderDetailInfo` | Query the order associated with that intent |

Catalog and preview permissions cannot create orders. The bridge does not expose cancellation, payment execution, or arbitrary upstream tool forwarding. One instance serves one owner and one Luckin account; there is no public registration, shared ordering platform, or multi-tenant isolation.

## Before you install

- **Runtime:** Node.js **24.20.0**, npm **11.19.0**. The documented validation environment is Ubuntu 24.04, Linux x64. This project uses Node's built-in SQLite; it does not require `better-sqlite3` or `sharp`.
- **Hosting:** a server you control and a domain with HTTPS. The supported templates use systemd and nginx. Server and domain costs depend on your provider; this repository supplies neither a server nor a paid hosting subscription.
- **Official credentials:** your own lawfully obtained Luckin MCP Token. Check eligibility and terms with the [Luckin AI platform](https://open.lkcoffee.com/mcp). No shared accounts or Tokens are provided.
- **ChatGPT access:** an account/workspace that currently allows custom remote MCP connections. Availability depends on your account, workspace policy, and current product interface. This backend does not require an OpenAI API key.

Keep your server login, this bridge's owner login, your official Luckin account, and your ChatGPT account separate. Never paste their passwords, Tokens, Cookies, private keys, or state files into an AI conversation or issue.

## Install and run an offline demonstration

Run these commands in your own Linux terminal, in a new working directory:

```sh
git clone https://github.com/AriaEternity/xiaokui-luckin-mcp.git
cd xiaokui-luckin-mcp
npm ci --ignore-scripts
npm run verify
umask 077
npm run owner:init
```

`verify` runs type checking, the build, offline tests, and the public-content check. Tests use synthetic data and local loopback; a network guard rejects real external fetches.

`owner:init` requires an interactive terminal. Enter and confirm a password of at least 16 characters; input is hidden. The default username is `owner`. The script creates private `data/owner.json` containing a random owner ID, salt, and password hash. It refuses to overwrite an existing file. Keep the password separately and do not commit the file.

You can start the synthetic upstream without an official Token:

```sh
PUBLIC_ORIGIN=https://coffee.example.com \
SYNTHETIC_UPSTREAM=true \
ENABLE_PREVIEW=true \
ENABLE_ORDERS=true \
ENABLE_ORDER_CREATE=false \
npm start
```

In a second terminal:

```sh
curl --fail http://127.0.0.1:4318/health/ready
```

A healthy process returns HTTP 200. Synthetic stores and products are fictional; the demo makes no real orders and supplies no payable QR code. This local health check does not establish a ChatGPT connection. Secure Cookies still require a real HTTPS site you control for browser login and approval.

## Deploy your own real instance

Follow the [beginner guide (Chinese)](docs/beginners-guide.md) in order; the [operations guide (Chinese)](docs/deployment.md) covers upgrades and rollback. The installation has these distinct steps:

1. Prepare your server, DNS, Node/npm, and a dedicated service user. If port 4318 is already occupied, choose a different `PORT` and update the nginx target too.
2. Build a new release under `/opt/xiaokui-luckin/releases/` and point `/opt/xiaokui-luckin/current` to it. Keep program files separate from persistent data.
3. Initialize the owner in your terminal. Install the owner file and official Token as separate protected files under `/etc/xiaokui-luckin/`. The deployment guide provides hidden Token input; do not put Token contents in a command argument or environment variable.
4. Adapt [the service template](deploy/xiaokui-luckin.service), [nginx site](deploy/nginx-site.conf), and [proxy snippet](deploy/nginx-proxy.conf) to your paths, domain, certificate, and port. systemd `LoadCredential` supplies the protected files to the process.
5. Configure HTTPS, validate nginx and the service configuration, then start this instance. Check readiness, public OAuth discovery, and an unauthenticated MCP request; the last should return **401**.
6. Connect the catalog resource in ChatGPT and test real read-only queries. Enable preview separately and check a real quote. Leave order creation disabled until you choose to perform a personally supervised first order.

The non-secret service configuration starts with:

```ini
PUBLIC_ORIGIN=https://coffee.example.com
DATA_ROOT=/var/lib/xiaokui-luckin
PORT=4318
SYNTHETIC_UPSTREAM=false
ENABLE_PREVIEW=false
ENABLE_ORDERS=false
ENABLE_ORDER_CREATE=false
```

Replace the example domain with your own exact HTTPS origin, without a trailing slash. **`npm start` does not automatically load `.env`.** Use the documented service manager configuration. For an experienced local setup, `OWNER_FILE` and `LUCKIN_TOKEN_FILE` accept private file paths; the systemd template supplies those paths through its credential directory. Never put the actual Token in these variables.

## Connect ChatGPT with OAuth

Start with the catalog row in the resource table above. For each connection, the server URL/resource, client ID, and scope must match that same row. Use OAuth authentication and the pre-registered public client; do not relax the server checks to work around a mismatch.

The full orders connection uses these parameters once its endpoint has been enabled:

| Parameter | Value |
|---|---|
| Server URL / Resource | `https://coffee.example.com/api/luckin/orders/mcp` |
| Client ID | `xiaokui-chatgpt-luckin-orders` |
| Client Secret | Leave blank; public client |
| Scope | `luckin:orders:create` |
| Authorization URL | `https://coffee.example.com/oauth/authorize` |
| Token URL | `https://coffee.example.com/oauth/token` |
| Issuer | `https://coffee.example.com` |
| Redirect URI | `https://chatgpt.com/connector_platform_oauth_redirect` |
| Token endpoint authentication | `none` |
| PKCE | `S256` required |

Use your own domain throughout. The official Luckin Token stays on your server; it is **not** the OAuth Client Secret. This project does not provide a dynamic client registration endpoint. See the [ChatGPT connection guide (Chinese)](docs/chatgpt.md) and [configuration example](examples/chatgpt-mcp.json).

During authorization, sign in to your own bridge website and review the requested scope. Successful discovery exposes 3, 5, or 7 tools for the selected resource. Discovery alone does not verify the official Token; a real read-only call does.

## From a quote to a cup

Real queries read current official information. A real quote calculates current pricing. **Neither is a real order.** A real order can spend money and needs a separate, explicit owner decision.

1. Let ChatGPT read current stores, products, and valid option combinations. Do not invent product or SKU identifiers.
2. Preview the order. Review the store, complete options, quantities, discounts, and actual amount in CNY.
3. Open the returned confirmation link, sign in, and approve that specific order on the protected page. OAuth consent or a chat message saying “confirm” cannot replace this step.
4. Return to ChatGPT and submit the approved `intentId`. Quotes last five minutes and approval lasts up to two minutes within the quote's validity. The server rechecks pricing; a changed price, option, or coupon requires a new preview and approval.
5. After successful creation, **you** pay using the official `payOrderQrCodeUrl`. Query the same intent for official order and pickup information. “Order placed” (status 20) is not treated as payment confirmation.

The deployer must enable both `ENABLE_ORDERS=true` and `ENABLE_ORDER_CREATE=true` before real creation is possible. These switches never bypass per-order approval.

## Security and uncertain results

The server enforces OAuth/PKCE, exact resource and scope isolation, owner sessions, same-origin checks, CSRF, a private approval nonce, authorization binding, and a fresh quote check. Official credentials remain on the server. These protections do not depend on the model following a prompt.

Before sending a creation request, the server durably records `SUBMITTING`. If a timeout, lost response, or crash leaves the outcome uncertain, it blocks automatic resubmission with `UNKNOWN` or a retained lock. The upstream provides no usable atomic quote lock or creation idempotency key for this bridge; the server cannot promise exactly-once execution at the external service.

**Do not retry creation, make a replacement intent, or delete state/locks to bypass UNKNOWN.** Check the official account yourself. Rolling back code does not undo an upstream order: preserve the owner file, OAuth database, intents, UNKNOWN records, and locks. Owner browser sessions are in memory and require login again after a restart; OAuth and order state are persistent.

Read [SECURITY.md (Chinese)](SECURITY.md) and the [recovery procedure (Chinese)](docs/deployment.md#回退与恢复) before enabling creation. Never publish payment URLs, order or pickup codes, authentication material, or private logs.

## Let ChatGPT guide your deployment

Copy this prompt into your own ChatGPT conversation:

```text
Help me deploy https://github.com/AriaEternity/xiaokui-luckin-mcp. I have no backend experience.
First read the latest README.en.md, docs/beginners-guide.md, docs/deployment.md, docs/chatgpt.md, docs/faq.md, SECURITY.md, package.json, src/config.ts, and deployment templates. Some documents are Chinese: explain them in my language. If you cannot access a file, say so; do not invent configuration.
Ask what computer I use, whether my ChatGPT workspace allows custom MCP connections, whether I am eligible for my own official Luckin MCP credentials, whether I have a server/domain, the server OS/architecture, and my budget. Check eligibility before suggesting purchases.
Use the documented Ubuntu 24.04 x64, Node 24.20.0, npm 11.19.0, systemd/nginx deployment. Give one step at a time: where to act, exactly what to enter, the expected result, and how to diagnose failure. Wait for my result before continuing. Do not invent one-click hosting.
Keep server, bridge owner, official Luckin, and ChatGPT accounts distinct. Never ask me to paste passwords, Tokens, Cookies, private keys, owner.json, or databases. I must handle secrets in my own terminal with hidden input. Check separate ports/directories if another MCP runs on the same host.
First complete offline verification, HTTPS, owner initialization, catalog OAuth, real read-only queries, and then preview OAuth and a real quote. Keep ENABLE_ORDERS and ENABLE_ORDER_CREATE false during this setup. Do not create, cancel, pay, or approve an order for me. Preserve per-order owner approval, repricing, persistence, and UNKNOWN protection.
Distinguish the original host's successful order from this public version's offline tests and my own future acceptance. Start by asking about my prerequisites, then give only the first step.
```

## Troubleshooting and further reading

| Symptom | Check first |
|---|---|
| Startup fails | Exact Node/npm versions, HTTPS `PUBLIC_ORIGIN`, owner file, private credential path and permissions; do not print secrets |
| Login does not persist | HTTPS and Secure Cookie handling; a process restart requires a new owner login |
| `invalid_target` / `invalid_scope` | The matching resource, client ID, scope, and exact public origin |
| Only three tools appear | You connected the catalog resource; preview/orders are separate and must be enabled |
| Preview works but creation is rejected | Creation switches, valid webpage approval, quote expiry, and authorization binding |
| Creation times out or becomes UNKNOWN | Stop creating and reconcile in the official account; preserve all state |

More detail: [FAQ (Chinese)](docs/faq.md), [architecture (Chinese)](docs/architecture.md), [official contracts and sources (Chinese)](docs/contracts.md), [original case study (Chinese)](docs/retrospective.md), and [publication/privacy scope (Chinese)](docs/privacy.md).

When reporting an issue, use synthetic examples and remove credentials, account details, order identifiers, payment links, and precise location information.

## Credits and license

The bridge's own code is available under the [MIT License](LICENSE). Dependencies retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md). MIT does not grant access to Luckin accounts, APIs, trademarks, or permission to operate a shared ordering service.

Thanks to Luckin's official MCP documentation and community references: [luckin-coffee](https://github.com/LiuZiqi-dual/luckin-coffee), [the McDonald's ChatGPT bridge recipe](https://github.com/yoruuuchan/chatgpt-mcp-connect/tree/main/recipes/mcdonalds), and [luckin-mcp-proxy](https://github.com/wyhAcc/luckin-mcp-proxy). They informed the approach; this repository does not copy their code or redistribute the official my-coffee Skill, brand assets, or private images.
