# lodgify-listener

Riceve i messaggi degli ospiti dal webhook di Lodgify, li classifica con [TypeSafe](https://docs.typesafe.ai) e, se serve una risposta che solo il proprietario dell'appartamento può dare, invia la notifica su Telegram.

## Come funziona

```
Lodgify (guest_message_received)
        │  POST /webhook/lodgify
        ▼
   server node:http ──► storico thread da API Lodgify ─┐
        │                                              ▼
        │                              triage TypeSafe (1 chiamata, 3 domande in parallelo)
        │                                              • category:    answerable | needs_owner | no_reply
        │                                              • owner_topic: perché serve il proprietario (speculativa)
        │                                              • owner_urgent: urgenza (Noul, speculativa)
        ▼
  category = needs_owner  ──►  messaggio Telegram al proprietario
  (o confidence < 0.5)         (dati booking + messaggio originale + topic/urgenza)
```

## Contesto (senza database vettoriale)

Il modello di triage giudica ogni messaggio con due fonti di contesto passate
nello `state` della richiesta TypeSafe:

1. **`data/property-context.md`** — conoscenza statica dell'immobile scritta dal
   proprietario (wifi, orari check-in, accessi, regole, servizi, prezzi). Se la
   risposta alla domanda dell'ospite è in questo file, il messaggio è
   `answerable` e non arriva su Telegram. Modifica liberamente il file: viene
   ricaricato a ogni avvio.
2. **Storico della conversazione** — gli ultimi 20 messaggi del thread recuperati
   da `GET /v2/messaging/{threadGuid}` (usa `LODGIFY_API_KEY`). Se il
   proprietario ha già risposto alla stessa domanda nel thread, è `answerable`.

Se lo storico non è disponibile il triage prosegue comunque col solo messaggio
nuovo (degradazione graceful).

- **answerable**: rispondibile con informazioni generiche, dal file di contesto
  o dallo storico — v1: solo log
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
| `LODGIFY_API_KEY` | API key Lodgify (Settings → API keys), usata per lo storico thread |
| `TYPESAFE_API_KEY` | API key TypeSafe (console.typesafe.ai) |
| `TELEGRAM_BOT_TOKEN` | Token del bot (crealo con @BotFather) |
| `TELEGRAM_CHAT_ID` | Chat id Telegram del proprietario |
| `PORT` | Porta del server (default 3000) |
| `PROPERTY_CONTEXT_PATH` | Percorso del file di contesto immobile (default `data/property-context.md`) |

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

## Deploy (Cloudflare Workers, free tier)

Lo stesso codice gira come Worker (`src/worker.ts`): niente server always-on,
paghi zero request che non arrivano.

```bash
npx wrangler login
npx wrangler secret put TYPESAFE_API_KEY
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler secret put LODGIFY_API_KEY
npx wrangler secret put PROPERTY_CONTEXT_MD   # incolla il contenuto di data/property-context.md
npm run deploy
```

Webhook su Lodgify: `https://lodgify-listener.<tuo-subdomain>.workers.dev/webhook/lodgify`
(evento *Guest message received*).

Per provare il Worker in locale: `npm run dev:worker`.

Nota: su Workers il contesto immobile vive nella variabile `PROPERTY_CONTEXT_MD`
(multilinea ok). Se lo aggiorni, ricordati di allineare anche
`data/property-context.md` (o viceversa) — in locale fa fede il file.

## Debug

VS Code → F5 ("Debug: build + run"): compila, carica `.env` e lancia il server con breakpoint. Con il server già avviato via `node --inspect`, usa la config "Attach".

## Script

| Script | Cosa fa |
| --- | --- |
| `npm run dev` | build + watch del server con `.env` |
| `npm run dev:worker` | Worker in locale con wrangler |
| `npm run deploy` | deploy su Cloudflare Workers |
| `npm run smoke` | test di wiring senza API key |
| `npm run lint` / `lint:fix` | Biome check / fix |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run release` | bump versione + CHANGELOG + tag dai commit convenzionali |
