#!/usr/bin/env python3
"""
MeetMind AI — Legacy Meeting Ownership Migration Tool

Safely inspects and migrates legacy unowned Firestore meeting documents
created prior to Phase 11 multi-user authentication.

Usage:
  # 1. Inspect unowned legacy meetings (read-only audit):
  python backend/scripts/migrate_legacy_meetings.py --list

  # 2. Dry run migration for a specific target user UID:
  python backend/scripts/migrate_legacy_meetings.py --assign <TARGET_USER_UID> --dry-run

  # 3. Apply non-destructive migration to assign legacy records to an owner:
  python backend/scripts/migrate_legacy_meetings.py --assign <TARGET_USER_UID>

  # 4. Migrate a single specific meeting:
  python backend/scripts/migrate_legacy_meetings.py --meeting-id <MEETING_ID> --assign <TARGET_USER_UID>
"""

import os
import sys
import argparse
import logging
from datetime import datetime, timezone

# Add backend directory to sys.path
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.services.firebase_service import firebase_service
from app.core.config import settings

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("migrate-legacy-meetings")


def find_legacy_meetings(meeting_id_filter: str = None):
    """Finds all Firestore meeting records that have no owner_uid set."""
    if not firebase_service.is_configured():
        logger.error("Firebase is not configured. Please check backend/.env.")
        sys.exit(1)

    db = firebase_service.get_client()
    collection_name = settings.FIRESTORE_COLLECTION_MEETINGS
    coll_ref = db.collection(collection_name)

    legacy_docs = []

    if meeting_id_filter:
        doc_ref = coll_ref.document(meeting_id_filter)
        snap = doc_ref.get()
        if not snap.exists:
            logger.error(f"Meeting '{meeting_id_filter}' not found.")
            sys.exit(1)
        data = snap.to_dict() or {}
        if not data.get("owner_uid"):
            legacy_docs.append((snap.id, data))
        else:
            logger.info(f"Meeting '{snap.id}' already owned by UID: '{data.get('owner_uid')}'.")
    else:
        snapshots = coll_ref.stream()
        for doc in snapshots:
            data = doc.to_dict() or {}
            owner = data.get("owner_uid")
            if not owner or not str(owner).strip():
                legacy_docs.append((doc.id, data))

    return legacy_docs


def list_legacy_meetings(legacy_docs):
    """Prints a structured summary of unowned legacy meetings."""
    print(f"\nFound {len(legacy_docs)} unowned legacy meeting(s):\n" + "-" * 70)
    for doc_id, data in legacy_docs:
        title = data.get("title") or "(Untitled)"
        created = data.get("created_at") or "Unknown"
        print(f"ID: {doc_id:<28} | Created: {created[:19]:<19} | Title: {title[:20]}")
    print("-" * 70)


def migrate_meetings(legacy_docs, target_uid: str, dry_run: bool = False):
    """Assigns unowned documents to the specified owner_uid non-destructively."""
    if not legacy_docs:
        print("No legacy unowned meetings found to migrate.")
        return

    print(f"\nPreparing to assign {len(legacy_docs)} meeting(s) to owner UID: '{target_uid}'")
    if dry_run:
        print("[DRY RUN MODE] No changes will be written to Firestore.")

    db = firebase_service.get_client()
    collection_name = settings.FIRESTORE_COLLECTION_MEETINGS
    now_iso = datetime.now(timezone.utc).isoformat()

    success_count = 0
    for doc_id, data in legacy_docs:
        if dry_run:
            print(f"  [DRY-RUN] Would update {doc_id} -> owner_uid='{target_uid}'")
            success_count += 1
        else:
            try:
                doc_ref = db.collection(collection_name).document(doc_id)
                doc_ref.update({
                    "owner_uid": target_uid,
                    "updated_at": now_iso,
                    "_legacy_migrated_at": now_iso,
                })
                print(f"  [MIGRATED] Successfully assigned {doc_id} to '{target_uid}'")
                success_count += 1
            except Exception as e:
                logger.error(f"Failed to migrate {doc_id}: {e}")

    action = "simulated" if dry_run else "completed"
    print(f"\nMigration {action}: {success_count}/{len(legacy_docs)} records processed.\n")


def main():
    parser = argparse.ArgumentParser(
        description="MeetMind AI Legacy Meeting Migration Utility",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="List all unowned legacy meetings without making changes.",
    )
    parser.add_argument(
        "--assign",
        type=str,
        metavar="TARGET_UID",
        help="Target Firebase UID to assign unowned meetings to.",
    )
    parser.add_argument(
        "--meeting-id",
        type=str,
        help="Optional specific meeting ID to migrate (instead of all).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Simulate the migration without writing changes to Firestore.",
    )

    args = parser.parse_args()

    if not args.list and not args.assign:
        parser.print_help()
        sys.exit(1)

    legacy_docs = find_legacy_meetings(meeting_id_filter=args.meeting_id)

    if args.list:
        list_legacy_meetings(legacy_docs)
    elif args.assign:
        target_uid = args.assign.strip()
        if not target_uid:
            logger.error("Target UID cannot be empty.")
            sys.exit(1)
        migrate_meetings(legacy_docs, target_uid=target_uid, dry_run=args.dry_run)


if __name__ == "__main__":
    main()

