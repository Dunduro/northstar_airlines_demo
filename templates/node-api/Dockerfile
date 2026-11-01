# syntax=docker/dockerfile:1
# Multi-stage: dependencies are installed on the full Debian image, the runtime is distroless
# (no shell, no package manager, runs as uid 65532 "nonroot"). Same glibc on both sides, so
# native modules built in stage 1 run in stage 2.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM gcr.io/distroless/nodejs22-debian12:nonroot AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
USER nonroot
EXPOSE 8080
# No HEALTHCHECK: there is no shell or curl in the image; the ALB probes GET /health.
CMD ["src/server.js"]
