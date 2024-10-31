import requests

# URL del server locale di app.py
url = "http://127.0.0.1:5000/fetch_all_data"  # Modifica il percorso in base al tuo endpoint

# Dati da inviare con la richiesta POST
data = {
    "act_type": "codice civile",
    "date": "",
    "act_number": "",
    "article": "1",
    "version": "vigente",
    "version_date": "2024-10-31",
    "show_brocardi_info": True
}

try:
    # Invia la richiesta POST
    response = requests.post(url, json=data)
    response.raise_for_status()  # Verifica errori HTTP

    # Stampa la risposta
    print("Status Code:", response.status_code)
    print("Response JSON:", response.json())

except requests.exceptions.RequestException as e:
    print("Errore nella richiesta:", e)
