# syntax=docker/dockerfile:1

FROM node:22-alpine AS dashboard-build
WORKDIR /app/dashboard
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci
COPY dashboard/ ./
RUN npm run build

FROM node:22-alpine AS backend-build
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

FROM node:22-alpine AS backend-dependencies
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=backend-dependencies /app/backend/node_modules ./backend/node_modules
COPY --from=backend-build /app/backend/dist ./backend/dist
COPY backend/package.json ./backend/package.json
COPY --from=dashboard-build /app/dashboard/dist ./dashboard/dist
USER node
EXPOSE 3000 9000
CMD ["node", "backend/dist/index.js"]
