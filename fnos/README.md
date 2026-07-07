# xnz-pt-automation 飞牛 (fnOS) 封装

本目录是 [xnz-pt-automation](https://github.com/qqxnz/xnz_pt_automation) 的飞牛 (fnOS) 应用封装，输出 `.fpk` 包，可在飞牛「应用中心」一键安装。

## 目录说明

```
fnos/
├── manifest                   # 应用元信息（K=V 格式，无扩展名）
├── ICON.PNG                   # 64×64 应用图标
├── ICON_256.PNG               # 256×256 应用图标
├── build.sh                   # 一键打包脚本
├── build_icons.py             # 重新生成图标（可选）
│
├── app/
│   └── docker/
│       ├── docker-compose.yaml   # 核心：host 网络，变量化端口/密码，内置当前镜像版本
│       └── .env.template
│
├── cmd/                       # 8 个生命周期钩子
│   ├── main                   # start/stop/status
│   ├── install_init
│   ├── install_callback       # 打印访问信息
│   ├── uninstall_init
│   ├── uninstall_callback     # 清空共享数据目录（按用户选择）
│   ├── upgrade_init           # 0.6.24+ 兼容旧版本数据迁移
│   ├── upgrade_callback
│   ├── config_init
│   └── config_callback
│
├── config/
│   ├── privilege              # 应用用户/组（package 模式）
│   └── resource               # docker-project + data-share 声明
│
├── wizard/
│   ├── install                # 端口 / 密码
│   ├── uninstall              # 是否删除数据 + 数据目录说明
│   └── upgrade                # 仅提示说明，使用 fpk 内置镜像版本
│
└── i18n/
    └── zh-CN                  # 简体中文
```

## 前置条件

- **阿里云容器镜像服务** 仓库已建好
  - 当前默认地址：`crpi-yg64rrvs864jdm4p.cn-shenzhen.personal.cr.aliyuncs.com/qqxnz/xnz-pt-automation`
  - 如需修改，编辑 `app/docker/docker-compose.yaml` 中 `image:` 字段
- **镜像已推送**：推送与 `manifest` 中 `version` 一致的 tag
- 镜像仓库设为**公开**（私有仓库需 fnOS 端额外配置登录）

## 本地打包 .fpk

### 1. 安装 fnpack

```bash
sudo wget https://static2.fnnas.com/fnpack/fnpack-1.2.1-linux-amd64 -O /usr/local/bin/fnpack
sudo chmod +x /usr/local/bin/fnpack
```

### 2. 打包

```bash
cd fnos
./build.sh 0.6.17
# 产物在仓库根目录：qqxnz.xnz-pt-automation-0.6.17.fpk
```

## 飞牛上安装

### 方式一：应用中心 GUI
- 「应用中心 → 手动安装 → 上传 .fpk」

### 方式二：SSH 安装
```bash
# 先开启手动安装
appcenter-cli manual-install enable
# 安装
appcenter-cli install-fpk /path/to/qqxnz.xnz-pt-automation-0.6.17.fpk
# 安装后关闭
appcenter-cli manual-install disable
```

### 方式三：本地调试（开发用）
```bash
cd fnos
appcenter-cli install-local
```

## 升级

1. 推送新镜像到阿里云：`docker push crpi-yg64rrvs864jdm4p.cn-shenzhen.personal.cr.aliyuncs.com/qqxnz/xnz-pt-automation:<version>`
2. 重新打包：`./build.sh <version>`
3. 飞牛应用中心 → 找到「PTA」→ 重新安装/升级

安装和升级向导不再提供镜像版本输入框；应用会使用 fpk 内置的当前版本镜像 tag。如需回滚，请安装对应旧版本 fpk。

飞牛版容器使用 host 网络，便于连接同机 host 网络模式的 qBittorrent 等下载器。Web 端口会直接占用宿主机端口；如果 `3180` 已被占用，请在安装向导中改为其他端口。

## 卸载

- 数据目录从 0.6.24 起映射到 fnOS 共享目录 `xnz-pt-automation/data`（在 fnOS「文件管理 → 共享文件夹」中可见）
- 默认**保留**共享目录内的应用数据
- 卸载向导中勾选「同时删除所有数据」会清空共享目录内的数据库/备份/缓存，但保留共享目录本身（由 fnOS 决定是否回收）
- 由于容器内 `node` 用户与 fnOS 包用户的 UID 不同，`uninstall_callback` 会优先用一次性 Docker 容器以 root 身份删除 share 内文件，失败时退化到 host 端 `find` 并在日志中完整列出残留条目，便于手动清理

## 数据迁移

### 0.6.24 之前的用户（升级时自动迁移）

`upgrade_init` 会检测旧版本残留数据 `$TRIM_PKGVAR/data`，并自动复制到新共享目录 `xnz-pt-automation/data`，复制成功后在共享目录写入 `.migrated-from-legacy` 标记以避免重复处理。老数据保留在原位置，可在新版本运行正常后手动清理。

### 从 Docker compose 部署迁移到飞牛

旧版部署在 `./data/`，飞牛封装使用共享目录 `xnz-pt-automation/data`，迁移方法：

```bash
# 在飞牛 SSH 中
SHARE_DIR="$(echo "$TRIM_DATA_SHARE_PATHS" | cut -d: -f1)"
# 把旧 ./data 整个目录拷贝过去
scp -r user@old-host:/path/to/old/data/* "$SHARE_DIR/"
# 重启应用
```

如果升级或重装后像全新安装，可先确认当前容器实际挂载源，并搜索旧数据库：

```bash
docker inspect xnz-pt-automation --format '{{range .Mounts}}{{println .Source "->" .Destination}}{{end}}'
find /vol* -path '*xnz-pt-automation*' -name app.db -print
```

0.6.15/0.6.16 曾使用应用安装目录下的 `data`，该目录可能在升级时被 fnOS 重建；如果搜索不到旧 `app.db`，需要依赖 NAS 快照、回收站或外部备份恢复。

## 访问地址

安装后：
- **统一网关**（fnOS V1.1.3100+）：`http://NAS_IP:5666/app/xnz-pt-automation`
- **直接端口**：`http://NAS_IP:3180`（端口可在安装向导调整）
- 默认账号：`admin` / `123456`（可在安装向导修改）

## 重新生成图标

```bash
cd fnos
python3 build_icons.py
```

需要 `Pillow`（`pip3 install Pillow`）。
