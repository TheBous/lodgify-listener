# lodgify-listener

Riceve i messaggi degli ospiti dal webhook di Lodgify, li classifica con [TypeSafe](https://docs.typesafe.ai) e, se serve una risposta che solo il proprietario dell'appartamento può dare, invia la notifica su Telegram.

## Come funziona

```
Lodgify (guest_message_received)
        │  POST /webhook/lodgify
        ▼
   server node:http ──► triage TypeSafe (1 chiamata, 3 domande in parallelo)
        │                    • category:    answerable | needs_owner | no_reply
        │                    • owner_topic: perché serve il proprietario (speculativa)
        │                    • owner_urgent: urgenza (Noul, speculativa)
        ▼
  category = needs_owner  ──►  messaggio Telegram al proprietario
  (o confidence < 0.5)         (dati booking + messaggio originale + topic/urgenza)
```

- **answerable**: rispondibile con informazioni generiche (saluti, conferme) — v1: solo log
- **needs_owner**: richiede informazioni che sa solo il proprietario (check-in anticipato, wifi, accessi, problemi, prezzi) — inviato a Telegram
- **no_reply**: spam/notifiche automatizzate — ignorato

La v1 **non** risponde automaticamente agli ospiti: fa solo triage.

## Setup

```bash
npm install
cp .env.example .env   # e compila le chiavi
```

| Variabile | Descrizione |
| --- | --- |
| `LODGIFY_API_KEY` | API key Lodgify (Settings → API keys) |
| `TYPESAFE_API_KEY` | API key TypeSafe (console.typesafe.ai) |
| `TELEGRAM_BOT_TOKEN` | Token del bot (crealo con @BotFather) |
| `TELEGRAM_CHAT_ID` | Chat id Telegram del proprietario |
| `PORT` | Porta del server (default 3000) |

## Run

```bash
npm run dev
```

Per ricevere i webhook in locale serve un URL pubblico, ad esempio:

```bash
cloudflared tunnel --url http://localhost:3000
```

Poi registra `https://<tunnel-url>/webhook/lodgify` su Lodgify come webhook per l'evento *Guest message received*.

## Test

Smoke test (no chiavi API richieste: copre il gate di routing e il wiring del server):

```bash
npm run smoke
```

Simulare un messaggio ospite (usa le chiavi reali: fa una chiamata TypeSafe e, se classificato `needs_owner`, manda davvero il messaggio Telegram):

```bash
curl -X POST http://localhost:3000/webhook/lodgify -H "content-type: application/json" -d '{
  "action": "guest_message_received",
  "thread_uid": "t-1",
  "inbox_uid": "B123",
  "guest_name": "Mario Rossi",
  "subject": null,
  "message": "Hi! Can we check in at 10am tomorrow? And what is the wifi password?"
}'
```

Risposta attesa: `200 ok`, log `[B123] category=needs_owner ...` e notifica Telegram al proprietario.

## Debug

VS Code → F5 ("Debug: build + run"): compila, carica `.env` e lancia il server con breakpoint. Con il server già avviato via `node --inspect`, usa la config "Attach".

## Script

| Script | Cosa fa |
| --- | --- |
| `npm run dev` | build + watch del server con `.env` |
| `npm run smoke` | test di wiring senza API key |
| `npm run lint` / `lint:fix` | Biome check / fix |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run release` | bump versione + CHANGELOG + tag dai commit convenzionali |
