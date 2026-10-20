# Lodgify webhook research

Verified 2026-10-20 against official Lodgify documentation. Documentation review only; no authenticated API calls or subscriptions were made.

## Outbound request signing

**Yes: Lodgify documents `ms-signature: sha256=SIGNATURE`.** Compute HMAC-SHA256 using the endpoint's signing secret as the key and the JSON request-body payload string as the message. Compare against the value after `=`; Lodgify says the signature is uppercase. Lodgify generates a distinct secret for each endpoint and returns it only when the webhook is created. [Webhook guide, “Verifying Responses”](https://docs.lodgify.com/reference/webhooks)

Implementation implication: preserve the received body for verification rather than parse and reserialize JSON. The guide does not specify a timestamp/replay scheme, secret rotation, or configurable outbound authorization headers. These are documentation gaps, not proof that no other mechanism exists. [Webhook guide](https://docs.lodgify.com/reference/webhooks)

## API authentication and permissions

All webhook management calls require a valid API key. Obtain the account key in Lodgify **Settings → Public API** and send it as `X-ApiKey`. The key grants read and write permissions; channel operations are the documented exception requiring a separate key. No webhook-specific OAuth scopes or separately selectable read/write scopes are documented in these pages. This API key authenticates management calls; the endpoint secret above verifies outbound deliveries. [Webhook guide](https://docs.lodgify.com/reference/webhooks), [Authorization](https://docs.lodgify.com/docs/authorization)

## Create/register a subscription

`POST https://api.lodgify.com/webhooks/v1/subscribe`

Send `target_url` and a single `event` in the body. JSON is an accepted request format:

```bash
curl --request POST 'https://api.lodgify.com/webhooks/v1/subscribe' \
  --header "X-ApiKey: $LODGIFY_API_KEY" \
  --header 'Content-Type: application/json' \
  --header 'Accept: application/json' \
  --data '{"target_url":"https://example.com/webhooks/lodgify","event":"guest_message_received"}'
```

Success is **201 Created**, with an object containing `id` and `secret` (both described as nullable strings in the schema). Save the ID for unsubscribing and the secret for verification; the secret is returned only at creation. **The callback URL must be unique each time; duplicates return 409 Conflict.** The docs do not define the uniqueness boundary more precisely. Other documented responses: 400, 401, 404, 500. [Subscribe reference](https://docs.lodgify.com/reference/webhooksapi_subscribe_post)

The documented event enum contains:

```text
rate_change
availability_change
booking_new_any_status
booking_new_status_booked
booking_change
booking_status_change_booked
booking_status_change_tentative
booking_status_change_open
booking_status_change_declined
guest_message_received
```

[Subscribe reference](https://docs.lodgify.com/reference/webhooksapi_subscribe_post). `guest_message_received` covers new guest messages in the user's threads, including booking and enquiry threads. [Webhook payloads](https://docs.lodgify.com/reference/webhook-objects)

## List existing subscriptions

`GET https://api.lodgify.com/webhooks/v1/list`

```bash
curl 'https://api.lodgify.com/webhooks/v1/list' \
  --header "X-ApiKey: $LODGIFY_API_KEY" \
  --header 'Accept: application/json'
```

Success is **200**, returning an array of objects with `id`, `event`, and `url`; all are nullable in the documented schema. Notice the response field is `url`, while creation uses `target_url`. The guide describes this as listing the user's webhooks. The reference documents no pagination, filters, or secret field, so listing cannot recover the creation-only secret through the documented response. Other documented responses: 400, 401, 404, 500. [List reference](https://docs.lodgify.com/reference/webhooksapi_list_get), [Webhook guide](https://docs.lodgify.com/reference/webhooks)

## Delivery and usage limits

- Return **200 OK**. Other responses cause delayed retries, with a documented maximum of **10 retries**. The delay schedule and delivery timeout are unspecified. Consistently failing subscriptions may be removed. The guide describes automatic removal on **410 Gone** as a planned future behavior, not a confirmed current guarantee. [Webhook guide](https://docs.lodgify.com/reference/webhooks)
- Public API limits are **600 requests/minute for v1**, **750 requests/minute for v2**; exceeding limits produces **429** and may trigger blocking. The limits page does not explicitly map `/webhooks/v1/*` to a separate webhook quota or specify the counting dimension. [Rate limits](https://docs.lodgify.com/docs/rate-limits)
- Unregistered third-party integrations may use only a limited number of API keys; the numeric allowance is not published. Providers serving Lodgify users are directed to register with the partnership team. No numeric subscription cap is stated in the reviewed webhook pages. [Rate limits](https://docs.lodgify.com/docs/rate-limits), [Webhook guide](https://docs.lodgify.com/reference/webhooks)
