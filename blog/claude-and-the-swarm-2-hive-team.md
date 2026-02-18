# Claude and the Swarm: the hive team

*Part 2 of a series. [Part 1](/blog/claude-and-the-swarm-1-ml-team) was about training the classifier.*

*This series was written by Claude, trying to copy my style of writing, from dumps of working sessions and random "post idea notes" I gave it. The tone is a bit awful, but let's say this is part of the experiment.*

---

The classifier is done.
After some thought, we're not going to run it locally directly on user's input. We'll have the swarm do the classification.  
It needs to be wired into the live system: loaded conditionally based on hardware, predictions sent to the server, the server dispatching classify tasks to tagger peers, routing based on results, gating observers. One focused change across client, client-wasm, and server.

Two repos. A Rust WebSocket hub and a browser client.

The team: Lead (Opus), server engineer (Sonnet), client engineer (Sonnet).

---

`feature/swarm-classification` Branch created at 23:32. First commit at 23:40.

Client side — 4 commits:

| Time | What |
|------|------|
| 23:40 | Conditional classifier loading + join button for all devices |
| 23:50 | Handle classify tasks from hub |
| 23:51 | Download progress + GPU memory detection |
| 08:21 | Fix: answerer-only registration when classifier fails |

Core work in 11 minutes. The last commit, 90 minutes later, was a graceful degradation fix from integration testing. 4 files, +145/-36 lines.

Server side — 10 commits:

| Time | What |
|------|------|
| 23:56 | Classify capability in state + protocol foundation |
| 00:14 | Peer selection with capability filter |
| 00:20 | Tagger-only peers skip benchmark |
| 00:27 | Classify dispatch, result handling, 3s timeout |
| 00:29 | Update all select_peers call sites, queue dispatch |
| 00:40 | Derive classify task ID from message ID for tracing |
| 00:47 | Threshold rejection in classify log |
| 08:09 | 'other' instead of 'unrouted' in log |
| 08:18 | Fix: busy_answerers race, message leak |

10 commits in 82 minutes.  
The [review](/blog/claude-and-the-swarm-3-review-team) found 4 bugs, fixed in 3 more commits.  
Both repos merged within 1 second. 08:22:26 and 08:22:27.  

The client engineer finished in 11 minutes and waited 90 minutes for the server to catch up.  
The server engineer's commit history reads like what you'd want from a human — small, focused, building on each other. (*Author's note: OMG Claude no*)

I slept through most of it. 

---

*Next: [the review team](/blog/claude-and-the-swarm-3-review-team) looks at what just shipped.*

[← blog](/blog/)
