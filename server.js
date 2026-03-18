const express = require("express");
const multer = require("multer");
const path = require("path");

const {
  DEFAULT_ZIP_FILE_NAME,
  buildResultsZip,
  processUploads,
} = require("./netlify/functions/_shared/transform.cjs");

const app = express();
const port = process.env.PORT || 3000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 21,
    fileSize: 20 * 1024 * 1024,
  },
});

function setResultHeaders(res, stats, zipSize) {
  res.set({
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="${DEFAULT_ZIP_FILE_NAME}"`,
    "Content-Length": String(zipSize),
    "X-Product-File-Count": String(stats.productFileCount),
    "X-Merged-Row-Count": String(stats.mergedRowCount),
    "X-Removed-Final-Active-Rows": String(
      stats.removedOriginalFinalActiveRows
    ),
    "X-Inventory-Sku-Count": String(stats.inventorySkuCount),
    "X-Matched-Inventory-Rows": String(stats.matchedInventoryRows),
    "X-Final-Row-Count": String(stats.finalRowCount),
    "X-Converted-Row-Count": String(stats.convertedRowCount),
    "X-Inventory-Sheet-Name": encodeURIComponent(stats.inventorySheetName),
  });
}

app.use(express.static(path.join(__dirname, "public")));

app.get("/favicon.ico", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "favicon.svg"));
});

app.post(
  "/api/process",
  upload.fields([
    { name: "productCsvs", maxCount: 20 },
    { name: "inventoryFile", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const productFiles = req.files?.productCsvs || [];
      const inventoryFiles = req.files?.inventoryFile || [];

      const result = await processUploads({
        productFiles,
        inventoryFile: inventoryFiles[0],
      });
      const zipBuffer = await buildResultsZip(result.outputFiles);

      setResultHeaders(res, result.stats, zipBuffer.length);
      res.status(200).send(zipBuffer);
    } catch (error) {
      console.error(error);
      res.status(400).json({
        error:
          error instanceof Error
            ? error.message
            : "处理失败，请检查输入文件。",
      });
    }
  }
);

app.listen(port, () => {
  console.log(`Final Sale Web App running at http://localhost:${port}`);
});
