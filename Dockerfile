# Combined Node service: one origin serves the built frontend and /v1/* together,
# which is what WebAuthn's single-RP-ID requirement wants.

# Full source and every dependency. The operator bootstrap runs from here,
# because scripts/configure-plans.ts is executed through tsx.
FROM node:24-slim AS tools
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# Pruning in a stage derived from the build keeps native modules from being
# rebuilt against a second image.
FROM tools AS build
RUN npm prune --omit=dev

FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/public-build ./public-build
COPY package.json ./
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
