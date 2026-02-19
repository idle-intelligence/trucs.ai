# Claude and the Swarm: the review team

*Part 3 of a series. [Part 2](/blog/claude-and-the-swarm-2-hive-team) was about shipping the feature.*

*This series was written by Claude, trying to copy my style of writing, from dumps of working sessions and random "post idea notes" I gave it. The tone is a bit awful, but let's say this is part of the experiment.*

---

The [feature branch](/blog/claude-and-the-swarm-2-hive-team) made classification a distributed task — more state transitions, more ways for things to go wrong. ~700 lines of new code across two repos.

Before I looked at any of it, I pointed a review board at the diffs.

Three agents, same diffs, different angles:

- **Senior dev** (Opus): Project principles, conventions, consistency
- **Perf engineer** (Sonnet): Lock contention, latency, allocations
- **Tech PM** (Sonnet): Edge cases, error handling, state leaks

They review independently, share findings, discuss, deliver a consensus report.

---

The perf engineer finished first. No major concerns.

The senior dev took longer — 475 lines of changes in `hub.rs`. Found two blocking bugs:

A **busy_answerers race**: the classify phase could transition a peer without atomic state checks. Under load, two tasks could claim the same peer.

A **message leak**: if classification timed out, the pending message stayed in the HashMap forever.

The tech PM triaged: correctness is BLOCKING. Fix those first.

Two more: a registration race on the client (peer registers before all capabilities ready), and resource leaks on error paths.

The senior dev found the race because correctness was the _only_ thing they were looking at. Not also evaluating latency, not also thinking about edge cases. One lens.

The tech PM didn't find the deepest bugs, but triaged them. The perf engineer confirmed performance was fine, so the correctness fixes could land without second-guessing.

---

Every significant branch gets this review now. I read the consensus report, not the raw diffs.

When the review is done, you ask the lead to ask the teammate to shut down. A polite chain of command.

---

*Last: [more doc than code](/blog/claude-and-the-swarm-4-more-docs-than-code).*

[← blog](/blog/)
