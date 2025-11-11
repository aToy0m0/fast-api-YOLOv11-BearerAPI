# 🧠 fast-api-YOLOv11-BearerAPI

YOLO11m を使用した物体検出APIです。  
画像を送信すると、**検出結果（JSON）とバウンディングボックス付き画像**を返します。  
認証は **APIキー（Bearerトークン）** 方式を採用。  
ローカル環境で、conda を使わず `venv + uv + pip` で動作します。

---

## 📘 機能概要

| 機能 | 説明 |
|------|------|
| 画像アップロード | `multipart/form-data` で画像をPOST |
| YOLOモデル | Ultralytics YOLO11m (COCO 80クラス) |
| 出力 | JSON（ラベル・座標・信頼度・個数）＋バウンディングボックス付き画像（Base64） |
| 認証 | APIキー (`Authorization: Bearer <API_KEY>`) |
| 環境 | Python 3.8以上, pip + venv, GPU不要（CPU動作） |
| モデル | 事前ダウンロード済み `yolo11m.pt` を使用 |

---

## 🧩 構成図
```text
Client
↓ POST /detect (multipart/form-data + Bearer token)
FastAPI (main.py)
├─ Load YOLO11m model (models/yolo11m.pt)
├─ Run detection on uploaded image
├─ Draw bounding boxes
└─ Return JSON + Base64 image
```

---

## 🧱 フォルダ構成
```text
project/
├── models/
│   └── yolo11m.pt  # 事前にダウンロードしたモデルファイル
├── main.py         # FastAPIアプリ本体
├── requirements.txt # 依存パッケージ一覧
└── README.md       # このファイル
```

---

## ⚙️ 環境構築手順（condaなし）

### 1️⃣ Python 環境確認
```bash
python --version
# → 3.8 以上であること
```

### 2️⃣ 仮想環境作成
```bash
uv venv
```

### 3️⃣ 仮想環境有効化
```bash
# WSL / macOS / Linux
source .venv/bin/activate
```

### 4️⃣ 必要パッケージのインストール
PyTorch を GPU 環境用に入れる場合
```bash
uv pip install -r requirements.txt
```

### 5️⃣ YOLOモデルの事前ダウンロード
Ultralytics公式から yolo11m.pt を取得して、`models/` に保存：

- 🔗 https://github.com/ultralytics/assets/releases
- 保存例: `project/models/yolo11m.pt`

CLIの場合
```
mkdir -p models
cd models/

TAG=v8.3.0   # 最新タグに置き換えてください

curl -L -o yolo11m.pt "https://github.com/ultralytics/assets/releases/download/${TAG}/yolo11m.pt"
curl -L -o yolo11n.pt "https://github.com/ultralytics/assets/releases/download/${TAG}/yolo11n.pt"
```

### 🔐 APIキーと推論パラメータの設定

```bash
openssl rand -hex 32
cp .env.example .env
nano .env
```

```
$ cat .env

# use command below to generate a secret key
## openssl rand -hex 32
DETECTION_API_KEY="your-secret-key"

export DETECTION_API_KEY="your-secret-key"
export YOLO_CONF_THRESHOLD=0.35      # 任意、未設定なら 0.25
export YOLO_IOU_THRESHOLD=0.45       # 任意、未設定なら 0.45
```

### 🚀 サーバー起動方法
```bash
uvicorn main:app --reload
```

起動後に以下へアクセス：
- Swagger UI: http://127.0.0.1:8000/docs


## 📦 テスト：APIリクエスト例
### sample画像を用意
以下をダウンロードし、sample.jpgにリネーム
```
https://ultralytics.com/images/zidane.jpg
```
```
project/
├── test/
│   └── sample.jpg  # リネームしたzidane.jpg
```
CLIの場合
```
mkdir -p test
curl -L https://ultralytics.com/images/zidane.jpg -o test/sample.jpg
```

### Python (requests)
```python
import requests

url = "http://127.0.0.1:8000/detect"
headers = {"Authorization": "Bearer your-secret-key"}
files = {"file": open("test.jpg", "rb")}

res = requests.post(url, headers=headers, files=files)
print(res.json())
```

## 📊 レスポンス例（JSON）
```json
{
  "detections": [
    {
      "label": "person",
      "confidence": 0.91,
      "box": [36.4, 52.8, 221.3, 309.9]
    },
    {
      "label": "dog",
      "confidence": 0.88,
      "box": [150.2, 200.5, 300.1, 400.7]
    }
  ],
  "counts": {
    "person": 1,
    "dog": 1
  },
  "image_with_boxes": "data:image/jpeg;base64,/9j/4AAQSk..."
}
```

# トラブルシュート
ImportError: libGL.so.1: cannot open shared object file: No such file or directory
```
sudo yum install -y mesa-libGL
```

# 参考公式ドキュメント
FastAPI公式: https://fastapi.tiangolo.com/
Ultralytics YOLO公式: https://docs.ultralytics.com/
COCOクラス一覧: https://docs.ultralytics.com/datasets/detect/coco/

# Author/Project
Author: aToy0m0
Project Start: 2025-11

# License
License: GNU AGPL v3 (see LICENSE)
