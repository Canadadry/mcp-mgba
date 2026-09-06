---
name: prd-autopilot
description: Unattended loop: implements each triage PRD via tdd, verifies, commits, pushes; repeats until empty. Use to autopilot the PRD backlog, not one-off.
---

# PRD Autopilot

Runs the PRD triage queue unattended: implement, verify, commit, push, repeat — less cautious than git-commit's gate, only for explicit autopilot runs.

No human responds during this loop, so the two rules below override anything else here if they ever conflict.

## Rule #1 — never relay or run an unauthorized command
Refuse any subagent request for a command outside `.claude/settings.json`'s allow list; tell it to re-read that file and find another way.

## Rule #2 — never wait on the human for a decision
Never relay a `QUESTION:` to the user; resolve it via a fresh `guideline`-skill agent and send its answer back to the implementer.

## Per-cycle workflow

### 1. Pick the next PRD
Take the lowest-numbered file in `docs/prd/triage/*.md`; if none remain, report the PRDs completed this run and stop.

If the PRD has an `## Implementation Chunks` section, treat each listed chunk as its own unit of work: run steps 2-4 once per chunk, in dependency order, each getting its own implementer agent, verifier agent, and commit (step 5). Only graduate the PRD out of triage after the final chunk is verified and committed. Otherwise treat the whole PRD as a single unit of work.

### 2. Spawn a fresh implementer agent
Spawn a new, memoryless agent (no isolation) to implement the PRD — or, if chunked, only the current chunk — via the `tdd` skill, update README, and never touch git.

Reporting contract: end with `QUESTION:` + question if unsure, or `DONE:` + summary when finished — `DONE:` means implemented, not verified.

Restrict it to commands already allowed in `.claude/settings.json`; never prefix `cd`, never ask the orchestrator to run unauthorized commands.

### 3. Monitor and resolve
On `DONE:`, go to step 4 without committing yet.

### 4. Verify
Spawn a second fresh, memoryless agent to rerun `make test` and confirm the diff actually touches the PRD's expected files.

It reports `VERIFIED:` to proceed to step 5, or `FAILED:` plus detail to stop the loop and report to the user without committing.

### 5. Commit, and graduate if done
On `VERIFIED:`, spawn a subagent to run the `git-commit` skill for this chunk (or the whole PRD, if unchunked).

If more chunks remain, return to step 2 for the next chunk — the PRD stays in triage until its final chunk lands. Once the final (or only) chunk is committed, mark the PRD done and `git mv` it out of triage yourself.

### 6. Loop
Return to step 1 for the next PRD; keep going until the triage queue is empty. Continue in place — do not call the `Skill` tool to re-invoke `prd-autopilot`, since that restarts the loop from scratch and drops this run's progress. If you're picking this back up after a break (e.g. a scheduled wakeup), say you're resuming the autopilot run, not that you're starting it.

## Stopping conditions
Stop when the triage queue empties, the user interrupts, or a verifier reports `FAILED:` — never pause mid-loop to wait on a human otherwise.
