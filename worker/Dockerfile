# SEVE streaming worker — Railway image.
# Build context MUST be the REPO ROOT (the worker imports ../engine + ../lib):
#   Railway → service settings → Dockerfile path: worker/Dockerfile
#   (Root Directory stays the repo root so engine/ and lib/ are in the context.)
# Node 22 (LTS) — has a native global WebSocket (Node <22 doesn't, which
# @supabase/realtime-js requires; store.ts also passes `ws` as a belt-and-braces).
FROM node:22-slim

WORKDIR /app

# Install the worker's deps first (better layer caching). Lockfile committed →
# reproducible `npm ci`.
COPY worker/package.json worker/package-lock.json ./worker/
RUN cd worker && npm ci --no-audit --no-fund

# The post-close publisher intentionally runs the repository-level scripts from
# /app (scripts/day-report.ts -> scripts/benched-sim.ts). Node resolves a
# package import from the importing file's ancestors, so those scripts cannot
# see dependencies installed only at /app/worker/node_modules. Expose the same
# reproducible worker install at the repository root; this is a symlink, not a
# second install or an independent dependency graph.
RUN ln -s /app/worker/node_modules /app/node_modules \
    && cd /app \
    && node --input-type=module --eval "await import('@supabase/supabase-js')"

# Shared engine + lib (imported directly — the whole point of this driver) and
# the worker source.
COPY engine ./engine
COPY lib ./lib
COPY worker ./worker
# scripts/ + tsconfig.json: the post-close shadow §03 publish (forensics.ts) spawns the
# EXISTING scripts/shadow-cron.ts (→ day-report → benched-sim) as a child, so the panel
# stays current with no Mac. tsconfig.json carries the `@/*` path alias the scripts resolve.
COPY scripts ./scripts
COPY tsconfig.json ./

WORKDIR /app/worker
ENV NODE_ENV=production
# Phase A is shadow-only; DRY_RUN must stay true until Phase B is wired + verified.
ENV DRY_RUN=true
# Absolute tsx for the shadow-publish child (forensics.ts / shadow-cron.ts / benched-sim.ts):
# the worker's deps install under /app/worker, but the child runs with cwd=/app (repo root),
# where a relative ./node_modules/.bin/tsx would not resolve.
ENV TSX_BIN=/app/worker/node_modules/.bin/tsx
# Run the worker directly as PID 1. An npm wrapper can consume Railway's
# SIGTERM before the Node process reaches its graceful shutdown handler, which
# leaves a normal platform restart misclassified as abrupt_or_unknown.
CMD ["/app/worker/node_modules/.bin/tsx", "src/index.ts"]
