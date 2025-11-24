// =======================
// 参考資料
// =======================
// FAQ：バッチ処理で添付ファイルを含んだレコードを新規作成したい
// https://pleasanter.org/ja/manual/faq-create-record-with-attachment
// →開発者向け機能：API：テーブル操作：レコード作成
//   https://pleasanter.org/ja/manual/api-record-create
// 
// テーブルの管理：エディタ：項目の詳細設定：自動採番
// https://pleasanter.org/ja/manual/auto-numbering


// =======================
// MARK: 初期設定
// =======================

// pleasanterサーバーから見たFast APIサーバーのIP
const API_BASE_URL = "http://API_BASE_URL:8000";
const API_ENDPOINT = API_BASE_URL + "/detect";
const YOLO_API_KEY = "YOLO_API_KEY";

// pleasanterサーバーから見たpleasanterサーバー自身のIP
const PLEASANTER_BASE_URL = "http://localhost";
const PLEASANTER_API_KEY = "PLEASANTER_API_KEY";

// 子サイトID（必要に応じて変更）
const CHILD_SITE_ID = CHILD_SITE_ID;

// HTTPリクエストのタイムアウト設定値
const REQUEST_TIMEOUT_MS = 15000;

// =======================
// MARK: MediaType = "application/json" で POST リクエストを送信する関数
// =======================
function postJson(url, body, headers = {}) {
  context.Log("===== HTTP POST (httpClient) =====");
  httpClient.RequestHeaders.Clear();
  httpClient.RequestUri = url;
  httpClient.MediaType = "application/json";
  for (const [key, value] of Object.entries(headers)) {
    httpClient.RequestHeaders.Add(key, value);
  }
  httpClient.Content = JSON.stringify(body);
  httpClient.TimeOut = REQUEST_TIMEOUT_MS;

  const responseText = httpClient.Post();
  context.Log(`🔄 HTTP Status: ${httpClient.StatusCode}`);
  context.Log(`🔍 IsSuccess: ${httpClient.IsSuccess}`);
  if (httpClient.IsTimeOut) {
    context.Log("⚠️ タイムアウト発生: リクエストが指定時間内に応答しませんでした。");
  }

  if (!httpClient.IsSuccess) {
    context.Log(`レスポンス本文: ${responseText}`);
    throw new Error(`HTTPエラー: ${httpClient.StatusCode}`);
  }

  try {
    const json = JSON.parse(responseText);
    return { data: json, rawText: responseText };
  } catch (e) {
    context.Log(`❌ JSON解析エラー: ${e.message}`);
    context.Log(`レスポンス内容: ${responseText}`);
    throw new Error(`JSON解析エラー: ${e.message}`);
  }
}

// =======================
// MARK: APIを使って添付ファイルを Base64 で取得する関数
// =======================
function getAttachmentBase64(guid) {
  const url = `${PLEASANTER_BASE_URL}/api/binaries/${guid}/get`;

  context.Log("===== getAttachmentBase64 開始 =====");
  context.Log(`📡 baseUrl : ${PLEASANTER_BASE_URL}`);
  context.Log(`📎 URL : ${url}`);
  context.Log(`🎯 対象GUID : ${guid}`);

  const requestData = {
    ApiVersion: "1.1",
    ApiKey: PLEASANTER_API_KEY
  };

  const { data } = postJson(url, requestData);

  if (!data || !data.Response || !data.Response.Base64) {
    context.Log("⚠️ 応答にBase64データが含まれていません。");
    throw new Error("Base64データが存在しません。");
  }

  context.Log(`📦 添付ファイル名: ${data.Response.Name || "(不明)"}`);
  context.Log(`📏 ファイルサイズ: ${data.Response.Size || "N/A"} bytes`);
  context.Log("===== getAttachmentBase64 完了 =====");

  return data.Response.Base64;
}

// =======================
// MARK: data URLからBase64と拡張子を抽出する関数
// =======================
function extractBase64FromDataUrl(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.length) {
    context.Log("⚠️ image_with_boxes が空文字のため解析をスキップします。");
    return null;
  }

  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    context.Log("⚠️ image_with_boxes の形式が data URL ではありません。");
    return null;
  }

  const mimeType = match[1];
  const base64 = match[2];
  if (!base64) {
    context.Log("⚠️ image_with_boxes に Base64 が含まれていません。");
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
// MARK: YOLO応答から DescriptionHash を構築
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
      context.Log(`⚠️ counts の JSON 化に失敗: ${e.message}`);
    }
  }

  if (Array.isArray(yoloResult.detections) && yoloResult.detections.length) {
    try {
      descriptionHash.DescriptionC = JSON.stringify(yoloResult.detections, null, 2);
    } catch (e) {
      context.Log(`⚠️ detections の JSON 化に失敗: ${e.message}`);
    }
  }

  return Object.keys(descriptionHash).length ? descriptionHash : null;
}

// =======================
// MARK: APIを使って DescriptionB にBase64形式の画像を上書きする関数
// =======================
function updateImageHashOnly(recordId, image, options = {}) {
  if (!recordId) {
    context.Log("⚠️ recordId が取得できないため ImageHash 更新をスキップします。");
    return;
  }
  if (!image || !image.base64) {
    context.Log("⚠️ 更新対象の画像情報が不足しているため ImageHash 更新をスキップします。");
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
    Body: "",
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

  context.Log(`📦 画像情報: name=${image.name || "(不明)"}, extension=${extension}, alt=${alt}`);

  if (descriptionHash) {
    payload.DescriptionHash = descriptionHash;
  }

  const url = `${PLEASANTER_BASE_URL}/api/items/${recordId}/update`;
  context.Log("===== updateImageHashOnly 開始 =====");
  context.Log(`📡 URL: ${url}`);
  context.Log(`🆔 レコードID: ${recordId}`);
  const { rawText } = postJson(url, payload);
  context.Log(`✅ ImageHash更新応答: ${rawText.substring(0, 200)}...`);
  context.Log("===== updateImageHashOnly 完了 =====");
}

// =======================
// MARK: 子レコードのID検索する関数(複数存在する場合は新しい順にソートされる)
// =======================
function getChildRecord(parentRecordId) {
  context.Log(`親レコードID : ${parentRecordId}`);
  if (!parentRecordId) {
    context.Log("⚠ 親レコードIDが空のため子レコード検索をスキップします。");
    return null;
  }

  let data = {
    "View": {
      "ColumnFilterHash": {
          "ClassA": `["${parentRecordId}"]`
      },
      "ColumnSorterHash":{
        "DateA":"asc"
      }
    }
  };
  context.Log(`子レコード検索 : data: ${JSON.stringify(data)}`);
  let records;
  try {
    records = items.Get(CHILD_SITE_ID, JSON.stringify(data));
    context.Log(`子レコード検索 : records.Length: ${JSON.stringify(records.Length)}`);
  } catch (e) {
    context.Log(`❗ 子レコード検索 API で例外が発生しました: ${e.message}`);
    context.Error(`child search failed: ${e.message}`);
    return null;
  }

  if (records.Length) {
    context.Log(`records.Length : ${records.Length}`);
    context.Log("正しいメソッドはLengthです。");
  } else {
    context.Log(`records.length : ${records.length}`);
    context.Log("正しいメソッドはlengthです。");
  }

  for (let record of records) {
    context.Log(`children ResultId : ${record.ResultId}`);
  }

  // return records[0]?.ResultId || null;
  return records || null;
}
// =======================
// MARK: メイン処理
// =======================
try {
  context.Log("===== 添付＋本文画像処理開始 =====");

  const imagesBase64 = [];

  // MARK: 1. Body 内の画像 (/binaries/xxx/show) のみを取得 ---
  const body = model.Body || "";
  const regex = /\/binaries\/([A-Fa-f0-9\-]{32,})\/show/g;
  let match;
  while ((match = regex.exec(body)) !== null) {
    const guid = match[1];
    context.Log(`Body画像検出 GUID=${guid}`);
    const b64 = getAttachmentBase64(guid);
    imagesBase64.push({ name: `${guid}.jpg`, source: "body", base64: b64 });
  }

  context.Log(`✅ 取得完了: ${imagesBase64.length} 件を Base64 化しました。`);

  // MARK: 2. 本文画像を優先し1枚だけ YOLO Fast API へ送信 ---
  let yoloResult = null;
  let selectedImage = null;
  let boxedImage = null;
  if (imagesBase64.length) {
    selectedImage = imagesBase64.find(img => img.source === "body") || imagesBase64[0];
    context.Log(`🖼 送信対象: ${selectedImage.name} (source=${selectedImage.source})`);

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
      context.Log(`✅ YOLO応答: ${rawText.substring(0, 500)}...`);

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
          context.Log("✅ image_with_boxes を DescriptionB 用の画像として準備しました。");
        } else {
          context.Log("⚠️ image_with_boxes の解析に失敗したため元画像を使用します。");
        }
      } else {
        context.Log("⚠️ YOLO応答に image_with_boxes が含まれていません。");
      }
    } catch (apiError) {
      context.Log(`❌ YOLO API 呼び出し失敗: ${apiError.message}`);
      context.Error(`YOLO API error: ${apiError.message}`);
    }
  } else {
    context.Log("⚠️ 送信する画像が無いため YOLO API 呼び出しをスキップしました。");
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

  // MARK: 3. API経由で ImageHash を更新 (DescriptionB) ---
  //// boxedImage or selectedImage(元画像) の優先順位で設定
  let imageForHash = null;
  if (boxedImage) {
    context.Log("📎 DescriptionB 用に image_with_boxes を使用します。");
    imageForHash = boxedImage;
  } else if (selectedImage) {
    context.Log("📎 DescriptionB 用に元画像を使用します。");
    imageForHash = selectedImage;
  }
  // 
  if (imageForHash) {
    // 子レコードを検索し、ないのであれば作成
    const recordId = model.ResultId;
    let childRecordId = null;
    const results = getChildRecord(recordId);
    if (!results) {
      context.Log(`❌ getChildRecord -> results取得エラー`);
    } else if (results.Length > 0) {
      context.Log(`✅ 子レコードが既に存在します。 : ${results[0].ResultId}`);
      // 検索した子レコードのIDを代入
      childRecordId = results[0].ResultId;
    } else {
      context.Log(`📎 子レコードが存在しません。新規作成します : ${results.Length} 件`);
      // 子レコードを作成し、IDを取得
      let apiModelNewChild = items.NewResult();
      //// 親レコードIDを子レコードのクラスAに設定し、リンクさせる
      apiModelNewChild.ClassA = model.ResultId;
      context.Log(`apiModelNewChild.ClassA : ${apiModelNewChild.ClassA}`);
      items.Create(CHILD_SITE_ID, apiModelNewChild);
      //// 作成した子レコードのIDを代入
      childRecordId = apiModelNewChild.ResultId;
    }
    // const childRecordId = apiModelNewChild.ResultId;
    context.Log(`childRecordId : ${childRecordId}`);
    const descriptionHash = buildDescriptionHashFromYolo(yoloResult);
    
    // 子レコードのImageHash 更新
    try {
      updateImageHashOnly(childRecordId, imageForHash, {
        position: 3,
        headNewLine: false,
        endNewLine: false,
        alt: imageForHash.alt || imageForHash.name,
        descriptionHash
      });
      if (boxedImage) {
        context.Log("📎 DescriptionB に image_with_boxes を登録しました。");
      } else {
        context.Log("📎 image_with_boxes が無いため元画像を登録しました。");
      }
    } catch (updateError) {
      context.Log(`❌ ImageHash更新API エラー: ${updateError.message}`);
      context.Error(`ImageHash update failed: ${updateError.message}`);
    }
  } else {
    context.Log("⚠️ ImageHash を設定する画像が無いため API 更新をスキップしました。");
  }

  context.Log("===== 処理完了: DescriptionA 更新 =====");
} catch (e) {
  context.Log(`❌ Error: ${e.message}`);
  context.Error(`Error in processing: ${e.message}`);
}