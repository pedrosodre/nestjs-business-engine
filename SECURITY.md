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
- a rule that blocks the process despite a configured `timeout`, other than the known limitation below.

Functions passed as `bindings` are trusted application code and are out of scope.

### Known limitation of `timeout`

The timeout is checked between the steps of a JSONata formula. It cannot interrupt a single operation that is slow on its own: a regular expression with catastrophic backtracking (in a formula or in a sift `$regex` condition, which is not time-limited) or `$sort` on a very large array. If rule authors are not trusted, run the engine in a worker thread or a separate process that you can terminate.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report it privately through GitHub's [private vulnerability reporting](https://github.com/pedrosodre/nestjs-business-engine/security/advisories/new) (Security tab → "Report a vulnerability"). Include:

- the affected version(s),
- a description of the issue and its impact,
- steps or a minimal project to reproduce it (for example the rule and payload).

You can expect an acknowledgement within 7 days. Once the issue is confirmed, a fix is prepared privately, released, and a security advisory is published crediting you, unless you prefer to stay anonymous.
