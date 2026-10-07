# Changelog

## Unreleased

- Refresh Worker and forwarder runtime/build dependencies and Cloudflare types, including React 19.3, React Router 8.4, PostCSS CLI 12, and Wrangler; document the existing Node.js 22.22.0 build minimum.
- Authenticate GitHub summaries with downloaded GitHub App RSA keys as well as PKCS#8 keys, instead of silently falling back to anonymous requests.

- Fix ClawHub appeals accepting client-supplied account context, and revalidate new and pending appeals against the authenticated GitHub applicant before unbanning. Thanks @SebTardif for the report and intake fix.
- Reject crafted GitHub summary owner/repository paths before authenticated requests while preserving configured installation access. Thanks @SebTardif for the report and path validation fix.
- Avoid duplicate channel webhooks when concurrent automod events reach an empty cache in the same Worker instance.
