#!/bin/sh
# Ship to the iPhone: build the web layer, put it in the iOS app, build and sign the app with the
# Apple ID in Xcode, install it on the phone over USB or Wi-Fi, and open it. After this, pushes to
# main reach the phone on their own (src/phone/updater.ts); only a change to the native shell
# (a Capacitor package, the iOS project) needs this again.
#
#   npm run ship:ios                         the first paired iPhone that can be reached
#   IOS_DEVICE="jphone" npm run ship:ios     a phone by name or id
#   IOS_TEAM=ABCDE12345 npm run ship:ios     a team, when the keychain holds more than one
#   IOS_SIM=1 npm run ship:ios               the booted simulator instead, no signing
#
# Once per Mac: Xcode, Settings, Accounts, add your Apple ID (a free one works). Once per phone:
# Settings, Privacy & Security, Developer Mode on, and pair it with this Mac (cable once, then
# Wi-Fi). With a free Apple ID an install lasts seven days; run this again within the week.
set -eu
cd "$(dirname "$0")/.."

npm run phone:build
npx cap sync ios >/dev/null
PROJECT=mobile/ios/App/App.xcodeproj
DERIVED=mobile/ios/DerivedData
# Swift packages download Capacitor's prebuilt framework from GitHub; looking for GitHub
# credentials in the keychain first can stop on a prompt nobody sees, so netrc only.
# Every install is a new binary to Capacitor, so it starts from the bundle inside it rather
# than one an earlier install took over the air.
BUILD_NO=$(date +%s)

if [ -n "${IOS_SIM:-}" ]; then
  xcodebuild -quiet -packageAuthorizationProvider netrc -project "$PROJECT" -scheme App -configuration Debug -sdk iphonesimulator \
    -destination 'platform=iOS Simulator,name=iPhone 16 Pro' -derivedDataPath "$DERIVED" \
    CURRENT_PROJECT_VERSION="$BUILD_NO" build
  APP="$DERIVED/Build/Products/Debug-iphonesimulator/App.app"
  xcrun simctl install booted "$APP"
  xcrun simctl launch booted app.mayorly >/dev/null
  echo "ship-ios: installed and launched in the booted simulator"
  exit 0
fi

# The team: the one in the Apple Development certificate Xcode made for your Apple ID.
TEAM=${IOS_TEAM:-}
if [ -z "$TEAM" ]; then
  TEAM=$(security find-certificate -a -c "Apple Development" -p 2>/dev/null \
    | openssl x509 -noout -subject -nameopt multiline 2>/dev/null \
    | awk -F' = ' '/organizationalUnitName/ {print $2; exit}')
fi
if [ -z "$TEAM" ]; then
  echo "ship-ios: no Apple Development certificate in the keychain." >&2
  echo "  Open Xcode, Settings, Accounts, add your Apple ID, then run this again." >&2
  exit 1
fi

# The phone: paired, and reachable now over USB or Wi-Fi.
JSON=$(mktemp)
xcrun devicectl list devices --json-output "$JSON" >/dev/null 2>&1 || true
PICK=$(python3 - "$JSON" "${IOS_DEVICE:-}" <<'PY'
import json, sys
want = sys.argv[2].lower()
try:
    devices = json.load(open(sys.argv[1]))["result"]["devices"]
except Exception:
    devices = []
for d in devices:
    hw, cp, dp = d.get("hardwareProperties", {}), d.get("connectionProperties", {}), d.get("deviceProperties", {})
    # Xcode 27 lists the simulators here too, as paired iPhones; only a real phone will do.
    if hw.get("platform") != "iOS" or hw.get("reality") == "simulated" or cp.get("pairingState") != "paired":
        continue
    name = dp.get("name", "")
    if want and want not in (name.lower(), d.get("identifier", "").lower(), hw.get("udid", "").lower()):
        continue
    if cp.get("tunnelState") == "unavailable" and not want:
        continue
    print(d["identifier"], hw.get("udid", ""), name)
    break
PY
)
rm -f "$JSON"
if [ -z "$PICK" ]; then
  echo "ship-ios: no paired iPhone can be reached. Unlock it, keep it on the same Wi-Fi (or plug it in), and try again." >&2
  exit 1
fi
DEVICE=$(echo "$PICK" | awk '{print $1}')
UDID=$(echo "$PICK" | awk '{print $2}')
echo "ship-ios: building for $(echo "$PICK" | cut -d' ' -f3-) with team $TEAM"

xcodebuild -quiet -packageAuthorizationProvider netrc -project "$PROJECT" -scheme App -configuration Release \
  -destination "id=$UDID" -derivedDataPath "$DERIVED" \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
  DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Automatic CURRENT_PROJECT_VERSION="$BUILD_NO" build
APP="$DERIVED/Build/Products/Release-iphoneos/App.app"
[ -d "$APP" ] || { echo "ship-ios: the build made no App.app" >&2; exit 1; }

xcrun devicectl device install app --device "$DEVICE" "$APP" >/dev/null
xcrun devicectl device process launch --device "$DEVICE" app.mayorly >/dev/null 2>&1 || \
  echo "ship-ios: installed. If it did not open, trust the developer once: Settings, General, VPN & Device Management."
echo "ship-ios: Mayorly installed on the phone"
