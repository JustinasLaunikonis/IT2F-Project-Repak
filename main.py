import logging
import os
import shutil
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Literal

import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from docx_generator.docx_generator import convert_json_to_docx
from transcript_to_json.report_extractor import extract_call_fields_from_transcript
from transcript_to_json.report_schema import empty_report, to_report_fields
from whisper_demo import transcribe_audio_segments
from speaker_transcript import merge_and_format_transcript


project_directory = Path(__file__).resolve().parent
static_directory = project_directory / "static"
home_page = static_directory / "index.html"
logger = logging.getLogger(__name__)

# Quen models that turn transcrpiton into JSON fields with estimated VRAM usage.
report_models = {
    "qwen3:0.6b": "~2 GB VRAM",
    "qwen3:1.7b": "~4 GB VRAM",
    "qwen3:4b": "~6 GB VRAM",
    "qwen3:8b": "~10 GB VRAM",
    "qwen3:14b": "~14 GB VRAM",
}

# Disable the generated API documentation so the page needs no external assets.
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

# Serve files in the static folder under /static.
app.mount("/static", StaticFiles(directory=static_directory), name="static")


@app.get("/")
def show_home_page():
    return FileResponse(home_page, media_type="text/html")


class DocxFileExportRequest(BaseModel):
    transcript: str


@app.post("/export")
def export_docx_file(request: DocxFileExportRequest):
    try:
        output_path = convert_json_to_docx(request.transcript)
    except Exception:
        raise HTTPException(status_code=500, detail="Document generation failed.")

    return FileResponse(
        path=output_path,
        filename=output_path.name,
        headers={"filename": output_path.name},
    )


def save_uploaded_wav(uploaded_file, destination):
    #check if the uploaded file is wav file
    if(
        not uploaded_file.filename
        or not uploaded_file.filename.lower().endswith(".wav")
    ):

        raise HTTPException(
            status_code=400,
            detail="Please upload WAV files.",
        )

    with open(destination, "wb") as saved_audio: #save uploaded recording temporarily
        shutil.copyfileobj(
            uploaded_file.file,
            saved_audio,
        )

    if destination.stat().st_size == 0: #dont accept empty recordings
        raise HTTPException(
            status_code=400,
            detail="An uploaded WAV file is empty.",
        )


def transcribe_saved_wav(audio_path, speaker):
    #turn whisper failures into a readable error for the browser
    try:
        return transcribe_audio_segments(str(audio_path))
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Transcribing the {speaker} recording failed: {error}",
        ) from error


@app.post("/transcribe")
def transcribe_uploaded_wav(
    harm: UploadFile = File(...),
    caller: UploadFile | None = File(None),
):
    #files inside this folder are removed automatically afterwards
    with TemporaryDirectory() as temporary_directory:
        temporary_path = Path(temporary_directory)

        harm_path = temporary_path / "harm.wav"

        save_uploaded_wav(
            harm,
            harm_path
        )

        #transcribe harm's mic recording
        harm_result = transcribe_saved_wav(harm_path, "microphone")
        harm_segments = harm_result["segments"]

        caller_segments = []

        #transcrive caller.wav if caller audio was recorded
        if caller is not None:
            caller_path = temporary_path / "caller.wav"

            save_uploaded_wav(
                caller,
                caller_path
            )

            caller_result = transcribe_saved_wav(caller_path, "caller")
            caller_segments = caller_result["segments"]

        #label speakers and put all segments in spoken order
        transcript_result = merge_and_format_transcript(
            harm_segments,
            caller_segments
        )
        transcript_result["transcription_info"] = {
            "Harm": {
                "model": harm_result["model"],
                "device": harm_result["device"],
            }
        }

        if caller is not None:
            transcript_result["transcription_info"]["Caller"] = {
                "model": caller_result["model"],
                "device": caller_result["device"],
            }

        return transcript_result


@app.get("/report-models")
def list_report_models():
    try:
        with httpx.Client(timeout=5.0, trust_env=False) as client:
            response = client.get("http://127.0.0.1:11434/api/tags")
            response.raise_for_status()
            installed = {model["name"] for model in response.json()["models"]}
    except Exception:
        installed = set()

    available = [name for name in report_models if name in installed]
    default = os.environ.get("REPORT_MODEL", "qwen3:4b")
    if default != "none" and default not in available:
        default = available[0] if available else "none"
    return {
        "models": [
            {"name": name, "memory": memory, "installed": name in installed}
            for name, memory in report_models.items()
        ],
        "default": default,
    }


class ExtractReportRequest(BaseModel):
    transcript: str = Field(min_length=1)
    model: Literal["qwen3:0.6b", "qwen3:1.7b", "qwen3:4b", "qwen3:8b", "qwen3:14b", "none"] | None = None


@app.post("/extract-report")
def convert_transcription_to_json_input(request: ExtractReportRequest):
    if not request.transcript.strip():
        raise HTTPException(status_code=422, detail="The transcript must not be blank.")

    report_fields = empty_report()
    warning = None
    mode = "llm"
    try:
        extracted_call_fields = extract_call_fields_from_transcript(request.transcript, request.model)
        report_fields = to_report_fields(extracted_call_fields)

    except Exception:
        logger.exception("Automatic filling failed")
        mode = "manual"
        warning = "Automatic filling is unavailable. Complete the remaining details manually."

    report_fields["[transcriptie]"] = request.transcript
    return {
        "fields": report_fields,
        "mode": mode,
        "warning": warning,
    }
