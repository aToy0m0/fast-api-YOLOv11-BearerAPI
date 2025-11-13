// =======================
// 初期設定
// =======================

// pleasanterサーバーから見たFast APIサーバーのIP
const API_IP = "api-ip";
const API_BASE_URL = "http://"+API_IP+":8000";
const API_ENDPOINT = API_BASE_URL + "/detect";
const YOLO_API_KEY = "YOLO_API_KEY";

// pleasanterサーバーから見たpleasanterサーバー自身のIP
//// localhostのままでOK
const PLEASANTER_IP = "localhost";
const PLEASANTER_BASE_URL = "http://"+PLEASANTER_IP;
const PLEASANTER_API_KEY = "PLEASANTER_API_KEY";

const REQUEST_TIMEOUT_MS = 1000;

let descriptionCLog = typeof model.DescriptionC === "string" ? model.DescriptionC : "";


function log(message) {
  const text = typeof message === "string" ? message : String(message);
  context.Log(text);
  if (descriptionCLog) {
    descriptionCLog += "\n";
  }
  descriptionCLog += text;
}

// =======================
// MediaType = "application/json" で POST リクエストを送信する関数
// =======================
function postJson(url, body, headers = {}) {
  log("===== HTTP POST (httpClient) =====");
  httpClient.RequestHeaders.Clear();
  httpClient.RequestUri = url;
  httpClient.MediaType = "application/json";
  for (const [key, value] of Object.entries(headers)) {
    httpClient.RequestHeaders.Add(key, value);
  }
  httpClient.Content = JSON.stringify(body);
  httpClient.TimeOut = REQUEST_TIMEOUT_MS;

  const responseText = httpClient.Post();
  log(`🔄 HTTP Status: ${httpClient.StatusCode}`);
  log(`🔍 IsSuccess: ${httpClient.IsSuccess}`);
  if (httpClient.IsTimeOut) {
    log("⚠️ タイムアウト発生: リクエストが指定時間内に応答しませんでした。");
  }

  if (!httpClient.IsSuccess) {
    log(`レスポンス本文: ${responseText}`);
    throw new Error(`HTTPエラー: ${httpClient.StatusCode}`);
  }

  try {
    const json = JSON.parse(responseText);
    return { data: json, rawText: responseText };
  } catch (e) {
    log(`❌ JSON解析エラー: ${e.message}`);
    log(`レスポンス内容: ${responseText}`);
    throw new Error(`JSON解析エラー: ${e.message}`);
  }
}


// =======================
// APIを使って添付ファイルを Base64 で取得する関数
// =======================
function getAttachmentBase64(guid) {
  const url = `${PLEASANTER_BASE_URL}/api/binaries/${guid}/get`;

  log("===== getAttachmentBase64 開始 =====");
  log(`📡 baseUrl : ${PLEASANTER_BASE_URL}`);
  log(`📎 URL : ${url}`);
  log(`🎯 対象GUID : ${guid}`);

  const requestData = {
    ApiVersion: "1.1",
    ApiKey: PLEASANTER_API_KEY
  };

  const { data } = postJson(url, requestData);

  if (!data || !data.Response || !data.Response.Base64) {
    log("⚠️ 応答にBase64データが含まれていません。");
    throw new Error("Base64データが存在しません。");
  }

  log(`📦 添付ファイル名: ${data.Response.Name || "(不明)"}`);
  log(`📏 ファイルサイズ: ${data.Response.Size || "N/A"} bytes`);
  log("===== getAttachmentBase64 完了 =====");

  return data.Response.Base64;
}

// =======================
// data URLからBase64と拡張子を抽出する関数
// =======================
function extractBase64FromDataUrl(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.length) {
    log("⚠️ image_with_boxes が空文字のため解析をスキップします。");
    return null;
  }

  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    log("⚠️ image_with_boxes の形式が data URL ではありません。");
    return null;
  }

  const mimeType = match[1];
  const base64 = match[2];
  if (!base64) {
    log("⚠️ image_with_boxes に Base64 が含まれていません。");
    return null;
  }

  let extension = ".png";
  if (mimeType && mimeType.includes("/")) {
    const subtype = mimeType.split("/")[1].split("+")[0];
    if (subtype) {
      extension = "." + subtype;
    }
  }

  return { mimeType, base64, extension };
}

// =======================
// YOLO応答から DescriptionHash を構築
// =======================
function buildDescriptionHashFromYolo(yoloResult) {
  if (!yoloResult || typeof yoloResult !== "object") {
    return null;
  }

  const descriptionHash = {};

  if (yoloResult.counts && Object.keys(yoloResult.counts).length) {
    try {
      descriptionHash.DescriptionA = JSON.stringify(yoloResult.counts, null, 2);
    } catch (e) {
      log(`⚠️ counts の JSON 化に失敗: ${e.message}`);
    }
  }

  if (Array.isArray(yoloResult.detections) && yoloResult.detections.length) {
    try {
      descriptionHash.DescriptionD = JSON.stringify(yoloResult.detections, null, 2);
    } catch (e) {
      log(`⚠️ detections の JSON 化に失敗: ${e.message}`);
    }
  }

  return Object.keys(descriptionHash).length ? descriptionHash : null;
}

// =======================
// APIを使って DescriptionB にBase64形式の画像を上書きする関数
// =======================
function updateImageHashOnly(recordId, image, options = {}) {
  if (!recordId) {
    log("⚠️ recordId が取得できないため ImageHash 更新をスキップします。");
    return;
  }
  if (!image || !image.base64) {
    log("⚠️ 更新対象の画像情報が不足しているため ImageHash 更新をスキップします。");
    return;
  }

  let extension = image.extension || (image.name ? "." + image.name.split(".").pop() : ".jpg");
  if (!extension.startsWith(".")) {
    extension = "." + extension;
  }
  extension = extension.toLowerCase();
  const position = Number.isFinite(options.position) ? options.position : -1;
  const alt = options.alt || image.alt || image.name || "imageBody";
  const headNewLine = options.headNewLine ?? true;
  const endNewLine = options.endNewLine ?? true;

  const descriptionHash = options.descriptionHash && Object.keys(options.descriptionHash).length
    ? options.descriptionHash
    : null;

  const payload = {
    ApiVersion: "1.1",
    ApiKey: PLEASANTER_API_KEY,
    ImageHash: {
      DescriptionB: {
        HeadNewLine: headNewLine,
        EndNewLine: endNewLine,
        Position: position,
        Alt: alt,
        Extension: extension,
        Base64: image.base64
      }
    }
  };

  if (descriptionHash) {
    payload.DescriptionHash = descriptionHash;
  }

  const url = `${PLEASANTER_BASE_URL}/api/items/${recordId}/update`;
  log("===== updateImageHashOnly 開始 =====");
  log(`📡 URL: ${url}`);
  log(`🆔 レコードID: ${recordId}`);
  const { rawText } = postJson(url, payload);
  log(`✅ ImageHash更新応答: ${rawText.substring(0, 200)}...`);
  log("===== updateImageHashOnly 完了 =====");
}

// =======================
// メイン処理
// =======================
try {
  log("===== 添付＋本文画像処理開始 =====");

  const imagesBase64 = [];

  // --- Body 内の画像 (/binaries/xxx/show) のみを取得 ---
  const body = model.Body || "";
  const regex = /\/binaries\/([A-Fa-f0-9\-]{32,})\/show/g;
  let match;
  while ((match = regex.exec(body)) !== null) {
    const guid = match[1];
    log(`Body画像検出 GUID=${guid}`);
    const b64 = getAttachmentBase64(guid);
    imagesBase64.push({ name: `${guid}.jpg`, source: "body", base64: b64 });
  }

  log(`✅ 取得完了: ${imagesBase64.length} 件を Base64 化しました。`);

  // --- 3. 本文画像を優先し1枚だけ YOLO Fast API へ送信 ---
  let yoloResult = null;
  let selectedImage = null;
  let boxedImage = null;
  if (imagesBase64.length) {
    selectedImage = imagesBase64.find(img => img.source === "body") || imagesBase64[0];
    log(`🖼 送信対象: ${selectedImage.name} (source=${selectedImage.source})`);

    const payload = {
      images: [{
        fileName: selectedImage.name,
        base64: selectedImage.base64
      }]
    };

    try {
      const { data, rawText } = postJson(
        API_ENDPOINT,
        payload,
        { Authorization: "Bearer " + YOLO_API_KEY }
      );

      yoloResult = data;
      log(`✅ YOLO応答: ${rawText.substring(0, 500)}...`);

      if (data.image_with_boxes) {
        const parsedImage = extractBase64FromDataUrl(data.image_with_boxes);
        if (parsedImage) {
          const originalName = selectedImage && selectedImage.name ? selectedImage.name : "yolo";
          const baseName = originalName.replace(/\.[^.]+$/, "");
          boxedImage = {
            name: `${baseName}_boxes`,
            base64: parsedImage.base64,
            extension: parsedImage.extension,
            alt: `${baseName}_boxes`
          };
          log("✅ image_with_boxes を DescriptionB 用の画像として準備しました。");
        } else {
          log("⚠️ image_with_boxes の解析に失敗したため元画像を使用します。");
        }
      } else {
        log("⚠️ YOLO応答に image_with_boxes が含まれていません。");
      }
    } catch (apiError) {
      log(`❌ YOLO API 呼び出し失敗: ${apiError.message}`);
      context.Error(`YOLO API error: ${apiError.message}`);
    }
  } else {
    log("⚠️ 送信する画像が無いため YOLO API 呼び出しをスキップしました。");
  }

  model.DescriptionA = JSON.stringify({
    images: imagesBase64.map(img => ({
      fileName: img.name,
      source: img.source,
      base64Preview: img.base64.substring(0, 40) + "..."
    })),
    selectedImage: selectedImage ? {
      fileName: selectedImage.name,
      source: selectedImage.source
    } : null,
    yoloResult
  }, null, 2);

  // --- 4. API経由で ImageHash を更新 (DescriptionB) ---
  const imageForHash = boxedImage || selectedImage;
  if (imageForHash) {
    const recordId = model.ResultId || model.Id || model.ReferenceId || "";
    const descriptionHash = buildDescriptionHashFromYolo(yoloResult);
    try {
      updateImageHashOnly(recordId, imageForHash, {
        position: 3,
        headNewLine: true,
        endNewLine: true,
        alt: imageForHash.alt || imageForHash.name,
        descriptionHash
      });
      if (boxedImage) {
        log("📎 DescriptionB に image_with_boxes を登録しました。");
      } else {
        log("📎 image_with_boxes が無いため元画像を登録しました。");
      }
    } catch (updateError) {
      log(`❌ ImageHash更新API エラー: ${updateError.message}`);
      context.Error(`ImageHash update failed: ${updateError.message}`);
    }
  } else {
    log("⚠️ ImageHash を設定する画像が無いため API 更新をスキップしました。");
  }

  log("===== 処理完了: DescriptionA 更新 =====");
} catch (e) {
  log(`❌ Error: ${e.message}`);
  context.Error(`Error in processing: ${e.message}`);
} finally {
  model.DescriptionC = descriptionCLog;
}
