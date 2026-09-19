# 预约系统开发与部署

本项目包含单店预约 MVP 与 [商家工作台](merchant-console-demo-spec.md)。最新实现与验证范围见 [项目状态](STATUS.md)。小程序根目录为 `miniprogram/`；根目录原始模板保留作参考，不参与小程序打包。源代码为 TypeScript，`npm run build` 编译页面与两个云函数。前端保留共享 CommonJS 模块，不再逐页内嵌公共 API；微信开发工具的 TypeScript 插件关闭。编辑 TS 后需要重新 build。不要编辑生成的 JavaScript。

## 配置自有开发环境

不要直接把仓库原维护者的环境当作共享后端。复制 `config/development.example.json` 为 `config/development.local.json`，填写自己的 AppID、环境 ID 与门店信息，并将 `exampleOnly` 改为 `false`，再执行：

```sh
export BOOKING_CONFIG=config/development.local.json
export BOOKING_TARGET_ENV='YOUR_CLOUDBASE_ENV_ID'
```

本地配置已加入忽略规则。构建会把公开 AppID／环境 ID 写入前端配置和 project.config.json；这些生成文件已排除 Git 跟踪，真实标识只保留在本地。两个云函数必须配置 `WECHAT_APP_ID` 为自己的 AppID；源码不再包含真实 AppID 回退值。迁移、初始化、部署是独立步骤，不会因本地构建自动执行。

## 本地验证

```sh
npm ci --ignore-scripts
npm run check
npm run cloud:plan
```

前端公开配置 `miniprogram/config/env.ts`、`catalog.ts` 也由构建生成。配置来源是 `BOOKING_CONFIG`（未指定时优先使用 development.local.json，否则使用 development.example.json），介绍文案来自 `config/service-content.json`。构建同步 AppID、全局门店标题、日期范围、预约配额提示和开发标识；仅提取公开字段，不将管理凭证或告警接收人下发。第一版显式只支持 Asia/Shanghai。修改本地配置不会自动迁移已有数据库设置或服务。

`tests/booking.test.ts` 验证区间、幂等、并发注册、权限、共享限流、配额、取消、分页；`tests/frontend.test.ts` 运行真实页面方法并连接内存数据库中的真实业务实现；`tests/operations.test.ts` 验证 SDK 适配层最多 3 次事务尝试及运维逻辑。内存测试不能代替 CloudBase 多实例事务实测。

## 云端部署顺序

开发配置：`config/development.local.json`，由示例文件复制并填写。正式环境必须独立创建并配置，示例项目不得直接上线。

1. 用受控执行环境的腾讯云权限运行脚本；凭证只通过环境变量注入，禁止粘贴到聊天、代码或小程序。
2. 显式设置 `BOOKING_CONFIG` 和 `BOOKING_TARGET_ENV`，防止连错环境。
3. 执行 `npm run cloud:migrate`，创建集合、禁止客户端读写的规则和索引。到控制台确认索引完成，再从小程序验证直读/直写均被拒绝。
4. 执行 `npm run cloud:seed`，仅允许 development，并拒绝覆盖已有 settings。初始化中断后可运行 daily 补齐日期，不会覆盖已有占用。
5. 执行 `npm run cloud:deploy`，仅部署 booking 和 operations。也可在微信开发者工具中为 cloudfunctions 选择环境，逐个右键「上传并部署：云端安装依赖」。部署脚本不购买套餐、不开放 HTTP、不创建匿名权限。已有函数按更新代码、更新配置、回读核验执行，保留其他已有环境变量；运行时不匹配会停止，需单独迁移。
6. `infra/functions.json` 统一定义 booking 5 秒、operations 60 秒，构建与部署共用；使用开发工具上传后仍需在控制台核对实际配置。平台并发/QPS 按套餐实际能力设置并留存截图。源码中的共享计数不替代入口限流。
7. 小程序普通编译，依次验证列表、详情、预约、我的预约和取消。`booking` 通过 `{action,data}` 路由 8 个动作；所有身份来自可信 WXContext。
8. 使用开发环境和独立测试身份进行 50 请求重叠压测、断网重试、事务失败及越权测试；总调用预算建议先控制在 500 次以内，记录实际调用量和费用。

受控执行示例（环境变量的凭证值由操作者在本地安全注入）：

```sh
export BOOKING_CONFIG=config/development.local.json
export BOOKING_TARGET_ENV='YOUR_CLOUDBASE_ENV_ID'
npm run cloud:migrate
npm run cloud:seed
npm run cloud:deploy
npm run cloud:reconcile
```

脚本使用 `TENCENTCLOUD_SECRETID`、`TENCENTCLOUD_SECRETKEY` 和可选 `TENCENTCLOUD_SESSIONTOKEN`。初始化脚本不通过客户端开放；不存在“第一个用户自动成为管理员”的接口。`operations` 要求 `admin_roles` 中存在可信 APPID:OPENID 的 SHA-256 映射并为 ACTIVE；由负责人通过受控服务端维护，不向普通用户暴露身份映射或完整角色记录；getMyMerchantRole 允许查询自身资格，普通用户返回 isMerchant:false。

## 日常任务

受控调度器每日运行 `npm run cloud:daily`，按 bookingDays 生成日程并做维护；另将 `npm run cloud:cleanup` 配为每 15 分钟运行一次的初始频率，再根据积压与费用调整。cleanup 每次默认最多检查 500 条、批次 50 条、软时限 45 秒（在途数据库调用可以完成），不会无限循环。返回 complete/backlog/stopReason 及每集合结果；未完成返回非零退出状态，调度器应告警并安排后续有界批次。expiresAt 目前是普通查询索引，不是自动 TTL 删除。身份凭证不得放入小程序或定时事件的明文载荷。调度器失败必须告警。本实现提供可调度脚本，尚未替用户安装机器或平台计划任务。

`npm run cloud:maintenance` 关闭新预约；查询、取消保留。`npx tsx scripts/manage.ts block-day YYYY-MM-DD` 停止该日期的新预约；已有预约保持有效。重新开放可在商家接单日历操作，恢复后仍保留已有占用和原始屏蔽区间。管理员取消使用 `npx tsx scripts/manage.ts cancel APPOINTMENT_ID`，复用同一事务服务。

第一版营业时间与服务项目用控制台/受控配置管理。更改营业时间只影响新生成日程；已有日程必须显式迁移并检查冲突。历史预约价格和时长不随服务配置变化。

## 项目图片

默认使用小程序随包的视觉展示，不开放普通用户上传。可选管理员图片处理脚本：`npx tsx scripts/upload-image.ts SERVICE_ID LOCAL_FILE`。在本地校验真实文件类型、2 MB、单帧、1200 万像素并重编码 WebP，然后通过管理员 SDK 上传，普通客户端没有签名直传权限。每项目 6 张、每天 20 张/40 MB，daily 任务清理到期预留并结算配额；上传中断保留 24 小时再清理，防止与在途请求冲突。

云存储默认禁止客户端读写；发布图片若要供小程序展示，应通过经过验证的受控分发方式或将合规图片加入小程序资源。当前没有开放公开存储分发，不能认为图片下载流量防刷已经部署。

## 依赖注意

依赖已锁定。官方 CloudBase SDK 的间接依赖仍有 npm audit 告警，尤其旧 lodash.set/unset；实时 watch 路径未使用，但不能据此宣称风险消失。Manager SDK 仅用于受控运维且不打入业务云函数。发布前须核对并解决/评估依赖告警以及平台实际兼容性，不可无测试地强制回退官方 SDK。

官方依据：

- https://docs.cloudbase.net/recipes/add-cloud-function-wechat-miniprogram
- https://docs.cloudbase.net/database/transaction
- https://docs.cloudbase.net/en/api-reference/manager/node/rule
- https://docs.cloudbase.net/cli-v1/functions/configs

## 修复后的检查范围

`cloud:reconcile` 检查配置预约窗口内的占用和所有用户未来配额，双向核对孤儿、取消、错归属、错时间和重复配额。按 ID 分页，默认 45 秒/5,000 个检查条目，超过限制 complete=false 且 ok=false。新增预约分页索引需要重新 migrate。它仍不是全历史备份恢复验收，也不是跨集合一致快照，恢复时应暂停写入再检查，并额外核对历史与取消记录。

临时 developmentSetup 源码已移除身份诊断分支，close 标记也覆盖 settings 集合规则入口；它不在默认构建或部署链中。仅生成本地文件不会改变云端已有函数。生产样例仍是验收模板，生产业务初始化流程尚待补齐，不要解除 seed 的 development 限制后直接写入生产。

## 配置脱敏后的部署注意

`project.config.example.json` 为公开模板；构建会在缺少 project.config.json 时自动生成它。无本地配置时可用虚构的示例配置完成构建与测试，真实云功能必须配置自有环境。

移除 AppID 回退值后，重新部署前必须给 booking 与 operations 设置 WECHAT_APP_ID，否则接口返回 MAINTENANCE。本次本地仓库整理没有修改已部署的云函数。

临时 developmentSetup 改为显式读取 SETUP_OWNER_HASH（64 位十六进制身份哈希）与 SETUP_CONFIG_JSON（开发配置 JSON），缺少设置时拒绝执行；环境必须与配置匹配，exampleOnly 不能为 true，原有 setupComplete 关闭保护保留。该工具不参与默认部署，也不应部署到生产。

生产配置新增 developmentEnvironmentId，用于检查生产与开发环境不能相同；该字段必须填写，不能通过删除旧环境硬编码取消隔离检查。
