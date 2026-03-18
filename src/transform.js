const { parse } = require("csv-parse/sync");
const { stringify } = require("csv-stringify/sync");
const ExcelJS = require("exceljs");
const JSZip = require("jszip");

const REQUIRED_PRODUCT_COLUMNS = [
  "Handle",
  "Title",
  "Variant SKU",
  "Variant Inventory Qty",
  "Variant Inventory Policy",
  "Status",
  "Variant Price",
  "Variant Compare At Price",
];

const INVENTORY_SKU_COLUMN = "库存SKU";
const INVENTORY_QTY_COLUMN = "可用库存总量";

const FINAL_FILE_NAME = "products_export_title_final.csv";
const CONVERTED_FILE_NAME =
  "products_export_title_nonfinal_added_final_sale.csv";
const DEFAULT_ZIP_FILE_NAME = "shopify-final-sale-results.zip";

function normalizeText(value) {
  return value == null ? "" : String(value);
}

function normalizeQuantity(value) {
  const text = normalizeText(value).trim();
  if (!text) {
    return "0";
  }

  const numeric = Number(text);
  if (Number.isFinite(numeric)) {
    return Number.isInteger(numeric) ? String(numeric) : String(numeric);
  }

  return text;
}

function arraysMatch(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function parseCsvUpload(file) {
  let headers = [];
  const records = parse(file.buffer, {
    bom: true,
    columns: (headerRow) => {
      headers = headerRow.map((cell) => normalizeText(cell));
      return headers;
    },
    relax_column_count: true,
    skip_empty_lines: false,
  });

  if (!headers.length) {
    throw new Error(`CSV 文件 ${file.originalname} 没有表头。`);
  }

  const rows = records.map((record) => {
    const normalized = {};
    for (const header of headers) {
      normalized[header] = normalizeText(record[header]);
    }
    return normalized;
  });

  return {
    fileName: file.originalname,
    headers,
    rows,
  };
}

function validateProductHeaders(parsedFiles) {
  const [firstFile, ...restFiles] = parsedFiles;
  if (!firstFile) {
    throw new Error("请至少上传一个商品 CSV。");
  }

  for (const requiredColumn of REQUIRED_PRODUCT_COLUMNS) {
    if (!firstFile.headers.includes(requiredColumn)) {
      throw new Error(`商品 CSV 缺少必需列：${requiredColumn}`);
    }
  }

  for (const file of restFiles) {
    if (!arraysMatch(firstFile.headers, file.headers)) {
      throw new Error(
        `CSV 表头不一致，无法合并：${firstFile.fileName} / ${file.fileName}`
      );
    }
  }

  return firstFile.headers;
}

async function readInventoryMap(file) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file.buffer);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error("库存 Excel 没有可读取的工作表。");
  }

  const sheetName = worksheet.name;
  const rows = [];
  worksheet.eachRow({ includeEmpty: true }, (row) => {
    rows.push(row.values.slice(1));
  });

  const [headerRow = [], ...dataRows] = rows;
  if (!headerRow.length) {
    throw new Error("库存 Excel 没有表头。");
  }

  const headerIndex = new Map();
  headerRow.forEach((header, index) => {
    headerIndex.set(normalizeText(header).trim(), index);
  });

  if (!headerIndex.has(INVENTORY_SKU_COLUMN)) {
    throw new Error(`库存 Excel 缺少列：${INVENTORY_SKU_COLUMN}`);
  }
  if (!headerIndex.has(INVENTORY_QTY_COLUMN)) {
    throw new Error(`库存 Excel 缺少列：${INVENTORY_QTY_COLUMN}`);
  }

  const skuColumnIndex = headerIndex.get(INVENTORY_SKU_COLUMN);
  const qtyColumnIndex = headerIndex.get(INVENTORY_QTY_COLUMN);
  const inventoryMap = new Map();

  for (const row of dataRows) {
    const sku = normalizeText(row[skuColumnIndex]).trim();
    if (!sku) {
      continue;
    }

    const quantity = normalizeQuantity(row[qtyColumnIndex]);
    inventoryMap.set(sku, quantity);
  }

  return {
    sheetName,
    inventoryMap,
  };
}

function applySharedTransforms(rows, inventoryMap) {
  let matchedInventoryRows = 0;

  const transformedRows = rows.map((row) => {
    const nextRow = { ...row };
    nextRow["Variant Inventory Policy"] = "deny";
    nextRow["Status"] = "active";

    const sku = normalizeText(nextRow["Variant SKU"]).trim();
    if (sku && inventoryMap.has(sku)) {
      nextRow["Variant Inventory Qty"] = inventoryMap.get(sku);
      matchedInventoryRows += 1;
    } else {
      nextRow["Variant Inventory Qty"] = "0";
    }

    return nextRow;
  });

  return {
    rows: transformedRows,
    matchedInventoryRows,
  };
}

function removeOriginalFinalActiveRows(rows) {
  const keptRows = [];
  let removedCount = 0;

  for (const row of rows) {
    const handle = normalizeText(row.Handle).trim().toLowerCase();
    const status = normalizeText(row.Status).trim().toLowerCase();
    if (handle.includes("final") && status === "active") {
      removedCount += 1;
      continue;
    }
    keptRows.push({ ...row });
  }

  return {
    rows: keptRows,
    removedCount,
  };
}

function buildHandleClassification(rows) {
  const handleClassMap = new Map();

  for (const row of rows) {
    const handle = normalizeText(row.Handle).trim();
    const title = normalizeText(row.Title).trim();

    if (!handle || !title) {
      continue;
    }

    const isFinal = title.toLowerCase().includes("final");
    if (handleClassMap.has(handle) && handleClassMap.get(handle) !== isFinal) {
      throw new Error(`同一个 Handle 的 Title 分类冲突：${handle}`);
    }

    handleClassMap.set(handle, isFinal);
  }

  for (const row of rows) {
    const handle = normalizeText(row.Handle).trim();
    if (!handleClassMap.has(handle)) {
      handleClassMap.set(handle, handle.toLowerCase().includes("final"));
    }
  }

  return handleClassMap;
}

function splitRows(rows, handleClassMap) {
  const finalRows = [];
  const nonFinalRows = [];

  for (const row of rows) {
    const handle = normalizeText(row.Handle).trim();
    const title = normalizeText(row.Title).trim();
    const isFinal = handle
      ? handleClassMap.get(handle) === true
      : title.toLowerCase().includes("final");

    if (isFinal) {
      finalRows.push({ ...row });
    } else {
      nonFinalRows.push({ ...row });
    }
  }

  return {
    finalRows,
    nonFinalRows,
  };
}

function parsePriceToCents(value) {
  const cleaned = normalizeText(value).replace(/[^0-9.-]/g, "").trim();
  if (!cleaned) {
    throw new Error("发现无法识别的价格值。");
  }

  const numeric = Number(cleaned);
  if (!Number.isFinite(numeric)) {
    throw new Error(`价格不是有效数字：${value}`);
  }

  return Math.round(numeric * 100);
}

function formatCents(cents) {
  return (cents / 100).toFixed(2);
}

function roundUpToX99Cents(targetCents) {
  const dollars = Math.floor(targetCents / 100);
  let candidate = dollars * 100 + 99;
  if (candidate < targetCents) {
    candidate += 100;
  }
  return candidate;
}

function convertNonFinalRows(rows) {
  return rows.map((row) => {
    const nextRow = { ...row };
    const handle = normalizeText(nextRow.Handle);
    const title = normalizeText(nextRow.Title);
    const rawPrice = normalizeText(nextRow["Variant Price"]).trim();

    if (handle && !handle.toLowerCase().endsWith("-final-sale")) {
      nextRow.Handle = `${handle}-final-sale`;
    }

    if (title && !title.toLowerCase().includes("-final-sale")) {
      nextRow.Title = `${title}-final-sale`;
    }

    if (rawPrice) {
      const originalPriceCents = parsePriceToCents(rawPrice);
      const discountedTarget = Math.ceil(originalPriceCents * 0.2);

      nextRow["Variant Compare At Price"] = formatCents(originalPriceCents);
      nextRow["Variant Price"] = formatCents(
        roundUpToX99Cents(discountedTarget)
      );
    }

    return nextRow;
  });
}

function buildCsv(headers, rows) {
  return stringify(rows, {
    header: true,
    columns: headers,
    bom: true,
    record_delimiter: "windows",
  });
}

async function buildResultsZip(outputFiles) {
  const zip = new JSZip();

  for (const outputFile of outputFiles) {
    zip.file(outputFile.fileName, outputFile.content);
  }

  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

async function processUploads({ productFiles, inventoryFile }) {
  if (!productFiles?.length) {
    throw new Error("请至少上传一个商品 CSV。");
  }
  if (!inventoryFile) {
    throw new Error("请上传库存 Excel。");
  }

  const parsedProductFiles = productFiles.map(parseCsvUpload);
  const headers = validateProductHeaders(parsedProductFiles);
  const mergedRows = parsedProductFiles.flatMap((file) => file.rows);

  const { inventoryMap, sheetName } = await readInventoryMap(inventoryFile);
  const filteredResult = removeOriginalFinalActiveRows(mergedRows);
  const sharedResult = applySharedTransforms(filteredResult.rows, inventoryMap);
  const handleClassMap = buildHandleClassification(sharedResult.rows);
  const { finalRows, nonFinalRows } = splitRows(
    sharedResult.rows,
    handleClassMap
  );
  const convertedNonFinalRows = convertNonFinalRows(nonFinalRows);

  return {
    outputFiles: [
      {
        fileName: FINAL_FILE_NAME,
        rowCount: finalRows.length,
        content: buildCsv(headers, finalRows),
      },
      {
        fileName: CONVERTED_FILE_NAME,
        rowCount: convertedNonFinalRows.length,
        content: buildCsv(headers, convertedNonFinalRows),
      },
    ],
    stats: {
      productFileCount: productFiles.length,
      mergedRowCount: mergedRows.length,
      removedOriginalFinalActiveRows: filteredResult.removedCount,
      inventorySheetName: sheetName,
      inventorySkuCount: inventoryMap.size,
      matchedInventoryRows: sharedResult.matchedInventoryRows,
      finalRowCount: finalRows.length,
      convertedRowCount: convertedNonFinalRows.length,
    },
  };
}

module.exports = {
  CONVERTED_FILE_NAME,
  DEFAULT_ZIP_FILE_NAME,
  FINAL_FILE_NAME,
  buildResultsZip,
  processUploads,
};
