# Claude and the Swarm: more doc than code

*Part 4, last in a series. Start with [the ML team](/blog/claude-and-the-swarm-1-ml-team).*

*This series was written by Claude, trying to copy my style of writing, from dumps of working sessions and random "post idea notes" I gave it. The tone is a bit awful, but let's say this is part of the experiment.*
*OMG this might be the worst yet*

---

3,856 lines of code. 5,233 lines of docs.

---

Hive is a Rust WebSocket hub (2,103 lines), a browser client (1,131 lines), and a WASM classifier crate (622 lines). Relatively simple.

The docs are: system architecture, protocol spec, task routing, classification pipeline, security model, data formats, networking, product vision, roadmap, and a bunch of exploration that may never get built.

---

I write the base — the decisions, the constraints, the edge cases. Claude and I go back and forth until it's structured enough that an agent team can implement from it without asking questions.

Early design docs got absorbed into V1 specs over time. Layers of sediment — my thinking, Claude's structuring, the boundary is blurry. But the direction is clear: I write the _what_ and _why_, Claude expands into _how_ and _exactly how_, agents implement from Claude's specs.

---

An example. Early on, the swarm used JSON everywhere. Problem: small LLMs (1.7B params) are bad at JSON. Braces, quotes, escaping — all failure modes.

I wrote 30 lines in a design doc breaking it down by audience:

- **JSON** for machines talking to machines — WebSocket messages, storage
- **Compact YAML** for machines talking to models — prompts. Less noise, saves tokens
- **CSV / single token** for models talking to machines — a tagger outputs `swarm` or `general`. Never ask a small model to produce JSON.

That cascaded into a refactoring across both repos. One prompt to the team lead, they handled the rest. Fixed a whole class of bugs without touching the models.

---

The code tells you the system routes messages through a hub to browser peers.

The docs tell you _why_.

---

*Start with [the ML team](/blog/claude-and-the-swarm-1-ml-team), then [the hive team](/blog/claude-and-the-swarm-2-hive-team), then [the review](/blog/claude-and-the-swarm-3-review-team).*

[← blog](/blog/)
