import argparse
import json
import sqlite3
import sys
from pathlib import Path

from knowledge_base import database
from knowledge_base.local_rag import ExtractiveAdviceGenerator, SqliteKeywordRetriever
from knowledge_base.rag import QUERY_FIELDS, RagService, build_request


class _SafeArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        raise ValueError("Invalid command-line arguments.")


def _parser():
    parser = _SafeArgumentParser(
        description="Offline keyword search with verbatim draft quotes. No model, saving, or export."
    )
    parser.add_argument("--review-confirmed", action="store_true", required=True,
                        help="Confirm an employee has reviewed the query fields.")
    for field_name in QUERY_FIELDS:
        option = "--" + field_name.replace("_", "-")
        parser.add_argument(option, default="")
    parser.add_argument("--max-results", type=int, default=5,
                        help="Maximum passages, from 1 to 20 (default: 5).")
    parser.add_argument("--database", type=Path, default=None,
                        help="Existing SQLite database; defaults to KNOWLEDGE_BASE_PATH or the configured local file.")
    return parser


def _open_read_only(database_path):
    """Never create a database or initialize a schema during a search."""
    uri = Path(database_path).resolve().as_uri() + "?mode=ro"
    connection = sqlite3.connect(uri, uri=True)
    try:
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA query_only = ON")
        version = connection.execute("PRAGMA user_version").fetchone()[0]
        if version != database.SCHEMA_VERSION:
            raise ValueError("Unsupported database schema.")
    except Exception:
        connection.close()
        raise
    return connection


def _unavailable():
    return {
        "status": "unavailable",
        "passages": [],
        "advice_steps": [],
        "uncertainties": [],
        "warnings": ["Local knowledge search could not run. Check reviewed query fields and the existing database."],
    }


def main(argument_list=None):
    try:
        arguments = _parser().parse_args(argument_list)
        fields = {}
        for field_name, placeholder in QUERY_FIELDS.items():
            fields[placeholder] = getattr(arguments, field_name)
        request = build_request(
            fields,
            review_confirmed=arguments.review_confirmed,
            max_results=arguments.max_results,
        )
    except ValueError:
        print(
            "Invalid query: explicit review confirmation, nonblank query fields, and a result limit from 1 to 20 are required.",
            file=sys.stderr,
        )
        return 2
    try:
        database_path = arguments.database
        if database_path is None:
            database_path = database.get_database_path()
        connection = _open_read_only(database_path)
        try:
            service = RagService(SqliteKeywordRetriever(connection), ExtractiveAdviceGenerator())
            result = service.run(request)
        finally:
            connection.close()
    except (ValueError, OSError, RuntimeError, sqlite3.Error):
        print(json.dumps(_unavailable()))
        return 1
    print(json.dumps(result))
    if result["status"] == "unavailable":
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
