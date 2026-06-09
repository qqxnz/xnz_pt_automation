#!/bin/bash
set -euo pipefail

# 配置
DOCKER_HUB_IMAGE="qqxnz/xnz-pt-automation"
ALIYUN_REGISTRY="crpi-yg64rrvs864jdm4p.cn-shenzhen.personal.cr.aliyuncs.com"
ALIYUN_IMAGE="${ALIYUN_REGISTRY}/qqxnz/xnz-pt-automation"
VERSION="${VERSION:-$(node -p "require('./package.json').version")}"

# 登录凭据（如需修改可在此处直接覆盖）
DOCKER_HUB_USERNAME="${DOCKER_HUB_USERNAME:-qqxnz}"
DOCKER_HUB_PASSWORD="${DOCKER_HUB_PASSWORD:-&bPTME9q%zS3}"
ALIYUN_USERNAME="${ALIYUN_USERNAME:-lsm164@126.com}"
ALIYUN_PASSWORD="${ALIYUN_PASSWORD:-x3sF2@xpmJ4HnzQ}"

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}=== 多架构镜像构建和推送脚本 ===${NC}"

# 自动登录 Docker Hub
echo -e "${YELLOW}登录 Docker Hub...${NC}"
echo "${DOCKER_HUB_PASSWORD}" | docker login -u "${DOCKER_HUB_USERNAME}" --password-stdin

# 自动登录阿里云
echo -e "${YELLOW}登录阿里云镜像仓库...${NC}"
echo "${ALIYUN_PASSWORD}" | docker login --username="${ALIYUN_USERNAME}" --password-stdin "${ALIYUN_REGISTRY}"

# 创建或使用构建器
BUILDER_NAME="multiarch-builder"
if docker buildx inspect "${BUILDER_NAME}" >/dev/null 2>&1; then
    echo -e "${GREEN}使用已存在的构建器: ${BUILDER_NAME}${NC}"
    docker buildx use "${BUILDER_NAME}"
    docker buildx inspect --bootstrap
else
    echo -e "${GREEN}创建多架构构建器...${NC}"
    docker buildx create --name "${BUILDER_NAME}" --use
    docker buildx inspect --bootstrap
fi

# 构建并推送
echo -e "${GREEN}开始构建多架构镜像...${NC}"
echo "支持的架构: linux/amd64, linux/arm64"
echo "版本号: ${VERSION}"
echo "标签: latest, ${VERSION}"
echo "目标仓库:"
echo "  - Docker Hub: ${DOCKER_HUB_IMAGE}"
echo "  - 阿里云: ${ALIYUN_IMAGE}"
echo ""

docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --build-arg VERSION=${VERSION} \
  --tag ${DOCKER_HUB_IMAGE}:latest \
  --tag ${DOCKER_HUB_IMAGE}:${VERSION} \
  --tag ${ALIYUN_IMAGE}:latest \
  --tag ${ALIYUN_IMAGE}:${VERSION} \
  --push \
  .

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ 多架构镜像构建并推送成功！${NC}"
    echo ""
    echo "=== 镜像拉取命令 ==="
    echo "从 Docker Hub 拉取:"
    echo "  docker pull ${DOCKER_HUB_IMAGE}:latest"
    echo "  docker pull ${DOCKER_HUB_IMAGE}:${VERSION}"
    echo ""
    echo "从阿里云拉取:"
    echo "  docker pull ${ALIYUN_IMAGE}:latest"
    echo "  docker pull ${ALIYUN_IMAGE}:${VERSION}"
    echo ""
    echo "=== 运行容器 ==="
    echo "  docker run -d --restart unless-stopped -p 3180:3180 -v ./data:/data ${DOCKER_HUB_IMAGE}:latest"
    
    # 显示镜像详情
    echo ""
    echo "=== 阿里云镜像详情 ==="
    docker buildx imagetools inspect ${ALIYUN_IMAGE}:latest
else
    echo -e "${RED}❌ 构建失败${NC}"
    exit 1
fi
