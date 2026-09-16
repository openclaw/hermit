# Changelog

## Unreleased

- Fix ClawHub appeals accepting client-supplied account context, and revalidate new and pending appeals against the authenticated GitHub applicant before unbanning. Thanks @SebTardif for the report and intake fix.
- Reject crafted GitHub summary owner/repository paths before authenticated requests while preserving configured installation access. Thanks @SebTardif for the report and path validation fix.
