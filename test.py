import aiohttp
import asyncio
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
import logging

# Configura il logging
logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s %(levelname)s %(message)s',
                    handlers=[logging.FileHandler("fetch_data.log"),
                              logging.StreamHandler()])

# URL del server locale di app.py
url = "http://127.0.0.1:5000/fetch_all_data"  # Modifica questo percorso se necessario

# Funzione per inviare richieste con backoff esponenziale
@retry(
    retry=retry_if_exception_type(aiohttp.ClientError),
    stop=stop_after_attempt(5),
    wait=wait_exponential(multiplier=1, min=2, max=60)
)
async def fetch_data(session, url, data):
    logging.info(f"Tentativo di invio richiesta POST per il range {data['article']}...")
    async with session.post(url, json=data) as response:
        logging.info(f"Ricevuta risposta per il range {data['article']} con status code: {response.status}")
        response.raise_for_status()
        return await response.json()

async def save_articles_in_ranges():
    # Range di articoli da cercare
    start = 1
    end = 139
    batch_size = 20  # Dimensione del batch in intervalli (ad esempio, 1-50, 51-100)

    data_template = {
        "act_type": "costituzione",
        "date": "",
        "act_number": "",
        "version": "vigente",
        "version_date": "2024-10-31",
        "show_brocardi_info": True
    }

    async with aiohttp.ClientSession() as session:
        with open("costituzione_articoli.txt", "a", encoding="utf-8") as file:
            for batch_start in range(start, end + 1, batch_size):
                batch_end = min(batch_start + batch_size - 1, end)
                data = data_template.copy()
                data["article"] = f"{batch_start}-{batch_end}"

                try:
                    # Recupera i dati con retry e backoff
                    articles_data = await fetch_data(session, url, data)
                    logging.info(f"Articoli {batch_start}-{batch_end} recuperati con successo.")

                    # Scrivi i dati nel file
                    for article in articles_data:
                        article_text = article.get("article_text", "Testo non disponibile")
                        article_url = article.get("url", "URL non disponibile")
                        norma_data = article.get("norma_data", {})
                        brocardi_info = article.get("brocardi_info", {})

                        file.write(f"Range di Articoli: {batch_start}-{batch_end}\n")
                        file.write(f"{article_text}\n")
                        file.write(f"URL: {article_url}\n")
                        file.write("Dettagli della norma:\n")
                        for key, value in norma_data.items():
                            file.write(f"{key.capitalize()}: {value}\n")
                        if brocardi_info:
                            file.write("Informazioni Brocardi:\n")
                            for key, value in brocardi_info.items():
                                file.write(f"{key.capitalize()}: {value}\n")
                        file.write("\n" + "="*50 + "\n\n")

                except aiohttp.ClientError as e:
                    logging.error(f"Errore nella richiesta per il range {batch_start}-{batch_end}:", exc_info=True)

                # Attendi 1 minuto prima del prossimo batch
                logging.info(f"Attesa di 10 secondi prima di procedere con il prossimo batch di articoli.")
                await asyncio.sleep(10)

# Esegui la funzione asincrona
asyncio.run(save_articles_in_ranges())
