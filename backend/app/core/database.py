from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import declarative_base

from app.core.config import settings

connect_args = {"ssl": "require"} if "supabase.com" in settings.database_url else {}

engine = create_async_engine(
    settings.database_url,
    pool_pre_ping=True,
    connect_args=connect_args,
)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
Base = declarative_base() # class python ở /models kế thừa class base, mục đích: quản lý và đồng bộ

async def get_db() -> AsyncGenerator[AsyncSession, None]: # là hàm Dependency Injection, được gọi liên tục ở /routers nhằm cung cấp DB cho các API
    async with AsyncSessionLocal() as session:
        yield session
