# Pillar Press Whisper sidecar

Place a whisper.cpp CLI binary at `bin/whisper-cli` and the tiny English model at `models/ggml-tiny.en.bin`.

For local packaging, run:

```sh
PILLAR_PRESS_WHISPER_BIN=/path/to/whisper-cli \
PILLAR_PRESS_WHISPER_MODEL=/path/to/ggml-tiny.en.bin \
PILLAR_PRESS_WHISPER_LIB_DIR=/path/to/whisper/lib \
PILLAR_PRESS_WHISPER_LIBEXEC_DIR=/path/to/whisper/libexec \
npm run desktop:prepare-whisper
```

At runtime, those same environment variables can override the bundled paths for development.
