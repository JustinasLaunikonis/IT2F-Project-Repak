import logging
import math
import os
import shutil
import subprocess
import uuid
from pathlib import Path
from tempfile import TemporaryDirectory

import httpx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from docx_generator.docx_generator import convert_json_to_docx
from transcript_to_json.report_extractor import extract_call_fields_from_transcript
from transcript_to_json.report_schema import ReportModel, empty_report, to_report_fields
from speaker_transcript import merge_and_format_transcript
from live_transcription import SPEAKER_LABELS, LiveTranscriber


project_directory = Path(__file__).resolve().parent
static_directory = project_directory / "static"
home_page = static_directory / "index.html"
logger = logging.getLogger(__name__)

# Qwen models in size order, with labels and estimated VRAM usage in GB.
report_models = {
    "qwen3:1.7b": {"label": "1.7B (fastest)", "memory": 4},
    "qwen3:4b": {"label": "4B (detailed, slower)", "memory": 6},
    "qwen3:8b": {"label": "8B (larger, slower)", "memory": 10},
    "qwen3:14b": {"label": "14B (best, slowest)", "memory": 14},
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


live_transcriber = LiveTranscriber()


def recording_name(speaker_key):
    if speaker_key == "harm":
        return "microphone"
    else:
        return "caller"


def transcribe_saved_wav(audio_path, speaker_key, session_id):
    try:
        return live_transcriber.transcribe_chunk(
            audio_path,
            speaker_key,
            0,
            session_id,
            whole_recording=True,
        )
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Transcribing the {recording_name(speaker_key)} recording failed: {error}",
        ) from error


@app.post("/transcribe")
def transcribe_uploaded_wav(
    harm: UploadFile = File(...),
    caller: UploadFile | None = File(None),
):
    session_id = "upload-" + uuid.uuid4().hex

    try:
        return transcribe_upload_files(harm, caller, session_id)
    finally:
        live_transcriber.end_session(session_id)


def transcribe_upload_files(harm, caller, session_id):
    #files inside this folder are removed automatically afterwards
    with TemporaryDirectory() as temporary_directory:
        temporary_path = Path(temporary_directory)

        harm_path = temporary_path / "harm.wav"

        save_uploaded_wav(
            harm,
            harm_path
        )

        #transcribe harm's mic recording
        harm_result = transcribe_saved_wav(harm_path, "harm", session_id)
        harm_segments = harm_result["segments"]

        caller_segments = []

        if caller is not None:
            caller_path = temporary_path / "caller.wav"

            save_uploaded_wav(
                caller,
                caller_path
            )

            caller_result = transcribe_saved_wav(caller_path, "caller", session_id)
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


@app.post("/transcribe-chunk")
def transcribe_live_chunk(
    audio: UploadFile = File(...),
    speaker: str = Form(...),
    start_seconds: float = Form(...),
    session_id: str = Form(...),
):
    if speaker not in SPEAKER_LABELS:
        raise HTTPException(status_code=400, detail="Speaker must be harm or caller.")

    if not math.isfinite(start_seconds) or start_seconds < 0:
        raise HTTPException(status_code=400, detail="start_seconds must be zero or more.")

    if not session_id.strip() or len(session_id) > 100:
        raise HTTPException(status_code=400, detail="A valid session_id is required.")

    with TemporaryDirectory() as temporary_directory:
        chunk_path = Path(temporary_directory) / "chunk.wav"
        save_uploaded_wav(audio, chunk_path)

        source = "microphone" if speaker == "harm" else "caller"
        try:
            return live_transcriber.transcribe_chunk(chunk_path, speaker, start_seconds, session_id)
        except Exception as error:
            raise HTTPException(
                status_code=500,
                detail=f"Transcribing the {source} chunk failed: {error}",
            ) from error


class EndLiveSessionRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=100)


@app.post("/live/end")
def end_live_session(request: EndLiveSessionRequest):
    #safe to call more than once, unknown sessions are ignored
    live_transcriber.end_session(request.session_id)
    return {"ended": True}


def get_gpu_vram():
    try:
        output = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=memory.total", "--format=csv,noheader,nounits"],
            text=True,
            timeout=3,
        )
        return max(int(memory) for memory in output.split()) / 1024
    except Exception:
        return None


@app.get("/report-models")
def list_report_models():
    try:
        with httpx.Client(timeout=5.0, trust_env=False) as client:
            response = client.get("http://127.0.0.1:11434/api/tags")
            response.raise_for_status()
            installed = {model["name"] for model in response.json()["models"]}
    except Exception:
        installed = set()

    total_vram = get_gpu_vram()
    recommended = None
    models = []
    available = []
    for name, details in report_models.items():
        memory = details["memory"]
        models.append({
            "name": name,
            "label": details["label"],
            "memory": f"~{memory} GB VRAM",
            "installed": name in installed,
        })
        if name in installed:
            available.append(name)
        if total_vram and memory <= total_vram - 1:
            recommended = name

    if os.environ.get("REPORT_DEVICE") == "cpu":
        recommended = None

    default = os.environ.get("REPORT_MODEL", recommended or "qwen3:4b")
    if default != "none" and default not in available:
        default = available[0] if available else "none"
    return {
        "models": models,
        "default": default,
        "total_vram": total_vram,
        "recommended": recommended,
    }


@app.post("/report-models/download")
def download_report_model(model: str):
    if model not in report_models:
        raise HTTPException(status_code=400, detail="Unknown interpretation model.")
    subprocess.Popen(["ollama", "pull", model])
    return {"status": "started"}


class ExtractReportRequest(BaseModel):
    transcript: str = Field(min_length=1)
    model: ReportModel | None = None


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
