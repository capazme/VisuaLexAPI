import sys
from pathlib import Path

# The package lives in scripts/: make `import datakit` work from anywhere.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
