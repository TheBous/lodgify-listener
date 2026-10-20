#!/usr/bin/env python3
"""Two-column CSV: one row per FAQ theme, merged guest intent + single best host reply."""

from __future__ import annotations

import csv
import json
import re
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

IN_JSON = Path("/tmp/lodgify-finetuning.json")
OUT_CSV = Path("/tmp/lodgify-finetuning-domanda-risposta.csv")

TOPIC_LABELS: dict[str, str] = {
    "checkin_hours": "Orario e modalità del check-in",
    "early_checkin_bags": "Check-in anticipato / stanza pronta",
    "luggage_storage": "Deposito bagagli prima o dopo il soggiorno",
    "online_checkin": "Check-in online e documenti",
    "privacy_vikey": "Affidabilità e privacy di Vikey",
    "legal_checkin": "Obbligo del check-in e riferimenti normativi",
    "access": "Chiavi virtuali e accesso all'alloggio",
    "parking": "Disponibilità e posizione dei parcheggi",
    "parking_rules": "Regole di parcheggio, ZTL e pulizia strade",
    "checkout_time": "Orario del check-out e proroga",
    "checkout_steps": "Cosa fare prima di lasciare l'alloggio",
    "city_tax_fees": "Tassa di soggiorno e costi obbligatori",
    "fees_payment_platform": "Modalità di pagamento e piattaforme",
    "payment_status": "Verifica di pagamenti già effettuati",
    "booking_availability": "Disponibilità dell'alloggio per le date richieste",
    "extension": "Prolungamento del soggiorno",
    "parking_long_term": "Parcheggio dell'auto per più giorni",
    "price_discount": "Prezzi e sconti",
    "cancel_change": "Cancellazione e modifica della prenotazione",
    "location_address": "Indirizzo e posizione dell'alloggio",
    "public_transport": "Distanze e trasporti pubblici",
    "food_recommendations": "Ristoranti, bar e colazione",
    "activities": "Attività e luoghi da visitare",
    "property_layout": "Piano, spazi e caratteristiche dell'alloggio",
    "guest_count": "Numero di ospiti e dati dei viaggiatori",
    "pet": "Animali domestici",
    "amenity_bedding_towels": "Biancheria e dotazioni (asciugamani, ferro, phon, culla)",
    "amenity_coffee": "Macchina del caffè e capsule",
    "amenity_wifi": "Wi-Fi e connessione",
    "amenity_tv": "TV e canali",
    "amenity_water_power": "Acqua calda, riscaldamento e impianto elettrico",
    "amenity_maintenance_noise": "Guasti, rumori e manutenzione",
    "water_potable": "Potabilità dell'acqua",
    "laundry": "Lavanderia e stireria",
    "clothing_storage": "Spazio per riporre i vestiti",
    "bike_storage": "Deposito biciclette",
    "umbrella": "Ombrello",
    "decorations": "Decorazioni e richieste speciali",
    "host_presence_contact": "Presenza e contatti dell'host",
    "invoice": "Fattura o ricevuta",
    "review": "Recensioni",
    "cleaning_schedule": "Pulizie e orari di servizio",
    "booking_confirmation": "Conferma o verifica di una procedura",
    "support_misc": "Richieste di assistenza non specificate",
}

REPRESENTATIVE_QUESTION: dict[str, str] = {
    "checkin_hours": "A che ora possiamo fare il check-in e come funziona l'arrivo?",
    "early_checkin_bags": "Possiamo entrare prima dell'orario standard o lasciare i bagagli se la stanza non è pronta?",
    "luggage_storage": "Possiamo depositare i bagagli prima del check-in o dopo il check-out?",
    "online_checkin": "Come completiamo il check-in online con Vikey e quali documenti servono?",
    "privacy_vikey": "Vikey è affidabile? Posso inviare i documenti in modo sicuro?",
    "legal_checkin": "Il check-in online è obbligatorio per legge? Potete indicare il riferimento normativo?",
    "access": "Come entriamo nell'alloggio con la chiave virtuale Vikey (portone e porta)?",
    "parking": "Dove possiamo parcheggiare l'auto vicino all'alloggio?",
    "parking_rules": "Quali regole di parcheggio valgono (strisce, ZTL, pulizia strade)?",
    "checkout_time": "Entro che ora dobbiamo lasciare l'alloggio e possiamo fare un check-out tardivo?",
    "checkout_steps": "Cosa dobbiamo fare prima di andare via (rifiuti, chiavi, pulizie)?",
    "city_tax_fees": "Quanto costa la tassa di soggiorno e come si paga?",
    "fees_payment_platform": "Come possiamo pagare extra o tasse (carta, link, piattaforma)?",
    "payment_status": "Il pagamento è arrivato? Potete confermare che risulta tutto a posto?",
    "booking_availability": "L'alloggio è libero nelle date che ci interessano?",
    "extension": "Possiamo prolungare il soggiorno di una notte?",
    "parking_long_term": "Possiamo lasciare l'auto parcheggiata per più giorni?",
    "price_discount": "Il prezzo è negoziabile o avete uno sconto?",
    "cancel_change": "Possiamo cancellare o modificare le date della prenotazione?",
    "location_address": "Qual è l'indirizzo esatto e come raggiungiamo l'alloggio?",
    "public_transport": "Quanto dista la stazione/fermata e come arriviamo con mezzi pubblici o taxi?",
    "food_recommendations": "Quali ristoranti, bar o colazioni consigliate in zona?",
    "activities": "Cosa ci consigliate da fare o visitare sul Lago di Como?",
    "property_layout": "A che piano è l'appartamento e com'è disposto (ascensore, spazi)?",
    "guest_count": "Quanti ospiti possiamo registrare e come inseriamo i dati di tutti i viaggiatori?",
    "pet": "Possiamo portare un animale domestico?",
    "amenity_bedding_towels": "Ci sono asciugamani, lenzuola, ferro da stiro, phon o culla?",
    "amenity_coffee": "C'è una macchina del caffè e come si usa / dove sono le capsule?",
    "amenity_wifi": "Qual è la password Wi‑Fi?",
    "amenity_tv": "Come vediamo i canali TV o lo streaming?",
    "amenity_water_power": "Problemi con acqua calda, riscaldamento o prese elettriche: cosa facciamo?",
    "water_potable": "L'acqua del rubinetto è potabile?",
    "laundry": "Dove possiamo lavare o stirare i vestiti?",
    "clothing_storage": "C'è spazio nell'armadio per i bagagli e i vestiti?",
    "bike_storage": "Dove possiamo lasciare le biciclette?",
    "umbrella": "C'è un ombrello in appartamento?",
    "decorations": "Potete preparare decorazioni o un piccolo extra per un'occasione speciale?",
    "host_presence_contact": "Sarete presenti all'arrivo o possiamo sentirvi per telefono?",
    "invoice": "Potete emettere fattura o ricevuta con i nostri dati?",
    "review": "Dove lasciamo una recensione?",
    "cleaning_schedule": "Quando passano le pulizie o c'è pulizia strade che ci riguarda?",
    "booking_confirmation": "La prenotazione e il check-in risultano completati correttamente?",
    "support_misc": "Abbiamo un problema generico: ci aiutate?",
}

AUTOMATION = re.compile(
    r"(vikey check-in|remember to carry out the online check-in|"
    r"grazie per la tua prenotazione! volevo confermare|check-in completed|"
    r"non vedo l'ora di ospitarti|looking forward to welcoming you)",
    re.I,
)

TOPIC_REPLY_ANTIPATTERN = {
    "parking": r"(fully private apartment|privacy and exclusive|exclusive use)",
    "booking_availability": r"(uploading your passport to vikey)",
}

TOPIC_REPLY_HINT = {
    "amenity_wifi": r"(wi.?fi|wlan|password|internet|connect|m4nd3ll0)",
    "amenity_tv": r"(tv|television|channel|rai|antenna|cavo)",
    "amenity_coffee": r"(coffee|caff|capsul|macchina)",
    "access": r"(vikey|key|door|link|button|porta|entrare|open)",
    "online_checkin": r"(vikey|check.?in|passport|document|link|registration)",
    "parking": r"(park|parchegg|strisc|white|yellow|auto)",
    "city_tax_fees": r"(tax|tassa|soggiorno|€|euro)",
    "checkout_time": r"(check.?out|10:00|11:00|late|partenza)",
    "early_checkin_bags": r"(early|anticip|pronto|pulizie|14:00|15:00|bagagli|luggage)",
    "location_address": r"(via cesare|mandello|address|indirizz|maps|google)",
    "food_recommendations": r"(restaurant|ristorant|breakfast|colazione|maps)",
    "public_transport": r"(station|ferry|bus|train|taxi|traghett|navigazione)",
    "water_potable": r"(potabile|drinkable|acqua)",
    "review": r"(review|recension|feedback|bewertung|avis)",
    "extension": r"(notte|night|stay|soggiorno|prolung)",
    "price_discount": r"(prezzo|price|€|euro|discount|sconto|cost)",
}

PLACEHOLDER_RE = re.compile(
    r"(https?://\S+|www\.\S+|\+\d[\d\s\-]{6,}\d|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|M4nd3LL0!)"
)


def looks_italian(text: str) -> bool:
    t = f" {text.lower()} "
    italian = sum(
        1
        for m in (
            " ciao ",
            " grazie ",
            " per ",
            " non ",
            " che ",
            " con ",
            " dell",
            " l'",
            " purtroppo",
            " perfetto",
            " sì",
            " è ",
            " sono ",
            " possibile",
            " appartamento",
            " buonasera",
            " buongiorno",
            " scusa",
            " ecco ",
            " certo",
        )
        if m in t
    )
    english = sum(
        1
        for m in (
            " thank you ",
            " hello ",
            " hi ",
            " yes ",
            " you can ",
            " your ",
            " please ",
            " regarding ",
            " you'll ",
            " we ",
            " the apartment",
            " have a nice",
        )
        if m in t
    )
    return italian > english


def protect_placeholders(text: str) -> tuple[str, list[str]]:
    tokens: list[str] = []

    def repl(match: re.Match[str]) -> str:
        tokens.append(match.group(0))
        return f"⟦{len(tokens) - 1}⟧"

    return PLACEHOLDER_RE.sub(repl, text), tokens


def restore_placeholders(text: str, tokens: list[str]) -> str:
    for i, tok in enumerate(tokens):
        text = text.replace(f"⟦{i}⟧", tok)
    return text


def detect_source_lang(text: str) -> str:
    t = text.lower()
    if any(x in t for x in ("bonjour", "merci", " vous ", "taxe de", "correspond à")):
        return "fr"
    if any(x in t for x in ("hallo", " sie ", " nicht", " dürfen", " guten", " können")):
        return "de"
    if any(x in t for x in ("hola", "gracias", " usted", " puede")):
        return "es"
    if any(x in t for x in ("dank", " u ", " niet ", " alstublieft")):
        return "nl"
    return "en"


def translate_to_italian(text: str) -> str:
    if looks_italian(text):
        return text
    src = detect_source_lang(text)
    protected, tokens = protect_placeholders(text)
    chunks: list[str] = []
    buf = protected
    max_len = 400
    while buf:
        piece = buf[:max_len]
        if len(buf) > max_len:
            cut = piece.rfind(". ")
            if cut < 80:
                cut = piece.rfind(" ")
            if cut > 0:
                piece = buf[: cut + 1]
        chunks.append(piece.strip())
        buf = buf[len(piece) :].lstrip()
    translated: list[str] = []
    for piece in chunks:
        if not piece:
            continue
        q = urllib.parse.quote(piece)
        url = f"https://api.mymemory.translated.net/get?q={q}&langpair={src}|it"
        with urllib.request.urlopen(url, timeout=30) as resp:
            data = json.loads(resp.read().decode())
        translated.append(data["responseData"]["translatedText"])
        time.sleep(0.25)
    out = restore_placeholders(" ".join(translated), tokens)
    out = out.replace("this is the password", "questa è la password")
    return out


def score_reply(text: str, topic_id: str | None = None) -> float:
    if not text or text.startswith("[messaggio troncato"):
        return -1e9
    score = min(len(text), 2500) * 0.05
    if AUTOMATION.search(text):
        score -= 500
    if "http" in text.lower():
        score += 15
    if re.search(r"\d{1,2}:\d{2}|€|\beuro\b", text, re.I):
        score += 25
    if len(text.strip()) < 20:
        score -= 120
    if re.fullmatch(r"[\W\s\d]+", text.strip()):
        score -= 200
    if topic_id:
        anti = TOPIC_REPLY_ANTIPATTERN.get(topic_id)
        if anti and re.search(anti, text, re.I):
            score -= 350
        hint = TOPIC_REPLY_HINT.get(topic_id)
        if hint and re.search(hint, text, re.I):
            score += 180
        elif hint and "maps.app.goo.gl" in text.lower() and topic_id not in {
            "location_address",
            "food_recommendations",
            "public_transport",
            "activities",
        }:
            score -= 150
    if looks_italian(text):
        score += 90
    return score


def main() -> None:
    if not IN_JSON.is_file():
        raise SystemExit(f"Run export-finetuning-dataset.py first; missing {IN_JSON}")

    rows = json.loads(IN_JSON.read_text(encoding="utf-8"))
    by_topic: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        topics = row.get("topic_ids") or ["support_misc"]
        for topic_id in topics:
            by_topic[topic_id].append(row)

    compact: list[tuple[str, str]] = []
    for topic_id in sorted(by_topic.keys(), key=lambda k: TOPIC_LABELS.get(k, k).casefold()):
        group = by_topic[topic_id]
        candidates: list[str] = []
        for row in group:
            for chunk in row["answer"].split("\n\n"):
                chunk = chunk.strip()
                if chunk:
                    candidates.append(chunk)
        reply = max(candidates, key=lambda c: score_reply(c, topic_id))
        question = REPRESENTATIVE_QUESTION.get(topic_id, TOPIC_LABELS.get(topic_id, topic_id))
        reply_it = translate_to_italian(reply)
        compact.append((question, reply_it))

    with OUT_CSV.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["domanda", "risposta"])
        writer.writerows(compact)

    print(f"Wrote {len(compact)} rows to {OUT_CSV}")


if __name__ == "__main__":
    main()
