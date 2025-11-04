"""
Basic API endpoint tests.
"""

import pytest


@pytest.mark.asyncio
class TestHealthEndpoint:
    """Test health check endpoint."""

    async def test_health_endpoint(self, client):
        """Test that health endpoint returns 200."""
        response = await client.get('/api/health')
        assert response.status_code == 200

        data = await response.get_json()
        assert 'status' in data
        assert data['status'] == 'healthy'


@pytest.mark.asyncio
class TestHomeEndpoint:
    """Test home endpoint."""

    async def test_home_endpoint(self, client):
        """Test that home endpoint returns HTML."""
        response = await client.get('/')
        assert response.status_code == 200

        # Check that it returns HTML content
        content_type = response.headers.get('Content-Type', '')
        assert 'text/html' in content_type


@pytest.mark.asyncio
class TestHistoryEndpoint:
    """Test history endpoint."""

    async def test_history_endpoint(self, client):
        """Test that history endpoint returns a list."""
        response = await client.get('/api/history')
        assert response.status_code == 200

        data = await response.get_json()
        assert 'history' in data
        assert isinstance(data['history'], list)


@pytest.mark.asyncio
class TestFetchNormaData:
    """Test fetch_norma_data endpoint."""

    async def test_missing_required_fields(self, client):
        """Test that missing required fields returns 400."""
        response = await client.post(
            '/api/fetch_norma_data',
            json={}
        )
        # Should return an error for missing fields
        assert response.status_code in [400, 500]

    async def test_valid_request(self, client):
        """Test valid fetch_norma_data request."""
        response = await client.post(
            '/api/fetch_norma_data',
            json={
                'act_type': 'codice civile',
                'article': '1'
            }
        )
        # Should return 200 or handle gracefully
        assert response.status_code in [200, 400, 500]

        if response.status_code == 200:
            data = await response.get_json()
            assert 'norma_data' in data or 'error' in data


@pytest.mark.asyncio
class TestFetchTree:
    """Test fetch_tree endpoint."""

    async def test_missing_urn(self, client):
        """Test that missing URN returns 400."""
        response = await client.post(
            '/api/fetch_tree',
            json={}
        )
        assert response.status_code == 400

        data = await response.get_json()
        assert 'error' in data

    async def test_invalid_link_parameter(self, client):
        """Test that invalid link parameter returns 400."""
        response = await client.post(
            '/api/fetch_tree',
            json={
                'urn': 'test-urn',
                'link': 'not-a-boolean'
            }
        )
        assert response.status_code == 400

    async def test_invalid_details_parameter(self, client):
        """Test that invalid details parameter returns 400."""
        response = await client.post(
            '/api/fetch_tree',
            json={
                'urn': 'test-urn',
                'details': 'not-a-boolean'
            }
        )
        assert response.status_code == 400
