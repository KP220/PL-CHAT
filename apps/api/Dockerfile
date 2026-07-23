FROM node:22-alpine AS deps
WORKDIR /app
COPY apps/api/package.json apps/api/package.json
COPY apps/api/prisma apps/api/prisma
RUN cd apps/api && npm install

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/apps/api/node_modules apps/api/node_modules
COPY apps/api apps/api
RUN cd apps/api && npm run prisma:generate && npm run build

FROM node:22-alpine AS runtime
WORKDIR /app/apps/api
ENV NODE_ENV=production
COPY --from=build /app/apps/api/package.json package.json
COPY --from=build /app/apps/api/node_modules node_modules
COPY --from=build /app/apps/api/dist dist
COPY --from=build /app/apps/api/prisma prisma
EXPOSE 8787
CMD ["node", "dist/server.js"]
