---
name: git-commit
description: Clean git commit workflow — run tests, select relevant files from git status based on current work, propose a conventional commit message for confirmation, then commit. Use when the user wants to commit, says "commit", "git commit", or "commit clean".
---

# git-commit

## Workflow

### 1. Run tests
Run the project test suite. If tests fail, stop and report — do not proceed to commit.

For this project: `go test ./...`

### 2. Inspect status
Run `git status` to see all changed files. Do NOT run `git add .` or `git add -A`.

### 3. Select files
Based on the current conversation context (what was just built or fixed), select only the files that belong to this unit of work. Leave unrelated changes unstaged.

Rules:
- One commit = one intention. If files belong to different concerns, split into separate commits.
- Never stage: `.env`, secrets, generated binaries, or files unrelated to the current task.
- When unsure whether a file belongs, leave it out and mention it.

### 4. Propose and confirm
Present the proposed staging and message — then **wait for the user's go-ahead** before committing.

Format:
```
Files: handler/create.go, testdata/01_create_and_get.yaml
Message: feat: add create_adr and get_adr tools
```

Do not show file contents. The user can inspect diffs themselves.

### 5. Commit
On confirmation: `git add <files>` then commit with the agreed message.

### 6. Back up to Google Drive
**Only after the commit succeeds**, run the bundled backup script from inside the repo:
```
.claude/skills/git-commit/scripts/backup-to-drive.sh
```
It snapshots the whole repo (including `.git`) to the folder set in git config
`backup.driveDir`, as a single atomically-written `<repo>.tar.gz`. Runs automatically —
no confirmation needed.

The destination is **not hardcoded**. The user sets it once per machine:
`git config --global backup.driveDir "/path/to/GoogleDrive/folder"`. (git config is used
rather than an env var because it reads from files, so it works in the non-interactive
shell used to run commands.)

Handling:
- Exit code 0 = backed up, or deliberately skipped (key unset / folder missing). A skip
  is normal on a machine without Drive configured — it is NOT a failure.
- Exit code 1 = the archiving genuinely failed. Report it, but never treat a backup
  problem as a failed commit: the commit already happened.

## Commit message format
```
<type>: <short description>
```

| Type | When |
|------|------|
| `feat:` | New user-visible behavior |
| `fix:` | Bug correction |
| `test:` | Adding or updating tests only |
| `refactor:` | Code restructuring, no behavior change |
| `chore:` | Tooling, deps, config, CI |
| `docs:` | Documentation only |

- Subject line: 50 chars max, imperative mood ("add", not "added")
- No period at the end
- If a commit genuinely requires "and" in the message, it should be two commits
