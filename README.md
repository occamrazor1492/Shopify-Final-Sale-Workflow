# Final Sale Web App

本地 WebApp，用来把多个 Shopify 商品 CSV 和一个库存 Excel 处理成两张最终结果表。

## 启动

```bash
npm install
npm start
```

默认地址：

```text
http://localhost:3000
```

## 输入

- 多个商品 CSV
- 一个库存 Excel

库存 Excel 需要包含两列：

- `库存SKU`
- `可用库存总量`

## 输出

- `products_export_title_final.csv`
- `products_export_title_nonfinal_added_final_sale.csv`

## 当前规则

- 合并所有商品 CSV
- 先删掉 `Handle` 含 `final` 且原始 `Status=active` 的行
- `Variant Inventory Policy` 全部改为 `deny`
- `Status` 全部改为 `active`
- 用库存表回填 `Variant Inventory Qty`，没有则写 `0`
- 按 `Title` 是否包含 `final` 拆分；若整组没有标题，则回退按 `Handle` 判断
- 非 `final` 组追加 `-final-sale`
- 非 `final` 组价格转换为：
  - 原 `Variant Price` 复制到 `Variant Compare At Price`
  - 新 `Variant Price` = 原价的 20%，并向上取整到最近的 `x.99`
