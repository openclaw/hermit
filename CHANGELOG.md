# Changelog

## Unreleased

- Remove Shell Society nomination commands, voting, role-grant/card/expiry recovery and the nomination-only cron for the Barnacle handoff. Preserve archived D1 history and decouple social guild configuration.
- Stop automatically registering Discord commands on Worker requests and cron events; run `bun run commands:deploy` after the first deployment and command-definition changes to avoid repeated guild-command writes and rate limits.
- Refresh Worker and forwarder runtime/build dependencies and Cloudflare types, including React 19.3, React Router 8.4, PostCSS CLI 12, and Wrangler; document the existing Node.js 22.22.0 build minimum.
- Authenticate GitHub summaries with downloaded GitHub App RSA keys as well as PKCS#8 keys, instead of silently falling back to anonymous requests.

- Fix ClawHub appeals accepting client-supplied account context, and revalidate new and pending appeals against the authenticated GitHub applicant before unbanning. Thanks @SebTardif for the report and intake fix.
- Reject crafted GitHub summary owner/repository paths before authenticated requests while preserving configured installation access. Thanks @SebTardif for the report and path validation fix.
- Avoid duplicate channel webhooks when concurrent automod events reach an empty cache in the same Worker instance.
