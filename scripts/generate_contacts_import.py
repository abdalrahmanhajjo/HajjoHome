#!/usr/bin/env python3
from __future__ import annotations

import csv
import re
from collections import OrderedDict
from datetime import date
from pathlib import Path

SOURCE = Path("/Users/abdalrahmanhajjo/Downloads/contacts.csv")
OUTPUT = Path(__file__).resolve().parents[1] / "db" / "import_contacts_2026-08-17.sql"


def clean(value: str | None) -> str:
    return re.sub(r"\s+", " ", (value or "").strip())


def normalized_phone(value: str | None) -> str:
    digits = re.sub(r"\D", "", value or "")
    if digits.startswith("00961"):
        digits = digits[5:]
    elif digits.startswith("961") and len(digits) >= 10:
        digits = digits[3:]
    digits = digits.lstrip("0")
    return f"+961{digits}" if digits else ""


def phone_values(row: dict[str, str]) -> list[str]:
    values: list[str] = []
    seen: set[str] = set()
    for column in ("Phone 1 - Value", "Phone 2 - Value"):
        for item in (row.get(column) or "").split(":::"):
            value = clean(item)
            key = normalized_phone(value)
            if value and key and key not in seen:
                values.append(value)
                seen.add(key)
    return values


def sql(value: str | None) -> str:
    if value is None or value == "":
        return "NULL"
    return "'" + value.replace("'", "''") + "'"


def first(*values: str) -> str:
    return next((clean(value) for value in values if clean(value)), "")


def contact_name(row: dict[str, str]) -> str:
    personal = clean(" ".join(filter(None, [
        clean(row.get("Name Prefix")),
        clean(row.get("First Name")),
        clean(row.get("Middle Name")),
        clean(row.get("Last Name")),
        clean(row.get("Name Suffix")),
    ])))
    return first(
        personal,
        row.get("Organization Name", ""),
        row.get("Nickname", ""),
        row.get("File As", ""),
        row.get("Phone 1 - Value", ""),
        row.get("Phone 2 - Value", ""),
        "Unnamed contact",
    )


def address(row: dict[str, str]) -> str:
    formatted = clean(row.get("Address 1 - Formatted"))
    if formatted:
        return formatted
    parts = [
        row.get("Address 1 - Street"),
        row.get("Address 1 - Extended Address"),
        row.get("Address 1 - PO Box"),
        row.get("Address 1 - City"),
        row.get("Address 1 - Region"),
        row.get("Address 1 - Postal Code"),
        row.get("Address 1 - Country"),
    ]
    return ", ".join(clean(part) for part in parts if clean(part))


def notes(row: dict[str, str], extra_phones: list[str]) -> str:
    fields = [
        ("Organization", row.get("Organization Name")),
        ("Job title", row.get("Organization Title")),
        ("Department", row.get("Organization Department")),
        ("Email", row.get("E-mail 1 - Value")),
        ("Birthday", row.get("Birthday")),
        ("Nickname", row.get("Nickname")),
        ("Labels", row.get("Labels")),
        ("Imported notes", row.get("Notes")),
        ("Additional phones", ", ".join(extra_phones)),
    ]
    return "\n".join(f"{label}: {clean(value)}" for label, value in fields if clean(value))


def mapped(row: dict[str, str], source_row: int) -> dict[str, str | int]:
    phones = phone_values(row)
    phone1 = phones[0] if phones else ""
    phone2 = phones[1] if len(phones) > 1 else ""
    return {
        "source_row": source_row,
        "full_name": contact_name(row),
        "phone_raw": phone1,
        "phone2_raw": phone2,
        "area": first(row.get("Address 1 - City", ""), row.get("Address 1 - Region", "")),
        "address": address(row),
        "notes": notes(row, phones[2:]),
        "phone_key": normalized_phone(phone1) or normalized_phone(phone2),
    }


def merge(left: dict[str, str | int], right: dict[str, str | int]) -> dict[str, str | int]:
    result = dict(left)
    for key in ("full_name", "phone_raw", "phone2_raw", "area", "address"):
        a, b = str(result[key]), str(right[key])
        if len(b) > len(a):
            result[key] = b
    note_parts = list(OrderedDict.fromkeys(
        part for part in (str(result["notes"]), str(right["notes"])) if part
    ))
    result["notes"] = "\n".join(note_parts)
    return result


def main() -> None:
    with SOURCE.open(newline="", encoding="utf-8-sig") as handle:
        rows = [mapped(row, index) for index, row in enumerate(csv.DictReader(handle), start=2)]

    consolidated: OrderedDict[str, dict[str, str | int]] = OrderedDict()
    for row in rows:
        phone_key = str(row["phone_key"])
        # Only phone matches are merged. Equal names with different phones remain separate customers.
        key = f"phone:{phone_key}" if phone_key else f"row:{row['source_row']}"
        consolidated[key] = merge(consolidated[key], row) if key in consolidated else row

    records = list(consolidated.values())
    values = []
    for row in records:
        values.append("    (" + ", ".join([
            str(row["source_row"]),
            sql(str(row["full_name"])),
            sql(str(row["phone_raw"])),
            sql(str(row["phone2_raw"])),
            sql(str(row["area"])),
            sql(str(row["address"])),
            sql(str(row["notes"])),
        ]) + ")")

    joined_values = ",\n".join(values)
    document = f"""-- Generated from {SOURCE.name} on {date.today().isoformat()}.
-- Source rows: {len(rows)}; import candidates after exact-phone consolidation: {len(records)}.
-- Safe to rerun: existing normalized phone matches are skipped. Contacts without a phone
-- are skipped only when the same case-insensitive name already exists.
-- This is deliberately one atomic statement so it works with pooled SQL connections.

with contacts_import_stage
  (source_row, full_name, phone_raw, phone2_raw, area, address, notes)
as (
  values
{joined_values}
),
inserted as (
  insert into customers
    (full_name, phone_raw, phone2_raw, area, address, notes)
  select
    s.full_name,
    nullif(btrim(s.phone_raw), ''),
    nullif(btrim(s.phone2_raw), ''),
    nullif(btrim(s.area), ''),
    nullif(btrim(s.address), ''),
    nullif(btrim(s.notes), '')
  from contacts_import_stage s
  where not exists (
    select 1
    from customers c
    where (
      normalize_phone(s.phone_raw) is not null
      and normalize_phone(s.phone_raw) in (c.phone, c.phone2)
    ) or (
      normalize_phone(s.phone2_raw) is not null
      and normalize_phone(s.phone2_raw) in (c.phone, c.phone2)
    ) or (
      normalize_phone(s.phone_raw) is null
      and normalize_phone(s.phone2_raw) is null
      and lower(btrim(c.full_name)) = lower(btrim(s.full_name))
    )
  )
  returning id
)
select count(*) as customers_inserted from inserted;
"""
    OUTPUT.write_text(document, encoding="utf-8")
    print(f"Wrote {OUTPUT}")
    print(f"Source rows: {len(rows)}")
    print(f"Consolidated records: {len(records)}")
    print(f"Exact-phone duplicates consolidated: {len(rows) - len(records)}")


if __name__ == "__main__":
    main()
