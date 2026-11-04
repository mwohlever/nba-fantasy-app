#!/usr/bin/env python3
"""Offline only: prepare local-restore bootstrap or reviewed maintenance SQL.

No database client, network, credentials, or production execution capability.
"""
import argparse
from decimal import Decimal
import hashlib
import json
from pathlib import Path

APPROVAL = "ARCHIVE_RESTORED_AND_APPROVED_1502203"
HERE = Path(__file__).resolve().parent


def load(value):
    return json.loads(value, parse_float=Decimal)


def encoded(value):
    return json.dumps(value, default=str, separators=(",", ":"))


def render(keys, current_count, approval="REVIEW_ONLY"):
    if approval not in ("REVIEW_ONLY", APPROVAL):
        raise ValueError("Unrecognized approval token")
    plan = encoded({"cutoff": 1502203, "current_count": current_count, "keys": keys})
    if "$approved_manifest$" in plan or "$maintenance$" in plan:
        raise ValueError("Reserved SQL delimiter in archive")
    return (HERE / "batch-template.sql").read_text().replace(
        "__APPROVAL__", approval).replace("__PLAN__", plan)


def bootstrap(metadata, output):
    if metadata["watermark"] != 1502203 or metadata["current_count"] != 34386:
        raise ValueError("Archive metadata no longer matches approved scope")
    if len(metadata["routines"]) != 3:
        raise ValueError("Expected exactly three archived routines")
    text = """-- DISPOSABLE LOCAL RESTORE ONLY; never execute this in production.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE TABLE public.players(id bigint PRIMARY KEY);
INSERT INTO public.players(id)
SELECT DISTINCT local_player_id
FROM public.nba_player_game_observation_versions
WHERE local_player_id IS NOT NULL;
"""
    text += "\n".join(x.rstrip().rstrip(";") + ";" for x in metadata["routines"])
    text += "\nCREATE VIEW public.nba_player_game_observations AS " + metadata["view"].rstrip().rstrip(";") + ";\n"
    output.write_text(text)


def batches(manifest, output, approval):
    output.mkdir(parents=True, exist_ok=False)
    template = (HERE / "batch-template.sql").read_bytes()
    totals = {"keys": 0, "versions": 0, "retained": 0, "candidates": 0}
    receipt = []
    pending = []
    batch_number = 0
    previous_key = None
    candidate_file = (output / "candidate-ids.csv").open("w")
    retained_file = (output / "retained-ids.csv").open("w")

    def flush():
        nonlocal pending, batch_number
        if not pending:
            return
        batch_number += 1
        name = f"batch-{batch_number:04d}.sql"
        content = render(pending, 34386, approval)
        (output / name).write_text(content)
        receipt.append({"file": name, "keys": len(pending),
            "candidates": sum(len(k["observations"]) - 2 for k in pending),
            "sha256": hashlib.sha256(content.encode()).hexdigest()})
        pending = []

    with manifest.open() as source:
        for line in source:
            key = load(line)
            if key.get("eligible") is not True:
                raise ValueError("Ineligible history in restored archive; no release")
            first, last = key["first"], key["last"]
            identity = tuple(first[x] for x in ("provider", "provider_player_id", "provider_event_id"))
            if previous_key is not None and identity <= previous_key:
                raise ValueError("Manifest keys repeated/out of order")
            previous_key = identity
            if identity != tuple(last[x] for x in ("provider", "provider_player_id", "provider_event_id")):
                raise ValueError("Retained rows belong to different keys")
            ids = [x["id"] for x in key["observations"]]
            if len(ids) not in (43, 44) or len(set(ids)) != len(ids):
                raise ValueError("Unexpected version count or duplicate IDs")
            if min(ids) < 1 or max(ids) > 1502203 or first["id"] == last["id"]:
                raise ValueError("Unexpected ID bounds/retention")
            if first["id"] not in ids or last["id"] not in ids:
                raise ValueError("Retained boundary absent from observations")
            totals["keys"] += 1
            totals["versions"] += len(ids)
            totals["retained"] += 2
            totals["candidates"] += len(ids) - 2
            for identifier in ids:
                target = retained_file if identifier in (first["id"], last["id"]) else candidate_file
                target.write(f"{identifier}\n")
            pending.append(key)
            if (batch_number == 0 and len(pending) == 25) or len(pending) == 250:
                flush()
    flush()
    candidate_file.close()
    retained_file.close()
    if totals != {"keys": 34386, "versions": 1502003, "retained": 68772, "candidates": 1433231}:
        raise ValueError(f"Archive totals differ from completed audit: {totals}. Do not execute generated files.")
    with manifest.open("rb") as source:
        manifest_hash = hashlib.file_digest(source, "sha256").hexdigest()
    (output / "READY.json").write_text(json.dumps({"totals": totals, "batches": receipt,
        "approval": approval, "template_sha256": hashlib.sha256(template).hexdigest(),
        "manifest_sha256": manifest_hash}, indent=2))
    print(json.dumps({"totals": totals, "batches": batch_number, "approval": approval}))


def restores(source, output, approval):
    output.mkdir(parents=True, exist_ok=False)
    template = (HERE / "restore-template.sql").read_text()
    pending = []
    count = 0
    number = 0
    def flush():
        nonlocal pending, number
        if not pending:
            return
        number += 1
        value = encoded(pending)
        if "$restore$" in value or "$archived_rows$" in value:
            raise ValueError("Reserved SQL delimiter in archive")
        content = template.replace("__ROWS__", value).replace("__APPROVAL__", approval)
        (output / f"restore-{number:04d}.sql").write_text(content)
        pending = []
    with source.open() as file:
        for line in file:
            row = load(line)
            if not 1 <= row["id"] <= 1502203:
                raise ValueError("Unexpected archive ID")
            pending.append(row)
            count += 1
            if len(pending) == 1000:
                flush()
    flush()
    if count != 1433231:
        raise ValueError("Recovery source count differs from approved candidates; do not use output")
    (output / "READY.json").write_text(json.dumps({"rows": count, "approval": approval}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    boot = sub.add_parser("bootstrap")
    boot.add_argument("metadata", type=Path)
    boot.add_argument("output", type=Path)
    batch = sub.add_parser("batches")
    batch.add_argument("manifest", type=Path)
    batch.add_argument("output", type=Path)
    batch.add_argument("--approval", default="REVIEW_ONLY", choices=["REVIEW_ONLY", APPROVAL])
    restore = sub.add_parser("restores")
    restore.add_argument("source", type=Path)
    restore.add_argument("output", type=Path)
    restore.add_argument("--approval", default="REVIEW_ONLY", choices=["REVIEW_ONLY", APPROVAL])
    args = parser.parse_args()
    if args.command == "bootstrap":
        bootstrap(load(args.metadata.read_text()), args.output)
    elif args.command == "batches":
        batches(args.manifest, args.output, args.approval)
    else:
        restores(args.source, args.output, args.approval)


if __name__ == "__main__":
    main()
