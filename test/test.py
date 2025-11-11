import requests, base64
import os
from dotenv import load_dotenv

# .envの読み込み
dotenv_path = os.path.join(os.path.dirname(__file__), '..', '.env')
if os.path.exists(dotenv_path):
    load_dotenv(dotenv_path)

DETECTION_API_KEY = os.environ["DETECTION_API_KEY"]

API = "http://127.0.0.1:8000/detect"
headers = {"Authorization": f"Bearer {os.environ['DETECTION_API_KEY']}"}
files = {"file": open("sample.jpg", "rb")}
res = requests.post(API, headers=headers, files=files)
data = res.json()
print(data["detections"])

with open("annotated.jpg", "wb") as f:
    blob = data["image_with_boxes"].split(",")[1]
    f.write(base64.b64decode(blob))
