#!/bin/zsh
# Bring up the whole Verso dev stack with a STABLE address.
#
# Connecting from a phone broke three times for three different reasons:
#   - the Mac's DHCP lease moved it to a new IP
#   - another dev server already owned port 3000
#   - Metro reverted to advertising 127.0.0.1, which on a phone means the phone
#
# The fix is to stop depending on the IP at all. Everything below is pinned to
# the Mac's Bonjour name, which does not change when the lease does.
set -euo pipefail
cd "$(dirname "$0")/../.."

export LANG=en_US.UTF-8
export JAVA_HOME=/opt/homebrew/opt/openjdk@21
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"

HOSTNAME_LOCAL="$(scutil --get LocalHostName).local"
API_PORT="${API_PORT:-4310}"   # not 3000/3001: Next.js takes 3001 when 3000 is busy

# Refuse to squat on a port something else already owns.
if lsof -nP -iTCP:"$API_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  if ! curl -s -m 2 "http://127.0.0.1:$API_PORT/health" | grep -q methodVersion; then
    echo "port $API_PORT is taken by something that is not the Verso API:"
    lsof -nP -iTCP:"$API_PORT" -sTCP:LISTEN | tail -2
    echo "set API_PORT=<free port> and retry"
    exit 1
  fi
fi

echo "host      $HOSTNAME_LOCAL"
echo "api port  $API_PORT"

# --- postgres ---
if ! docker info >/dev/null 2>&1; then
  echo "starting Docker Desktop..."
  open -a Docker
  until docker info >/dev/null 2>&1; do sleep 3; done
fi
docker compose up -d >/dev/null 2>&1
until docker compose exec -T db pg_isready -U verso -d verso >/dev/null 2>&1; do sleep 2; done
echo "postgres  ready"

# --- api ---
if ! curl -s -m 2 "http://127.0.0.1:$API_PORT/health" >/dev/null 2>&1; then
  HOST=0.0.0.0 PORT="$API_PORT" nohup node --env-file-if-exists=.env services/api/src/server.js > /tmp/verso-api.log 2>&1 &
  until curl -s -m 2 "http://127.0.0.1:$API_PORT/health" >/dev/null 2>&1; do sleep 1; done
fi
echo "api       http://$HOSTNAME_LOCAL:$API_PORT"

# --- metro ---
# REACT_NATIVE_PACKAGER_HOSTNAME is what stops Metro advertising 127.0.0.1.
# EXPO_PUBLIC_* are read by the app at bundle time as the fallback address.
lsof -ti:8081 2>/dev/null | xargs kill -9 2>/dev/null || true
cd apps/mobile
export REACT_NATIVE_PACKAGER_HOSTNAME="$HOSTNAME_LOCAL"
export EXPO_PUBLIC_DEV_HOSTNAME="$HOSTNAME_LOCAL"
export EXPO_PUBLIC_API_PORT="$API_PORT"
nohup npx expo start --lan > /tmp/verso-metro.log 2>&1 &
until curl -s -o /dev/null -w '%{http_code}' http://localhost:8081/status 2>/dev/null | grep -q 200; do sleep 2; done

ADVERTISED=$(curl -s -H "expo-platform: ios" http://localhost:8081/ 2>/dev/null \
  | python3 -c "import json,sys;print(json.load(sys.stdin).get('launchAsset',{}).get('url',''))" 2>/dev/null)
echo "metro     $ADVERTISED" | cut -c1-72

case "$ADVERTISED" in
  *127.0.0.1*|*localhost*) echo "WARNING: metro is still advertising loopback — a phone cannot reach that" ;;
esac

echo
echo "open on the phone:  exp://$HOSTNAME_LOCAL:8081"
