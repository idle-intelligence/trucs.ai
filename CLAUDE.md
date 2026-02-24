# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

trucs.ai — a static site hosted on GitHub Pages with Jekyll. Client-side AI experiments running entirely in the browser. An [Idle Intelligence](https://idleintelligence.org/) initiative.

## Architecture

Two page types:

- **Markdown text pages** — processed by Jekyll, rendered through `_layouts/default.html`. Never load JS.
- **Standalone HTML inference pages** — pass-through (no Jekyll front matter), load WASM + model weights directly. Never use Jekyll front matter.

## Stack

Jekyll on GitHub Pages (built-in, no local install needed). Kramdown with GFM input. One layout, one stylesheet.

## Design

Monospace system font stack. Black (`#111`) on white (`#fff`). Single column, `max-width: 680px` (wider `1200px` for multi-panel pages). No nav component — the home page links to everything, sub-pages link back. No decorative elements. No JS on text pages.

## Structure

Flat. Each project gets a top-level directory. No `/demos/` grouping — the home page is the index.

- `/stt/` — Speech-to-text. Quantized Kyutai STT model (Mimi codec + text decoder), custom Rust inference compiled to WASM, GPU via WebGPU. Uses [stt-web](https://github.com/idle-intelligence/stt-web).
- `/llm/` — LLM chat. SmolLM2-1.7B-Instruct via [WebLLM](https://github.com/mlc-ai/web-llm), single-turn, WebGPU.
- `/tts/` — Text-to-speech. Quantized Kyutai Pocket-TTS model, custom Rust inference compiled to WASM. Uses [tts-web](https://github.com/idle-intelligence/tts-web). Audio output via AudioWorklet (`audio-worklet.js`).
- `/llm-tts/` — Combined LLM + TTS. Two-panel layout.
- `/stt-llm-tts/` — Full voice loop: STT → LLM → TTS with silence detection, auto-restart, multi-turn chat. Three-panel layout. Includes demo button (`joke.wav`).
- `/classifier/` — BERT text classifier compiled to WASM via Candle + wasm-pack.
- `/swarm/` — links to ruche.world
- `/ilnmtlbnm/` — profile page
- `/blog/` — blog posts

## Key patterns

- **STT client**: `SttClient` from `stt/stt-client.js`. Worker-based (`stt/worker.js`). Audio resampled to 24kHz, chunked in 1920-sample frames (80ms Mimi codec frames). Worker accepts `{ type: 'audio', samples }` messages.
- **TTS**: `TtsWorker` from `tts/tts-worker.js`. Audio streamed to `AudioWorklet` (`tts/audio-worklet.js`). Worklet supports `finish`/`ended` signaling for playback completion detection.
- **LLM**: WebLLM engine loaded from CDN. KV cache reused across turns (don't call `resetChat()` between turns). Only reset on abort, history trim, or explicit reset.
- **Voice loop** (`stt-llm-tts`): Silence detection via `onTranscript` — only tokens with letters reset the 1.5s timer. Repeat detection filters STT hallucinations (>3 identical consecutive tokens ignored). `autoRestartEnabled` flag guards the loop.

## Local Development

`python3 -m http.server 8000` from the project root, then open `http://localhost:8000/`. Required because ES modules and WASM don't load from `file://` (CORS). Standalone HTML pages must use relative paths for assets (e.g. `../assets/style.css`) so they work both locally and on GitHub Pages.

## Rules

- Never add front matter to standalone HTML inference pages.
- Never add JS to text pages.
- All text content lives in `.md` files.
- Binary assets go in their project subdirectory.
- New project = new top-level directory + a link on the home page.
- Bottom-of-page descriptions use `.panel-desc` class (grey, small text with links to models and source repos).
