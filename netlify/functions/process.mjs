import workflow from "./_shared/transform.cjs";

const { DEFAULT_ZIP_FILE_NAME, buildResultsZip, processUploads } = workflow;

function isUploadFile(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.arrayBuffer === "function" &&
    typeof value.name === "string"
  );
}

async function toUploadFile(file) {
  return {
    originalname: file.name,
    buffer: Buffer.from(await file.arrayBuffer()),
  };
}

function buildHeaders(stats, zipSize) {
  return {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="${DEFAULT_ZIP_FILE_NAME}"`,
    "Content-Length": String(zipSize),
    "X-Product-File-Count": String(stats.productFileCount),
    "X-Merged-Row-Count": String(stats.mergedRowCount),
    "X-Removed-Final-Active-Handles": String(
      stats.removedOriginalFinalActiveHandles
    ),
    "X-Removed-Final-Active-Rows": String(
      stats.removedOriginalFinalActiveRows
    ),
    "X-Inventory-Sku-Count": String(stats.inventorySkuCount),
    "X-Matched-Inventory-Rows": String(stats.matchedInventoryRows),
    "X-Final-Row-Count": String(stats.finalRowCount),
    "X-Converted-Row-Count": String(stats.convertedRowCount),
    "X-Inventory-Sheet-Name": encodeURIComponent(stats.inventorySheetName),
  };
}

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers: {
        "Allow": "POST",
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  }

  try {
    const form = await req.formData();
    const rawProductFiles = form.getAll("productCsvs").filter(isUploadFile);
    const rawInventoryFile = form.get("inventoryFile");

    const productFiles = await Promise.all(rawProductFiles.map(toUploadFile));
    const inventoryFile = isUploadFile(rawInventoryFile)
      ? await toUploadFile(rawInventoryFile)
      : undefined;

    const result = await processUploads({ productFiles, inventoryFile });
    const zipBuffer = await buildResultsZip(result.outputFiles);

    return new Response(zipBuffer, {
      status: 200,
      headers: buildHeaders(result.stats, zipBuffer.length),
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error:
          error instanceof Error
            ? error.message
            : "处理失败，请检查输入文件。",
      }),
      {
        status: 400,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
      }
    );
  }
};

export const config = {
  path: "/api/process",
  preferStatic: true,
};
