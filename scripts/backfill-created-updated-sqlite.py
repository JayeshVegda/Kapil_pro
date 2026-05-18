#!/usr/bin/env python3
import sqlite3

DB_PATH = "/home/ubuntu/Kapil_pro/pb_data/data.db"


def backfill_table(conn: sqlite3.Connection, table: str):
    cur = conn.cursor()
    cur.execute(
        f"""
        UPDATE {table}
        SET
          created = CASE
            WHEN date IS NOT NULL AND date != '' THEN date
            ELSE COALESCE(created, '')
          END,
          updated = CASE
            WHEN date IS NOT NULL AND date != '' THEN date
            ELSE COALESCE(updated, '')
          END
        WHERE created IS NULL OR created = ''
        """
    )
    updated_rows = cur.rowcount
    cur.execute(
        f"SELECT COUNT(*) FROM {table} WHERE created IS NULL OR created = ''"
    )
    missing_created = cur.fetchone()[0]
    cur.execute(
        f"SELECT COUNT(*) FROM {table} WHERE updated IS NULL OR updated = ''"
    )
    missing_updated = cur.fetchone()[0]
    return updated_rows, missing_created, missing_updated


def main():
    conn = sqlite3.connect(DB_PATH)
    try:
        bills = backfill_table(conn, "bills")
        payments = backfill_table(conn, "payments")
        conn.commit()
        print(
            {
                "bills": {
                    "updated_rows": bills[0],
                    "missing_created": bills[1],
                    "missing_updated": bills[2],
                },
                "payments": {
                    "updated_rows": payments[0],
                    "missing_created": payments[1],
                    "missing_updated": payments[2],
                },
            }
        )
    finally:
        conn.close()


if __name__ == "__main__":
    main()
