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

# A Developer ID certificate (CSC_NAME or CSC_LINK) signs for real. Without one, the local
# certificate from scripts/local-cert.sh gives every build the same identity, so the keychain's
# Always Allow for safeStorage holds across ships; without that too, the build is ad-hoc signed
# and the prompt returns after every ship. See docs/release.md.
if [ -n "${CSC_NAME:-}${CSC_LINK:-}" ]; then SIGN="-c.mac.hardenedRuntime=true"
elif security find-identity -v -p codesigning | grep -q '"Mayorly Local"'; then SIGN="-c.mac.identity=Mayorly Local"
else SIGN="-c.mac.identity=-"; fi
echo "ship-mac: signing with ${SIGN#-c.mac.}"

rm -rf dist/mac dist/mac-arm64
npm run build
npx electron-builder --mac dir "$FLAG" "$SIGN" --publish never
APP=$(ls -d dist/mac*/Mayorly.app 2>/dev/null | head -1)
[ -n "$APP" ] || { echo "ship-mac: no Mayorly.app under dist/"; exit 1; }

# Quit whatever holds the single-instance lock: the installed app, or a dev instance of this checkout.
# Wait until it is really gone; a new instance started while the old one is still quitting
# loses the lock and exits, leaving the old build running from a bundle that no longer exists.
running() { pgrep -f "Mayorly.app/Contents/MacOS/Mayorly|electron-vite dev|Mayorly/node_modules/electron/dist/Electron.app" >/dev/null 2>&1; }
osascript -e 'quit app "Mayorly"' 2>/dev/null || true
pkill -f "Mayorly.app/Contents/MacOS/Mayorly" 2>/dev/null || true
pkill -f "electron-vite dev" 2>/dev/null || true
pkill -f "Mayorly/node_modules/electron/dist/Electron.app" 2>/dev/null || true
for _ in $(seq 1 40); do running || break; sleep 0.25; done
if running; then
  echo "ship-mac: the old instance did not quit in 10 s; killing it"
  pkill -9 -f "Mayorly.app/Contents/MacOS/Mayorly|electron-vite dev|Mayorly/node_modules/electron/dist/Electron.app" 2>/dev/null || true
  sleep 1
fi

rm -rf /Applications/Mayorly.app
ditto "$APP" /Applications/Mayorly.app
open -a /Applications/Mayorly.app
for _ in $(seq 1 40); do pgrep -f "/Applications/Mayorly.app/Contents/MacOS/Mayorly" >/dev/null 2>&1 && break; sleep 0.25; done
if pgrep -f "/Applications/Mayorly.app/Contents/MacOS/Mayorly" >/dev/null 2>&1; then
  echo "ship-mac: /Applications/Mayorly.app installed and launched"
else
  echo "ship-mac: installed, but the app is not running; check the log in the data folder" >&2
  exit 1
fi
