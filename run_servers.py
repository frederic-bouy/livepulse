import asyncio
from pathlib import Path
import uvicorn
from app import app

BASE_DIR = Path(__file__).resolve().parent
CERT_FILE = BASE_DIR / "certs" / "cert.pem"
KEY_FILE = BASE_DIR / "certs" / "key.pem"


async def main():
    config_http = uvicorn.Config(
        app,
        host="0.0.0.0",
        port=8765,
        log_level="info",
    )
    server_http = uvicorn.Server(config_http)

    servers = [server_http.serve()]

    if CERT_FILE.exists() and KEY_FILE.exists():
        config_https = uvicorn.Config(
            app,
            host="0.0.0.0",
            port=8766,
            ssl_certfile=str(CERT_FILE),
            ssl_keyfile=str(KEY_FILE),
            log_level="info",
        )
        server_https = uvicorn.Server(config_https)
        servers.append(server_https.serve())

    await asyncio.gather(*servers)


if __name__ == "__main__":
    asyncio.run(main())
