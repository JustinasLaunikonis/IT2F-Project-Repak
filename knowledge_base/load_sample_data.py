"""Load the fictional sample documents into the local knowledge base.

The sample documents in knowledge_base/sample_data/ are written by the team.
They are fictional and contain no real customer data, so they can be used
for demonstrations and tests of a later search (RAG) feature.

This loader is ONLY for those fictional samples. It always stores every
document with source_type "synthetic_sample", whatever the file says. Never
use it to load real Repak documents, supplier manuals, or anything that
contains customer data.

Run it from the project folder:

    python -m knowledge_base.load_sample_data
    python -m knowledge_base.load_sample_data --database path/to/other.sqlite3

Loading again replaces the earlier samples instead of adding them twice.
See knowledge_base/sample_data/README.md for the file format.
"""

import argparse
import sqlite3
import sys
from pathlib import Path

from knowledge_base import database


SAMPLE_DATA_FOLDER = database.KNOWLEDGE_BASE_FOLDER / "sample_data"
PROJECT_FOLDER = database.KNOWLEDGE_BASE_FOLDER.parent

IGNORED_FILE_NAMES = ("readme.md",)

HEADER_END_LINE = "---"
HEADING_START = "## "
LIST_SEPARATOR = ";"

REQUIRED_HEADER_KEYS = (
    "name",
    "document_number",
    "version",
    "document_date",
    "status",
    "language",
)
LIST_HEADER_KEYS = ("machine_types", "components")

MAX_PASSAGE_CHARACTERS = 1500


def make_location(file_path):
    """Return the location to store for a sample file.

    For a file inside the project this is the path relative to the project
    folder with forward slashes, for example
    knowledge_base/sample_data/syn-sis-001-conveyor-runs-backwards.md.
    For a file outside the project only the file name is used, so a full
    path with a user name is never stored.
    """
    full_path = Path(file_path).resolve()
    try:
        relative_path = full_path.relative_to(PROJECT_FOLDER)
    except ValueError:
        return full_path.name
    return relative_path.as_posix()


def parse_sample_file(file_path):
    """Read one sample file and return it as a document dictionary.

    The dictionary has the keys that database.replace_synthetic_samples
    expects, including a "passages" list. Raises ValueError, with the file
    location in the message, when the file does not follow the format.
    """
    file_path = Path(file_path)
    label = make_location(file_path)

    try:
        file_text = file_path.read_text(encoding="utf-8-sig")
    except UnicodeDecodeError:
        raise ValueError(label + ": the file is not valid UTF-8 text.")

    lines = file_text.splitlines()
    header, body_start_index = _parse_header(lines, label)

    body_lines = []
    line_index = body_start_index
    while line_index < len(lines):
        body_lines.append(lines[line_index])
        line_index = line_index + 1

    first_body_line_number = body_start_index + 1
    passages = _parse_passages(body_lines, first_body_line_number, label)

    document = {}
    document["name"] = header["name"]
    document["document_number"] = header["document_number"]
    document["version"] = header["version"]
    document["document_date"] = header["document_date"]
    document["status"] = header["status"]
    document["language"] = header["language"]
    document["machine_types"] = header["machine_types"]
    document["components"] = header["components"]
    document["location"] = label
    document["passages"] = passages
    return document


def _parse_header(lines, label):
    """Read the "key: value" lines at the top of a file, up to the "---" line.

    Return the header as a dictionary and the index of the first line after
    "---". Blank lines in the header are skipped.
    """
    header = {}
    line_index = 0

    while line_index < len(lines):
        line = lines[line_index]
        line_number = line_index + 1
        stripped_line = line.strip()
        line_index = line_index + 1

        if stripped_line == HEADER_END_LINE:
            _check_required_header_keys(header, label)
            _add_missing_list_keys(header)
            return header, line_index

        if stripped_line == "":
            continue

        key, value = _parse_header_line(stripped_line, label, line_number)
        if key in header:
            message = (
                label
                + " line "
                + str(line_number)
                + ": the header key "
                + repr(key)
                + " appears twice."
            )
            raise ValueError(message)

        if key in LIST_HEADER_KEYS:
            header[key] = _split_list(value)
        else:
            header[key] = value

    message = (
        label
        + ": the header must end with a line that contains only "
        + repr(HEADER_END_LINE)
        + "."
    )
    raise ValueError(message)


def _parse_header_line(stripped_line, label, line_number):
    """Split one header line such as "status: final" into key and value.

    Error messages give the file and line number but never repeat the text
    of the line, so file content does not end up in logs or the console.
    """
    if ":" not in stripped_line:
        message = (
            label
            + " line "
            + str(line_number)
            + ": expected a header line in the form 'key: value'."
        )
        raise ValueError(message)

    parts = stripped_line.split(":", 1)
    key = parts[0].strip()
    value = parts[1].strip()

    allowed_keys = REQUIRED_HEADER_KEYS + LIST_HEADER_KEYS
    if key not in allowed_keys:
        message = (
            label
            + " line "
            + str(line_number)
            + ": unknown header key. Allowed keys are: "
            + ", ".join(allowed_keys)
            + "."
        )
        raise ValueError(message)

    if key in REQUIRED_HEADER_KEYS and value == "":
        message = (
            label
            + " line "
            + str(line_number)
            + ": the header key "
            + repr(key)
            + " must have a value."
        )
        raise ValueError(message)

    return key, value


def _check_required_header_keys(header, label):
    """Raise ValueError that lists every required header key that is missing."""
    missing_keys = []
    for key in REQUIRED_HEADER_KEYS:
        if key not in header:
            missing_keys.append(key)

    if len(missing_keys) > 0:
        message = (
            label
            + ": the header is missing these keys: "
            + ", ".join(missing_keys)
            + "."
        )
        raise ValueError(message)


def _add_missing_list_keys(header):
    """Give the optional list keys an empty list when the file leaves them out."""
    for key in LIST_HEADER_KEYS:
        if key not in header:
            header[key] = []


def _split_list(value):
    """Split "a; b; c" into ["a", "b", "c"]. Blank items are left out."""
    items = []
    for part in value.split(LIST_SEPARATOR):
        item = part.strip()
        if item != "":
            items.append(item)
    return items


def _read_heading(line):
    """Return the heading text of a "## " line, "" for an empty heading, or None.

    None means the line is not a heading but normal text.
    """
    stripped_line = line.rstrip()
    if stripped_line == "##":
        return ""
    if stripped_line.startswith(HEADING_START):
        heading_text = stripped_line[len(HEADING_START):]
        return heading_text.strip()
    return None


def _parse_passages(body_lines, first_line_number, label):
    """Turn the lines after the header into passages, one per "## " section."""
    passages = []
    current_heading = None
    current_heading_line_number = 0
    current_lines = []
    line_number = first_line_number

    for line in body_lines:
        heading = _read_heading(line)

        if heading is not None:
            if heading == "":
                message = (
                    label
                    + " line "
                    + str(line_number)
                    + ": a '## ' heading must have text after it."
                )
                raise ValueError(message)
            if current_heading is not None:
                _finish_passage(
                    passages,
                    current_heading,
                    current_heading_line_number,
                    current_lines,
                    label,
                )
            current_heading = heading
            current_heading_line_number = line_number
            current_lines = []
        elif current_heading is None:
            if line.strip() != "":
                message = (
                    label
                    + " line "
                    + str(line_number)
                    + ": text before the first '## ' heading. Every piece of"
                    + " text must belong to a section."
                )
                raise ValueError(message)
        else:
            current_lines.append(line)

        line_number = line_number + 1

    if current_heading is not None:
        _finish_passage(
            passages,
            current_heading,
            current_heading_line_number,
            current_lines,
            label,
        )

    if len(passages) == 0:
        message = (
            label
            + ": the file has no passages. Add at least one '## ' section"
            + " after the '---' line."
        )
        raise ValueError(message)

    return passages


def _finish_passage(passages, heading, heading_line_number, lines, label):
    """Check one finished section and add it to the passages list.

    Error messages point to the line of the "## " heading instead of
    repeating the heading text.
    """
    text = _join_passage_lines(lines)

    if text == "":
        message = (
            label
            + " line "
            + str(heading_line_number)
            + ": the section that starts here has no text."
        )
        raise ValueError(message)

    if len(text) > MAX_PASSAGE_CHARACTERS:
        message = (
            label
            + " line "
            + str(heading_line_number)
            + ": the section that starts here has "
            + str(len(text))
            + " characters. The limit is "
            + str(MAX_PASSAGE_CHARACTERS)
            + "; split it into more '## ' sections."
        )
        raise ValueError(message)

    passage = {}
    passage["position"] = len(passages)
    passage["location_in_document"] = heading
    passage["text"] = text
    passages.append(passage)


def _join_passage_lines(lines):
    """Join the lines of one section into one text.

    Spaces at the end of a line are removed. Blank lines at the start and
    the end of the section are dropped, and several blank lines in a row
    become one blank line, which marks a new paragraph. The other lines are
    kept as they are, so lists stay readable.
    """
    kept_lines = []
    previous_line_was_blank = True

    for line in lines:
        clean_line = line.rstrip()
        if clean_line == "":
            if not previous_line_was_blank:
                kept_lines.append("")
            previous_line_was_blank = True
        else:
            kept_lines.append(clean_line)
            previous_line_was_blank = False

    if len(kept_lines) > 0:
        last_index = len(kept_lines) - 1
        if kept_lines[last_index] == "":
            kept_lines.pop()

    return "\n".join(kept_lines)


def find_sample_files(folder):
    """Return the sample files in a folder, sorted by file name.

    Every ".md" file is a sample file, except README.md. Sub-folders are not
    searched. The sorted order makes the documents load in the same order
    every time.

    A symbolic link raises ValueError instead of being skipped: a link could
    point to a real document outside the folder, and skipping it silently
    would hide the problem.
    """
    folder = Path(folder)
    if not folder.is_dir():
        raise ValueError("The sample data folder does not exist: " + str(folder))

    sample_files = []
    for path in folder.iterdir():
        if path.is_symlink():
            message = (
                path.name
                + ": is a symbolic link. Sample files must be ordinary files"
                + " inside the sample data folder."
            )
            raise ValueError(message)
        if not path.is_file():
            continue
        if path.suffix.lower() != ".md":
            continue
        if path.name.lower() in IGNORED_FILE_NAMES:
            continue
        sample_files.append(path)

    sample_files.sort(key=_file_name_for_sorting)
    return sample_files


def _file_name_for_sorting(path):
    """Return the lower-case file name, used to sort the sample files."""
    return path.name.lower()


def parse_sample_folder(folder=None):
    """Read and check every sample file in a folder before anything is loaded.

    Return a list of document dictionaries. Raises ValueError when a file is
    broken, when the folder has no sample files, or when two files use the
    same document_number.

    The folder parameter exists for tests. It must only point to a folder
    with fictional sample files, never to real documents.
    """
    if folder is None:
        folder = SAMPLE_DATA_FOLDER

    sample_files = find_sample_files(folder)
    if len(sample_files) == 0:
        raise ValueError("No sample files (*.md) were found in " + str(folder))

    documents = []
    for sample_file in sample_files:
        document = parse_sample_file(sample_file)
        _refuse_duplicate_number(documents, document)
        documents.append(document)

    return documents


def _refuse_duplicate_number(documents, new_document):
    """Raise ValueError when another file already uses the same document_number."""
    for document in documents:
        if document["document_number"] == new_document["document_number"]:
            message = (
                new_document["location"]
                + ": uses the same document_number as "
                + document["location"]
                + "."
            )
            raise ValueError(message)


def load_sample_data(connection, folder=None):
    """Read every sample file in the folder and load it into the database.

    All files are checked first; nothing is written when one of them is
    broken. Then everything happens in one transaction: either all samples
    are replaced, or the database stays exactly as it was. Documents that
    are not synthetic samples are never touched.

    The folder parameter exists for tests. It must only point to a folder
    with fictional sample files, never to real documents.

    Return a dictionary with the counts "removed_documents", "documents",
    and "passages".
    """
    documents = parse_sample_folder(folder)
    return database.replace_synthetic_samples(connection, documents)


def _print_summary(summary, database_path):
    """Print how many documents and passages were loaded. Never prints passage text."""
    print(
        "Loaded "
        + str(summary["documents"])
        + " sample documents with "
        + str(summary["passages"])
        + " passages into "
        + str(database_path)
        + "."
    )
    print(
        "Replaced "
        + str(summary["removed_documents"])
        + " earlier sample documents. Other documents were not changed."
    )


def main(argument_list=None):
    """Command line entry point. Return 0 on success and 1 on an error."""
    parser = argparse.ArgumentParser(
        description=(
            "Load the fictional sample documents into the local knowledge base."
            " Running it again replaces the earlier samples."
        )
    )
    parser.add_argument(
        "--database",
        type=Path,
        default=None,
        help=(
            "Database file to load into. Default: the KNOWLEDGE_BASE_PATH"
            " environment variable, or knowledge_base/data/knowledge_base.sqlite3."
        ),
    )
    arguments = parser.parse_args(argument_list)

    database_path = arguments.database
    if database_path is None:
        database_path = database.get_database_path()

    try:
        documents = parse_sample_folder(SAMPLE_DATA_FOLDER)
        database.check_sample_documents(documents)

        connection = database.open_database(database_path)
        try:
            summary = database.replace_synthetic_samples(connection, documents)
        finally:
            connection.close()
    except (ValueError, OSError, RuntimeError, sqlite3.Error) as error:
        print("Could not load the sample data: " + str(error), file=sys.stderr)
        return 1

    _print_summary(summary, database_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
