# Dev Voice Assistant (DeepSeek + Pocket TTS)

Standalone Python chat that matches the early ArcSonare voice prototype:

- **Chat:** DeepSeek (`deepseek-v4-pro` by default)
- **Speak:** Kyutai Pocket TTS with the **jane** voice

## Setup

```powershell
cd tools\voice-assistant
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:DEEPSEEK_API_KEY = "sk-..."   # from https://platform.deepseek.com
python voice_chat.py
```

Optional env vars:

- `DEEPSEEK_MODEL` — default `deepseek-v4-pro`
- `POCKET_TTS_VOICE` — default `jane`

## In-app Voice Lab

**Settings → Voice Lab** speaks text with Pocket TTS only — no AI model required.

ArcSonare installs Pocket TTS automatically with **pip** into a private venv under
app data (`voice/pocket-tts`) and starts `pocket-tts serve` for you. You do **not**
need `uvx` or a manual terminal command.

Requires **Python 3.10–3.14** on PATH the first time (so pip can create the venv).
After that, ArcSonare reuses its managed environment.

Robotic Windows/system speech is not used for Voice Lab.

## Security

Never commit API keys. If a key was pasted into chat or source, rotate it in the DeepSeek console.
