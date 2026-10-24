#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
mkdir -p build
javac --release 21 -encoding UTF-8 -d build src/*.java
exec java -Xmx512m -cp build BlueprintServer
