# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| main    | :white_check_mark: |

This project is actively maintained. Security updates are applied to the main branch.

## Reporting a Vulnerability

If you discover a security vulnerability in the Agent Coordination Hub, please report it responsibly:

### How to Report

1. **Do NOT** create a public GitHub issue for security vulnerabilities
2. Email security concerns to the maintainers at [security@pistonlabs.com](mailto:security@pistonlabs.com)
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Any suggested fixes (optional)

### What to Expect

- **Acknowledgment**: Within 48 hours of your report
- **Initial Assessment**: Within 7 days
- **Resolution Timeline**: Depends on severity
  - Critical: 24-48 hours
  - High: 7 days
  - Medium: 30 days
  - Low: Next release cycle

### Scope

The following are considered security issues:

- Authentication/authorization bypasses
- Data exposure or leakage
- Injection vulnerabilities (SQL, command, etc.)
- Cross-site scripting (XSS)
- Sensitive data in logs or responses
- Insecure dependencies with known CVEs

The following are **not** in scope:

- Denial of service attacks
- Social engineering
- Issues requiring physical access
- Third-party services we integrate with

## Security Best Practices for Contributors

When contributing to this project:

1. **Never commit secrets** - Use environment variables
2. **Validate inputs** - Especially from external sources
3. **Use parameterized queries** - Avoid string concatenation for data
4. **Keep dependencies updated** - Run `npm audit` regularly
5. **Review OWASP Top 10** - Avoid common vulnerabilities

## Acknowledgments

We appreciate responsible disclosure and will acknowledge security researchers who help improve our security (with permission).
