#!/bin/sh
# Stamp a new version on the app before publishing, so phones pick up the update right away.
#
# What it does:
#   1. Adds ?v=<version> to the local .js/.css links in index.html, so each release's files
#      have new addresses and can't be mixed up with old copies a browser kept.
#   2. Writes the same version to version.json. The running app checks that file (skipping
#      any cache) and reloads itself, or offers to, when a newer version is out.
# Run it from anywhere:  sh tools/release.sh
set -e
cd "$(dirname "$0")/.."
v=$(date -u +%Y%m%d%H%M%S)
# Only local files: matches src="app.js" / href="styles.css" (with or without an old ?v=).
sed -E "s/(src|href)=\"([a-z]+)\.(js|css)(\?v=[0-9]+)?\"/\1=\"\2.\3?v=$v\"/g" index.html > index.html.tmp
mv index.html.tmp index.html
printf '{"v":"%s"}\n' "$v" > version.json
echo "Stamped version $v"
