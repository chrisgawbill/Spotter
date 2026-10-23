---
name: handoff
description: >-
  Take an existing implementation plan document and execute it by delegating to code-only
  Sonnet agents divided by non-overlapping file ownership. You do all the thinking; agents
  only write code and report questions up. Use when the user points at a plan/spec file and
  asks to implement it, divide it up, delegate it, or hand it off, or invokes /handoff.
  Not for work that has no written plan yet — investigate and write one first, then hand off.
---

# Handoff

The user points you at an implementation plan. You execute it by splitting it across
Sonnet agents that **only write code** — every judgement call stays with you.

Two rules define this skill, and everything below serves them:

1. **Agents code; they do not think.** Any decision an agent would have to *make* is a
   decision you failed to freeze before dispatching. Frozen decisions in, code out.
2. **No two agents may ever write the same file.** Not "mostly"; never.

Speed is not the goal. The goal is that the plan gets implemented with its reasoning
intact, and that uncertainty reaches a human instead of being resolved by whichever agent
tripped over it.

## 1. Read the plan, then verify it against the code

Read the whole plan document before doing anything. Then **re-validate its claims against
the current repository** — plans are written against a snapshot and the tree has moved.
Read the project's own instruction files (`AGENTS.md`, `CLAUDE.md`, nested ones) too.

For each finding the plan asserts, confirm it still holds and cite where: `file.ts:line`.
Record which findings were confirmed, which were already fixed, and which are now wrong.

Do not delegate this step. An agent re-deriving your context will disagree with it.

Also capture, because agents get this wrong otherwise:

- Runtime prerequisites (node/toolchain version, services that must be running).
- The **test baseline** — what already fails before anyone touches anything. An agent
  without the baseline reports pre-existing failures as its own regressions, or "fixes"
  them.
- Existing structures to extend rather than duplicate. Check whether a table, repository,
  or module the plan wants to invent already exists in compatible form — and whether it
  has properties (portability, replication, export inclusion) that make it the *wrong*
  place for the new state.

## 2. Freeze the contracts before you dispatch anything

This is the step that makes agents coders instead of designers, and the step most
tempting to skip.

Write a `docs/plans/<topic>-contracts.md` containing the **exact** type signatures,
function names, table and column names, and enum members that every agent will implement
or import. Head it with:

> These types are decided. Do not redesign, rename, or "improve" them. If a contract
> genuinely cannot be implemented as written, stop and report it to the coordinator
> instead of substituting your own design.

Freezing contracts up front buys something specific: **agents can code against a port
before its adapter exists.** An agent implementing business logic against a frozen
storage interface does not have to wait for the agent building the storage. That is what
turns a strictly sequential plan into something parallelizable.

Encode dangerous decisions as *functions*, not prose. If a rule says "only advance the
checkpoint when X" or "only clear the credential when Y", write
`permitsCheckpointAdvance(decision)` into the contract. A code-only agent will follow a
predicate; it will not reliably follow a paragraph, and the failure is usually silent.

## 3. Divide by permanent file ownership, never by plan phase

Plans are organized by phase. **Do not assign agents by phase.** Phases collide on files:
one hot file (a provider, a client, an orchestrator) is typically a target in four
different phases, and four phase-agents would all edit it at once.

Instead: give every file **one owner for the whole effort**, then distribute the plan's
phases across those owners. Two agents then never touch the same file even where their
phases overlap.

Build the ownership table by:

- Listing every file the plan names as a target, plus every caller you found.
- Grouping them by *surface* — mobile session lifecycle, host transport, schema, one
  subsystem, the UI layer.
- Checking file sizes. A 900-line file that five phases touch is a strong signal it should
  be exactly one agent's, late in the sequence.

Write the table into a coordinator-owned progress file: agent name, owned paths, which
plan phases it covers.

### Waves

Order the owners into waves where a wave's agents are mutually disjoint *and* their
dependencies are satisfied:

- **Wave 1: contracts and storage.** Mostly new files, so nothing collides.
- **Wave 2: the lifecycle/transport layer** the rest depends on.
- **Wave 3: subsystems**, coding against frozen ports.
- **Wave 4: the UI/surface layer**, which usually owns the hot orchestrator file.

### Parallel or serial — decide deliberately

Launching a wave in one message runs it in parallel. That is the right default only when
budget is not a constraint.

Under a spend cap, **prefer serial.** A wave of three agents costs ~500k tokens and, if
the cap is hit mid-wave, every one of them dies before writing its report — and the
reports are what make the *next* wave cheap. Losing three reports to save wall-clock time
is a bad trade you make once and pay for repeatedly. One agent at a time is far likelier
to reach its final step, and a solo agent can also run the **full** test suite and lint
rather than a subset, which is how concurrent waves let regressions slip past.

Signals you are on a budget that will interrupt you: an agent dying with a rate-limit or
spend error, or a reset window that moves later between waves (a cap refilling slower
than you spend). When you see either, switch to serial and tell the user plainly — raising
the cap is their decision, not something to route around silently.

### The caller-integration cost — name it out loud

Non-overlapping scope has a real price: a phase whose exit criteria require updating
callers **cannot close inside its own file boundary**, because the callers belong to other
owners.

Handle it explicitly rather than letting it rot. Require every agent whose change is
visible to callers to emit a section titled **"Required caller changes"**: each call site,
the file that owns it, and exactly what that owner must change — specific enough to apply
without re-deriving the design. Fold those into the later waves' briefs.

Then say plainly, in the progress file and to the user, that those phases are **not
complete** until the caller edits land. Do not report them done early.

## 4. Pre-load the context so agents never start cold

A subagent begins with nothing. Left to itself it reads the whole plan, the whole
contracts file, and the whole progress document before touching a line of code — on a
real project that is ~25k tokens of preamble, most of it about phases that are not its
job.

**The cost is multiplied, not one-off.** Everything an agent reads early rides along in
every subsequent request for the rest of its life. A 75-tool-call agent pays that 25k on
all 75 turns. Trimming the front of an agent's context is the highest-leverage thing you
do, and it is worth real effort before dispatch.

So: **you** assemble each agent's context, because you already have it. Never make an
agent re-derive what you know.

### The two files

Write both under `docs/plans/<topic>-handoff/`.

**`STATE.md` — one file, coordinator-owned, OVERWRITTEN every wave.** The current-state
fact sheet, and it must stay under ~150 lines. Not a log. A log grows without bound and
agents read all of it, which recreates the problem you are solving. Narrative history for
humans belongs in the progress document; agents get facts:

- What has landed and is verified (one line each, no story).
- The verification baseline as exact numbers — typecheck counts, test file/test counts,
  lint counts. Without it agents report pre-existing failures as their own regressions.
- Frozen decisions and resolved ambiguities, each in one sentence.
- Known-bad patterns specific to this repo (imports that don't resolve, files that must
  stay free of a native dependency, generated directories excluded from tooling).
- What is in flight and who owns it.

**`<agent>.md` — one per agent, written before dispatch.** Its whole context, assembled:

- The **phase slice extracted verbatim** from the plan — the agent's sections only. This
  is the single biggest saving; a plan is mostly other people's phases.
- The **contract signatures it will use**, pasted in, not cited by section number.
- Its **exact file list**, with `path:line` anchors for the specific call sites it must
  change.
- **What already landed in its files** and must not be redone or reverted.
- The **required tests**, enumerated.
- The **verification commands** and the baseline numbers.

Then the prompt says: *read your brief and STATE.md first; they are your context. Do not
read the full plan or the progress document.*

### The escape hatch — do not seal an agent off

Never write "use only this summary and nothing else." If your brief is wrong or stale, a
sealed-off agent implements against a false picture confidently and cannot discover the
error, which is exactly the failure the escalation chain exists to catch.

Put this in every brief instead:

> This brief is your primary context and is meant to be complete. But it is a summary
> written by someone else, and it can be stale or wrong. If the actual code contradicts
> it, **the code wins** — follow the code, and report the discrepancy to the coordinator.
> Read beyond this brief when you genuinely need to; just don't re-read the full plan to
> rediscover what is already written here.
>
> **When you need context or judgement this brief does not give you, ask the coordinator
> rather than working it out yourself.** Send it with
> `SendMessage({to: "main", message: "..."})` — you are a background subagent, so `"main"`
> reaches the coordinating Opus session that briefed you. Say what you were doing, the
> specific question, and what you would do absent an answer. Then **stop and wait**; the
> coordinator replies by messaging you back, which resumes you with your context intact.
> If `SendMessage` is unavailable to you, stop and put the question at the top of your
> report instead.
>
> Which way to go:
> - **Local and checkable** — what a function returns, which shape a row has, whether a
>   guard exists: read the code. That is not a question, that is your job.
> - **Design, scope, contract, or priority** — the brief is silent or ambiguous, two
>   readings lead to different implementations, the contract seems wrong, the change wants
>   a file you do not own: **ask.** Do not decide it yourself. Thinking is the
>   coordinator's job and it has the whole picture; you have one slice of it.
> - **Already resolved provisionally** — you made a call to keep moving: it still goes in
>   `## ESCALATIONS`, even if the tests pass.

The division only holds if asking is genuinely cheaper for the agent than guessing. Say so
explicitly: **a question costs one round trip; a confident wrong guess costs a debugging
cycle and can reach production.** An agent that has been told it is a coder, and then
quietly makes an architectural decision because asking felt like failure, is the exact
outcome this skill exists to prevent.

Budget for it. Expect questions mid-wave, answer them promptly, and resume the agent by
messaging it back rather than relaunching — a relaunch pays the cold-start cost all over
again, which is what the briefs were for.

### What this does not fix

Be honest with yourself about the ceiling. The irreducible cost is reading the source
files an agent edits and iterating on test output — on a 900-line component that dwarfs
any briefing saving. Pre-loading context buys maybe 10-15% directly, more once the
per-turn multiplier is counted. **The bigger lever is scope**: a smaller, sharper task
finishes in fewer turns, and turns are what you are actually paying for.

## 5. Write the agent prompts

One agent per owner. Use the Agent tool with **`subagent_type: "coder"`** (defined in
`.claude/agents/coder.md`). Never `general-purpose`.

### Why the `coder` agent type, and what it can and cannot strip

A spawned agent pays fixed overhead before it reads a word of your brief. Measured on a
real run, `general-purpose` agents hit ~70k tokens almost immediately, and the brief was
~3k of that. The `coder` definition exists to cut the rest:

- **System prompt**: a custom agent gets its own short markdown body, not the full Claude
  Code system prompt. The standing role, ownership rules, prohibitions, escalation contract,
  and honesty clauses live there, so they are not retyped into every delegation prompt.
- **Tools**: an allow-list of `Read, Edit, Write, Bash, Grep, Glob, SendMessage`. No MCP
  servers, no browser, no Drive/Gmail tool definitions.
- **Cache TTL**: `experimental.cacheTtl: 1h`. Subagents default to a 5-minute cache, so an
  agent that waits on a long test run or on your reply re-pays its whole context. (Ignored
  while the subscription is on usage credits.) Caches are per-conversation; do not assume
  two spawns share one.
- **User-level CLAUDE.md cannot be skipped.** Every custom subagent loads the full CLAUDE.md
  hierarchy; only built-in Explore/Plan skip it. The coder body neutralizes the parts meant
  for interactive sessions (Notes section, teaching) instead. It is a few hundred tokens.
- **context-mode cannot be skipped per agent.** Its `PreToolUse` hook on `Agent` appends a
  ~1.2k-token routing block to every delegation prompt, and its Read/Bash/Grep hooks add tips
  inside the agent. The coder body tells the agent it has no `ctx_*` tools and to ignore
  both. Removing the injection itself needs a plugin change.
- **ponytail stays** (its `SubagentStart` hook injects ~1.3k tokens). The coder body scopes
  it: ponytail governs how code is written inside the contract, never whether a contracted
  item is built — that conflict is an escalation.

### What each delegation prompt carries

Because the standing rules live in the agent definition, the prompt is short and specific.
**Put the stable part first and the agent-specific part last** so the prefix is as uniform
as possible. Every prompt carries:

- **Identity**: agent name and repo path.
- **A numbered read-first list**: its brief, then `STATE.md`, then project instruction
  files, then the specific existing files whose conventions it must match. Name what NOT
  to read — the full plan and the progress narrative — and say its brief already carries
  their relevant contents.
- **The file-ownership boundary**, as an explicit allow-list — plus a named deny-list of
  what other agents own *and* that those agents are editing concurrently **right now**.
- **The task**, as numbered imperatives traceable to the plan.
- **What to keep.** Name the existing code that must not be regressed and why. Agents
  delete load-bearing guards they do not recognize.
- **Required tests**, enumerated from the plan.
- **Exact verification commands**, including runtime setup (e.g. `nvm use` — an agent that
  skips it can report environment-skipped tests as passing), plus: *do not run the full
  suite — other agents are editing concurrently and you will see unrelated failures.*
  Check the linter actually covers the files; a root config that ignores a package makes
  "eslint: 0 errors" meaningless.
- **Its own report path**: `docs/plans/<topic>-progress/<agent>.md`.

Prohibitions, how to reach you via `SendMessage`, the escalation contract, and honesty
clauses are already in the `coder` definition. Repeat one in the prompt only when this task
sharpens it (e.g. naming the specific unverifiable device checks).

**This does not excuse the brief.** The escape hatch still goes in every brief, in full,
exactly as written above — `coder.md` and the brief do different jobs. `coder.md` tells the
agent that asking is allowed; the brief is what it is actually reading when it hits *this*
ambiguity and decides whether *this one* is worth asking about. Quote the block whole: the
routing list (local and checkable -> read the code; design, scope, contract, priority ->
ask) is the part that does the work, and a brief that stops after "read beyond this brief
when you genuinely need to" has kept the permission and dropped the routing. Naming only
the report and its `## ESCALATIONS` section biases the agent toward the after-the-fact
path, which is the weaker of the two — by then the code is already written.

### Never let two agents write one progress file

Each agent writes its *own* report file. The main progress document is
**coordinator-owned**; agents are told explicitly not to write it. Concurrent writes to a
shared progress file clobber each other silently.

### Pre-wire cross-agent dependencies

If agent A needs something from a file agent B owns, put that request in **B's** prompt
("expose this distinction, document the exact shape in your report") and tell A to consume
it as-is and report if it is missing. Never let A edit B's file "just this once".

### Honesty clauses

These are standing rules in `coder.md`; name the task-specific unverifiable checks in the prompt. Agents may not claim:

- No claiming device/platform verification from mocks or unit tests.
- If an external dependency is unavailable (a real database, a device, a live account),
  they must write the honest coverage they *can* and mark the rest **explicitly
  unverified**, listing the exact tests still owed. "An honest gap is required; a mock
  presented as proof is not acceptable."

### Escalation contract

This text lives in `.claude/agents/coder.md`; it does not need to be pasted into prompts. If you change it here, change it there — the agent reads that copy.

> Under-escalating is the failure mode, NOT over-escalating. If you are not genuinely
> confident about a decision, do not guess and do not paper over it.
>
> **There are two ways up, and the first one is better.** If the uncertainty BLOCKS you —
> you cannot write the next line without deciding something that is not yours to decide —
> ask the coordinator now with `SendMessage({to: "main", message: "..."})` and stop. You
> are a background subagent; `"main"` is the coordinating Opus session that briefed you,
> it holds the whole plan and every other agent's report, and answering you is its job,
> not an interruption. It resumes you by messaging back, so you keep your context. A
> question costs one round trip; a confident wrong guess costs a debugging cycle.
>
> If you could keep moving and did, it goes in the report. End with `## ESCALATIONS`, or
> `## ESCALATIONS\nNone.` — writing "None" is an affirmative claim of genuine confidence in
> every decision you made, and it will be read that way. Resolving an uncertainty by
> guessing counts as an escalation even if the tests pass. For each: what you were
> deciding, the options, what you did provisionally, and why you are not confident.
>
> Never expand your own scope to resolve a question. If the fix wants a file you do not
> own, or the contract looks wrong, that is a message to the coordinator, not a decision
> to make. Reaching for an out-of-scope file has already happened on this pattern; the
> coordinator would far rather reassign than discover it afterwards in a diff.

## 6. Verify independently — reports are evidence, not results

Never accept a completion report at face value. For each returned agent:

- **Re-run the verification yourself.** Agents run subsets, or the wrong environment.
- **Typecheck both/all surfaces**, not just the test suite. Tests do not catch type drift
  in files nobody imported yet.
- **Read the diff**, not the summary.
- **Confirm the ownership boundary held** — that no agent wrote a file it did not own.
- **Confirm the barrel/export wiring landed.** New modules that are never exported are
  invisible to every other agent, and tests on them still pass, so this gap hides well.
- **Review flagged ambiguities yourself.** An agent's resolution may be fine while
  revealing a contract gap it could not see. Fix the contract, then update the frozen spec
  so later waves inherit the rule.

## 7. Escalation routing — where your own questions go

Agents escalate to you. You resolve what you can from the full picture.

**If you are also not confident, it goes to a human — or to another model the user has
running.** Check with `ListAgents` for a peer session, and if one is reachable, message it
with `SendMessage`. Otherwise ask the user. Do not resolve a genuine uncertainty by picking
the more plausible option; that is the one rule this whole chain exists to protect.

When asking, give the decision, the realistic options with consequences, and your
recommendation. A question with no recommendation dumps the analysis back on them.

## 8. When agents die mid-flight

Interrupted, killed, and rate-limited agents leave **partially applied edits**, and a
half-edited tree can be worse than an unstarted one.

1. **Assess the disk first.** What files exist, what is half-written, what reports landed.
   Do not assume a stopped agent wrote nothing, or everything.
2. **Typecheck and test immediately** to find breakage. A killed agent often leaves a file
   importing something it never created.
3. A stopped agent generally **cannot be resumed** — relaunch a fresh one scoped to *only*
   the remaining work, and tell it explicitly which parts are already done and verified so
   it does not re-review passing code.
4. If no agent can run (rate limit, spend cap), **stabilize the tree yourself** and leave
   it compiling and green. Do not hand back a broken tree.

## 9. Traps worth checking for by hand

Learned the hard way; each is cheap to check and expensive to miss.

- **Never tell an agent to fall back to deep subpath imports** if a barrel export "isn't
  wired yet". Packages usually export only the barrel, and this single instruction can
  produce dozens of cascading type errors. Sequence the export wiring instead.
- **Widening a return type to a discriminated union silently inverts every truthiness
  check in its callers.** `if (session)` was false for the failure case and is now *always
  true*, because a result object is truthy. Grep every call site; the compiler will not
  catch it where the value is only tested for truthiness.
- **Native/pure import boundaries.** Adding one import can drag a native module into a
  previously node-testable file and break test *collection* (not assertions) for
  everything that imports it. Defer the dependency to call time, or keep the logic pure.
- **Git worktrees and build output get collected as test files.** A worktree is a full
  second copy of the repo with no `node_modules`; exclude it in the test config.
- **Job/lease/checkpoint state must not be portable.** Check whether new bookkeeping is
  swept into archive export or peer replication, and add coverage proving it is excluded.
- **Pooled connections break session-level locks.** A pooled executor gives no guarantee
  of connection affinity, so a lock must be a real row with a fencing token, not an
  advisory lock.
- **Making one consumer of a shared limit concurrent doubles the limit.** Before
  parallelising anything that paces, throttles, or rate-limits itself, grep for every other
  construction of that limiter. A second instance — a different transport, an HTML reader
  beside a JSON client — is its own independent budget, so the "shared" interval silently
  becomes N intervals. The plan usually names only the consumer it was written about.

## 10. Close out

Update the coordinator-owned progress file with: wave status per agent, your own
interventions and why, outstanding caller integrations, and every explicitly unverified
item with the exact steps still needed.

Report to the user: what landed, what you verified and how (commands and counts), what you
changed yourself and why, what is still open, and any question you could not settle. State
plainly which phases are complete and which are blocked on caller integration — the work
is not done because helpers exist and old tests pass.
