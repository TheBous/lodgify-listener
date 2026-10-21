#!/usr/bin/env bash
set -u

usage() {
  echo "Usage: LODGIFY_API_KEY=... $0 B<booking-id> <thread-uuid>" >&2
  echo "Example: LODGIFY_API_KEY=... $0 B23879394 008f1eb4-3eb8-4f2a-88cf-112fb58ebcb0" >&2
}

if [[ -z "${LODGIFY_API_KEY:-}" || $# -ne 2 ]]; then
  usage
  exit 2
fi

booking_ref=$1
thread_id=$2

if [[ ! "$booking_ref" =~ ^B[1-9][0-9]*$ ]]; then
  echo "Invalid booking reference: expected B followed by a positive numeric ID" >&2
  exit 2
fi

booking_id=${booking_ref#B}
if (( booking_id > 2147483647 )); then
  echo "Booking ID exceeds the maximum accepted by the worker" >&2
  exit 2
fi

if [[ ! "$thread_id" =~ ^[0-9a-fA-F-]{36}$ ]]; then
  echo "Invalid thread UUID" >&2
  exit 2
fi

request_get() {
  local label=$1
  local url=$2
  local headers_file result status duration curl_status
  headers_file=$(mktemp)

  echo "== $label =="
  result=$(curl --silent --show-error --location --max-time 4 \
    --dump-header "$headers_file" --output /dev/null \
    --write-out '%{http_code} %{time_total}' \
    -H "X-ApiKey: $LODGIFY_API_KEY" \
    -H 'content-type: application/json' \
    -H 'accept: application/json' \
    "$url")
  curl_status=$?
  status=${result%% *}
  duration=${result#* }

  if [[ -s "$headers_file" ]]; then
    awk 'BEGIN { IGNORECASE=1 }
      /^HTTP\// || /^(cf-ray|retry-after|x-ratelimit[^:]*|ratelimit[^:]*|rate-limit[^:]*):/ { print }' \
      "$headers_file"
  fi
  rm -f "$headers_file"

  if (( curl_status != 0 )); then
    echo "curl failed (exit $curl_status); thread request will not run."
    return 1
  fi

  echo "HTTP $status; duration ${duration}s"
  if [[ ! "$status" =~ ^2[0-9][0-9]$ ]]; then
    echo "Request failed; matching worker behavior, stopping before the next read."
    return 1
  fi
}

# Mirrors createLodgifyMessaging.context(): booking read first, then thread read.
request_get 'booking.read' "https://api.lodgify.com/v1/reservation/booking/$booking_id" || exit 1
request_get 'thread.read' "https://api.lodgify.com/v2/messaging/$thread_id" || exit 1

echo 'Both sequential reads returned 2xx.'
