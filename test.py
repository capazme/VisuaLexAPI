import aiohttp
import asyncio
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
import logging

# Configura il logging
logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s %(levelname)s %(message)s',
                    handlers=[logging.FileHandler("fetch_tree.log"),
                              logging.StreamHandler()])

# URL del server locale per l'endpoint fetch_tree
url = "http://127.0.0.1:5000/fetch_tree"  # Modifica questo percorso se necessario

# Configurazione dei parametri (modifica questi valori per testare)
parameters = {
    "urns": [
        "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legislativo:2023-03-31;36",
    ],
    "link": True,      # Se includere i link agli articoli
    "details": True    # Se includere i dettagli delle sezioni
}

# Funzione per inviare richieste con backoff esponenziale
@retry(
    retry=retry_if_exception_type(aiohttp.ClientError),
    stop=stop_after_attempt(5),
    wait=wait_exponential(multiplier=1, min=2, max=60)
)
async def fetch_tree(session, url, data):
    logging.info(f"Tentativo di invio richiesta POST per URN: {data['urn']} con link={data.get('link', False)} e details={data.get('details', False)}...")
    async with session.post(url, json=data) as response:
        logging.info(f"Ricevuta risposta per URN: {data['urn']} con status code: {response.status}")
        response.raise_for_status()
        return await response.json()

async def fetch_tree_for_norm(session, url, urn, link=False, details=False):
    """
    Testa l'endpoint /fetch_tree con un URN di esempio e specifiche flag.
    """
    data = {
        "urn": urn,
        "link": link,
        "details": details
    }

    try:
        # Recupera i dati con retry e backoff
        tree_data = await fetch_tree(session, url, data)
        logging.info(f"Struttura della norma {urn} recuperata con successo.")

        # Stampa i dati in modo leggibile
        print(f"\n--- Struttura della Norma (URN: {urn}) ---\n")
        articles = tree_data.get("articles", [])
        count = tree_data.get("count", 0)
        print(f"Numero di articoli trovati: {count}\n")
        
        print(count, '\n\n', articles)

    except aiohttp.ClientError as e:
        logging.error(f"Errore nella richiesta per URN {urn}:", exc_info=True)
    except Exception as e:
        logging.error(f"Errore in fetch_tree_for_norm per URN {urn}:", exc_info=True)

async def test_multiple_trees(session, url, urns, link=False, details=False):
    """
    Testa l'endpoint /fetch_tree per più URN con specifiche flag.
    """
    for urn in urns:
        await fetch_tree_for_norm(session, url, urn, link=link, details=details)
        await asyncio.sleep(1)  # Pausa tra richieste per evitare sovraccarichi

async def main():
    # Carica i parametri dalla configurazione
    urns = parameters["urns"]
    link = parameters["link"]
    details = parameters["details"]

    async with aiohttp.ClientSession() as session:
        # Se è stato fornito un solo URN, esegui fetch_tree_for_norm
        if len(urns) == 1:
            await fetch_tree_for_norm(session, url, urns[0], link=link, details=details)
        else:
            # Se sono stati forniti più URN, esegui test_multiple_trees
            await test_multiple_trees(session, url, urns, link=link, details=details)

if __name__ == '__main__':
    asyncio.run(main())
