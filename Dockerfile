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
COPY frontend/public frontend/public
COPY frontend/src frontend/src

# 优化4：构建时设置环境变量，确保生产构建
ENV NODE_ENV=production
RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app

ARG VERSION=0.6.43
ARG DATA_DIR=/data
ARG SCHEMA_VERSION=22

# 强制使用 Asia/Shanghai 时区，避免容器默认 UTC 与用户本地时区错位
# 导致「今日流量」按字符串日期匹配时查不到数据
RUN apk add --no-cache tzdata && \
    cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime && \
    echo "Asia/Shanghai" > /etc/timezone && \
    apk del tzdata

ENV NODE_ENV=production \
    PORT=3180 \
    DATA_DIR=${DATA_DIR} \
    TZ=Asia/Shanghai \
    XNZ_VERSION=${VERSION} \
    XNZ_SCHEMA_VERSION=${SCHEMA_VERSION} \
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
COPY --chown=node:node scripts/pre-start.sh /usr/local/bin/pre-start.sh
COPY --from=build --chown=node:node /app/backend/dist backend/dist
COPY --from=build --chown=node:node /app/frontend/dist frontend/dist

# 优化9：创建数据目录并设置权限
RUN mkdir -p ${DATA_DIR} && chown -R node:node ${DATA_DIR}

# 优化10：切换到非 root 用户运行
USER node

RUN chmod +x /usr/local/bin/pre-start.sh

VOLUME ["/data"]
EXPOSE 3180

# 优化11：使用 pre-start.sh 包装 PM2 Runtime，先打印升级横幅再启动 node
CMD ["/usr/local/bin/pre-start.sh"]
