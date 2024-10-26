import requests
import json

url = "http://localhost:8000/fetch_article_text"
headers = {"Content-Type": "application/json"}
data = {
    "act_type": "legge",
    "date": "1990",
    "act_number": "241",
    "article": "1"
}

response = requests.post(url, headers=headers, data=json.dumps(data))
print(response.status_code)
print(response.json())
