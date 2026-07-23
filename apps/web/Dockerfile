FROM node:22-alpine AS deps
WORKDIR /app
COPY apps/web/package.json apps/web/package.json
RUN cd apps/web && npm install

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/apps/web/node_modules apps/web/node_modules
COPY apps/web apps/web
RUN cd apps/web && npm run build

FROM node:22-alpine AS runtime
WORKDIR /app/apps/web
ENV NODE_ENV=production
COPY --from=build /app/apps/web/package.json package.json
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./.next/static
COPY --from=build /app/apps/web/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
