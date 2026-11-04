import logging
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response, JSONResponse
from fastapi import status

from app.core.config import settings

logger = logging.getLogger("meetmind-ai.middleware")


class PayloadTooLargeException(Exception):
    """Internal exception raised when an incoming stream exceeds byte ceiling."""
    pass


class RequestSizeLimitMiddleware(BaseHTTPMiddleware):
    """
    Enforces request body size ceilings across all incoming HTTP requests.
    Checks Content-Length header upfront to reject oversized bodies instantly.
    Wraps the ASGI receive stream to protect against chunked transfer memory exhaustion.
    Returns HTTP 413 Payload Too Large when limits are exceeded.
    """

    def __init__(self, app, max_body_bytes: int = None):
        super().__init__(app)
        self.max_body_bytes = max_body_bytes or settings.MAX_REQUEST_BODY_BYTES

    async def dispatch(self, request: Request, call_next) -> Response:
        # 1. Fast-path check Content-Length header if present
        content_length_header = request.headers.get("content-length")
        if content_length_header:
            try:
                content_length = int(content_length_header)
                if content_length > self.max_body_bytes:
                    logger.warning(
                        f"Rejected oversized request ({content_length} bytes > {self.max_body_bytes} bytes limit) "
                        f"at {request.method} {request.url.path}."
                    )
                    return JSONResponse(
                        status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                        content={
                            "detail": (
                                f"Payload Too Large: Request body size ({content_length} bytes) "
                                f"exceeds maximum allowed limit of {self.max_body_bytes} bytes."
                            )
                        },
                    )
            except ValueError:
                pass

        # 2. Meter streaming and chunked request bodies
        original_receive = request.receive
        accumulated_bytes = 0

        async def metered_receive():
            nonlocal accumulated_bytes
            message = await original_receive()
            if message["type"] == "http.request":
                chunk = message.get("body", b"")
                accumulated_bytes += len(chunk)
                if accumulated_bytes > self.max_body_bytes:
                    logger.warning(
                        f"Streamed request payload exceeded ceiling of {self.max_body_bytes} bytes "
                        f"at {request.method} {request.url.path}."
                    )
                    raise PayloadTooLargeException(
                        f"Payload Too Large: Streamed request payload exceeds maximum limit of {self.max_body_bytes} bytes."
                    )
            return message

        request._receive = metered_receive

        try:
            response = await call_next(request)
            return response
        except PayloadTooLargeException as exc:
            return JSONResponse(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                content={"detail": str(exc)},
            )


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """
    Applies defensive HTTP security headers to all API responses without
    interfering with PDF report streaming, Firebase authentication, or Swagger UI.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)

        # Apply standard defensive security headers
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

        # Content-Security-Policy permitting API assets and Swagger UI in development
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "img-src 'self' data: https:; "
            "style-src 'self' 'unsafe-inline'; "
            "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
            "frame-ancestors 'none';"
        )

        # Attach Rate-Limit metadata headers if set by rate_limit dependency
        if hasattr(request, "state") and hasattr(request.state, "rate_limit_headers"):
            for header_name, header_val in request.state.rate_limit_headers.items():
                response.headers[header_name] = str(header_val)

        return response
