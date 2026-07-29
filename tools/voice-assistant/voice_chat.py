"""
ArcSonare development voice chat — DeepSeek + Pocket TTS (Jane).

Usage:
  set DEEPSEEK_API_KEY=your_key
  pip install -r requirements.txt
  python voice_chat.py

Do not hardcode API keys in this file.
"""
from __future__ import annotations

import os
import sys
import winsound

import scipy.io.wavfile
from openai import OpenAI
from pocket_tts import TTSModel

API_KEY = os.environ.get("DEEPSEEK_API_KEY", "").strip()
MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-v4-pro").strip()
VOICE = os.environ.get("POCKET_TTS_VOICE", "jane").strip()
TEMP_WAV = os.path.join(os.path.dirname(__file__), "_voice_chat_reply.wav")


def speak(tts_model: TTSModel, voice_state, text: str) -> None:
    audio = tts_model.generate_audio(voice_state, text)
    scipy.io.wavfile.write(TEMP_WAV, tts_model.sample_rate, audio.numpy())
    winsound.PlaySound(TEMP_WAV, winsound.SND_FILENAME)


def main() -> int:
    if not API_KEY:
        print(
            "Missing DEEPSEEK_API_KEY.\n"
            "  Windows PowerShell:  $env:DEEPSEEK_API_KEY = 'sk-...'\n"
            "  Then run:            python voice_chat.py",
            file=sys.stderr,
        )
        return 1

    client = OpenAI(api_key=API_KEY, base_url="https://api.deepseek.com")

    print("--- ArcSonare Voice Chat (dev) ---")
    print(f"Model: {MODEL} · Voice: {VOICE}")
    print("Loading Pocket TTS model...")
    tts_model = TTSModel.load_model()
    voice_state = tts_model.get_state_for_audio_prompt(VOICE)
    print("Ready. Type a message and press Enter. Type 'quit' or 'exit' to end.\n")

    messages = [
        {
            "role": "system",
            "content": (
                "You are a helpful, concise AI assistant chatting via voice. "
                "Keep responses short and conversational since they will be spoken aloud."
            ),
        }
    ]

    while True:
        try:
            user_input = input("You: ")
            if user_input.strip().lower() in {"quit", "exit"}:
                print("\nGoodbye!")
                break
            if not user_input.strip():
                continue

            messages.append({"role": "user", "content": user_input})
            response = client.chat.completions.create(model=MODEL, messages=messages)
            reply = response.choices[0].message.content or ""
            print(f"AI: {reply}\n")
            messages.append({"role": "assistant", "content": reply})
            speak(tts_model, voice_state, reply)
        except KeyboardInterrupt:
            print("\n\nGoodbye!")
            break
        except Exception as exc:  # noqa: BLE001 — keep chat loop alive while developing
            print(f"\nAn error occurred: {exc}\n")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
