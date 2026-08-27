# Contributing to dsh-teams

Thank you for contributing to dsh-teams. This guide defines the required Issue, branch, commit, and pull request workflow.

## Prerequisites

- Git
- Node.js 22.12 or later
- npm

## Set Up the Repository

Install the development dependencies after cloning:

```bash
npm install
```

The `prepare` script installs the Lefthook Git hooks automatically:

```bash
lefthook install --force
```

You can reinstall the hooks at any time with:

```bash
npm run prepare
```

## Start With an Issue

Every change must start from a GitHub Issue.

- Describe the user-facing goal, relevant constraints, and acceptance criteria.
- Do not include collaborator attribution or generated-by information in the Issue title or body.
- Use the project Issue workflow so the branch remains linked to the Issue.

## Create the Branch

Create a branch for the Issue. Branch names follow this pattern:

```text
feature/<issue-number>-<short-english-phrase>
```

Examples:

```text
feature/12-add-user-invitations
feature/27-enforce-workspace-roles
```

The branch description must be a short English phrase. Do not use Chinese characters, pinyin, or unrelated wording in branch names.

## Make Focused Changes

- Keep each change scoped to its Issue.
- Do not mix unrelated refactors or formatting changes into the same pull request.
- Add or update tests in proportion to the behavioral risk.
- Update requirements, design documents, and operational guidance when behavior changes.
- Do not commit credentials, generated secrets, local environment files, or `node_modules/`.

## Commit Message Rules

Commit messages are checked by Commitlint and Lefthook through the `commit-msg` hook.

Use this format:

```text
<type>(<scope>): <subject>

<body>
```

All commits must have:

- an allowed type;
- a non-empty, lower-case scope;
- a non-empty subject;
- a non-empty explanatory body;
- body lines no longer than 100 characters.

Allowed types:

| Type | Purpose |
|---|---|
| `feat` | Add user-facing behavior |
| `fix` | Correct faulty behavior |
| `docs` | Change documentation |
| `style` | Change formatting without behavior changes |
| `refactor` | Restructure code without changing behavior |
| `test` | Add or change tests |
| `chore` | Maintain tooling or repository metadata |
| `ci` | Change continuous integration |
| `perf` | Improve performance |
| `build` | Change build behavior or dependencies |

Valid example:

```text
feat(auth): require password reset after invitation

Restrict invited accounts until the user replaces the temporary password.
Revoke the temporary session after the password change succeeds.
```

Invalid examples:

```text
add login
feat: add login
feat(Auth): add login
feat(auth): add login
```

The examples are invalid because they omit required structure, use an uppercase scope, or do not include a body.

## Prohibited Commit Trailers

The commit hook rejects these trailers case-insensitively:

```text
Co-Authored-By:
Made with:
Generated with:
Signed-off-by:
```

Do not add collaborator attribution, generated-by text, tool signatures, or sign-off trailers to commit messages.

## Verify Before Committing

Run the relevant project checks before committing. You can test a prepared commit message directly with:

```bash
./node_modules/.bin/commitlint --edit <commit-message-file>
```

A real `git commit` runs both Commitlint and the prohibited-trailer check automatically. Do not bypass hooks with `--no-verify`.

## Open the Pull Request

- Push the Issue branch and open a pull request against `main`.
- Link the pull request to its Issue with `Closes #<issue-number>` or an equivalent GitHub closing keyword.
- Explain the user-visible outcome, security implications, and verification evidence.
- Keep the title consistent with the Conventional Commit format when practical.
- Do not include collaborator attribution or generated-by information in the pull request title or body.
- Do not merge while required checks are failing or the design remains unresolved.

## Finish the Issue

After the pull request is merged:

1. Confirm the linked Issue is closed.
2. Return to `main` and pull the latest changes.
3. Remove only the local branch associated with that Issue.
4. Prune stale remote-tracking references.

Do not delete branches belonging to other Issues.

## License

By contributing, you agree that your contributions are licensed under the [Mozilla Public License 2.0](LICENSE).
