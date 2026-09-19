# GitHub 展示与上传准备

## 仓库定位

建议仓库名称：`wechat-booking-miniprogram`。

建议 GitHub About 简介：

> 微信原生 TypeScript + CloudBase 单店预约 Demo，包含顾客预约、商家工作台、事务防冲突、幂等重试与 59 项本地测试。

建议 Topics：`wechat-miniprogram`、`typescript`、`cloudbase`、`booking`、`appointment`。

入口使用根目录 README；STATUS 汇总当前进度，ARCHITECTURE 帮助读代码，ROADMAP 说明后续方向。不要将尚未完成的真机、并发或完整商家验收写成已经通过。

## 上传内容

提交 TypeScript 源码、WXML／WXSS／JSON、共享类型、基础设施定义、构建与维护脚本、测试、package.json、package-lock.json 和文档。新商家页面、server/merchant.ts、共享页面工具、商家测试及新文档也必须加入版本管理，不能只提交原先已跟踪文件。

不要提交 node_modules、环境密钥、数据库导出、控制台截图中的身份或会话信息、系统 .DS_Store、本地编辑器设置。页面 JS 与云函数 index.js 是构建产物，已被忽略，下载者应先运行构建。

根目录原始模板目前保留，README 已标明实际入口；无需在首次文档整理中顺带删除模板。

## 当前公开范围检查

- 真实开发配置保留在被忽略的 config/development.local.json，公开 development.example.json 使用虚构标识并标记 exampleOnly。
- project.config.json、project.private.config.json、生成的前端配置与 JavaScript 均不跟踪；构建可以从 project.config.example.json 创建项目配置。
- 源码中的真实 AppID、开发环境 ID 和初始化账号哈希已改为显式配置，测试采用虚构数据。
- 原本地 Git 历史已备份到项目外，并重新初始化仓库；新仓库不继承旧提交中的个人邮箱。
- 新仓库尚未提交；仓库级姓名和邮箱设为空，防止自动继承全局个人邮箱。首次提交前设置自己的公开作者名与 GitHub 提供的隐私邮箱。
- 尚未添加 LICENSE；是否授权他人复用以及采用何种许可证由作者决定。

## 展示素材

推荐后续添加 4 张真实界面截图：服务列表、时段选择、商家工作台、接单日历。截图前清理真实顾客信息、用户标识和控制台内容；只展示已运行的页面，不用设计图冒充实测界面。本轮未添加未经确认的截图。

## 上传步骤

已重建本地仓库并暂存公开文件，但没有创建 GitHub 远端仓库、提交或推送代码。准备上传时：

1. 创建空仓库，选择公开或私有，并确定许可证。
2. 检查暂存文件，确认新商家代码、测试和文档完整，个人配置不在提交中。
3. 运行本地检查，创建一个能回退的提交。
4. 添加自己的 GitHub 远端后推送；不要照抄任何示例账号地址。
5. 检查 GitHub 上 README、Mermaid、相对链接与目录是否正常显示。

可先使用 `git status --short`、`git diff --stat` 和 `git diff --cached` 审阅。云函数上传不等于 GitHub 推送，GitHub 推送也不会自动部署本项目的云函数。
