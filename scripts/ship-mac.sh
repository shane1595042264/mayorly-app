#!/bin/sh
# Ship to this Mac: build Mayorly.app, put it in /Applications, relaunch it.
# The whole release step for a one-person product, where every push is prod.
#   npm run ship:mac
set -eu
cd "$(dirname "$0")/.."

case "$(uname -m)" in
  arm64) FLAG=--arm64 ;;
  *) FLAG=--x64 ;;
esac

# A Developer ID certificate (CSC_NAME or CSC_LINK) signs for real; without one the build is ad-hoc
# signed so it runs here. See docs/release.md.
if [ -n "${CSC_NAME:-}${CSC_LINK:-}" ]; then SIGN="-c.mac.hardenedRuntime=true"; else SIGN="-c.mac.identity=-"; fi

rm -rf dist/mac dist/mac-arm64
npm run build
npx electron-builder --mac dir "$FLAG" "$SIGN" --publish never
APP=$(ls -d dist/mac*/Mayorly.app 2>/dev/null | head -1)
[ -n "$APP" ] || { echo "ship-mac: no Mayorly.app under dist/"; exit 1; }

# Quit whatever holds the single-instance lock: the installed app, or a dev instance of this checkout.
osascript -e 'quit app "Mayorly"' 2>/dev/null || true
pkill -f "Mayorly.app/Contents/MacOS/Mayorly" 2>/dev/null || true
pkill -f "electron-vite dev" 2>/dev/null || true
pkill -f "Mayorly/node_modules/electron/dist/Electron.app" 2>/dev/null || true
sleep 1.5

rm -rf /Applications/Mayorly.app
ditto "$APP" /Applications/Mayorly.app
open -a /Applications/Mayorly.app
echo "ship-mac: /Applications/Mayorly.app installed and launched"
