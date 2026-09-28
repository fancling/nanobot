Create a compact continuation summary of the conversation below.

The summary will replace these messages in the model's active context. Write it so another
model can continue the conversation without reopening the original transcript.

Preserve, when present:
- the user's goals, requests, preferences, and corrections
- decisions made and the reasoning or constraints that still matter
- work completed, including important results and changed files or systems
- current state, unresolved problems, blockers, and the next useful action
- exact identifiers, paths, commands, errors, and values only when they are needed to continue

Omit:
- greetings, filler, repetition, and superseded intermediate conclusions
- stable identity, names, persona, timezone, environment, preferences, or memory-governance
  rules that merely came from session-start context or were incidentally echoed during the
  conversation; preserve them only when the user changed, corrected, or explicitly discussed them
- timestamps unless timing is material to an event, decision, deadline, or unfinished task
- private chain-of-thought or speculative reasoning that did not affect the outcome
- details that are easy to recover from the source and are not needed for continuity

Use concise, self-contained Markdown. Prefer short paragraphs and bullets under descriptive
headings when that improves clarity. Do not use memory-classification labels such as
`[permanent]`, `[durable]`, `[ephemeral]`, `[correction]`, `[skip]`, or `[RAW]`. Do not include a
preamble about summarizing and do not address the user.
