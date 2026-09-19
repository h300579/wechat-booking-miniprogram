# 商家端 Demo 实现约定与交接

依据 [商家端设计](merchant-console-demo-spec.md) 实现。当前已完成主要功能、本地 59 项测试、开发环境部署、商家授权和查询索引配置；完整商家联调尚未完成。最新进度见 [项目状态](STATUS.md)。

## 三项补充约定

1. 关店与预约竞态以数据库事务提交顺序为准。预约先提交但响应较晚到达是合法结果；关店提交后不能有绕过关闭标记的新预约。
2. 无上架服务显示“暂无可预约服务”。尚未结束营业但已经没有合法起约时间，显示“已无可预约时段”，不误称已约满。
3. 商家取消确认明确：释放占用不等于重新开放，是否可约以当天开放设置为准；不宣称已发送通知。

## 实现位置

- server/merchant.ts：列表、详情、当日统计、日历状态、关闭与重新开放。
- server/ops-entry.ts：可信身份解析、角色查询和商家接口鉴权。
- server/appointment.ts：创建事务与空闲查询共用 fits，识别 resource_days.manuallyClosed；取消重试先返回已取消结果。
- server/operations.ts：旧 blockDay 入口复用新的关店逻辑。
- miniprogram/pages/merchant：dashboard、list、day、detail 四个页面。
- miniprogram/utils/merchant-page.ts：页面加载、刷新、日期选择、二次确认和错误处理。
- miniprogram/utils/api.ts：复用传输，按云函数区分请求去重与冷却。
- “我的预约”页面根据自身资格查询显示商家入口。

## 接口与行为

operations 新增 getMyMerchantRole、getMerchantDashboard、getMerchantAppointments({date})、getMerchantAppointment({appointmentId})、getMerchantDay({date?})、closeDay({date})、reopenDay({date})。复用 cancelAppointment。

资格查询允许普通已登录用户，返回 isMerchant:false。其他商家接口必须检查有效角色、有效用户和身份映射一致。

日列表按 _id 分批读取后按 startTime / _id 排序，包含取消记录。最多返回 200 条，超过返回 MERCHANT_QUERY_TOO_LARGE，页面不冒充完整结果。统计单独读取当天 CONFIRMED 记录，不以日列表长度统计；异常超过 500 条拒绝出数。

manuallyClosed 为新增可选布尔字段，旧记录缺省为 false。关闭不修改 windows、blockedIntervals 或 intervals；重新开放只清除自己的关闭标记。原有其他封闭区间保持有效，旧版 blockDay 写入 blockedIntervals 的历史关闭不能自动认定为新式手动关闭，需部署前检查并人工确认迁移。

所有权威时间来自服务器、使用 settings/booking 的 timeZone。首页统计仅限今天；历史预约可查看，关闭/开放只允许当前预约窗口内已有的营业日。页面进入和手动刷新重新读取，不做推送。

## 店主角色配置与撤销

在受信任云控制台进行，不通过小程序自助授予权限。不要在客户端保存管理密钥。

1. 店主先使用自己的微信进入顾客端，让现有 ensureUser 创建用户及 wechat_accounts 映射。
2. 管理人员以可信的店主身份凭据核实对应账号。映射键是 server/security.ts principal 计算的 SHA-256(APPID + ':' + OPENID)，不信任客户端上传的身份或任意选择一个用户。
3. 在 wechat_accounts 中核对该 _id 对应的 userId，并确认 users 中该用户 status 为 ACTIVE。
4. admin_roles 文档 _id 使用同一个身份哈希，内容为 {userId: 对应用户编号, status:'ACTIVE'}。可附 createdAt/updatedAt 数字时间戳。当前单店只给核实过的店主开通。
5. 撤销时将该角色 status 改为 INACTIVE。当前实现仅 ACTIVE 生效，其他值均拒绝；角色类型无需新增字段。
6. 每个商家请求重新查询角色；撤权后页面可能暂时显示入口，但新的业务请求会被服务端拒绝。已在执行的事务不承诺瞬时中断。

## 验证与部署状态

- 开发环境已同步部署 booking 和 operations，并添加 appointments(resourceId,localDate,_id) 索引。
- 已通过受信任控制台核对身份映射、有效用户及商家角色，前端商家入口已显示。
- 旧版“有预约不能关店”测试已更新；类型检查与 59 项本地测试通过。
- 尚未完成商家取消、关闭／恢复接单后的两端同步与真机验收；真实云端事务并发仍需验证。
- 生产环境、真实门店配置和运维验收仍待完成；开发环境部署不等同于正式发布。

实际检查范围见 [本地测试记录](merchant-console-local-test-report.md) 与 [项目状态](STATUS.md)。
