# IG-2c — the content-render job image: Node 22 + ffmpeg + whisper.cpp (Turkish speech → subtitles).
# Everything runs inside this container; video and audio are never sent to an outside service.
# Build:  node render-image/build.mjs && gcloud run jobs deploy content-render --source render-image …
#         (see docs/RUNBOOK.md "content-render")

FROM debian:bookworm-slim AS whisper
RUN apt-get update && apt-get install -y --no-install-recommends build-essential cmake git ca-certificates curl && rm -rf /var/lib/apt/lists/*
# Pinned release. GGML_NATIVE=OFF: built on Cloud Build, run on other CPUs — no host-specific instructions.
RUN git clone --depth 1 --branch v1.7.4 https://github.com/ggerganov/whisper.cpp /src
WORKDIR /src
RUN cmake -B build -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON \
 && cmake --build build -j --config Release --target whisper-cli
# "medium", 5-bit quantised (~540 MB): the smallest model that writes Turkish well.
RUN curl -fsSL -o /ggml-medium-q5_0.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium-q5_0.bin

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core libgomp1 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=whisper /src/build/bin/whisper-cli /opt/whisper/whisper-cli
COPY --from=whisper /ggml-medium-q5_0.bin /opt/whisper/ggml-medium-q5_0.bin
COPY --from=whisper /src/samples/jfk.wav /opt/whisper/jfk.wav
WORKDIR /app
RUN npm init -y >/dev/null && npm install --omit=dev firebase-admin@13.10.0 && npm cache clean --force
COPY dist/main.cjs dist/main.cjs.map dist/selftest.cjs ./
ENV NODE_OPTIONS=--enable-source-maps
CMD ["node", "main.cjs"]
