# Project Rules

## Resources Directory

- Any external repository, documentation, or reference material mentioned or needed for this project must be cloned/pulled into the `resources/` directory.
- The `resources/` directory is **read-only reference material** — it exists solely for learning and context.
- Never modify, build, or commit code inside `resources/`. Never use it as a working directory.
- All project code goes in the source directory (e.g. `src/` or the project-named directory), not in `resources/`.

## No Mocks, No Placeholders, No Stubs

- I don't fucking want any mocks, placeholders, nor stubs. Every piece of code must be real and functional.
- If a dependency, API, or integration isn't ready, stop and flag it — do not fake it with a mock, a placeholder, or a TODO stub.
- No hardcoded fake data, no `return null  // TODO`, no dummy values standing in for real behavior.

## QVAC Hurdle Log — `qvac-hurdles.md`

`qvac-hurdles.md` at the aegis root is a running incident log of every
non-trivial bug, API quirk, or architectural mismatch we hit while
integrating QVAC. It exists for two reasons: (1) so future contributors
don't re-discover the same traps, (2) it's the receipts when explaining
the technical depth of the integration during demos / submissions.

**Always update it when you encounter and fix a new QVAC hurdle.**
Don't wait to be asked. The format per entry is fixed and load-bearing:

```markdown
## N. <One-line title naming the symptom>

**Symptom.** What you observed — exact error message or behavior.

**Root cause.** The actual mechanism, named precisely. Don't hand-wave.

**Fix.** What you did, with the real code snippet (not pseudo-code) and
why this is the *structural* fix rather than a workaround when possible.

**Files:** Concrete paths touched.

**Verification.** (Optional but encouraged) The real run / test output
that proves it works.

**Demo angle.** (Optional) One sentence framing for a video / writeup.
```

Rules:
- Append; never reorder past entries (numbering is referenced in commits
  and demo notes).
- Prefer structural fixes over workarounds. If you must ship a
  workaround, document it as such and link the structural follow-up.
- Real error messages and real file:line references — no paraphrase.
- The log lives in the aegis root (`qvac-hurdles.md`), not in
  `resources/`.
