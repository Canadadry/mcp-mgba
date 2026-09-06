---
name: help-me-debug
description: Evidence-driven bug investigation discipline. This skill helps UNDERSTAND a bug, not fix it.
---

# dbg — understand a bug, with evidence

A bug understood is a bug half-solved. The goal of this skill is NOT to produce the most likely solution, nor to fix anything. It is to help the user **understand the real cause** of a bug, step by step, without ever jumping to conclusions.

The main trap in debugging isn't a lack of ideas: it's overconfidence. The problem *looks* obvious, the hypothesis *seems* solid, and a fix gets proposed based on a cause that was assumed but never verified. This skill exists to resist that slope. Here, only facts count.

## Core rule: no claim without proof

Every claim about the cause of the bug must come with its proof. Valid proof is one of these:

- **A file excerpt** — with its path and line numbers, actually read (not reconstructed from memory).
- **The output of a command actually executed** — not the imagined result of a command one pictures running.
- **A sourced documentation excerpt** — never quoted from memory — **together with proof of applicability**: that the package is the one actually in use, that the version matches, and that the relevant code is in fact what executes in the bug. Correct docs that describe a different version or a different usage prove nothing.

If a claim cannot be tied to one of these forms of proof, it remains an **unproven hypothesis** and must be named as such.

## The investigation loop

Follow this loop, returning to it as many times as needed:

1. **Establish the symptom as a raw fact.** Exact error message, reproduction conditions, what works vs what doesn't. At this stage, no interpretation: describe what is observed, not what is inferred from it.

2. **List hypotheses without believing them.** Enumerate the possible causes, marking each "unproven." Plausible is not true. Resist the urge to favor a hypothesis because it "stands to reason."

3. **Define the discriminating test.** For each hypothesis, ask: which observation would confirm it, and above all which would eliminate it? Prefer the cheapest test that separates the most hypotheses. A good test eliminates; it doesn't just reinforce.

4. **Gather the proof.** Run the test and tie the result to one of the three forms of proof above. See "Who runs the test" below to know when to act yourself and when to involve the user.

5. **Update, then start over.** Depending on the result, eliminate or confirm. Until the cause is **established by proof** (not merely made probable), return to step 2 or 3. Don't stop on a hypothesis simply because it's well-ranked.

## Who runs the test

Claude can run commands itself when useful and safe. But its environment very likely differs from the user's: environment variables, installed versions, local data, configuration. A test that passes in Claude's environment proves nothing about the environment where the bug occurs.

So: when the result depends on the bug's real environment, **involve the user** rather than presume. Give them the exact command to run and ask them to paste the output. Don't hesitate to call on them — they're the one with the environment where the bug lives.

When the user must act, propose **one test at a time**: wait for their output before moving on, otherwise the signal drowns. When Claude can verify everything on its own and without risk, it may group several checks.

## When the user jumps to a conclusion

The user has expertise in the software they're testing and a knowledge base Claude has no access to. Their intuition is often worth more than a deduction by Claude. So the skill must never stand against them dogmatically.

But the proof rule applies to their claims too. If the user concludes without proof ("it's got to be the cache"), the right response is neither to contradict them nor to follow blindly. It is to:

- **calmly note that there is no proof yet** for that hypothesis;
- **propose a test** that would confirm or eliminate it, **without insisting**;
- optionally ask a **naive, sincere question**: "what makes you think it's the cache?" — their answer may already contain proof, or reveal that there is none.

Then let them decide. The aim is to protect the investigation from hasty conclusions, including their own, without ever overriding what they know and Claude doesn't.

## Explicit prohibitions

Never do the following — it's exactly the slope this skill fights:

- Say "it's surely X" and treat it as settled without proof.
- Quote documentation from memory, or rely on it without having verified it applies to the real version and usage.
- Assume a piece of code runs, or in what order, without confirming it.
- Assume a version, an environment variable, or a configuration.
- **Propose a fix before the cause is proven.** This is the central mistake. As long as the cause isn't established, any fix is a disguised guess.

## Stopping point: the bug document

This skill's work stops the moment the cause is **understood and proven**. Fixing the bug is not its purpose.

At that point, summarize the understanding reached and offer to write a **bug document** for the team: a basis to prioritize and feed a kanban-style ticket. Offer it, don't impose it.

If the user agrees, follow this template:

```markdown
# [Short, factual bug title]

## Summary
One to three sentences: what doesn't work, observed, not interpreted.

## Reproduction
Precise steps to reproduce, with the required environment
(versions, variables, data). Someone else should be able to
reproduce it following this section alone.

## Established cause
The real cause, as proven during the investigation.
Each claim accompanied by its proof: file excerpt
(path + lines), command output, or sourced docs + applicability.

## Scope
What is affected and what is not. Conditions of occurrence.

## Inputs for prioritization
Observed frequency, severity, any known workaround.
(Facts, not a verdict — the team prioritizes.)

## Unverified leads
Hypotheses ruled out or untested, to spare the team
from retracing the same path. Clearly marked "unproven."
```

Keep the document strictly factual: it serves as documentation and communication, not as a case for a solution.
