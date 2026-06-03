# SEVE streaming worker — Railway image.
# Build context MUST be the REPO ROOT (the worker imports ../engine + ../lib):
#   Railway → service settings → Dockerfile path: worker/Dockerfile
#   (Root Directory stays the repo root so engine/ and lib/ are in the context.)
FROM node:20-slim

WORKDIR /app

# Install the worker's deps first (better layer caching). Lockfile committed →
# reproducible `npm ci`.
COPY worker/package.json worker/package-lock.json ./worker/
RUN cd worker && npm ci --no-audit --no-fund

# Shared engine + lib (imported directly — the whole point of this driver) and
# the worker source.
COPY engine ./engine
COPY lib ./lib
COPY worker ./worker

WORKDIR /app/worker
ENV NODE_ENV=production
# Phase A is shadow-only; DRY_RUN must stay true until Phase B is wired + verified.
ENV DRY_RUN=true
CMD ["npm", "start"]
