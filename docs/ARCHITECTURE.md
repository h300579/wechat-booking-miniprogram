# 从入口阅读代码

本项目是一个小程序内的顾客与商家两种使用流程，没有独立 Web 商家后台。两端共用预约业务与数据库。

## 建议阅读顺序

| 顺序 | 文件／目录 | 主要职责 |
| --- | --- | --- |
| 1 | `project.config.json` | 指定实际小程序目录 `miniprogram/` 与云函数目录 |
| 2 | `miniprogram/app.ts`、`app.json` | 初始化云环境，注册 10 个页面和底部导航 |
| 3 | `miniprogram/pages/service/` | 顾客浏览服务列表与详情 |
| 4 | `miniprogram/pages/booking/` | 查询时段、提交预约与显示结果 |
| 5 | `miniprogram/pages/appointment/` | 查看个人预约、详情及取消；展示商家入口 |
| 6 | `miniprogram/utils/api.ts` | 统一云函数调用、错误、请求去重和冷却 |
| 7 | `server/index.ts`、`server/api.ts` | booking 云函数入口与顾客动作路由 |
| 8 | `server/security.ts`、`appointment.ts` | 身份、限流、时段校验、创建／取消事务 |
| 9 | `miniprogram/pages/merchant/`、`utils/merchant-page.ts` | 4 个商家页面，以及共享加载、确认和操作逻辑 |
| 10 | `server/ops-entry.ts`、`merchant.ts` | 商家鉴权、查询、统计、关闭／开放日期 |
| 11 | `server/store.ts`、`cloud-store.ts` | 存储接口、CloudBase 适配与事务重试 |
| 12 | `tests/` | 使用内存存储、模拟微信接口与云管理接口验证行为 |

每个页面的 `.ts` 处理逻辑，`.wxml` 描述结构，`.wxss` 描述样式，`.json` 保存页面配置。商家页面复用工厂函数，具体 UI 仍在各自 WXML 中。

## 关键数据关系

- `wechat_accounts`：微信可信身份到内部用户的映射。
- `users`：用户状态与未来预约配额记录。
- `admin_roles`：受信任管理员配置的商家角色。
- `services`：服务价格、时长和上架状态。
- `settings`、`business_hours`：预约规则和周营业时间。
- `resource_days`：某天的营业窗口、屏蔽区间、预约占用与手动关闭标记。
- `appointments`：预约及其服务价格／时长快照。
- `idempotency_records`：重复请求的结果恢复。
- `rate_limits`、`audit_logs`、`upload_intents`：限流、审计与可选图片处理记录。

创建预约同时检查规则和占用，相关写入在事务内提交；取消预约同步移除占用并更新用户配额。关店只改变手动关闭标记，不删除预约。`server/time.ts` 负责业务日期和上海时区转换。

## 配置与生成文件

`config/development.example.json` 提供开发配置，`config/service-content.json` 提供介绍文案。`scripts/build.mjs` 生成前端公开配置、页面 JS 和两个业务云函数的 JS，并同步小程序标题与 AppID。

编辑 TypeScript 和配置源文件；不要直接维护生成的 JS。`server/operations.ts`、`scripts/manage.ts` 提供受控初始化和维护能力，日常操作说明见 DEVELOPMENT 与 RUNBOOK。

根目录原始 `app.*`、`pages/`、`components/` 为保留模板，不属于当前 `miniprogramRoot` 的运行入口。临时 `developmentSetup` 不在默认业务构建／部署链中，也不是公开注册管理员的接口。
