# One image for all Node services in the PoC (api, worker, web dev server, mock receivers).
# Production builds one minimal image per service on the ecs-service golden path.
FROM node:22-alpine
WORKDIR /app
RUN chown node:node /app
USER node
ENV NODE_ENV=development

COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node packages/shared/package.json packages/shared/
COPY --chown=node:node packages/db/package.json packages/db/
COPY --chown=node:node apps/api/package.json apps/api/
COPY --chown=node:node apps/worker/package.json apps/worker/
COPY --chown=node:node apps/web/package.json apps/web/
COPY --chown=node:node apps/mock-receivers/package.json apps/mock-receivers/
COPY --chown=node:node apps/mcp/package.json apps/mcp/
COPY --chown=node:node simulator/package.json simulator/
RUN npm ci --no-audit --no-fund

COPY --chown=node:node tsconfig.base.json ./
COPY --chown=node:node packages packages
COPY --chown=node:node apps apps
COPY --chown=node:node simulator simulator
COPY --chown=node:node terraform/registry terraform/registry
