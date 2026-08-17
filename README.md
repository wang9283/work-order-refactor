# 工单配置重构原型（work-order-refactor）

独立的迭代原型目录，不修改现有 `Prototype/` 下的旧原型。

## 目录结构

```
work-order-refactor/
├── docs/                    # 迭代方案文档
├── public/                  # logo 等静态资源
├── src/
│   ├── shared/              # PC 与 App 共享的数据模型、演示数据、localStorage 存取
│   ├── admin/               # PC 管理端（React + Ant Design）
│   └── mobile/              # App 执行端（React + antd-mobile）
├── index.html               # PC 端入口
├── app.html                 # App 端入口
├── package.json
└── vite.config.js
```

## 视觉

- 复用旧原型 `Prototype/feed-proto/public` 中的正式 logo / favicon / 图标。
- PC 端主题色：`#1677ff`，圆角 6。
- App 端顶部导航使用主题色。

## 快速开始

```bash
npm install
npm run dev
```

- PC 管理端：`http://localhost:5173/index.html`
- App 执行端：`http://localhost:5173/app.html`

PC 与 App 处于同一 Vite 应用，共用同一 `localStorage`，因此 PC 新增/修改工单类型后，App 端直接可见，无需单独配置。

## 原型范围

- 工单模板构建：主表单、子表单、字段、条件逻辑、版本发布。
- 工单类型配置：基础信息、表单绑定、触发规则、时限窗口、生成通知、状态流转。
- 组织视角：集团 / 子公司视角切换，集团标准 + 子公司运营覆盖。
- App 端：任务创建、主表单/子表单填写、提交完工。

## 技术栈

- React 18
- Vite 5
- Ant Design 5（PC）
- antd-mobile 5（App）
- 共享数据层：`src/shared/store.js` + `localStorage`
