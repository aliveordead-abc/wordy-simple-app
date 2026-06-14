FROM node:22-alpine AS frontend

WORKDIR /app
COPY frontend/package.json frontend/tsconfig.json frontend/index.html frontend/vite.config.ts ./
COPY frontend/src ./src
COPY public ../public
RUN npm install
RUN npm run lint
RUN npm run build

FROM nginx:1.27-alpine

COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend /app/dist /usr/share/nginx/html
