#!/bin/sh
# Builds the Safari app from extension/safari and opens it once, which is what
# registers the extension with Safari. Output stays in extension/safari/build
# (ignored by git). Pass a team id to sign with your Apple developer team:
#   extension/build-safari.sh            # "Sign to Run Locally" — needs Develop → Allow Unsigned Extensions in Safari
#   extension/build-safari.sh ABCDE12345 # signed with your team; Safari keeps it enabled across restarts
set -e
cd "$(dirname "$0")/safari"
TEAM="$1"
xcodebuild -project allai/allai.xcodeproj -scheme allai -configuration Release \
  -derivedDataPath build ${TEAM:+DEVELOPMENT_TEAM="$TEAM" -allowProvisioningUpdates} build \
  | grep -E "^error|BUILD |Signing Identity" || true
APP="build/Build/Products/Release/allai.app"
test -d "$APP" || { echo "build failed — open allai/allai.xcodeproj in Xcode to see why"; exit 1; }
open "$APP"
echo "→ $PWD/$APP"
echo "Now in Safari: Settings → Extensions → tick allai. Unsigned builds also need Develop → Allow Unsigned Extensions."
