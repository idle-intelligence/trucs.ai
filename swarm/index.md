---
layout: default
title: swarm
---
  
# swarm  
  
A distributed AI system where your browser is the computer.  
  
![a screenshot of the swarm logs as seen by a user](/swarm/swarm.png)
  
---
  
The Hive/swarm is a peer-to-peer collective intelligence experiment.  
Users contribute browser-based inference to a shared swarm.  
No servers running models, no API keys, no centralized brain.  
  
A Rust WebSocket hub (the Hive) acts as a dumb pipe,  
routing messages between browser nodes that do all the thinking.  
  
Each node runs small model.  
The swarm remembers, classifies, and responds, together.  
  
## How it works (wip)
  
Nodes connect to the hub.  
Messages flow in.  
A tiny BERT classifier routes them.  
Workers pick up tasks: summarizing, tagging, responding; and feed results back into a shared memory that grows from every interaction.  
  
No node sees the full picture.  
Inconsistency is a feature.  
Each participant shapes the swarm's perspective just by being there.  
  
---
[← trucs.ai](/)
