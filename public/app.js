const form = document.querySelector("#upload-form");
const submitButton = document.querySelector("#submit-button");
const statusPanel = document.querySelector("#status-panel");
const statusEyebrow = document.querySelector("#status-eyebrow");
const statusTitle = document.querySelector("#status-title");
const statusMessage = document.querySelector("#status-message");
const summaryGrid = document.querySelector("#summary-grid");

const summaryTargets = {
  merged: document.querySelector("#merged-row-count"),
  removedDuplicateHandles: document.querySelector(
    "#removed-duplicate-handle-count"
  ),
  removedHandles: document.querySelector("#removed-handle-count"),
  matched: document.querySelector("#matched-row-count"),
  final: document.querySelector("#final-row-count"),
  converted: document.querySelector("#converted-row-count"),
};

function setStatus(state, message, detail = "") {
  statusPanel.hidden = false;
  statusPanel.dataset.state = state;
  statusEyebrow.textContent =
    state === "error" ? "处理失败" : state === "success" ? "处理完成" : "处理中";
  statusTitle.textContent = message;
  statusMessage.textContent = detail;
}

function resetSummary() {
  summaryGrid.hidden = true;
  for (const element of Object.values(summaryTargets)) {
    element.textContent = "-";
  }
}

function showSummaryFromHeaders(headers) {
  const merged = headers.get("x-merged-row-count");
  const removedDuplicateHandles = headers.get("x-removed-duplicate-handles");
  const removedHandles = headers.get("x-removed-final-active-handles");
  const matched = headers.get("x-matched-inventory-rows");
  const finalRows = headers.get("x-final-row-count");
  const converted = headers.get("x-converted-row-count");

  if (
    !merged ||
    !removedDuplicateHandles ||
    !removedHandles ||
    !matched ||
    !finalRows ||
    !converted
  ) {
    return;
  }

  summaryTargets.merged.textContent = merged;
  summaryTargets.removedDuplicateHandles.textContent = removedDuplicateHandles;
  summaryTargets.removedHandles.textContent = removedHandles;
  summaryTargets.matched.textContent = matched;
  summaryTargets.final.textContent = finalRows;
  summaryTargets.converted.textContent = converted;
  summaryGrid.hidden = false;
}

function parseFilename(contentDisposition) {
  if (!contentDisposition) {
    return "shopify-final-sale-results.zip";
  }

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) {
    return decodeURIComponent(utf8Match[1]);
  }

  const basicMatch = contentDisposition.match(/filename="([^"]+)"/i);
  if (basicMatch) {
    return basicMatch[1];
  }

  return "shopify-final-sale-results.zip";
}

function triggerDownload(blob, fileName) {
  const link = document.createElement("a");
  const objectUrl = URL.createObjectURL(blob);
  link.href = objectUrl;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

async function readErrorMessage(response) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const payload = await response.json().catch(() => null);
    if (payload?.error) {
      return payload.error;
    }
  }

  const text = await response.text().catch(() => "");
  return text || "处理失败，请检查输入文件后重试。";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  resetSummary();
  submitButton.disabled = true;
  submitButton.textContent = "处理中...";

  setStatus(
    "loading",
    "正在处理上传文件",
    "请稍等，处理完成后浏览器会自动开始下载 ZIP。"
  );

  try {
    const response = await fetch("/api/process", {
      method: "POST",
      body: new FormData(form),
    });

    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }

    const blob = await response.blob();
    const fileName = parseFilename(response.headers.get("content-disposition"));
    triggerDownload(blob, fileName);

    const sheetName = decodeURIComponent(
      response.headers.get("x-inventory-sheet-name") || ""
    );
    setStatus(
      "success",
      "ZIP 已生成并开始下载",
      sheetName
        ? `库存工作表使用的是 ${sheetName}。如果浏览器拦截下载，请允许当前站点下载文件。`
        : "如果浏览器拦截下载，请允许当前站点下载文件。"
    );
    showSummaryFromHeaders(response.headers);
  } catch (error) {
    setStatus(
      "error",
      "这次处理没有成功",
      error instanceof Error ? error.message : "处理失败，请检查输入文件后重试。"
    );
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "生成并下载 ZIP";
  }
});
