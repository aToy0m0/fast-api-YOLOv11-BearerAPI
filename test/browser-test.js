/*
  ブラウザの <script> タグに貼り付けて使うテスト用コード。
  - フォームが自動生成され、APIキー・エンドポイント・画像を指定して送信できる。
  - フェッチAPIを用いて HTTP リクエストを送信する実装。
*/
(function () {
  // ==== 初期値（必要に応じて書き換え） ====
  var DEFAULT_URL = "server-ip";
  var DEFAULT_API_URL = "http://"+DEFAULT_URL+":8000/detect";
  var DEFAULT_API_KEY = "API_KEY";

  // ==== 定数 ====
  // ログを表示するか
  var SHOW_LOG = false; // true , false
  // 応答JSONを表示するか
  var SHOW_JSON = true; // true , false

  // ==== DOM生成ヘルパー ====
  function createLabel(text, input) {
    var label = document.createElement("label");
    label.style.display = "block";
    label.style.marginBottom = "6px";
    label.appendChild(document.createTextNode(text));
    label.appendChild(input);
    return label;
  }

  function log(message) {
    var now = new Date();
    var line = now.toLocaleTimeString() + " - " + message + "\n";
    statusArea.value = statusArea.value + line;
    statusArea.scrollTop = statusArea.scrollHeight;
    // 開発中はブラウザのコンソールでも確認できるようにしておく
    if (typeof console !== "undefined" && console.log) {
      console.log("[YOLO11m tester] " + message);
    }
  }

  // ==== UI初期化 ====
  var container = document.createElement("div");
  container.style.border = "1px solid #ccc";
  container.style.padding = "16px";
  container.style.margin = "16px 0";
  container.style.fontFamily = "sans-serif";

  var title = document.createElement("h3");
  title.appendChild(document.createTextNode("YOLO11m 推論テスト"));
  container.appendChild(title);

  var apiUrlInput = document.createElement("input");
  apiUrlInput.type = "text";
  apiUrlInput.value = DEFAULT_API_URL;
  apiUrlInput.style.width = "100%";

  var apiKeyInput = document.createElement("input");
  apiKeyInput.type = "text";
  apiKeyInput.value = DEFAULT_API_KEY;
  apiKeyInput.style.width = "100%";

  var fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";

  var sendButton = document.createElement("button");
  sendButton.type = "button";
  sendButton.appendChild(document.createTextNode("画像を送信"));
  sendButton.style.marginTop = "12px";

  var statusArea = document.createElement("textarea");
  statusArea.rows = 8;
  statusArea.style.width = "100%";
  statusArea.style.marginTop = "12px";
  statusArea.readOnly = true;

  var jsonArea = document.createElement("textarea");
  jsonArea.rows = 8;
  jsonArea.style.width = "100%";
  jsonArea.style.marginTop = "12px";
  jsonArea.readOnly = true;

  var previewImage = document.createElement("img");
  previewImage.style.display = "block";
  previewImage.style.maxWidth = "100%";
  previewImage.style.marginTop = "12px";
  previewImage.alt = "推論結果のプレビュー";

  container.appendChild(createLabel("API URL", apiUrlInput));
  container.appendChild(createLabel("APIキー (Bearer)", apiKeyInput));
  container.appendChild(createLabel("送信する画像", fileInput));
  container.appendChild(sendButton);
  if (SHOW_LOG) {
    container.appendChild(statusArea);
  }
  if (SHOW_JSON) {
    container.appendChild(jsonArea);
  }
  container.appendChild(previewImage);

  document.body.insertBefore(container, document.body.firstChild);

  // ==== HTTP送信処理 ====
  function sendRequest() {
    if (!fileInput.files || fileInput.files.length === 0) {
      alert("先に画像ファイルを選択してください");
      return;
    }

    var imageFile = fileInput.files[0];
    var apiUrl = apiUrlInput.value;
    var apiKey = apiKeyInput.value;

    var formData = new FormData();
    formData.append("file", imageFile);

    log("fetch -> POST " + apiUrl);
    log("送信サイズ(推定): " + imageFile.size + " bytes");

    // fetch ではタイムアウトがネイティブで無いので AbortController で実装
    var controller = null;
    var signal = null;
    if (typeof AbortController !== "undefined") {
      controller = new AbortController();
      signal = controller.signal;
      setTimeout(function () {
        if (controller) {
          controller.abort();
          log("AbortController により 20 秒で中断");
        }
      }, 20000);
    }

    log("リクエスト送信開始");
    fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
      },
      body: formData,
      signal: signal,
    })
      .then(function (response) {
        log("HTTP status " + response.status);
        return response.text().then(function (bodyText) {
          return { ok: response.ok, status: response.status, text: bodyText };
        });
      })
      .then(function (result) {
        if (!result.ok) {
          log("エラー: status " + result.status + " / body: " + result.text);
          return;
        }
        try {
          var responseJson = JSON.parse(result.text);
          jsonArea.value = JSON.stringify(responseJson, null, 2);
          if (responseJson.image_with_boxes) {
            previewImage.src = responseJson.image_with_boxes;
          } else {
            previewImage.removeAttribute("src");
          }
          log("推論成功: status " + result.status);
        } catch (e) {
          log("JSON の解析に失敗しました: " + e.message);
        }
      })
      .catch(function (error) {
        if (error.name === "AbortError") {
          log("タイムアウトが発生しました");
        } else {
          log("fetch でエラー: " + error.message);
        }
      });
  }

  sendButton.addEventListener("click", sendRequest);
})();
