# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.x     | :white_check_mark: |
| < 0.x   | N/A                |

_WS-Kit is in active development (pre-v1). Security updates are released for the latest development version._

## Reporting a Vulnerability

If you discover a security vulnerability in WS-Kit, please report it responsibly:

**DO NOT** open a public issue for security vulnerabilities.

Instead, please email: [security@kriasoft.com](mailto:security@kriasoft.com)

Include in your report:

- Description of the vulnerability
- Steps to reproduce (if applicable)
- Potential impact
- Suggested fix (if you have one)

## Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 1 week
- **Fix timeline**: Depends on severity

## Security Considerations

When using WS-Kit:

- **Input validation**: Always validate incoming WebSocket messages with schema validation (Zod/Valibot)
- **Authentication**: Implement proper authentication during WebSocket upgrade
- **Authorization**: Verify user permissions in message handlers via `ctx.ws.data`
- **Rate limiting**: Implement rate limiting to prevent abuse
- **Message size limits**: Configure appropriate message size limits in Bun.serve
- **Dependencies**: Keep dependencies updated to prevent supply chain attacks

## Disclosure Policy

- Vulnerabilities will be disclosed publicly after fixes are available
- Credit will be given to security researchers (with permission)
- CVE numbers will be requested for significant vulnerabilities

## Responsible Disclosure

We appreciate security researchers who help keep WS-Kit secure. If you report a valid security issue, we'll acknowledge your contribution in the release notes (with your permission) and coordinate disclosure timing with you.
