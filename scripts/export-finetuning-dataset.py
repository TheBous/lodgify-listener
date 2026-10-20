#!/usr/bin/env python3
"""Build Q/A fine-tuning dataset from FAQ trace CSV + conversation JSON export."""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path

SRC_JSON = Path("/tmp/lodgify-conversations-last-365-days.json")
TRACE_CSV = Path("/tmp/lodgify-messaggi-tracciati.csv")
OUT_JSONL = Path("/tmp/lodgify-finetuning.jsonl")
OUT_JSON = Path("/tmp/lodgify-finetuning.json")
OUT_CSV = Path("/tmp/lodgify-finetuning.csv")

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

SYSTEM_TEMPLATE = (
    "Sei l'host dell'alloggio {property} (canale: {source}). "
    "Rispondi come nelle conversazioni reali: tono cordiale, conciso, "
    "nella lingua usata dall'ospite quando possibile."
)


def load_messages_by_ref(path: Path) -> dict[str, dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    by_ref: dict[str, dict] = {}
    for ci, conv in enumerate(data, 1):
        code = f"C{ci:03d}"
        for mi, msg in enumerate(conv.get("messages", []), 1):
            ref = f"{code}-M{mi:02d}"
            by_ref[ref] = {
                "from": msg.get("from", ""),
                "text": (msg.get("text") or "").strip(),
                "sentAt": msg.get("sentAt", ""),
                "conversation": code,
            }
    return by_ref


def host_answer_text(host_refs: list[str], by_ref: dict[str, dict]) -> str:
    parts: list[str] = []
    for href in host_refs:
        m = by_ref.get(href)
        if not m or m["from"] != "host":
            continue
        t = m["text"]
        if not t or t == "[":
            t = "[messaggio troncato nell'export – testo non disponibile nel JSON]"
        parts.append(t)
    return "\n\n".join(parts)


def main() -> None:
    if not SRC_JSON.is_file():
        raise SystemExit(f"Missing JSON export: {SRC_JSON}")
    if not TRACE_CSV.is_file():
        raise SystemExit(f"Missing trace CSV: {TRACE_CSV}")

    by_ref = load_messages_by_ref(SRC_JSON)
    rows_out: list[dict] = []
    stats = {"trace_rows": 0, "training_pairs": 0, "skipped_no_answer": 0, "skipped_not_question": 0}

    with TRACE_CSV.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            stats["trace_rows"] += 1
            guest_ref = row["guest_message_ref"]
            host_refs = [r for r in row.get("host_response_refs", "").split(";") if r]
            if row.get("message_type") != "question_or_explicit_request":
                stats["skipped_not_question"] += 1
                continue
            if not host_refs:
                stats["skipped_no_answer"] += 1
                continue

            guest = by_ref.get(guest_ref)
            if not guest:
                continue
            question = guest["text"]
            if not question:
                continue

            answer = host_answer_text(host_refs, by_ref)
            if not answer:
                stats["skipped_no_answer"] += 1
                continue

            topic_ids = [t for t in row.get("topic_ids", "").split(";") if t]
            topic_labels = [TOPIC_LABELS.get(t, t) for t in topic_ids]

            record = {
                "guest_message_ref": guest_ref,
                "conversation_ref": row.get("conversation_ref", ""),
                "property": row.get("property", ""),
                "source": row.get("source", ""),
                "sent_at": row.get("sent_at", ""),
                "topic_ids": topic_ids,
                "topic_labels": topic_labels,
                "question": question,
                "answer": answer,
                "host_response_refs": host_refs,
            }
            rows_out.append(record)
            stats["training_pairs"] += 1

    rows_out.sort(key=lambda r: (r["sent_at"], r["guest_message_ref"]))

    with OUT_JSONL.open("w", encoding="utf-8") as f:
        for r in rows_out:
            system = SYSTEM_TEMPLATE.format(property=r["property"], source=r["source"])
            meta_note = ""
            if r["topic_labels"]:
                meta_note = " Temi: " + "; ".join(r["topic_labels"]) + "."
            chat = {
                "messages": [
                    {"role": "system", "content": system + meta_note},
                    {"role": "user", "content": r["question"]},
                    {"role": "assistant", "content": r["answer"]},
                ],
                "metadata": {
                    "guest_message_ref": r["guest_message_ref"],
                    "host_response_refs": r["host_response_refs"],
                    "conversation_ref": r["conversation_ref"],
                    "topic_ids": r["topic_ids"],
                },
            }
            f.write(json.dumps(chat, ensure_ascii=False) + "\n")

    OUT_JSON.write_text(json.dumps(rows_out, ensure_ascii=False, indent=2), encoding="utf-8")

    with OUT_CSV.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "guest_message_ref",
                "conversation_ref",
                "property",
                "source",
                "sent_at",
                "topic_ids",
                "topic_labels",
                "question",
                "answer",
                "host_response_refs",
            ]
        )
        for r in rows_out:
            w.writerow(
                [
                    r["guest_message_ref"],
                    r["conversation_ref"],
                    r["property"],
                    r["source"],
                    r["sent_at"],
                    ";".join(r["topic_ids"]),
                    ";".join(r["topic_labels"]),
                    r["question"],
                    r["answer"],
                    ";".join(r["host_response_refs"]),
                ]
            )

    print(json.dumps({"outputs": [str(OUT_JSONL), str(OUT_JSON), str(OUT_CSV)], **stats}, indent=2))


if __name__ == "__main__":
    main()
