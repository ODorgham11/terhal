# The web image: the customer site, the staff dashboard and the admin panel (web/proxy.ts picks one by host).
# NEXT_PUBLIC_API_URL is baked into the browser bundle at build time, so each environment gets its own image.
# Built from the repo root: docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.terhal.co .

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS build
ARG NEXT_PUBLIC_API_URL
# Optional: without them the locations editor leaves out its map and the coordinates are typed in.
ARG NEXT_PUBLIC_GOOGLE_MAPS_KEY=""
ARG NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID=""
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_GOOGLE_MAPS_KEY=$NEXT_PUBLIC_GOOGLE_MAPS_KEY NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID=$NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID
RUN test -n "$NEXT_PUBLIC_API_URL" || (echo "NEXT_PUBLIC_API_URL build arg is required" && exit 1)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY tooling tooling
# The web app type checks against the server's routes, so it needs the server's dependencies too.
RUN pnpm install --frozen-lockfile --filter @terhal/web... --filter terhal
COPY turbo.json ./
COPY packages packages
COPY apps/server apps/server
COPY apps/web apps/web
RUN pnpm turbo run build --filter=@terhal/web

# standalone output: a minimal server.js with only the files it traces, laid out from the repo root.
FROM node:24-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
