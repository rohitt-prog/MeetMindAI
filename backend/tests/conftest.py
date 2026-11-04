import pytest
from unittest.mock import MagicMock
from app.main import app
from app.core.auth import get_current_user, AuthenticatedUser
from app.core.rate_limit import rate_limiter
from app.services.firebase_service import firebase_service

@pytest.fixture(autouse=True)
def override_auth_dependency():
    """
    Automatically overrides get_current_user for all standard regression tests,
    ensuring they execute in an authenticated context with UID 'test_user_default'.
    Tests in test_auth.py specifically test unauthenticated, invalid, or cross-user
    scenarios by clearing or customizing app.dependency_overrides.
    """
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="test_user_default",
        email="test@meetmind.ai",
        name="Test User",
        email_verified=True,
    )
    yield
    app.dependency_overrides.pop(get_current_user, None)

@pytest.fixture(autouse=True)
def mock_firebase_client_globally():
    """
    Ensures unit tests never initiate real outbound network connections to
    Google Cloud Firestore by setting a mock client by default.
    """
    orig_client = firebase_service._client
    mock_client = MagicMock()
    # Default doc exists to False to represent unsaved draft unless configured otherwise
    mock_client.collection().document().get().exists = False
    mock_client.collection().document().get().to_dict.return_value = {}
    firebase_service.set_client(mock_client)
    yield
    firebase_service.set_client(orig_client)

@pytest.fixture(autouse=True)
def reset_rate_limiter_globally():
    """
    Clears rate limit records between test executions to ensure complete test isolation.
    """
    rate_limiter.reset()
    yield
    rate_limiter.reset()
