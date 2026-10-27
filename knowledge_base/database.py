"""SQLite database and data model for the local knowledge base.

The knowledge base stores approved Repak documents, the passages (pieces of
text) inside them, and room for embeddings that a later group can add. The
database is a single file on the workstation, so no data leaves the premises.

This module only creates the database and offers small functions to add,
read, and delete documents and passages. Searching, loading real documents,
and computing embeddings are separate tasks for later.

See docs/knowledge-base-data-model.md for an explanation of every table.
"""

import os
import sqlite3
from datetime import date, datetime, timezone
from pathlib import Path


SCHEMA_VERSION = 1

SOURCE_TYPES = (
    "service_information_sheet",
    "repak_manual",
    "supplier_manual",
    "exported_report",
    "video_transcript",
    "synthetic_sample",
)

BLOCKED_SOURCE_TYPES = ("exported_report",)
SAMPLE_SOURCE_TYPE = "synthetic_sample"
SAMPLE_DOCUMENT_KEYS = (
    "name",
    "location",
    "status",
    "document_number",
    "version",
    "document_date",
    "language",
    "machine_types",
    "components",
    "passages",
)
DOCUMENT_STATUSES = ("concept", "final")
SUBJECT_TYPES = ("machine_type", "component")
KNOWLEDGE_BASE_FOLDER = Path(__file__).resolve().parent
DEFAULT_DATABASE_PATH = KNOWLEDGE_BASE_FOLDER / "data" / "knowledge_base.sqlite3"
DATABASE_PATH_VARIABLE = "KNOWLEDGE_BASE_PATH"


SCHEMA_VERSION_1 = """
BEGIN IMMEDIATE;

-- AUTOINCREMENT makes sure the id of a deleted row is never given to a new
-- row, so an id saved somewhere else can never point to a different document.
CREATE TABLE documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL CHECK (trim(name) <> ''),
    document_number TEXT,
    version TEXT,
    -- date() gives NULL for text that is not a date. "IS" (not "=") makes
    -- that comparison false instead of NULL, because a NULL check passes.
    document_date TEXT CHECK (
        document_date IS NULL OR date(document_date) IS document_date
    ),
    location TEXT NOT NULL CHECK (trim(location) <> ''),
    source_type TEXT NOT NULL CHECK (source_type IN (
        'service_information_sheet',
        'repak_manual',
        'supplier_manual',
        'exported_report',
        'video_transcript',
        'synthetic_sample'
    )),
    status TEXT NOT NULL CHECK (status IN ('concept', 'final')),
    language TEXT,
    added_at TEXT NOT NULL
);

CREATE TABLE document_subjects (
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    subject_type TEXT NOT NULL CHECK (subject_type IN ('machine_type', 'component')),
    value TEXT NOT NULL CHECK (trim(value) <> ''),
    PRIMARY KEY (document_id, subject_type, value)
);

-- Lets a later search filter quickly on a machine type or component.
CREATE INDEX document_subjects_by_value
    ON document_subjects (subject_type, value);

CREATE TABLE passages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    location_in_document TEXT NOT NULL CHECK (trim(location_in_document) <> ''),
    text TEXT NOT NULL CHECK (trim(text) <> ''),
    UNIQUE (document_id, position)
);

-- Full-text index for keyword search. It does not store its own copy of the
-- text; it reads the text from the passages table (an "external content"
-- table). The triggers below keep the index in step with the passages table.
CREATE VIRTUAL TABLE passages_fts USING fts5(
    text,
    content = 'passages',
    content_rowid = 'id'
);

CREATE TRIGGER passages_after_insert AFTER INSERT ON passages BEGIN
    INSERT INTO passages_fts (rowid, text) VALUES (new.id, new.text);
END;

CREATE TRIGGER passages_after_delete AFTER DELETE ON passages BEGIN
    INSERT INTO passages_fts (passages_fts, rowid, text)
        VALUES ('delete', old.id, old.text);
END;

CREATE TRIGGER passages_after_update AFTER UPDATE ON passages BEGIN
    INSERT INTO passages_fts (passages_fts, rowid, text)
        VALUES ('delete', old.id, old.text);
    INSERT INTO passages_fts (rowid, text) VALUES (new.id, new.text);
END;

-- Empty for now. Reserved for a local embedding model chosen by a later group.
-- The vector is stored as float32 numbers in little-endian byte order,
-- so it takes exactly 4 bytes per dimension.
CREATE TABLE passage_embeddings (
    passage_id INTEGER NOT NULL REFERENCES passages(id) ON DELETE CASCADE,
    model_name TEXT NOT NULL CHECK (trim(model_name) <> ''),
    dimensions INTEGER NOT NULL CHECK (dimensions > 0),
    vector BLOB NOT NULL CHECK (
        typeof(vector) = 'blob' AND length(vector) = dimensions * 4
    ),
    created_at TEXT NOT NULL,
    PRIMARY KEY (passage_id, model_name)
);

PRAGMA user_version = 1;

COMMIT;
"""


def get_database_path():
    """Return the path of the knowledge base database file.

    The KNOWLEDGE_BASE_PATH environment variable wins when it is set and not
    blank. Otherwise the default file inside knowledge_base/data/ is used.
    """
    configured_path = os.environ.get(DATABASE_PATH_VARIABLE)
    if configured_path is None:
        return DEFAULT_DATABASE_PATH

    configured_path = configured_path.strip()
    if configured_path == "":
        return DEFAULT_DATABASE_PATH

    return Path(configured_path)


def open_database(database_path=None):
    """Open the knowledge base and create the tables when the file is new.

    The caller is responsible for closing the returned connection.
    """
    if database_path is None:
        database_path = get_database_path()
    database_path = Path(database_path)

    database_path.parent.mkdir(parents=True, exist_ok=True)

    connection = sqlite3.connect(database_path)
    try:
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA secure_delete = ON")
        _prepare_schema(connection, database_path)
    except Exception:
        connection.close()
        raise

    return connection


def _prepare_schema(connection, database_path):
    """Create the schema for a new file, or check the version of an old one."""
    current_version = _read_schema_version(connection)

    if current_version > SCHEMA_VERSION:
        message = (
            "The knowledge base at "
            + str(database_path)
            + " uses schema version "
            + str(current_version)
            + ", but this program only understands version "
            + str(SCHEMA_VERSION)
            + ". It was probably made by a newer version of the program."
        )
        raise RuntimeError(message)

    if current_version == 0:
        _create_schema(connection)


def _read_schema_version(connection):
    """Read the schema version number stored in the database file."""
    row = connection.execute("PRAGMA user_version").fetchone()
    return row[0]


def _create_schema(connection):
    """Create every table in one transaction, so a failure leaves no half schema.

    Two programs may open the same new file at the same moment. The script
    starts with BEGIN IMMEDIATE, so only one of them can create the tables;
    the other waits and then fails with "table documents already exists".
    In that case the schema is already there and we can simply continue.
    """
    try:
        connection.executescript(SCHEMA_VERSION_1)
    except sqlite3.OperationalError:
        _rollback_if_open(connection)
        version_after_failure = _read_schema_version(connection)
        if version_after_failure == SCHEMA_VERSION:
            return
        raise
    except sqlite3.Error:
        _rollback_if_open(connection)
        raise


def _rollback_if_open(connection):
    """Undo an unfinished transaction, for example after a failed script."""
    if connection.in_transaction:
        connection.rollback()


def _current_utc_time():
    """Return the current UTC time as ISO 8601 text, for example 2026-10-22T09:30:00+00:00."""
    now = datetime.now(timezone.utc)
    return now.isoformat(timespec="seconds")


def _clean_text(value, field_name):
    """Strip surrounding spaces from a text value. None stays None."""
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(field_name + " must be text.")
    return value.strip()


def _require_text(value, field_name):
    """Return the stripped text, or raise ValueError when it is missing or blank."""
    cleaned_value = _clean_text(value, field_name)
    if cleaned_value is None or cleaned_value == "":
        raise ValueError(field_name + " must not be blank.")
    return cleaned_value


def _optional_text(value, field_name):
    """Return the stripped text, or None when the value is missing or blank."""
    cleaned_value = _clean_text(value, field_name)
    if cleaned_value is None:
        return None
    if cleaned_value == "":
        return None
    return cleaned_value


def _validate_choice(value, allowed_values, field_name):
    """Raise ValueError when the value is not one of the allowed values."""
    if value not in allowed_values:
        allowed_text = ", ".join(allowed_values)
        message = (
            field_name
            + " must be one of: "
            + allowed_text
            + " (got "
            + repr(value)
            + ")."
        )
        raise ValueError(message)
    return value


def _clean_document_date(document_date):
    """Return the date as YYYY-MM-DD text, or None when it is missing or blank.

    Accepts text such as "2026-09-15" or a datetime.date object.
    """
    if document_date is None:
        return None

    if isinstance(document_date, datetime):
        raise ValueError("document_date must be a date without a time.")
    if isinstance(document_date, date):
        return document_date.isoformat()

    if not isinstance(document_date, str):
        raise ValueError("document_date must be text in the form YYYY-MM-DD.")

    date_text = document_date.strip()
    if date_text == "":
        return None

    try:
        parsed_date = date.fromisoformat(date_text)
    except ValueError:
        message = (
            "document_date must be a valid date in the form YYYY-MM-DD (got "
            + repr(document_date)
            + ")."
        )
        raise ValueError(message)
    
    return parsed_date.isoformat()


def _clean_language(language):
    """Return a lower-case language code such as 'nl', or None when unknown."""
    cleaned_language = _optional_text(language, "language")
    if cleaned_language is None:
        return None
    return cleaned_language.lower()


def _clean_subject_values(values, field_name):
    """Return a list of stripped, non-blank, unique subject values."""
    cleaned_values = []
    if values is None:
        return cleaned_values

    if isinstance(values, str):
        raise ValueError(field_name + " must be a list of text values, not one text.")

    for value in values:
        cleaned_value = _optional_text(value, field_name)
        if cleaned_value is None:
            continue
        if cleaned_value in cleaned_values:
            continue
        cleaned_values.append(cleaned_value)

    return cleaned_values


def _insert_subjects(connection, document_id, subject_type, values):
    """Link a document to machine types or components."""
    for value in values:
        connection.execute(
            "INSERT OR IGNORE INTO document_subjects (document_id, subject_type, value) "
            "VALUES (?, ?, ?)",
            (document_id, subject_type, value),
        )


def _refuse_blocked_source_type(source_type):
    """Raise ValueError for source types that may not be loaded yet."""
    if source_type in BLOCKED_SOURCE_TYPES:
        message = (
            "source_type "
            + repr(source_type)
            + " is blocked: exported reports contain customer data; loading"
            + " them is blocked until retention and consent are decided."
        )
        raise ValueError(message)


def add_document(
    connection,
    name,
    location,
    source_type,
    status,
    document_number=None,
    version=None,
    document_date=None,
    language=None,
    machine_types=None,
    components=None,
):
    """Add a document with its machine types and components. Return the new id."""
    clean_document = _check_document(
        name,
        location,
        source_type,
        status,
        document_number,
        version,
        document_date,
        language,
        machine_types,
        components,
    )

    with connection:
        document_id = _insert_document(connection, clean_document)

    return document_id


def _check_document(
    name,
    location,
    source_type,
    status,
    document_number,
    version,
    document_date,
    language,
    machine_types,
    components,
):
    """Check and clean the fields of a new document. Return them as a dictionary.

    Raises ValueError when a value is missing or invalid. Nothing is written.
    """
    clean_document = {}
    clean_document["name"] = _require_text(name, "name")
    clean_document["location"] = _require_text(location, "location")
    _validate_choice(source_type, SOURCE_TYPES, "source_type")
    _refuse_blocked_source_type(source_type)
    _validate_choice(status, DOCUMENT_STATUSES, "status")
    clean_document["source_type"] = source_type
    clean_document["status"] = status
    clean_document["document_number"] = _optional_text(document_number, "document_number")
    clean_document["version"] = _optional_text(version, "version")
    clean_document["document_date"] = _clean_document_date(document_date)
    clean_document["language"] = _clean_language(language)
    clean_document["machine_types"] = _clean_subject_values(machine_types, "machine_types")
    clean_document["components"] = _clean_subject_values(components, "components")
    return clean_document


def _insert_document(connection, clean_document):
    """Write a checked document and its subjects. Return the new id.

    This does not commit. The caller must run it inside a "with connection:"
    block, so the caller decides which writes belong to one transaction.
    """
    added_at = _current_utc_time()
    cursor = connection.execute(
        "INSERT INTO documents (name, document_number, version, document_date, "
        "location, source_type, status, language, added_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            clean_document["name"],
            clean_document["document_number"],
            clean_document["version"],
            clean_document["document_date"],
            clean_document["location"],
            clean_document["source_type"],
            clean_document["status"],
            clean_document["language"],
            added_at,
        ),
    )
    document_id = cursor.lastrowid
    _insert_subjects(connection, document_id, "machine_type", clean_document["machine_types"])
    _insert_subjects(connection, document_id, "component", clean_document["components"])
    return document_id


def _validate_position(position):
    """Check that the position is a whole number of 0 or more."""
    if isinstance(position, bool) or not isinstance(position, int):
        raise ValueError("position must be a whole number.")
    if position < 0:
        raise ValueError("position must be 0 or higher (got " + str(position) + ").")
    return position


def add_passage(connection, document_id, position, location_in_document, text):
    """Add a passage (a piece of text) to a document. Return the new id.

    position is the order of the passage inside the document, starting at 0.
    location_in_document tells the reader where to look, for example 'page 12'.
    """
    clean_passage = _check_passage(position, location_in_document, text)

    with connection:
        passage_id = _insert_passage(connection, document_id, clean_passage)

    return passage_id


def _check_passage(position, location_in_document, text):
    """Check and clean the fields of a new passage. Return them as a dictionary.

    Raises ValueError when a value is missing or invalid. Nothing is written.
    """
    clean_passage = {}
    clean_passage["position"] = _validate_position(position)
    clean_passage["location_in_document"] = _require_text(
        location_in_document, "location_in_document"
    )
    clean_passage["text"] = _require_text(text, "text")
    return clean_passage


def _insert_passage(connection, document_id, clean_passage):
    """Write a checked passage. Return the new id.

    This does not commit. The caller must run it inside a "with connection:" block.
    """
    cursor = connection.execute(
        "INSERT INTO passages (document_id, position, location_in_document, text) "
        "VALUES (?, ?, ?, ?)",
        (
            document_id,
            clean_passage["position"],
            clean_passage["location_in_document"],
            clean_passage["text"],
        ),
    )
    return cursor.lastrowid


def replace_synthetic_samples(connection, documents):
    """Replace all synthetic sample documents with new ones, all or nothing."""
    if _is_autocommit(connection):
        message = (
            "replace_synthetic_samples needs a connection that is not in"
            " autocommit mode, otherwise loading cannot be all or nothing."
            " Use a connection from open_database."
        )
        raise ValueError(message)

    checked_samples = check_sample_documents(documents)

    removed_document_count = 0
    document_count = 0
    passage_count = 0

    with connection:
        cursor = connection.execute(
            "DELETE FROM documents WHERE source_type = ?",
            (SAMPLE_SOURCE_TYPE,),
        )
        removed_document_count = cursor.rowcount

        for checked_sample in checked_samples:
            document_id = _insert_document(connection, checked_sample["document"])
            document_count = document_count + 1
            for clean_passage in checked_sample["passages"]:
                _insert_passage(connection, document_id, clean_passage)
                passage_count = passage_count + 1

    summary = {}
    summary["removed_documents"] = removed_document_count
    summary["documents"] = document_count
    summary["passages"] = passage_count
    return summary


def _is_autocommit(connection):
    """Return True when the connection saves every statement on its own."""
    if connection.isolation_level is None:
        return True

    autocommit_setting = getattr(connection, "autocommit", False)
    if autocommit_setting is True:
        return True

    return False


def check_sample_documents(documents):
    """Check every sample document and passage without writing anything."""
    if documents is None or isinstance(documents, (str, dict)):
        raise ValueError("documents must be a list of dictionaries.")

    checked_samples = []
    index = 0
    for document in documents:
        label = _describe_sample_document(document, index)
        try:
            checked_sample = _check_one_sample_document(document)
        except ValueError as error:
            raise ValueError("Sample document " + label + ": " + str(error))
        checked_samples.append(checked_sample)
        index = index + 1

    return checked_samples


def _describe_sample_document(document, index):
    """Return a short name for a sample document to use in error messages."""
    if isinstance(document, dict):
        location = document.get("location")
        if isinstance(location, str) and location.strip() != "":
            return location.strip()
    return "number " + str(index + 1)


def _check_one_sample_document(document):
    """Check one sample document dictionary and its passages."""
    if not isinstance(document, dict):
        raise ValueError("each document must be a dictionary.")

    for key in document:
        if key not in SAMPLE_DOCUMENT_KEYS:
            raise ValueError("unknown key " + repr(key) + ".")

    clean_document = _check_document(
        document.get("name"),
        document.get("location"),
        SAMPLE_SOURCE_TYPE,
        document.get("status"),
        document.get("document_number"),
        document.get("version"),
        document.get("document_date"),
        document.get("language"),
        document.get("machine_types"),
        document.get("components"),
    )

    passages = document.get("passages")
    if passages is None:
        raise ValueError("passages is missing or None.")
    if isinstance(passages, (str, dict)):
        raise ValueError("passages must be a list of dictionaries.")

    clean_passages = []
    used_positions = []
    for passage in passages:
        if not isinstance(passage, dict):
            raise ValueError("each passage must be a dictionary.")
        clean_passage = _check_passage(
            passage.get("position"),
            passage.get("location_in_document"),
            passage.get("text"),
        )
        position = clean_passage["position"]
        if position in used_positions:
            raise ValueError("position " + str(position) + " is used twice.")
        used_positions.append(position)
        clean_passages.append(clean_passage)

    checked_sample = {}
    checked_sample["document"] = clean_document
    checked_sample["passages"] = clean_passages
    return checked_sample


def _read_subjects(connection, document_id):
    """Return two sorted lists: the machine types and the components of a document."""
    machine_types = []
    components = []
    rows = connection.execute(
        "SELECT subject_type, value FROM document_subjects "
        "WHERE document_id = ? ORDER BY value",
        (document_id,),
    ).fetchall()

    for row in rows:
        if row["subject_type"] == "machine_type":
            machine_types.append(row["value"])
        else:
            components.append(row["value"])

    return machine_types, components


def get_document(connection, document_id):
    """Return a document as a dictionary, or None when the id does not exist."""
    row = connection.execute(
        "SELECT id, name, document_number, version, document_date, location, "
        "source_type, status, language, added_at "
        "FROM documents WHERE id = ?",
        (document_id,),
    ).fetchone()

    if row is None:
        return None

    document = dict(row)
    machine_types, components = _read_subjects(connection, document_id)
    document["machine_types"] = machine_types
    document["components"] = components
    return document


def get_passages(connection, document_id):
    """Return the passages of a document as a list of dictionaries, in order."""
    rows = connection.execute(
        "SELECT id, document_id, position, location_in_document, text "
        "FROM passages WHERE document_id = ? ORDER BY position",
        (document_id,),
    ).fetchall()

    passages = []
    for row in rows:
        passages.append(dict(row))
    return passages


def delete_document(connection, document_id):
    """Delete a document. Return True when it existed, False otherwise.

    Its passages, subjects, embeddings, and search index entries are removed
    automatically by the foreign keys (ON DELETE CASCADE) and the triggers.
    """
    with connection:
        cursor = connection.execute(
            "DELETE FROM documents WHERE id = ?",
            (document_id,),
        )
        deleted_row_count = cursor.rowcount

    if deleted_row_count > 0:
        return True
    return False
