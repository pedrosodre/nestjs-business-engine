# Security Policy

## Supported versions

Security fixes are released for the latest major version. Older majors may receive fixes on their `N.x` maintenance branch when the impact justifies it.

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |

## Scope

Rules are often authored outside the application code, so the engine treats them as untrusted data. Reports are especially welcome for:

- a rule (transform, condition or formula) that executes JavaScript or reaches Node.js APIs,
- a rule that pollutes prototypes or changes objects outside its own result,
- a rule that blocks the process despite a configured `timeout`.

Functions passed as `bindings` are trusted application code and are out of scope.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report it privately through GitHub's [private vulnerability reporting](https://github.com/pedrosodre/nestjs-business-engine/security/advisories/new) (Security tab → "Report a vulnerability"). Include:

- the affected version(s),
- a description of the issue and its impact,
- steps or a minimal project to reproduce it (for example the rule and payload).

You can expect an acknowledgement within 7 days. Once the issue is confirmed, a fix is prepared privately, released, and a security advisory is published crediting you, unless you prefer to stay anonymous.
