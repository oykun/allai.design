#!/bin/sh
# Builds the Safari app from extension/safari and opens it once, which is what
# registers the extension with Safari. Output stays in extension/safari/build
# (ignored by git).
#
# Signing: put your Apple team id in the repo's .env as ALLAI_APPLE_TEAM (a
# free Apple ID's Personal Team works), or pass it as the first argument.
# Signed, Safari keeps the extension on across restarts. Without a team the
# build is "Sign to Run Locally" and needs Allow unsigned extensions in
# Safari's Developer settings after every Safari restart.
#   extension/build-safari.sh            # team from .env, else unsigned
#   extension/build-safari.sh ABCDE12345 # this team
set -e
cd "$(dirname "$0")/safari"
TEAM="${1:-}"
if [ -z "$TEAM" ] && [ -f ../../.env ]; then
  TEAM="$(sed -n 's/^ALLAI_APPLE_TEAM=//p' ../../.env | tr -d '"[:space:]' | tail -1)"
fi
echo "signing: ${TEAM:-unsigned (Sign to Run Locally)}"
xcodebuild -project allai/allai.xcodeproj -scheme allai -configuration Release \
  -derivedDataPath build ${TEAM:+DEVELOPMENT_TEAM="$TEAM" -allowProvisioningUpdates} build \
  | grep -E "^error|BUILD |Signing Identity" || true
APP="build/Build/Products/Release/allai.app"
test -d "$APP" || { echo "build failed — open allai/allai.xcodeproj in Xcode to see why"; exit 1; }
open "$APP"
echo "→ $PWD/$APP"
echo "Now in Safari: Settings → Extensions → tick allai. Unsigned builds also need Develop → Allow Unsigned Extensions."
