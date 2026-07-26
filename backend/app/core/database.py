import ssl
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import declarative_base

from app.core.config import settings

connect_args: dict[str, object] = {
    # Bound both the TCP handshake and each asyncpg command so provider
    # outages cannot pin an API worker indefinitely.
    "timeout": 10,
    "command_timeout": 30,
}

if settings.database_ssl_mode == "verify-full":
    database_ssl_context = ssl.create_default_context(
        cafile=settings.database_ssl_root_cert_path
    )
    database_ssl_context.check_hostname = True
    database_ssl_context.verify_mode = ssl.CERT_REQUIRED
    connect_args["ssl"] = database_ssl_context
elif settings.database_ssl_mode == "require":
    connect_args["ssl"] = "require"

engine = create_async_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_timeout=10,
    # SQLAlchemy exception strings otherwise include bound values such as
    # student names, phone numbers and notes.
    hide_parameters=True,
    connect_args=connect_args,
)
AsyncSessionLocal = async_sessionmaker(
    engine, expire_on_commit=False, class_=AsyncSession
)
Base = (
    declarative_base()
)  # class python ở /models kế thừa class base, mục đích: quản lý và đồng bộ


async def get_db() -> (
    AsyncGenerator[AsyncSession, None]
):  # là hàm Dependency Injection, được gọi liên tục ở /routers nhằm cung cấp DB cho các API
    async with AsyncSessionLocal() as session:
        yield session
