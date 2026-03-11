#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 2 ]]; then
    echo "Usage: $0 <gcc-path> <destination-dir>"
    exit 1
fi

GCC="$1"
DEST="$2"

if [[ ! -x "$GCC" ]]; then
    echo "Error: gcc not executable: $GCC"
    exit 1
fi

mkdir -p "$DEST"

echo "Detecting system include paths using $GCC..."

INCLUDES=$(
    "$GCC" -E -x c++ - -v < /dev/null 2>&1 |
    awk '
        /#include <...> search starts here:/ {flag=1; next}
        /End of search list./ {flag=0}
        flag {gsub(/^[ \t]+/, ""); print}
    '
)

echo "Found include directories:"
echo "$INCLUDES"
echo

for dir in $INCLUDES; do
    if [[ -d "$dir" ]]; then
        echo "Copying $dir -> $DEST"
        cp -a "$dir" "$DEST/"
    else
        echo "Skipping missing directory: $dir"
    fi
done

echo "Done."
