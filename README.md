# trucs.ai

A personal site and client-side AI demo garden, built with Jekyll and served by Cloudflare Pages. No server code, just markdown pages and standalone HTML inference pages that run models in the browser. Live at [trucs.ai](https://trucs.ai).

## Development

Serve the repository root over HTTP (for example `npx serve`); ES modules and WASM do not load from `file://`. Pages that use threads need cross-origin isolation, which `_headers` sets on Cloudflare Pages and `serve.json` sets for the local server.

`404.html` (from `404.md`) is the page Cloudflare Pages serves with status 404 for unknown paths; without a top-level 404.html it falls back to the home page with status 200.

Markdown pages go through Jekyll and the `_layouts/default.html` layout. Standalone HTML inference pages have no front matter, load WASM and model weights directly, and use relative asset paths so they work both locally and on the live site. Loading URLs for WASM and model assets carry a build tag (`?v=<tag>`); bump it on every rebuild so browsers do not keep serving a stale cached module.

## License

Code is licensed under [MIT](LICENSE). Blog posts and page prose are licensed under [CC BY 4.0](LICENSE-CONTENT). Third-party files keep their own licenses, see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
