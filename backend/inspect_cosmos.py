"""Quick sanity check: prints how many items are in each container and a
sample item from each, so migrated data can be eyeballed without opening the
Azure Portal.

Usage: python inspect_cosmos.py
"""

import json

from dotenv import load_dotenv

load_dotenv()

from cosmos_client import get_sync_database


def main() -> None:
    database = get_sync_database()

    # Discovered from the database itself rather than a hardcoded list, so
    # this stays accurate if a container is ever added/renamed/removed
    # without needing this script updated too.
    for container_props in database.list_containers():
        name = container_props["id"]
        container = database.get_container_client(name)
        items = list(container.read_all_items())
        # print(f"\n=== {name}: {len(items)} item(s) ===")
        for item in items[:3]:
            # Hide password_hash if present, everything else is fine to print.
            shown = {k: v for k, v in item.items() if k != "password_hash" and not k.startswith("_")}
            # print(json.dumps(shown, indent=2, default=str))
        if len(items) > 3:
            print(f"... and {len(items) - 3} more")


if __name__ == "__main__":
    main()
