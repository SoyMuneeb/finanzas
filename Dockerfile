# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
COPY telegram-bot/package.json telegram-bot/package.json
RUN npm ci
COPY . .
RUN npm run db:generate -w server && npm run build

FROM node:22-bookworm-slim AS server
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /data && chown node:node /data
USER node
ENV NODE_ENV=production PORT=3001 DATABASE_URL=file:/data/finanzas.db
EXPOSE 3001
CMD ["sh", "-c", "npm run db:migrate -w server && npm run start -w server"]

FROM nginx:1.28-alpine AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/client/dist /usr/share/nginx/html
EXPOSE 80
