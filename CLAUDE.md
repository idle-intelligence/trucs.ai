# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

trucs.ai — a static site hosted on GitHub Pages with Jekyll. Personal site + client-side AI projects. Part of the Unnecessary Intelligence ecosystem (trucs.ai, ruche.world, unnecessaryintelligence.ai).

## Architecture

Two page types:

- **Markdown text pages** — processed by Jekyll, rendered through `_layouts/default.html`. Never load JS.
- **Standalone HTML inference pages** — pass-through (no Jekyll front matter), load WASM + model weights directly. Never use Jekyll front matter.

## Stack

Jekyll on GitHub Pages (built-in, no local install needed). Kramdown with GFM input. One layout, one stylesheet.

## Design

Monospace system font stack. Black (`#111`) on white (`#fff`). Single column, `max-width: 680px`. No nav component — the home page links to everything, sub-pages link back. No decorative elements. No JS on text pages.

## Structure

Flat. Each project gets a top-level directory. No `/demos/` grouping — the home page is the index.

- `/classifier/` — WASM inference page (BERT text classifier, 4 classes: other/swarm/time/weather)
- `/swarm/` — links to ruche.world
- `/stt/`, `/tts/`, `/llm/` — future projects
- `/ilnmtlbnm/` — profile page

## Key Files

- `_config.yml` — Jekyll configuration
- `_layouts/default.html` — single layout for all text pages
- `assets/style.css` — single stylesheet (<80 lines)
- `index.md` — home page
- `ilnmtlbnm/index.md` — profile
- `classifier/index.html` — standalone inference page
- `swarm/index.md` — swarm project page

## Rules

- Never add front matter to standalone HTML inference pages.
- Never add JS to text pages.
- Keep CSS under 80 lines.
- All text content lives in `.md` files.
- Binary assets go in their project subdirectory.
- New project = new top-level directory + a link on the home page.
