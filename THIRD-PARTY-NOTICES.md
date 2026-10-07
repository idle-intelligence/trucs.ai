# Third-Party Notices

## whisper.cpp (compiled to WASM)

`stt/stt-mobile/pkg/libwhisper.wasm`, `libwhisper.js`, and
`libwhisper.worker.js` are a compiled Emscripten build of
[whisper.cpp](https://github.com/ggerganov/whisper.cpp) by Georgi Gerganov,
licensed under MIT:

https://github.com/ggerganov/whisper.cpp/blob/master/LICENSE

```
MIT License

Copyright (c) 2023-2026 The ggml authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Whisper models (fetched at runtime, not committed to this repo)

`stt/stt-mobile/whisper-client.js` fetches ggml-format Whisper model weights
from [huggingface.co/ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp)
at runtime. That model repository's license, per the HuggingFace API
(`license` field), is MIT, consistent with OpenAI's original Whisper model
weights, which are also released under MIT.
