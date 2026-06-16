from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings

app = FastAPI(title="TPRO Classio API")

allowed_origins = ["http://localhost:3000"]
if settings.frontend_url and settings.frontend_url not in allowed_origins:
    allowed_origins.append(settings.frontend_url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def health_check() -> dict[str, str]:
    return {"status": "ok", "app": "TPRO Classio API"}
