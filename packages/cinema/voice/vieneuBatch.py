"""Đọc nhiều câu bằng VieNeu-TTS trong một lần nạp mô hình.

stdin:  {"mode": "v3turbo", "items": [{"text": "...", "voice": "Thiện Minh", "out": "/abs/path.wav"}]}
stdout: một dòng JSON {"done": n} khi xong; lỗi in ra stderr và thoát mã 1.
"""

import json
import sys
import wave

import numpy as np
from vieneu import Vieneu


def main() -> None:
    jobs = json.load(sys.stdin)
    tts = Vieneu(mode=jobs.get("mode", "v3turbo"))
    for item in jobs["items"]:
        voice = item.get("voice") or None
        if voice and tts.resolve_voice_name(voice) is None:
            raise SystemExit(f"Giọng VieNeu không tồn tại: {voice}")
        audio = np.asarray(tts.infer(item["text"], voice=voice), dtype=np.float32).reshape(-1)
        pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype("<i2")
        with wave.open(item["out"], "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(int(tts.sample_rate))
            output.writeframes(pcm.tobytes())
        print(json.dumps({"written": item["out"]}), file=sys.stderr, flush=True)
    print(json.dumps({"done": len(jobs["items"])}), flush=True)


if __name__ == "__main__":
    main()
