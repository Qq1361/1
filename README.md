# Resale ERP

二手商品交易 ERP。当前只实现 M0 项目骨架，不包含采购订单 CRUD 和成本分摊。

## 环境要求

- Node.js 24+
- pnpm 11+
- PostgreSQL 17，或支持 Docker Compose 的环境

## 本地启动

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Windows PowerShell 可使用 `Copy-Item .env.example .env`。

开发环境允许 `APP_PASSWORD` 留空。公网或生产环境必须配置非空
`APP_PASSWORD`，否则受保护页面无法访问。

## M0 验证

```bash
pnpm db:validate
pnpm test
pnpm lint
pnpm build
```

健康检查位于 `GET /api/health`。未来数据模型与里程碑约束见
[`docs/roadmap.md`](docs/roadmap.md)。

## 本地图片

`LocalStorageAdapter` 默认将文件保存至 `.data/uploads`。该目录已被 Git
忽略。生产部署必须为 `STORAGE_LOCAL_DIR` 配置持久卷；后续可通过相同接口替换为
云对象存储。
