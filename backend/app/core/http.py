from importlib.util import find_spec

import httpx

_supports_http2 = find_spec("h2") is not None

supabase_auth_client = httpx.AsyncClient(
    http2=_supports_http2,
    limits=httpx.Limits(
        max_connections=20,
        max_keepalive_connections=10,
        keepalive_expiry=30,
    ),
    timeout=httpx.Timeout(
        connect=4.0,
        read=12.0,
        write=12.0,
        pool=4.0,
    ),
)
