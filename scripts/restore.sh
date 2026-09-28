#!/bin/sh
# Load a backup folder into a VisuaLex stack and check the counts.
# Options and examples: scripts/datakit/README.md
exec python3 "$(dirname "$0")/datakit/cli.py" restore "$@"
