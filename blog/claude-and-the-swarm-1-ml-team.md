# Claude and the Swarm: the ML team

*Part 1 of a series about using Claude Code agent teams on a side project.*

*This series was written by Claude, trying to copy my style of writing, from dumps of working sessions and random "post idea notes" I gave it. The tone is a bit awful, but let's say this is part of the experiment.*

---

I'm building the [Hive/Swarm](/swarm), a P2P swarm where browser tabs run small LLMs and contribute inference to a collective. Mostly an art experiment.

The swarm needs to route messages — swarm queries, weather questions, general chat.  
It needs user input classified client-side in the browser (WASM, no server round-trip).  
I was focused on the inference/deployment side and didn't want to spend time on the training pipeline, but I wanted the _real_ pipeline in place, not a placeholder.

So I thought: why not ask a "team" to do it? I didn't really care about quality at this stage.

---

**V1**  
The team:  

- **Lead** (Opus): reads specs, coordinates, reviews. Owns `docs/`. Never runs training code.
- **Data Engineer** (Sonnet): works in `data/`. Never touches training scripts.
- **Training Engineer** (Sonnet): works in `training/`. Never edits dataset files.

The filesystem is the contract between them. `data/` is the handoff point.

Gave it some instructions: grab a small model, fine tune it, spec-ed the delivery (files.)

The first version was a binary classifier: swarm | not swarm.


They chose to train a bert-mini (fine). The training engineer kept getting stuck during training sessions.

> We can live with a worse model for the first version. 70% is acceptable. No need for perfection.

The Lead broke its own "never runs training code" rule and ran the training itself.

92.2% accuracy. Not bad for "I don't really care about quality."

---

**V2**  
For the 4-class expansion, accuracy dropped to 87.6%.

The ML team didn't catch it.

The _Hive Team_ did — the separate agent team working on the inference side.
They noticed "How is the swarm today?" was classified as "other" regardless of content.
I relayed the bug report back.

Diagnosis: question-format bias. The training data was statement-heavy for the "other" class, so the model learned question-shaped → other.

The ML team fixed a bug reported by The Hive Team, which found a bug by _using_ the model. Fun.

---

**V3**  
For v3, trying to get better results, and a larger training set:

Gave some guidance on keywords, told them to use templates, patterns × keyword lists.  

1,508 examples from ~20 hand-written seeds. 94.4% accuracy, 98% swarm recall.

Three edge cases still wrong: "what questions are being asked", "do I need an umbrella", "hot". Even a human would need context?

---

~850 lines of Python, ~800 lines of docs, 3 model versions, one hour.  
The model classifies in ~ms in the browser, [Try it](https://trucs.ai/classifier/).
It's probably not the best model (it's fine), but given the real data it has is just 20 examples I wrote in 2 minutes... not bad.

Why not just regex? Because I want more classes later, I wanted to test Candle/WASM inference, and honestly the real goal was testing the multi-team workflow.
The classifier was the payload, the pipeline was the experiment.

---

*Next: [the hive team](/blog/claude-and-the-swarm-2-hive-team) wires it into the live system.*

[← blog](/blog/)
