# Configurazione e verifica del risponditore

## Cosa viene trasferito da n8n

Webhook, storico, risposta multilingua, aggregazione per 15 secondi, tre tentativi
in caso di errore, notifiche e passaggio a un umano sono nel Worker. Le Data Table e
le attese di n8n diventano storage SQLite e allarmi di un Durable Object per thread.

Le email del workflow diventano notifiche Telegram. Non sono trasferiti il manuale
di Cadelasco, Sofia, deposito bagagli, comandi di apertura Vikey e il promemoria del
portone: dipendevano da quella struttura e dagli eventi Hospitable.

Il riferimento dei cambiamenti è il commit `78b31a266309ebd9a454e1edd7014477187794bd`.

## Variabili e secret

| Nome | Uso |
| --- | --- |
| `LODGIFY_API_KEY` | Prenotazione, storico e invio messaggi |
| `OPENAI_API_KEY` | Generazione della risposta |
| `TELEGRAM_BOT_TOKEN` | Bot per le notifiche |
| `TELEGRAM_CHAT_ID` | Uno o più chat ID separati da virgola |
| `WEBHOOK_TOKEN` | Token casuale di almeno 32 caratteri per Lodgify |
| `ADMIN_TOKEN` | Un altro token casuale di almeno 32 caratteri per i controlli |
| `PROPERTY_CONTEXTS_JSON` | Oggetto JSON: property ID → manuale markdown |
| `OPENAI_MODEL` | Default in Wrangler: `gpt-6-luna` |
| `AUTO_REPLY_ENABLED` | `false` = anteprima Telegram; `true` = invio agli ospiti |

OpenAI usa la Responses API con `gpt-6-luna`, reasoning `low`, JSON Schema strict
e `store=false`. Risposte incomplete, rifiuti e JSON non valido seguono il percorso
di errore e non vengono inviati agli ospiti. Non esiste fallback ad altri modelli.

In locale usa `.dev.vars` copiato da `.dev.vars.example`; il file è ignorato da git.
In produzione carica le prime sette variabili come secret:

```bash
npx wrangler secret put LODGIFY_API_KEY
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler secret put WEBHOOK_TOKEN
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put PROPERTY_CONTEXTS_JSON
```

Genera due token differenti, per esempio con `openssl rand -hex 32`. Non inserire le
chiavi nel codice o nei messaggi Telegram. I parametri query vengono oscurati nei log
Worker tramite `observability.redact_query_string`.

Per creare il JSON del manuale esistente, sostituisci `PROPERTY_ID_REALE` nel comando:

```bash
node --input-type=module -e 'import {readFileSync,writeFileSync} from "node:fs"; writeFileSync("/tmp/lodgify-contexts.json", JSON.stringify({[process.argv[1]]:readFileSync("data/property-context.md","utf8")}));' 744245
```

Passa il contenuto di `/tmp/lodgify-contexts.json` al secret `PROPERTY_CONTEXTS_JSON`.
Per più alloggi aggiungi una voce per ogni ID. Se più alloggi condividono il manuale,
riutilizza esplicitamente lo stesso contenuto. Non esiste un manuale di fallback.
`PROPERTY_CONTEXT_MD` e `TYPESAFE_API_KEY` del vecchio Worker non sono usati dal nuovo.

## Webhook e prima prova

Registra su Lodgify l'evento **Guest message received** con questo URL:

```text
https://lodgify-listener.<subdomain>.workers.dev/webhook/lodgify?token=<WEBHOOK_TOKEN>
```

È supportato anche `Authorization: Bearer <WEBHOOK_TOKEN>` per client che possono
impostare header. I controlli amministrativi richiedono sempre il Bearer token.
Una configurazione incompleta restituisce 503; token errato 401; payload invalido 400.
Il payload deve contenere i campi ufficiali `message_id`, `thread_uid`, `inbox_uid`,
`creation_time` e il testo/indicatore allegati. La risposta 202 significa accodato.

1. Mantieni `AUTO_REPLY_ENABLED=false` ed esegui il deploy.
2. Usa una prenotazione di test `Booked`, con il property ID configurato.
3. Invia due messaggi come ospite in rapida successione. Dopo circa 15 secondi più
   elaborazione deve arrivare una sola anteprima Telegram nella lingua dell'ospite.
4. Verifica i dati del manuale, una domanda sconosciuta, una richiesta di persona e
   un allegato senza testo. In anteprima le decisioni del modello non attivano il
   passaggio a un umano; gli errori e gli interventi rilevati del proprietario sì.
5. Per provare la consegna reale, usa un Worker di staging con **solo** l'ID del
   tuo alloggio di test nel manuale, imposta `AUTO_REPLY_ENABLED=true` e ridistribuisci.
6. Verifica che la risposta arrivi nel canale originale (email/Airbnb/Booking ecc.)
   e che Lodgify mostri lo stato Sent/Delivered. Un HTTP 200 da solo non prova la
   consegna finale. Ripeti la prova sui canali che userai.
7. Solo dopo la prova abilita il Worker principale e gli altri manuali.

La modalità anteprima usa comunque OpenAI e Telegram reali, quindi richiede le
chiavi e invia notifiche al tuo bot. I comandi `npm run test` e `test:worker` simulano
le API esterne e non usano le chiavi reali.

## Controlli per conversazione

Il thread UUID è indicato in ogni notifica Telegram. Negli esempi `WORKER_URL`,
`THREAD_UUID` e `ADMIN_TOKEN` sono segnaposto, non valori da committare.

```bash
curl "$WORKER_URL/conversations/$THREAD_UUID" -H "Authorization: Bearer $ADMIN_TOKEN"
curl -X POST "$WORKER_URL/conversations/$THREAD_UUID/pause" -H "Authorization: Bearer $ADMIN_TOKEN"
curl -X POST "$WORKER_URL/conversations/$THREAD_UUID/resume" -H "Authorization: Bearer $ADMIN_TOKEN"
curl -X POST "$WORKER_URL/conversations/$THREAD_UUID/retry-notification" -H "Authorization: Bearer $ADMIN_TOKEN"
```

Lo stato espone modalità, numero dei messaggi in attesa, fase, tentativi, UUID di
invio ed eventuale errore. `pause` impedisce invii ancora da iniziare. Un invio
precedente con esito incerto viene segnalato al team, senza nuovi tentativi.
`resume` cancella i messaggi ancora in attesa: usalo dopo averli gestiti su Lodgify,
così il bot riprende soltanto dai nuovi messaggi. Se un job non è completato restituisce
409; risolvi prima la notifica tramite `retry-notification`, oppure sospendi con
`pause` un invio in corso e attendi la segnalazione. I token non appaiono su Telegram.

## Errori, concorrenza e limiti

- ID del messaggio e hash del payload normalizzato vengono registrati atomicamente
  con il buffer e l'allarme. Replay identici non generano nuovi invii; stesso ID con
  contenuto diverso restituisce 409. Le ricevute hash sono conservate senza scadenza
  per la durata del Durable Object; non contengono il testo. Webhook più vecchi di
  30 giorni vengono ignorati anche se sconosciuti.
- Ogni thread ha storage e ordinamento propri. Le fasi sono serializzate; le chiamate
  esterne hanno timeout di 4 secondi, la generazione di 8. Una richiesta può attendere
  la fase già in esecuzione. Gli allarmi non garantiscono esecuzione al millisecondo.
- Un nuovo messaggio invalida una bozza non inviata e viene raggruppato con essa.
  Se l'invio è già iniziato, la nuova richiesta resta in attesa del suo esito.
- Storico o prenotazione indisponibili non vengono ignorati: dopo tre tentativi il
  bot sospende le risposte e avvisa il team. Richieste `E…`, ID mancanti, prenotazioni
  non `Booked` o eliminate producono solo una notifica.
- Prima di inviare si rilegge lo storico e la prenotazione. Se sono cambiati, si
  passa a un umano. Se il proprietario ha già risposto dopo il messaggio ospite,
  la risposta automatica non viene generata. Rimane una piccola finestra tra
  l'ultima lettura e l'invio: Lodgify non offre qui un invio condizionale atomico.
- Lo storico Lodgify non distingue con certezza operatore e automazione: il modello
  tratta i messaggi Owner con prudenza. Non viene applicata la distinzione
  Hospitable/Vikey del workflow originario.
- L'UUID `message_id` e il testo della risposta sono salvati prima dell'invio. Nei
  tentativi successivi si usano gli stessi valori; se l'UUID compare nello storico
  con stato Sent/Delivered, il job si completa senza inviare nuovamente. Submitted,
  Failed o stato ignoto non causano un nuovo POST. Dopo tre tentativi l'esito incerto
  viene segnalato e richiede verifica manuale. La garanzia di deduplicazione in
  uscita dipende anche dal contratto di idempotenza di Lodgify.
- Telegram non supporta chiavi di idempotenza: timeout o consegna parziale a più
  chat possono produrre notifiche duplicate. Dopo tre errori il job resta memorizzato,
  senza altri tentativi automatici. Controlla `lastError`/log e usa
  `retry-notification` dopo aver ripristinato Telegram.
- Buffer massimo: 20 messaggi e 40 KB di eventi serializzati per thread. Un overflow
  restituisce 429 senza registrare il nuovo ID. Non è una coda illimitata.
- Le immagini non vengono analizzate. Il modello riceve solo l'indicazione di allegato.
  Le risposte non sono garantite corrette dal solo schema: la prova sui tuoi casi
  reali e il controllo del manuale restano necessari.

## Fonti dei contratti

- [Webhook Lodgify](https://docs.lodgify.com/reference/webhook-objects)
- [Dettagli prenotazione](https://docs.lodgify.com/reference/getbookingbyid-1)
- [Storico e stato messaggi](https://docs.lodgify.com/reference/get_v2-messaging-threadguid)
- [Invio messaggi: Owner, send_notification e message_id](https://docs.lodgify.com/reference/post_v1-reservation-booking-id-messages)
- [Allarmi Durable Objects](https://developers.cloudflare.com/durable-objects/api/alarms/)
- [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna)
- [Output strutturati OpenAI](https://developers.openai.com/api/docs/guides/structured-outputs)

## Verifica locale eseguita

Il 15 ottobre 2026, sulla versione con OpenAI `gpt-6-luna`:

- `npm run typecheck`, `npm run lint`, `npm run smoke`: superati.
- `npm run test`: 17 test superati su parsing, instradamento, provider, intervento
  umano, invalidazione delle bozze e recupero degli invii incerti.
- `npm run test:worker`: 2 test superati in workerd/SQLite, in anteprima e in modalità
  invio, con API esterne simulate. Coprono richieste simultanee duplicate, riavvio
  del Durable Object, aggregazione con allarme reale e controlli di pausa/ripresa.
- Bundle Wrangler con `deploy --dry-run` e `git diff --check`: superati.
- Controllo Biome `noExcessiveCognitiveComplexity`: superato. I nuovi file sorgente
  hanno al massimo 148 righe; la complessità ciclomatica è stata esaminata manualmente,
  senza un misuratore configurato nel progetto. Revisione del codice eseguita dall'autore.

La verifica locale copre codice e runtime Cloudflare con API simulate. La consegna
ai canali reali, la qualità linguistica del modello e il deploy nell'account Cloudflare
non sono stati verificati automaticamente da questi test.
