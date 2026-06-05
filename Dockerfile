FROM node:22-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json

RUN npm ci

FROM deps AS build

COPY backend/tsconfig.json backend/tsconfig.json
COPY backend/src backend/src
COPY frontend/tsconfig.json frontend/tsconfig.json
COPY frontend/index.html frontend/index.html
COPY frontend/vite.config.ts frontend/vite.config.ts
COPY frontend/src frontend/src

RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app

ARG VERSION=0.1.0

ENV NODE_ENV=production
ENV PORT=3180
ENV DATA_DIR=/data

LABEL org.opencontainers.image.title="PT Automation"
LABEL org.opencontainers.image.description="Personal and home NAS PT automation system with a Vue frontend and Express API."
LABEL org.opencontainers.image.version="${VERSION}"
LABEL org.opencontainers.image.source="https://github.com/qqxnz/xnz_pt_automation"
LABEL org.opencontainers.image.url="https://hub.docker.com/r/qqxnz/xnz-pt-automation"

COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json

RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/frontend/dist frontend/dist

VOLUME ["/data"]
EXPOSE 3180

CMD ["npm", "run", "start", "-w", "backend"]
