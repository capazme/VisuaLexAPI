"""
Tests for configuration management.
"""

import pytest
import os
from visualex_api.tools.config import Settings, MAX_CACHE_SIZE, HISTORY_LIMIT


class TestSettings:
    """Test Settings class."""

    def test_default_values(self):
        """Test that default values are returned when env vars are not set."""
        # Clear any existing env vars
        for key in ['SECRET_KEY', 'DEBUG', 'ALLOWED_ORIGINS', 'LOG_LEVEL']:
            os.environ.pop(key, None)

        settings = Settings()

        assert settings.secret_key == "development-key-change-in-production"
        assert settings.debug is False
        assert settings.allowed_origins == ["http://localhost:3000"]
        assert settings.log_level == "INFO"
        assert settings.max_cache_size == MAX_CACHE_SIZE
        assert settings.history_limit == HISTORY_LIMIT

    def test_get_method(self):
        """Test get method for retrieving values."""
        os.environ['TEST_KEY'] = 'test_value'
        settings = Settings()

        assert settings.get('TEST_KEY') == 'test_value'
        assert settings.get('NON_EXISTENT_KEY', 'default') == 'default'

        os.environ.pop('TEST_KEY', None)

    def test_get_int_method(self):
        """Test get_int method for integer values."""
        os.environ['TEST_INT'] = '42'
        settings = Settings()

        assert settings.get_int('TEST_INT') == 42
        assert settings.get_int('NON_EXISTENT_INT', 10) == 10

        # Test invalid integer
        os.environ['TEST_INVALID_INT'] = 'not_a_number'
        assert settings.get_int('TEST_INVALID_INT', 5) == 5

        os.environ.pop('TEST_INT', None)
        os.environ.pop('TEST_INVALID_INT', None)

    def test_get_bool_method(self):
        """Test get_bool method for boolean values."""
        settings = Settings()

        # Test true values
        for value in ['true', '1', 'yes', 'on', 'True', 'YES']:
            os.environ['TEST_BOOL'] = value
            settings_reload = Settings()
            assert settings_reload.get_bool('TEST_BOOL') is True

        # Test false values
        for value in ['false', '0', 'no', 'off', 'False']:
            os.environ['TEST_BOOL'] = value
            settings_reload = Settings()
            assert settings_reload.get_bool('TEST_BOOL') is False

        # Test default
        os.environ.pop('TEST_BOOL', None)
        assert settings.get_bool('TEST_BOOL', True) is True

    def test_get_list_method(self):
        """Test get_list method for list values."""
        os.environ['TEST_LIST'] = 'item1,item2,item3'
        settings = Settings()

        result = settings.get_list('TEST_LIST')
        assert result == ['item1', 'item2', 'item3']

        # Test with spaces
        os.environ['TEST_LIST_SPACES'] = 'item1, item2 ,  item3  '
        result = settings.get_list('TEST_LIST_SPACES')
        assert result == ['item1', 'item2', 'item3']

        # Test default
        result = settings.get_list('NON_EXISTENT_LIST', ['default'])
        assert result == ['default']

        os.environ.pop('TEST_LIST', None)
        os.environ.pop('TEST_LIST_SPACES', None)

    def test_secret_key_property(self):
        """Test secret_key property."""
        os.environ['SECRET_KEY'] = 'my-secret-key'
        settings = Settings()

        assert settings.secret_key == 'my-secret-key'

        os.environ.pop('SECRET_KEY', None)

    def test_debug_property(self):
        """Test debug property."""
        os.environ['DEBUG'] = 'true'
        settings = Settings()

        assert settings.debug is True

        os.environ.pop('DEBUG', None)

    def test_allowed_origins_property(self):
        """Test allowed_origins property."""
        os.environ['ALLOWED_ORIGINS'] = 'http://example.com,http://test.com'
        settings = Settings()

        assert settings.allowed_origins == ['http://example.com', 'http://test.com']

        os.environ.pop('ALLOWED_ORIGINS', None)

    def test_log_level_property(self):
        """Test log_level property."""
        os.environ['LOG_LEVEL'] = 'debug'
        settings = Settings()

        assert settings.log_level == 'DEBUG'  # Should be uppercase

        os.environ.pop('LOG_LEVEL', None)

    def test_rate_limit_properties(self):
        """Test rate limit properties."""
        os.environ['RATE_LIMIT'] = '500'
        os.environ['RATE_LIMIT_WINDOW'] = '300'
        settings = Settings()

        assert settings.rate_limit == 500
        assert settings.rate_limit_window == 300

        os.environ.pop('RATE_LIMIT', None)
        os.environ.pop('RATE_LIMIT_WINDOW', None)
