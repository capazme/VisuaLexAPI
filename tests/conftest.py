"""
Pytest configuration and fixtures for VisuaLex API tests.
"""

import pytest
import os
import sys

# Add src directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))


@pytest.fixture
def mock_settings():
    """Mock settings for testing."""
    from visualex_api.tools.config import Settings

    # Set test environment variables
    os.environ['SECRET_KEY'] = 'test-secret-key'
    os.environ['DEBUG'] = 'true'
    os.environ['ALLOWED_ORIGINS'] = 'http://localhost:3000,http://localhost:8000'
    os.environ['LOG_LEVEL'] = 'DEBUG'
    os.environ['RATE_LIMIT'] = '100'

    settings = Settings()
    yield settings

    # Cleanup
    for key in ['SECRET_KEY', 'DEBUG', 'ALLOWED_ORIGINS', 'LOG_LEVEL', 'RATE_LIMIT']:
        os.environ.pop(key, None)


@pytest.fixture
def app():
    """Create a test application instance."""
    from visualex_api.app import NormaController

    controller = NormaController()
    app = controller.app
    app.config['TESTING'] = True

    return app


@pytest.fixture
async def client(app):
    """Create a test client."""
    return app.test_client()
