import os
from contextlib import asynccontextmanager
from typing import Dict

from azure.cosmos import CosmosClient as SyncCosmosClient, PartitionKey
from azure.cosmos.aio import CosmosClient

from fastapi import FastAPI

USERS_CONTAINER = "users"
SUBMISSIONS_CONTAINER = "submissions"
TEMPLATES_CONTAINER = "templates"
DRAFTS_CONTAINER = "drafts"


def get_sync_database():
    # For standalone scripts (inspect_cosmos.py etc.) that aren't part of the
    # running app's request lifecycle, so can't hook into lifespan() below —
    # a plain sync client/database handle, one place for the env-var reads
    # and connection setup instead of each script duplicating them.
    client = SyncCosmosClient(
        url=os.environ["COSMOS_ENDPOINT"],
        credential=os.environ["COSMOS_KEY"],
    )
    return client.get_database_client(os.environ["COSMOS_DATABASE"])


async def _load_templates_cache(database) -> Dict[int, dict]:
    # Templates are static (4 rows, never written by the app at runtime) —
    # loaded once here rather than queried per-request, so
    # fetch_form_by_template_id-equivalent lookups are a dict lookup, not a
    # Cosmos round trip.
    container = database.get_container_client(TEMPLATES_CONTAINER)
    templates: Dict[int, dict] = {}
    async for item in container.read_all_items():
        templates[item["template_id"]] = item
    return templates


@asynccontextmanager
async def lifespan(app: FastAPI):
    client = CosmosClient(
        url=os.environ["COSMOS_ENDPOINT"],
        credential=os.environ["COSMOS_KEY"],
    )

    database = client.get_database_client(os.environ["COSMOS_DATABASE"])

    app.state.cosmos_client = client
    app.state.users_container = database.get_container_client(USERS_CONTAINER)
    app.state.submissions_container = database.get_container_client(SUBMISSIONS_CONTAINER)

    # Unlike the other containers above (provisioned ahead of time, just
    # referenced here), drafts is created on demand — it holds nothing but
    # disposable autosave data, so there's no migration/backup step that
    # needs to happen before it can exist. Same partition key as
    # submissions (/employee_email) since a draft is addressed exactly like
    # the submission it'll eventually become (see _resolve_target_employee
    # in main.py). Idempotent — safe to call on every startup.
    app.state.drafts_container = await database.create_container_if_not_exists(
        id=DRAFTS_CONTAINER, partition_key=PartitionKey(path="/employee_email")
    )

    # Load templates at startup
    app.state.templates_cache = await _load_templates_cache(database)

    yield

    await client.close()