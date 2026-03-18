const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");

const express = require("express");
const multer = require("multer");

const { processUploads } = require("./src/transform");

const app = express();
const port = process.env.PORT || 3000;
const generatedRoot = path.join(__dirname, "generated");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 21,
    fileSize: 20 * 1024 * 1024,
  },
});

app.use("/static", express.static(path.join(__dirname, "public")));

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderLayout(content, pageTitle = "Final Sale Web App") {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(pageTitle)}</title>
    <link rel="stylesheet" href="/static/styles.css" />
  </head>
  <body>
    <div class="backdrop backdrop-one"></div>
    <div class="backdrop backdrop-two"></div>
    <main class="shell">
      ${content}
    </main>
  </body>
</html>`;
}

function renderHome({ errorMessage = "", defaults = {} } = {}) {
  const errorBanner = errorMessage
    ? `<div class="notice notice-error">${escapeHtml(errorMessage)}</div>`
    : "";

  return renderLayout(`
    <section class="hero">
      <p class="eyebrow">Shopify Final Sale Workflow</p>
      <h1>把 CSV 上传进来，直接生成两张可交付结果表</h1>
      <p class="lede">
        上传多个商品 CSV 和一个库存 Excel，应用我们已经确认过的规则：
        合并、库存回填、按 final 拆分、再把非 final 自动转成 final-sale 版本。
      </p>
    </section>

    ${errorBanner}

    <section class="panel">
      <form class="upload-form" action="/process" method="post" enctype="multipart/form-data">
        <label class="field">
          <span>商品 CSV（可多选）</span>
          <input type="file" name="productCsvs" accept=".csv,text/csv" multiple required />
          <small>支持任意多个 Shopify 商品导出 CSV，表头必须一致。</small>
        </label>

        <label class="field">
          <span>库存 Excel</span>
          <input
            type="file"
            name="inventoryFile"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            required
          />
          <small>需要包含 <code>库存SKU</code> 和 <code>可用库存总量</code> 两列。</small>
        </label>

        <div class="workflow">
          <div class="workflow-card">
            <h2>输出文件</h2>
            <p>1. <code>products_export_title_final.csv</code></p>
            <p>2. <code>products_export_title_nonfinal_added_final_sale.csv</code></p>
          </div>

          <div class="workflow-card">
            <h2>处理规则</h2>
            <p>先删掉 <code>Handle</code> 含 <code>final</code> 且原始 <code>Status=active</code> 的行</p>
            <p><code>Variant Inventory Policy</code> 全改为 <code>deny</code></p>
            <p><code>Status</code> 全改为 <code>active</code></p>
            <p>库存按 <code>库存SKU</code> 对 <code>Variant SKU</code> 回填，没有就写 <code>0</code></p>
            <p>非 final 表自动补 <code>-final-sale</code>，并重算价格</p>
          </div>
        </div>

        <button class="cta" type="submit">生成结果文件</button>
      </form>
    </section>
  `);
}

function renderResult({ jobId, outputFiles, stats }) {
  const downloads = outputFiles
    .map(
      (file) => `
        <a class="download-card" href="/download/${encodeURIComponent(jobId)}/${encodeURIComponent(file.fileName)}">
          <strong>${escapeHtml(file.fileName)}</strong>
          <span>${file.rowCount} 行</span>
        </a>
      `
    )
    .join("");

  return renderLayout(
    `
    <section class="hero hero-compact">
      <p class="eyebrow">处理完成</p>
      <h1>结果已经生成，可以直接下载了</h1>
      <p class="lede">这次处理了 ${stats.productFileCount} 个商品 CSV，库存工作表为 ${escapeHtml(
        stats.inventorySheetName
      )}。</p>
    </section>

    <section class="panel summary-grid">
      <div class="metric">
        <span>合并总行数</span>
        <strong>${stats.mergedRowCount}</strong>
      </div>
      <div class="metric">
        <span>预删 Final Active 行数</span>
        <strong>${stats.removedOriginalFinalActiveRows}</strong>
      </div>
      <div class="metric">
        <span>库存 SKU 数</span>
        <strong>${stats.inventorySkuCount}</strong>
      </div>
      <div class="metric">
        <span>命中库存行数</span>
        <strong>${stats.matchedInventoryRows}</strong>
      </div>
      <div class="metric">
        <span>Final 表行数</span>
        <strong>${stats.finalRowCount}</strong>
      </div>
      <div class="metric">
        <span>非 Final 转换表行数</span>
        <strong>${stats.convertedRowCount}</strong>
      </div>
    </section>

    <section class="panel">
      <div class="downloads">
        ${downloads}
      </div>
      <div class="actions">
        <a class="secondary" href="/">再处理一批文件</a>
      </div>
    </section>
  `,
    "处理完成"
  );
}

app.get("/", (_req, res) => {
  res.type("html").send(renderHome());
});

app.get("/favicon.ico", (_req, res) => {
  res.status(204).end();
});

app.post(
  "/process",
  upload.fields([
    { name: "productCsvs", maxCount: 20 },
    { name: "inventoryFile", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const productFiles = req.files?.productCsvs || [];
      const inventoryFiles = req.files?.inventoryFile || [];
      if (!productFiles.length) {
        res.status(400).type("html").send(renderHome({ errorMessage: "请至少上传一个商品 CSV。" }));
        return;
      }
      if (!inventoryFiles.length) {
        res.status(400).type("html").send(renderHome({ errorMessage: "请上传库存 Excel。" }));
        return;
      }

      const jobId = randomUUID();
      const outputDir = path.join(generatedRoot, jobId);
      const result = await processUploads({
        productFiles,
        inventoryFile: inventoryFiles[0],
        outputDir,
      });

      res.type("html").send(renderResult({ jobId, ...result }));
    } catch (error) {
      console.error(error);
      res
        .status(400)
        .type("html")
        .send(
          renderHome({
            errorMessage: error instanceof Error ? error.message : "处理失败，请检查输入文件。",
          })
        );
    }
  }
);

app.get("/download/:jobId/:fileName", async (req, res) => {
  const { jobId, fileName } = req.params;
  if (!/^[a-f0-9-]+$/i.test(jobId)) {
    res.status(400).send("Invalid job id.");
    return;
  }

  const safeFileName = path.basename(fileName);
  const filePath = path.join(generatedRoot, jobId, safeFileName);

  try {
    await fs.access(filePath);
    res.download(filePath, safeFileName);
  } catch {
    res.status(404).send("File not found.");
  }
});

app.listen(port, async () => {
  await fs.mkdir(generatedRoot, { recursive: true });
  console.log(`Final Sale Web App running at http://localhost:${port}`);
});
