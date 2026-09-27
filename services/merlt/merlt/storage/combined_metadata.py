"""
Combined SQLAlchemy Metadata
=============================

Merges metadata from all 3 declarative bases into a single MetaData
for Alembic migrations. All bases share the same PostgreSQL database
(rlcf_dev on port 5433).

Bases:
- RLCFBase: rlcf/database.py (17 models)
- EnrichmentBase: storage/enrichment/models.py (12 models)
- BridgeBase: storage/bridge/models.py (1 model)
"""

from sqlalchemy import MetaData

# Import all bases — the imports also register their models
from merlt.rlcf.database import Base as RLCFBase
from merlt.storage.enrichment.models import Base as EnrichmentBase
from merlt.storage.bridge.models import Base as BridgeBase

# Ensure all models are imported so their tables are registered on their bases
import merlt.rlcf.models  # noqa: F401 — registers RLCF models
import merlt.rlcf.persistence  # noqa: F401 — registers persistence models
import merlt.experts.models  # noqa: F401 — registers QATrace, QAFeedback

# Merge all metadata into one for Alembic autogenerate
combined_metadata = MetaData()

for base in [RLCFBase, EnrichmentBase, BridgeBase]:
    for table in base.metadata.tables.values():
        table.to_metadata(combined_metadata)
