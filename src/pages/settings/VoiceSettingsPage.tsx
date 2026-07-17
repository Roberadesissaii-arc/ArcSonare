import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SettingRow } from "../../components/settings/SettingRow";
import { SettingsGroup } from "../../components/settings/SettingsGroup";
import { Toggle } from "../../components/settings/Toggle";
import { Dropdown } from "../../components/settings/Dropdown";
import { SegmentedControl } from "../../components/settings/SegmentedControl";
import { Slider } from "../../components/settings/Slider";
import { patchPrefs, usePrefs } from "../../stores/settingsStore";
import {
  listAudioDevices,
  microphonePermission,
  startLevelMeter,
  type AudioDevice,
  type LevelMeterHandle,
  type MicPermission,
} from "../../services/DeviceService";
import { AudioDeviceSelector } from "../../features/voice/AudioDeviceSelector";
import { VoiceLevelMeter } from "../../features/voice/VoiceLevelMeter";
import { VoiceSelector } from "../../features/voice/VoiceSelector";
import { wakeWordService } from "../../features/voice/WakeWordService";
import { playOutputTestTone } from "../../services/SoundService";
import type {
  FollowUpWindow,
  ResponseLength,
  SttEngine,
  TurnDetectionMode,
  VoiceActivationMode,
  WhisperModelSize,
} from "../../config/prefs";
import { speechRecognitionAvailable } from "../../services/SpeechRecognitionService";

const PERMISSION_TEXT: Record<MicPermission, string> = {
  granted: "Microphone permission: granted",
  denied: "Microphone permission: denied — enable it in Windows privacy settings",
  prompt: "Microphone permission: not requested yet",
  unknown: "Microphone permission: unknown",
};

export function VoiceSettingsPage() {
  const prefs = usePrefs();
  const voice = prefs.voice;
  const wake = prefs.wakeWord;

  const [inputs, setInputs] = useState<AudioDevice[]>([]);
  const [outputs, setOutputs] = useState<AudioDevice[]>([]);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [permission, setPermission] = useState<MicPermission>("unknown");
  const [level, setLevel] = useState<number | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const meterRef = useRef<LevelMeterHandle | null>(null);
  const [wakeTest, setWakeTest] = useState<string | null>(null);
  const wakeMeterRef = useRef<LevelMeterHandle | null>(null);
  const [wakeLevel, setWakeLevel] = useState<number | null>(null);

  const set = (patch: Partial<typeof voice>) => patchPrefs("voice", patch);
  const setWake = (patch: Partial<typeof wake>) => patchPrefs("wakeWord", patch);

  const refreshDevices = useCallback((requestPermission = false) => {
    setDeviceError(null);
    listAudioDevices({ requestPermission })
      .then((list) => {
        setInputs(list.inputs);
        setOutputs(list.outputs);
      })
      .catch((err) =>
        setDeviceError(err instanceof Error ? err.message : String(err)),
      );
    microphonePermission().then(setPermission).catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshDevices(false);
  }, [refreshDevices]);

  // Never leave a microphone running when the page unmounts.
  useEffect(
    () => () => {
      meterRef.current?.stop();
      wakeMeterRef.current?.stop();
    },
    [],
  );

  const stopMicTest = () => {
    meterRef.current?.stop();
    meterRef.current = null;
    setLevel(null);
  };

  const startMicTest = async () => {
    setMicError(null);
    try {
      meterRef.current = await startLevelMeter(
        voice.inputDeviceId,
        {
          noiseSuppression: voice.noiseSuppression,
          echoCancellation: voice.echoCancellation,
          autoGainControl: voice.autoGainControl,
        },
        setLevel,
      );
      // Labels become available after the first successful getUserMedia.
      refreshDevices(false);
    } catch (err) {
      setMicError(
        err instanceof Error
          ? err.message
          : "The microphone could not be opened.",
      );
      setLevel(null);
    }
  };

  const stopWakeTest = () => {
    wakeMeterRef.current?.stop();
    wakeMeterRef.current = null;
    setWakeLevel(null);
    setWakeTest(null);
  };

  const startWakeTest = async () => {
    setWakeTest("Opening microphone…");
    try {
      wakeMeterRef.current = await startLevelMeter(
        voice.inputDeviceId,
        {
          noiseSuppression: voice.noiseSuppression,
          echoCancellation: voice.echoCancellation,
          autoGainControl: voice.autoGainControl,
        },
        setWakeLevel,
      );
      setWakeTest(
        `Microphone is live. ${wakeWordService.statusText()} The phrase “${wake.phrase}” cannot be detected in this build.`,
      );
    } catch (err) {
      setWakeTest(
        err instanceof Error ? err.message : "The microphone could not be opened.",
      );
      setWakeLevel(null);
    }
  };

  const openWindowsMicSettings = () => {
    invoke("open_microphone_privacy_settings").catch((err) =>
      console.error("[ArcSonare] could not open Windows settings:", err),
    );
  };

  const micTesting = level !== null;
  const wakeTesting = wakeLevel !== null;

  return (
    <div className="page">
      <header className="page-header settings-page-header">
        <h1 className="page-title settings-page-title">Voice</h1>
        <p className="page-subtitle settings-page-subtitle">
          Input, output, voice character and turn detection. Speech models are
          configured under Models.
        </p>
      </header>

      <SettingsGroup title="Input">
        <SettingRow label="Microphone" description={PERMISSION_TEXT[permission]}>
          <AudioDeviceSelector
            devices={inputs}
            value={voice.inputDeviceId}
            onChange={(inputDeviceId) => set({ inputDeviceId })}
            onRefresh={() => refreshDevices(true)}
            ariaLabel="Input microphone"
            error={deviceError}
          />
        </SettingRow>
        <SettingRow
          label="Test microphone"
          description="Opens the selected microphone and shows its live level. The microphone is released when you stop."
        >
          <div className="mic-test">
            <VoiceLevelMeter level={level} />
            <button
              type="button"
              className="btn"
              onClick={micTesting ? stopMicTest : startMicTest}
            >
              {micTesting ? "Stop" : "Test"}
            </button>
          </div>
        </SettingRow>
        {micError ? (
          <p className="field-error" role="alert">
            {micError}
          </p>
        ) : null}
        <SettingRow label="Noise suppression">
          <Toggle
            checked={voice.noiseSuppression}
            onChange={(noiseSuppression) => set({ noiseSuppression })}
            label="Noise suppression"
          />
        </SettingRow>
        <SettingRow label="Echo cancellation">
          <Toggle
            checked={voice.echoCancellation}
            onChange={(echoCancellation) => set({ echoCancellation })}
            label="Echo cancellation"
          />
        </SettingRow>
        <SettingRow label="Automatic gain control">
          <Toggle
            checked={voice.autoGainControl}
            onChange={(autoGainControl) => set({ autoGainControl })}
            label="Automatic gain control"
          />
        </SettingRow>
        <SettingRow
          label="Background-noise filtering"
          description="Additional model-based filtering; applies once a speech provider is configured."
        >
          <Toggle
            checked={voice.backgroundFilter}
            onChange={(backgroundFilter) => set({ backgroundFilter })}
            label="Background-noise filtering"
          />
        </SettingRow>
        <SettingRow label="Input sensitivity">
          <Slider
            value={voice.inputSensitivity}
            min={0}
            max={100}
            onChange={(inputSensitivity) => set({ inputSensitivity })}
            label="Input sensitivity"
            format={(v) => `${v}%`}
          />
        </SettingRow>
        <SettingRow
          label="Windows microphone privacy"
          description="Manage which apps may use the microphone."
        >
          <button type="button" className="btn" onClick={openWindowsMicSettings}>
            Open Windows settings
          </button>
        </SettingRow>
        <SettingRow label="Activation mode" description="How voice capture starts and stops.">
          <SegmentedControl<VoiceActivationMode>
            options={[
              { value: "push-to-talk", label: "Push to talk" },
              { value: "toggle", label: "Toggle" },
              { value: "hands-free", label: "Hands-free" },
            ]}
            value={voice.activationMode}
            onChange={(activationMode) => set({ activationMode })}
            ariaLabel="Activation mode"
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Output">
        <SettingRow
          label="Speaker"
          description="Spoken responses use this output once speech generation is configured."
        >
          <AudioDeviceSelector
            devices={outputs}
            value={voice.outputDeviceId}
            onChange={(outputDeviceId) => set({ outputDeviceId })}
            onRefresh={() => refreshDevices(true)}
            ariaLabel="Output speaker"
          />
        </SettingRow>
        <SettingRow label="Output volume">
          <Slider
            value={voice.outputVolume}
            min={0}
            max={100}
            onChange={(outputVolume) => set({ outputVolume })}
            label="Output volume"
            format={(v) => `${v}%`}
          />
        </SettingRow>
        <SettingRow label="Test output" description="Plays a short tone on the system output.">
          <button
            type="button"
            className="btn"
            onClick={() => playOutputTestTone(voice.outputVolume)}
          >
            Play test tone
          </button>
        </SettingRow>
        <SettingRow label="Mute spoken responses">
          <Toggle
            checked={voice.muteResponses}
            onChange={(muteResponses) => set({ muteResponses })}
            label="Mute spoken responses"
          />
        </SettingRow>
        <SettingRow label="Duck other application audio while ArcSonare speaks">
          <Toggle
            checked={voice.duckOtherAudio}
            onChange={(duckOtherAudio) => set({ duckOtherAudio })}
            label="Duck other application audio"
          />
        </SettingRow>
        <SettingRow label="Stop speaking when you interrupt">
          <Toggle
            checked={voice.stopOnInterrupt}
            onChange={(stopOnInterrupt) => set({ stopOnInterrupt })}
            label="Stop speaking when interrupted"
          />
        </SettingRow>
        <SettingRow label="Use the system output as fallback">
          <Toggle
            checked={voice.systemOutputFallback}
            onChange={(systemOutputFallback) => set({ systemOutputFallback })}
            label="Use the system output as fallback"
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup
        title="Voice"
        description="Voice preview requires a configured speech provider. Configure a speech model under Models to enable previews."
      >
        <VoiceSelector
          value={voice.voiceId || "sonare"}
          onChange={(voiceId) => set({ voiceId })}
          providerConfigured={false}
          onPreview={() => undefined}
        />
        <SettingRow label="Speaking speed">
          <Slider
            value={voice.speakingSpeed}
            min={50}
            max={200}
            step={5}
            onChange={(speakingSpeed) => set({ speakingSpeed })}
            label="Speaking speed"
            format={(v) => `${v}%`}
          />
        </SettingRow>
        <SettingRow label="Pitch">
          <Slider
            value={voice.pitch}
            min={50}
            max={150}
            step={5}
            onChange={(pitch) => set({ pitch })}
            label="Pitch"
            format={(v) => `${v}%`}
          />
        </SettingRow>
        <SettingRow label="Expressiveness">
          <Slider
            value={voice.expressiveness}
            min={0}
            max={100}
            onChange={(expressiveness) => set({ expressiveness })}
            label="Expressiveness"
            format={(v) => `${v}%`}
          />
        </SettingRow>
        <SettingRow label="Response length">
          <SegmentedControl<ResponseLength>
            options={[
              { value: "brief", label: "Brief" },
              { value: "balanced", label: "Balanced" },
              { value: "detailed", label: "Detailed" },
            ]}
            value={voice.responseLength}
            onChange={(responseLength) => set({ responseLength })}
            ariaLabel="Response length"
          />
        </SettingRow>
        <SettingRow label="Allow interruption">
          <Toggle
            checked={voice.allowInterruption}
            onChange={(allowInterruption) => set({ allowInterruption })}
            label="Allow interruption"
          />
        </SettingRow>
        <SettingRow label="Speak confirmations">
          <Toggle
            checked={voice.speakConfirmations}
            onChange={(speakConfirmations) => set({ speakConfirmations })}
            label="Speak confirmations"
          />
        </SettingRow>
        <SettingRow label="Speak error messages">
          <Toggle
            checked={voice.speakErrors}
            onChange={(speakErrors) => set({ speakErrors })}
            label="Speak error messages"
          />
        </SettingRow>
        <SettingRow label="Speak task-completion messages">
          <Toggle
            checked={voice.speakTaskCompletions}
            onChange={(speakTaskCompletions) => set({ speakTaskCompletions })}
            label="Speak task-completion messages"
          />
        </SettingRow>
        <SettingRow
          label="Preview voice"
          description="Voice preview requires a configured speech provider."
        >
          <button type="button" className="btn" disabled>
            Preview voice
          </button>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup
        title="Speech to text"
        description="How ArcSonare turns what you say into commands. Local uses Whisper (openai/whisper). Cloud arrives later."
      >
        <SettingRow
          label="Recognition engine"
          description={
            voice.sttEngine === "local"
              ? "Whisper is selected for local recognition. Speak after activating voice — try “open Spotify”."
              : "Cloud speech-to-text is not connected in this build."
          }
        >
          <SegmentedControl<SttEngine>
            options={[
              { value: "local", label: "Local (Whisper)" },
              { value: "cloud", label: "Cloud" },
            ]}
            value={voice.sttEngine}
            onChange={(sttEngine) => set({ sttEngine })}
            ariaLabel="Speech-to-text engine"
          />
        </SettingRow>
        {voice.sttEngine === "local" ? (
          <SettingRow
            label="Whisper model"
            description="Smaller models are faster; larger models are more accurate. Offline weights ship with the Whisper runtime."
          >
            <Dropdown<WhisperModelSize>
              options={[
                { value: "tiny", label: "tiny — fastest" },
                { value: "base", label: "base — balanced" },
                { value: "small", label: "small" },
                { value: "medium", label: "medium" },
                { value: "turbo", label: "turbo — recommended" },
              ]}
              value={voice.whisperModel}
              onChange={(whisperModel) => set({ whisperModel })}
              ariaLabel="Whisper model"
            />
          </SettingRow>
        ) : null}
        <p className="field-help">
          {speechRecognitionAvailable()
            ? "Listening is active when you open voice. Final phrases run as ArcSonare commands."
            : "This WebView has no speech recognizer yet. The Whisper offline runtime will provide capture when bundled."}
        </p>
      </SettingsGroup>

      <SettingsGroup title="Turn detection">
        <SettingRow
          label="End-of-speech detection"
          description="Semantic turn detection requires a compatible realtime speech backend and is not active in this build."
        >
          <Dropdown<TurnDetectionMode>
            options={[
              { value: "push-release", label: "Push-to-talk release" },
              { value: "silence", label: "Automatic silence detection" },
              { value: "semantic", label: "Semantic (requires realtime backend)" },
            ]}
            value={voice.turnDetection}
            onChange={(turnDetection) => set({ turnDetection })}
            ariaLabel="End-of-speech detection"
          />
        </SettingRow>
        <SettingRow label="Silence duration">
          <Dropdown
            options={[
              { value: "400", label: "0.4 s — quick" },
              { value: "700", label: "0.7 s" },
              { value: "900", label: "0.9 s — default" },
              { value: "1200", label: "1.2 s" },
              { value: "1800", label: "1.8 s" },
              { value: "2500", label: "2.5 s — patient" },
            ]}
            value={String(voice.silenceDurationMs)}
            onChange={(v) => set({ silenceDurationMs: Number(v) })}
            ariaLabel="Silence duration"
          />
        </SettingRow>
        <SettingRow label="Interruption sensitivity">
          <SegmentedControl
            options={[
              { value: "25", label: "Low" },
              { value: "50", label: "Medium" },
              { value: "75", label: "High" },
            ]}
            value={
              voice.interruptionSensitivity <= 37
                ? "25"
                : voice.interruptionSensitivity >= 63
                  ? "75"
                  : "50"
            }
            onChange={(v) => set({ interruptionSensitivity: Number(v) })}
            ariaLabel="Interruption sensitivity"
          />
        </SettingRow>
        <SettingRow label="Minimum speech duration">
          <Dropdown
            options={[
              { value: "100", label: "100 ms" },
              { value: "300", label: "300 ms — default" },
              { value: "500", label: "500 ms" },
              { value: "800", label: "800 ms" },
              { value: "1200", label: "1.2 s" },
            ]}
            value={String(voice.minSpeechMs)}
            onChange={(v) => set({ minSpeechMs: Number(v) })}
            ariaLabel="Minimum speech duration"
          />
        </SettingRow>
        <SettingRow label="Cancel accidental activation">
          <Toggle
            checked={voice.cancelAccidental}
            onChange={(cancelAccidental) => set({ cancelAccidental })}
            label="Cancel accidental activation"
          />
        </SettingRow>
        <SettingRow label="Keep conversation open for follow-up">
          <Dropdown<FollowUpWindow>
            options={[
              { value: "off", label: "Off" },
              { value: "30s", label: "30 seconds" },
              { value: "1m", label: "1 minute" },
              { value: "2m", label: "2 minutes" },
              { value: "5m", label: "5 minutes" },
            ]}
            value={voice.followUpWindow}
            onChange={(followUpWindow) => set({ followUpWindow })}
            ariaLabel="Keep conversation open for follow-up"
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup
        title="Wake word"
        description={wakeWordService.statusText()}
      >
        <SettingRow
          label="Enable wake word"
          description="Disabled until a local wake-word engine is configured. The wake phrase is not active."
        >
          <Toggle
            checked={false}
            onChange={() => undefined}
            label="Enable wake word"
            disabled
          />
        </SettingRow>
        <SettingRow label="Wake phrase">
          <input
            type="text"
            className="text-input"
            value={wake.phrase}
            aria-label="Wake phrase"
            maxLength={40}
            onChange={(e) => setWake({ phrase: e.target.value })}
            onBlur={() => {
              if (!wake.phrase.trim()) setWake({ phrase: "Hey ArcSonare" });
            }}
          />
        </SettingRow>
        <SettingRow label="Wake-word sensitivity">
          <Slider
            value={wake.sensitivity}
            min={0}
            max={100}
            onChange={(sensitivity) => setWake({ sensitivity })}
            label="Wake-word sensitivity"
            format={(v) => `${v}%`}
          />
        </SettingRow>
        <SettingRow label="Listen after Windows startup">
          <Toggle
            checked={wake.listenAfterStartup}
            onChange={(listenAfterStartup) => setWake({ listenAfterStartup })}
            label="Listen after Windows startup"
          />
        </SettingRow>
        <SettingRow label="Pause wake word while ArcSonare is speaking">
          <Toggle
            checked={wake.pauseWhileSpeaking}
            onChange={(pauseWhileSpeaking) => setWake({ pauseWhileSpeaking })}
            label="Pause wake word while speaking"
          />
        </SettingRow>
        <SettingRow label="Pause wake word during calls or meetings">
          <Toggle
            checked={wake.pauseDuringCalls}
            onChange={(pauseDuringCalls) => setWake({ pauseDuringCalls })}
            label="Pause wake word during calls"
          />
        </SettingRow>
        <SettingRow label="Audible activation confirmation">
          <Toggle
            checked={wake.audibleConfirmation}
            onChange={(audibleConfirmation) => setWake({ audibleConfirmation })}
            label="Audible activation confirmation"
          />
        </SettingRow>
        <SettingRow label="Visual activation confirmation">
          <Toggle
            checked={wake.visualConfirmation}
            onChange={(visualConfirmation) => setWake({ visualConfirmation })}
            label="Visual activation confirmation"
          />
        </SettingRow>
        <SettingRow
          label="Require local wake-word processing"
          description="Wake-word audio stays on this computer."
        >
          <Toggle
            checked={wake.localOnly}
            onChange={(localOnly) => setWake({ localOnly })}
            label="Require local wake-word processing"
          />
        </SettingRow>
        <SettingRow label="Push-to-talk fallback">
          <Toggle
            checked={wake.pushToTalkFallback}
            onChange={(pushToTalkFallback) => setWake({ pushToTalkFallback })}
            label="Push-to-talk fallback"
          />
        </SettingRow>
        <SettingRow
          label="Test wake word"
          description="Shows the live microphone level. Detection itself requires the wake-word engine."
        >
          <div className="mic-test">
            <VoiceLevelMeter level={wakeLevel} />
            <button
              type="button"
              className="btn"
              onClick={wakeTesting ? stopWakeTest : startWakeTest}
            >
              {wakeTesting ? "Cancel" : "Test"}
            </button>
          </div>
        </SettingRow>
        {wakeTest ? (
          <p className="field-help" role="status">
            {wakeTest}
          </p>
        ) : null}
      </SettingsGroup>
    </div>
  );
}
