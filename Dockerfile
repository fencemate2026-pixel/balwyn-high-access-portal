# Magic Keys portal — production image for Azure App Service (Linux, container).
# Multi-stage: dependencies and build in one stage, a slim runtime in the next.
# The same image runs anywhere Docker runs, so what is tested is what ships.

# ---- build ---------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- runtime -------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080
# Run as the unprivileged "node" user that ships with the image.
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/data ./data
# next start reads next.config.ts at runtime (security headers live there).
COPY --from=build --chown=node:node /app/next.config.ts ./next.config.ts
USER node
EXPOSE 8080
# App Service probes /api/health (configured in provision.sh). This check lets
# Docker itself mark the container unhealthy if the server stops answering.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "start"]
