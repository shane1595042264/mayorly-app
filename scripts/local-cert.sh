#!/bin/sh
# A local code-signing certificate for ship:mac, so every build has the same identity.
# macOS ties a keychain "Always Allow" to the app's code signature; an ad-hoc signature is
# new on every build, so the safeStorage prompt came back after each ship. A self-signed
# certificate in the login keychain gives every build one designated requirement, and the
# answer sticks. No Apple account involved; a Developer ID still wins when CSC_NAME is set.
#   sh scripts/local-cert.sh
set -eu
NAME="Mayorly Local"
if security find-identity -v -p codesigning | grep -q "\"$NAME\""; then
  echo "local-cert: \"$NAME\" is already in the login keychain"
  exit 0
fi
DIR=$(mktemp -d)
trap 'rm -rf "$DIR"' EXIT
cd "$DIR"
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 3650 -nodes -subj "/CN=$NAME" \
  -addext "keyUsage=critical,digitalSignature" -addext "extendedKeyUsage=critical,codeSigning" -addext "basicConstraints=critical,CA:false" 2>/dev/null
# macOS reads the legacy PKCS12 algorithms only.
openssl pkcs12 -export -legacy -out cert.p12 -inkey key.pem -in cert.pem -passout pass:local -name "$NAME"
security import cert.p12 -k ~/Library/Keychains/login.keychain-db -P local -T /usr/bin/codesign -T /usr/bin/security -T /usr/bin/productbuild
# Trusted for code signing in your own trust settings; macOS may ask for the login password once.
security add-trusted-cert -r trustRoot -p codeSign -k ~/Library/Keychains/login.keychain-db cert.pem
security find-identity -v -p codesigning | grep "\"$NAME\""
echo "local-cert: done. The next ship signs with \"$NAME\"; answer the keychain prompt once with Always Allow."
