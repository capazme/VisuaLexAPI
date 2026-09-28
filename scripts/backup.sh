#!/bin/sh
# Export every data store of a VisuaLex stack into one dated folder.
# Options and examples: scripts/datakit/README.md
exec python3 "$(dirname "$0")/datakit/cli.py" backup "$@"
