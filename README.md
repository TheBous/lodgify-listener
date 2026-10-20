# lodgify-listener

Risponditore per gli ospiti Lodgify su Cloudflare Workers, con risposte generate
tramite OpenAI e notifiche Telegram. Il manuale di ogni alloggio viene associato
al suo `property_id`: nessuna informazione di Cadelasco e nessuna apertura Vikey.

Il Worker parte in **modalità anteprima**: genera la risposta e la manda su
Telegram, senza inviarla all'ospite.

## Flusso

1. Riceve e autentica `guest_message_received` su `/webhook/lodgify`.
2. Un Durable Object per thread registra l'ID del messaggio e aspetta 15 secondi
   dall'ultimo arrivo, raggruppando i messaggi consecutivi.
3. Recupera prenotazione e ultimi 20 messaggi da Lodgify. Risponde solo a prenotazioni
   `Booked`, associate allo stesso thread, con un manuale configurato.
4. OpenAI produce una risposta nella lingua dell'ospite e sceglie:
   - `no`: risponde e resta attivo;
   - `notifica`: risponde, avvisa Telegram e resta attivo;
   - `umano`: invia una cortesia, avvisa Telegram e sospende le risposte;
   - `ignore`: nessuna risposta a spam/notifiche.
5. Prima dell'invio rilegge il contesto: se è cambiato, sospende la risposta.
   I messaggi successivi di un thread sospeso vengono segnalati su Telegram.

Per la configurazione completa, la prova su una prenotazione di test e la gestione
degli errori, leggi [la guida operativa](docs/auto-reply.md).

## Avvio locale del Worker

```bash
npm install
cp .dev.vars.example .dev.vars
# Compila chiavi, token e manuali in .dev.vars.
npm run dev:worker
```

Per esporlo a Lodgify in sviluppo usa un tunnel HTTPS verso la porta di Wrangler.
URL webhook Lodgify: `https://<host>/webhook/lodgify` (firma `ms-signature` con
`LODGIFY_WEBHOOK_SECRET`). Per curl manuali: `?token=<WEBHOOK_TOKEN>`.

## Verifica senza servizi reali

```bash
npm run typecheck
npm run lint
npm run test
npm run test:worker
npm run smoke
```

`test:worker` crea un bundle con `wrangler deploy --dry-run` e lo esegue in
Miniflare/workerd: storage SQLite, riavvio del Durable Object, deduplicazione,
attesa reale, aggregazione e controlli amministrativi. Le API esterne sono simulate.
Non effettua un deploy né invia messaggi reali.

## Deploy

Configura i secret descritti nella [guida](docs/auto-reply.md), poi:

```bash
npx wrangler login
npm run deploy
```

`wrangler.jsonc` contiene binding e migrazione SQLite dei Durable Objects.
`AUTO_REPLY_ENABLED` è `false`: mantienilo così durante la prima verifica.
Dopo la prova di consegna puoi impostarlo a `true` e ridistribuire.

## Server Node precedente

`npm run dev` mantiene il precedente flusso locale di triage TypeSafe, configurato
tramite `.env.example`. Legge `data/property-context.md`, recupera lo storico e
invia notifiche/bozze su Telegram; non risponde agli ospiti. Non usa i Durable Objects.
Per provare il nuovo risponditore usa `npm run dev:worker`.
