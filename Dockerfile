FROM node:22-alpine AS deps

WORKDIR /app

# 优化1：先复制锁文件，利用Docker缓存
COPY package*.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json

# 优化2：使用 --frozen-lockfile 确保锁文件一致性
RUN npm ci --frozen-lockfile

FROM deps AS build

# 优化3：只复制必要文件，使用 .dockerignore 排除 node_modules 等
COPY backend/tsconfig*.json backend/
COPY backend/src backend/src
COPY frontend/tsconfig*.json frontend/
COPY frontend/index.html frontend/
COPY frontend/vite.config.ts frontend/
COPY frontend/src frontend/src

# 优化4：构建时设置环境变量，确保生产构建
ENV NODE_ENV=production
RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app

ARG VERSION=0.2.8
ARG DATA_DIR=/data

ENV NODE_ENV=production \
    PORT=3180 \
    DATA_DIR=${DATA_DIR} \
    # 优化5：Node.js 生产环境优化
    NODE_OPTIONS="--max-old-space-size=512"

LABEL org.opencontainers.image.title="PT Automation" \
      org.opencontainers.image.description="Personal and home NAS PT automation system with a Vue frontend and Express API." \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.source="https://github.com/qqxnz/xnz_pt_automation" \
      org.opencontainers.image.url="https://hub.docker.com/r/qqxnz/xnz-pt-automation"

# 优化6：使用更精简的方式复制 package 文件
COPY package*.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json

# 优化7：添加 --no-audit --no-fund 加快安装
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && \
    npm install -g pm2@6 --no-audit --no-fund && \
    npm cache clean --force

# 优化8：使用多阶段复制，并设置正确的权限
COPY --chown=node:node ecosystem.config.cjs ecosystem.config.cjs
COPY --from=build --chown=node:node /app/backend/dist backend/dist
COPY --from=build --chown=node:node /app/frontend/dist frontend/dist

# 优化9：创建数据目录并设置权限
RUN mkdir -p ${DATA_DIR} && chown -R node:node ${DATA_DIR}

# 优化10：切换到非 root 用户运行
USER node

VOLUME ["/data"]
EXPOSE 3180

# 优化11：使用 PM2 Runtime 守护 Node.js 进程
CMD ["pm2-runtime", "ecosystem.config.cjs"]
