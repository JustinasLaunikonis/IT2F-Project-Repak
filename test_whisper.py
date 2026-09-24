import os
import sys
import time
from pathlib import Path


site = Path(sys.prefix) / "Lib" / "site-packages" # gets the path to the site-packages directory of the current Python environment and adds Lib and site-packages to the path,
# which is where Python packages are typically installed. This is important for locating the necessary CUDA libraries that are required for GPU acceleration in deep learning tasks.

cuda_directories = [
    site / "nvidia" / "cublas" / "bin", # this one contains mathematical GPU libraries like cuBLAS, which is essential for many deep learning frameworks
    site / "nvidia" / "cudnn" / "bin", # this one contains the cuDNN library, which is a GPU-accelerated library for deep neural networks
    site / "nvidia" / "cuda_nvrtc" / "bin", # this one contains the NVIDIA Runtime Compilation library, which is used for compiling CUDA code at runtime
]

for directory in cuda_directories:
    if directory.exists():
        os.add_dll_directory(str(directory)) # Windows uses DLL files for shared libraries. CUDA consists of many DLL files.

        os.environ["PATH"] = (
            str(directory)
            + os.pathsep # this one automatically gives the correct separator for the current operating system.
            + os.environ.get("PATH", "") # Get the current PATH value. If it does not exist, use an empty string.
        )


cublas_file = site / "nvidia" / "cublas" / "bin" / "cublas64_12.dll"

print("Python:", sys.executable)
print("cuBLAS:", cublas_file)
print("cuBLAS exists:", cublas_file.exists())

from faster_whisper import WhisperModel
import ctranslate2

def get_whisper_device():
    try:
        if ctranslate2.get_cuda_device_count() > 0:
            return "cuda"
    except Exception as e:
        print(f"CUDA checks failed: {e}")
    return "cpu"

device = get_whisper_device()
if device == "cuda":
    compute_type = "float16"
else:
    compute_type = "int8"

model = WhisperModel(
    "large-v3",
    device=device,
    compute_type=compute_type,
)

def transcribe_audio(audio_path):

    print(f"Using device: {device}")
    print(f"Transcribing audio: {audio_path}")

    segments, info = model.transcribe(audio_path, beam_size=5)

    print(f"Detected language: {info.language}")
    print(f"Confidence: {info.language_probability:.2f}")

    for segment in segments:
        print(f"[{segment.start:.2f}s -> {segment.end:.2f}s] {segment.text}")

def generate_unique_filename(original_name):
    timestamp = int(time.time())
    name, ext = os.path.splitext(original_name)
    return f"{name}_{timestamp}{ext}"

if __name__ == "__main__":
    SAMPLE_AUDIO = r"F:\Uni\Documents\Sound Recordings\AudioTestOne.m4a" # you have to change this path to the location of your audio file, and make sure to use raw string notation (r"") to avoid issues with backslashes in Windows paths.

    if os.path.exists(SAMPLE_AUDIO):
        transcribe_audio(SAMPLE_AUDIO)
        print(f"\nSaved name example: {generate_unique_filename('repak_customer_call.mp3')}")
    else:
        print(f"Error: File not found: {SAMPLE_AUDIO}")