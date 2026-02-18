---
layout: default
title: "Claude Code and stt-web"
---
 
As I [wrote somewhere else](/blog/),  
"how you use a coding agent" is a spectrum,  
from having copilot review a single PR,  
to blindly vibe coding 100k loc AI Slop products.  

I tend to steer clear of that last type,  
and if I am "vibe coding",  
the project usually starts with a lot of documentation,  
and ends up with [more doc than code](/blog/claude-code-and-the-swarm-4-more-docs-than-code).  

I do like to play dumb with new model releases, though.  
Just to see how they get stuck, on what,  
detect those failure modes,  
so that I work around them when writing for LLMs.  

I've got that old idea of doing an STT→LLM→TTS loop fully "web",  
running local models in browser tabs.  
Maybe at the time you're reading this, it's done at [trucs.ai](/stt/).  

_Bref_, today I was thinking about doing the STT part,  
and was about to take an off-the-shelf reliable web compatible STT,  
like a small whisper or something.  

Instead, I reached out to Claude (in teams mode) with a project designed to fail:  
No docs. No definition of the interfaces. No global architecture.  
No instructions to write tests, follow good practices, ...  

Just a vague goal, and some reference implementations.  

Here's the actual prompt:

> I would like to use the latest mistral STT,  
> Is there already a way to run it in the browser?  
> Is it CPU or GPU?  
> Are there any other candidates? Kyutai?  
> My goal would be: if something that isn't bespoke already exist, use it.  
> If not, let's build a WebGPU or WASM demo  

Claude wrote a bunch of stuff, then concluded  
"Kyutai 1B would be the dream candidate to port to WebGPU/WASM but nobody's done it yet."

> What would that entail?  
> I would like a full "Claude did it":  
> 1\. ? 2\. unleash a team of claude  
> But what do I tell the team?  

It wrote a CLAUDE.md, some doc with some details, and  

> You are the lead on a multi-agent project.
> Your job is to bootstrap the repo, then spawn a team of agents to build it.
> TL;DR for the agents
> You're porting Kyutai STT 1B (a streaming speech-to-text transformer) to run 100% client-side in a browser using Rust → WASM + WebGPU. The model is 1B params, you need to Q4 quantize it to ~500MB. The audio tokenizer (Mimi) already exists in Rust. The transformer inference needs to be rewritten from Candle to Burn (which has a wgpu backend). Use voxtral-mini-realtime-rs as your architectural reference — they solved the same problem for a larger model. Ship a demo that captures mic audio and streams transcription text in real-time.

It didn't make a team. I was annoyed.  
But I just forgot to turn it on...

>    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"

My next prompt was about the team  
"Lead/opus, ML Engineer/sonnet, Systems Programmer/sonnet, ML Systems Engineer/opus, Frontend Engineer/sonnet" and off we went.  

As I expected, the team of Claude Code got stuck on weird bugs, build issues, ... while writing a lot of useless code.
Handling the audio pipeline, building a quantized version of a model, wasm, wgpu, all at once, impossible.

I let it struggle.  
Looked from time to time as the team members messaged each other, not "understanding" anything.
When it announced with all its LLM faked satisfaction that it was done, hours later,
I opened the website, and of course it wasn't working.

Of course.

But... it was kinda close.  
Too close to let it stay stuck like that.  

I helped. A little.  
Nudged to leverage the rust tooling to run tests.  
Nudged to add more logs.  
Nudged to run actual end to end tests.  

When I had something actually working,  
I spun another team of Claude Code to polish:  
review, cleanup, find issues with the code, the architecture, profile, improve performance.  

You can test the result at [trucs.ai/stt](/stt/).  

Did _I_ fail? Not sure if AI Slop or not, haven't read [the code](https://github.com/idle-intelligence/stt-web) yet.  

---

P.S.: the actual team definition, maybe that's what made the difference:  

> Create a team of claude code
>
> - **You, the lead (opus)** — Project architect. Reads the full spec, scaffolds the repo, spawns the team,
>   handles integration after they converge. Needs to understand the whole system but doesn't implement
>   any single piece.
> - **ML Engineer (sonnet)** — Quantization & Evaluation.
>   Python-heavy. Knows safetensors, GGUF format, quantization techniques (Q4/Q5/Q8 block quantization),
>   HuggingFace Hub tooling. Runs WER evals on LibriSpeech. No Rust, no browser — pure offline Python work.
> - **Systems Programmer (sonnet)** — Rust & WASM.
>   Takes an existing Rust crate (rustymimi), strips it down (removes pyo3 bindings, CUDA paths), adds
>   wasm-bindgen exports, compiles to wasm32. Needs to understand audio codecs at a surface level (PCM in,
>   tokens out) but the codec logic is already written — the job is porting and plumbing, not ML.
> - **ML Systems Engineer (opus)** — Burn Framework & WebGPU. The hardest role.
>   Reimplements a 1B-param transformer in Burn with wgpu backend. Needs deep understanding of: attention
>   mechanisms, RoPE, KV caching, grouped-query attention, autoregressive decoding, and the delayed-streams
>   paradigm specific to this model. Also writes custom WGSL compute shaders for Q4 dequantization. Must
>   make it work both native and in WASM+WebGPU. This agent should be the strongest.
> - **Frontend Engineer (sonnet)** — Browser APIs & Audio.
>   Builds the browser demo in pure HTML+JS. Knows AudioWorklet, Web Workers, WebGPU device initialization,
>   Cache API, and the MediaDevices API for mic capture. No Rust — consumes the WASM packages as black boxes.
>   Builds the glue that connects mic → codec → model → text on screen.

[← blog](/blog/)
