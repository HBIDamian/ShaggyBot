#!/bin/bash
# Loop start script for ShaggyBot JS

DIR="$(cd -P "$( dirname "${BASH_SOURCE[0]}" )" && pwd)"
cd "$DIR"
# Ensure bun is in PATH
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

DO_LOOP="no"

while getopts "p:f:l" OPTION 2> /dev/null; do
    case ${OPTION} in
        l)
            DO_LOOP="yes"
            ;;
        \?)
            break
            ;;
    esac
done

LOOPS=0

set +e

if [ "$DO_LOOP" == "yes" ]; then
    while true; do
        LOOPS=$((LOOPS+1))
        echo "Starting ShaggyBot JS (Loop $LOOPS)"
        bun src/index.js
        EXIT_CODE=$?
        
        if [ $EXIT_CODE -eq 0 ]; then
            echo "ShaggyBot exited cleanly, stopping"
            break
        fi
        
        echo "ShaggyBot crashed with exit code $EXIT_CODE"
        echo "Restarting in 5 seconds..."
        sleep 5
    done
else
    bun src/index.js
fi
