import aiohttp
import asyncio

class HttpClient:
    """
    Gestore sessione HTTP globale con supporto per loop asyncio multipli.

    Quando il loop cambia (es. tra test pytest), la sessione viene ricreata
    automaticamente per evitare errori "Event loop is closed".
    """
    _session: aiohttp.ClientSession = None
    _session_loop: asyncio.AbstractEventLoop = None

    async def get_session(self) -> aiohttp.ClientSession:
        """
        Ottiene o crea una sessione HTTP.

        La sessione viene ricreata se:
        - Non esiste
        - È stata chiusa
        - Il loop asyncio corrente è diverso da quello della sessione

        Returns:
            Sessione aiohttp.ClientSession valida per il loop corrente
        """
        current_loop = asyncio.get_running_loop()

        # Ricreo la sessione se il loop è cambiato o la sessione è chiusa
        needs_new_session = (
            self._session is None
            or self._session.closed
            or self._session_loop is None
            or self._session_loop != current_loop
            or self._session_loop.is_closed()
        )

        if needs_new_session:
            # Chiudi la vecchia sessione se esiste e il loop è ancora attivo
            if self._session is not None and not self._session.closed:
                try:
                    if self._session_loop and not self._session_loop.is_closed():
                        await self._session.close()
                except Exception:
                    pass  # Ignora errori di chiusura su loop vecchio

            # Crea nuova sessione sul loop corrente
            connector = aiohttp.TCPConnector(ssl=False, limit=100)
            self._session = aiohttp.ClientSession(connector=connector)
            self._session_loop = current_loop

        return self._session

    async def close_session(self):
        """Chiude la sessione HTTP corrente."""
        if self._session and not self._session.closed:
            await self._session.close()
            # Recommended grace period for TCP connections to close
            await asyncio.sleep(0.250)
            self._session = None
            self._session_loop = None

# Global instance to be used across the application
http_client = HttpClient()
