# Slice 5b review

Two-axis review (`mattpocock-skills:code-review`) of `feat/slice-5b-live-updates` against `master`, after #38, #39 and the shutdown fix. Spec: [#37](https://github.com/movchaneric/resumeai/issues/37). Owner's decision: fix as recommended (below).

## Standards
| # | Finding | Decision |
|---|---|---|
| S1 | Service built in `index.ts`, but `CLAUDE.md` said `routes/index.ts` wires store → service → controller (hard) | Fixed: `CLAUDE.md` updated, stale comment in `routes/index.ts` fixed |
| S2 | `createApp(deps, service = new RunsService(deps))` takes the deps twice | Kept: tests rely on the default |
| S3 | Event bus and shutdown helper are new kinds of `utils/` code; `InProcessRunEvents` doesn't declare `implements RunEvents` | Fixed: `CLAUDE.md` lists them; `implements` added if the architecture test allows it |
| S4 | Graph position → Pause status is mapped in three places | Deferred (refactor) |
| S5 | The `interrupted` view repeats the step order from `StepKeySchema` | Fixed |
| S6 | `events.publish` is called by hand in five places | Deferred (refactor; a publishing status writer would gather them) |
| S7 | `RESTING_STATUSES` name and comment don't fit `failed`/`interrupted`/`completed` | Fixed: renamed |
| S8 | `stop(); close();` twice in `openRunStream` | Deferred |
| S9 | `recordFailure` labels repeat the span names as strings | Deferred |
| S10 | The SSE handler keeps four mutable flags | Deferred |

## Spec
| # | Finding | Decision |
|---|---|---|
| P1 | `decisions.md` didn't record the later fixes | Fixed: "After implementation" |
| P2 | `closeAllConnections()` also cut in-flight ordinary requests | Fixed: shutdown ends only the open streams and idle connections |
| P3 | The startup filter (`createdBefore`) isn't in the spec | Accepted, recorded |
| P4 | Extra "skipped" log line; SQL `CHECK` on `recoveries` | Accepted |
| P5 | Pushes happen when the next node is entered | Accepted; the comment now says it is deliberate |
| P6 | `pausedAtOf` reads "graph ended" as `review` | **Deferred to slice 6**, which lets the graph end: a finished Run must not be read as paused at review |
| P7 | Log reason after a lost recovery claim | No change: the "already recovered once" line is printed only when the status write succeeds, which means the status had not moved, so the reason is right; a lost race logs "skipped" |
| P8 | A Run cut off while picking Questions shows `tailor` as the failed step | Accepted; note for slice 7's wording |
| gap | No test for a resumed Run failing inside the tailoring loop | Fixed: test added |
