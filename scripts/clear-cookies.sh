#!/usr/bin/env bash
# Dev-only: nuke the Electron BrowserView cookie partitions so the next launch
# starts logged-out. Pair with the sidebar "Import cookies" button to rebuild a
# fresh signed-in state for repeated test runs. "Destroy, then rebuild."
#
# There is NO production analog — end-users never clear their cookies. This is a
# dev affordance only, which is exactly why Clear is a script and Import is the
# (also makeshift) button. See workstreams/browser/shell/cookie-import.md.
#
# Electron stores per-partition data under <userData>/Partitions/<name>. The
# userData dir is the app name: a packaged build uses the productName
# ("Jorb AI"); an unpackaged dev run uses package.json "name" (jorb-ai-desktop).
# We clear whichever exist so this works in both.
set -euo pipefail

SUPPORT="$HOME/Library/Application Support"
cleared=0

for app in "jorb-ai-desktop" "Jorb AI"; do
  parts="$SUPPORT/$app/Partitions"
  if [ -d "$parts" ]; then
    echo "Clearing cookie partitions: $parts"
    rm -rf "$parts"
    cleared=1
  fi
done

if [ "$cleared" = "0" ]; then
  echo "No Electron partitions found (the app may not have run yet). Nothing to clear."
else
  echo "Done. Relaunch the app and click 'Import cookies' to rebuild a signed-in session."
fi
