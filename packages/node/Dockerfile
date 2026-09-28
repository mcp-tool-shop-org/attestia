# ────────────────────────────────────────────────────────────
# Stage 1: Build
# ────────────────────────────────────────────────────────────
FROM node:22-slim AS builder

RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

WORKDIR /build

# Copy workspace root files needed for pnpm install
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY tsconfig.json ./

# Copy all package.json files for workspace resolution
COPY packages/types/package.json packages/types/
COPY packages/registrum/package.json packages/registrum/
COPY packages/ledger/package.json packages/ledger/
COPY packages/chain-observer/package.json packages/chain-observer/
COPY packages/vault/package.json packages/vault/
COPY packages/treasury/package.json packages/treasury/
COPY packages/reconciler/package.json packages/reconciler/
COPY packages/witness/package.json packages/witness/
COPY packages/verify/package.json packages/verify/
COPY packages/event-store/package.json packages/event-store/
COPY packages/proof/package.json packages/proof/
COPY packages/sdk/package.json packages/sdk/
COPY packages/demo/package.json packages/demo/
COPY packages/attestia/package.json packages/attestia/
COPY packages/node/package.json packages/node/

# Copy source before install so the workspace links point at the sources
# that will actually be compiled. .dockerignore keeps host dist and
# tsbuildinfo out; a stale tsbuildinfo would make tsc skip emit.
COPY packages/ packages/

# Install all dependencies (workspace-wide)
RUN pnpm install --frozen-lockfile

# Build all packages (dependencies first, then node)
RUN pnpm -r build

# ────────────────────────────────────────────────────────────
# Stage 2: Production
# ────────────────────────────────────────────────────────────
FROM node:22-slim AS production

RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

WORKDIR /app

# Copy workspace root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY tsconfig.json ./

# Copy all package.json files
COPY packages/types/package.json packages/types/
COPY packages/registrum/package.json packages/registrum/
COPY packages/ledger/package.json packages/ledger/
COPY packages/chain-observer/package.json packages/chain-observer/
COPY packages/vault/package.json packages/vault/
COPY packages/treasury/package.json packages/treasury/
COPY packages/reconciler/package.json packages/reconciler/
COPY packages/witness/package.json packages/witness/
COPY packages/verify/package.json packages/verify/
COPY packages/event-store/package.json packages/event-store/
COPY packages/proof/package.json packages/proof/
COPY packages/sdk/package.json packages/sdk/
COPY packages/demo/package.json packages/demo/
COPY packages/attestia/package.json packages/attestia/
COPY packages/node/package.json packages/node/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

RUN mkdir -p /app/data

# Copy built output from builder stage
COPY --from=builder /build/packages/types/dist packages/types/dist
COPY --from=builder /build/packages/registrum/dist packages/registrum/dist
COPY --from=builder /build/packages/ledger/dist packages/ledger/dist
COPY --from=builder /build/packages/chain-observer/dist packages/chain-observer/dist
COPY --from=builder /build/packages/vault/dist packages/vault/dist
COPY --from=builder /build/packages/treasury/dist packages/treasury/dist
COPY --from=builder /build/packages/reconciler/dist packages/reconciler/dist
COPY --from=builder /build/packages/witness/dist packages/witness/dist
COPY --from=builder /build/packages/verify/dist packages/verify/dist
COPY --from=builder /build/packages/event-store/dist packages/event-store/dist
COPY --from=builder /build/packages/proof/dist packages/proof/dist
COPY --from=builder /build/packages/node/dist packages/node/dist

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => process.exit(r.ok ? 0 : 1))"

CMD ["node", "packages/node/dist/main.js"]
