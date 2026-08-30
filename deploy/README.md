
## 📋 Prerequisites & System Requirements

Running [llama.cpp](https://github.com/ggml-org/llama.cpp) requires zero heavy runtimes (like Python) for standalone inference. However, certain hardware parameters and build utilities must be present depending on your compilation route.

### 1. Hardware Benchmarks

*   **Memory:** Minimum **8 GB RAM** to run small quantized models (e.g., 7B-parameter models). Larger model tasks (e.g., 13B or 70B parameters) require 16 GB to 64 GB+ RAM.
*   **Storage:** 5 GB to 50 GB+ of free space on a fast **SSD** to accommodate localized model weight files (typically `.gguf` format).
*   **Processor:** Modern multi-core CPU featuring instruction set support for **AVX2**, **AVX512**, or ARM **NEON**.

### 2. Compilation Toolchain (Building from Source)

If you are cloning the source tree to compile optimized binaries natively, ensure the following core tools are installed:

*   **Git:** Version 2.0+ for codebase pulling and synchronization.
*   **CMake:** Version **3.18 or newer** (the legacy Makefile approach is officially deprecated).
*   **C++17 Compiler:**
    *   **Linux:** `gcc` (v10+) or `clang`.
    *   **macOS:** Xcode Command Line Tools (provides default apple-clang).
    *   **Windows:** Visual Studio Community (with the *"Desktop development with C++"* bundle) or `MinGW-w64`.

### 3. Hardware Acceleration Frameworks (Optional)

To leverage local GPU speeds rather than running purely on the CPU, ensure your device has the appropriate SDK bindings installed prior to running CMake:

| Hardware Engine | Platform Target | Required Underlying SDK / Runtime Driver |
| :--- | :--- | :--- |
| **NVIDIA CUDA** | Windows / Linux | [NVIDIA CUDA Toolkit](https://nvidia.com) (v11.8 or higher) |
| **Apple Silicon** | macOS | No external tools required (Leverages Native Metal API) |
| **AMD/Intel** | Windows / Linux | Vulkan SDK, AMD ROCm Engine, or Intel SYCL toolkit |

### 4. Optional Tooling (Model Script Utilities)

Python runtime libraries are **not required** to execute ready-made `.gguf` binaries. They are only needed if you intend to convert third-party pipeline layers (like Hugging Face `.safetensors`) locally:

