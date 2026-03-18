# Final Sale Web App

Netlify 友好的 WebApp，用来把多个 Shopify 商品 CSV 和一个库存 Excel 处理成最终结果 ZIP。

## 本地启动

```bash
npm install
npm start
```

默认地址：

```text
http://localhost:3000
```

如果你想在本地模拟 Netlify Functions：

```bash
npm run netlify:dev
```

如果你想单独验证 Netlify 函数 bundle：

```bash
npm run build:functions
```

## Netlify 部署

这个项目已经包含 [netlify.toml](/Users/zhongziyun/Downloads/检查下架/final-sale/netlify.toml)：

- 静态页面发布目录：`public`
- Functions 源码目录：`netlify/functions`
- Functions 构建产物目录：`netlify/functions-dist`
- Node 版本：`20`

推到 GitHub 后，直接在 Netlify 里导入仓库即可。

## 输入

- 多个商品 CSV
- 一个库存 Excel

库存 Excel 需要包含两列：

- `库存SKU`
- `可用库存总量`

## 输出

下载一个 ZIP：

- `products_export_title_final.csv`
- `products_export_title_nonfinal_added_final_sale.csv`

## 当前规则

- 合并所有商品 CSV
- 合并后先按重复 SKU 去重：如果重复商品同时存在普通 `Handle` 和 `final-sale Handle`，整组保留 `final-sale`，整组删除普通款
- 先删掉 `Handle` 含 `final` 且原始 `Status=active` 的整组商品
- `Variant Inventory Policy` 全部改为 `deny`
- `Status` 全部改为 `active`
- 用库存表回填 `Variant Inventory Qty`，没有则写 `0`
- 按 `Title` 是否包含 `final` 拆分；若整组没有标题，则回退按 `Handle` 判断
- 非 `final` 组追加 `-final-sale`
- 非 `final` 组价格转换为：
  - 原 `Variant Price` 复制到 `Variant Compare At Price`
  - 新 `Variant Price` = 原价的 20%，并向上取整到最近的 `x.99`

## 为什么这个版本更适合 Netlify

- 前端是纯静态文件，适合 CDN 发布
- 处理逻辑跑在 Function 里
- 不依赖本地磁盘持久化
- 结果在内存里打包成 ZIP 后直接返回下载
- 在部署前先把 Function 打成单文件 bundle，减少运行时找不到依赖的风险
