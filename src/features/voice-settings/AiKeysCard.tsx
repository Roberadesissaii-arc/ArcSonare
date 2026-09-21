import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SettingsCard } from "../../components/settings/SettingsCard";

/**
 * Product defaults: OpenAI powers voice (Realtime); DeepSeek powers dashboard chat.
 * Keys live in Windows Credential Manager — never shown after save.
 */
export function AiKeysCard() {
  const [openaiOn, setOpenaiOn] = useState(false);
  const [deepseekOn, setDeepseekOn] = useState(false);
  const [openaiKey, setOpenaiKey] = useState("");
  const [deepseekKey, setDeepseekKey] = useState("");
  const [showOpenai, setShowOpenai] = useState(false);
  const [showDeepseek, setShowDeepseek] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const refresh = useCallback(() => {
    invoke<boolean>("has_provider_key", { provider: "openai" })
      .then(setOpenaiOn)
      .catch(() => setOpenaiOn(false));
    invoke<boolean>("has_provider_key", { provider: "deepseek" })
      .then(setDeepseekOn)
      .catch(() => setDeepseekOn(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = async (provider: "openai" | "deepseek", key: string) => {
    if (!key.trim()) return;
    setBusy(provider);
    setStatus(null);
    try {
      await invoke("set_provider_key", { provider, key: key.trim() });
      if (provider === "openai") setOpenaiKey("");
      else setDeepseekKey("");
      setStatus(
        provider === "openai"
          ? "OpenAI key saved — voice overlay (Realtime) is ready."
          : "DeepSeek key saved — dashboard chat is ready.",
      );
      refresh();
    } catch (err) {
      setStatus(typeof err === "string" ? err : "Could not store the key.");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (provider: "openai" | "deepseek") => {
    setBusy(`rm-${provider}`);
    setStatus(null);
    try {
      await invoke("delete_provider_key", { provider });
      setStatus(provider === "openai" ? "OpenAI key removed." : "DeepSeek key removed.");
      refresh();
    } catch (err) {
      setStatus(typeof err === "string" ? err : "Could not remove the key.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <SettingsCard
      title="AI keys"
      description="OpenAI Realtime runs the voice overlay. DeepSeek runs dashboard chat and tools. Save each key once."
    >
      <div className="ai-keys-grid">
        <div className="ai-key-block">
          <div className="ai-key-block-head">
            <div>
              <p className="ai-key-name">OpenAI</p>
              <p className="ai-key-role">Voice · Realtime speech</p>
            </div>
            <span className={`ai-key-status${openaiOn ? " is-on" : ""}`}>
              {openaiOn ? "Connected" : "Not set"}
            </span>
          </div>
          <div className="ai-key-row">
            <input
              type={showOpenai ? "text" : "password"}
              value={openaiKey}
              onChange={(e) => setOpenaiKey(e.target.value)}
              placeholder={openaiOn ? "Paste a new key to replace…" : "sk-…"}
              className="settings-input"
              autoComplete="off"
            />
            <button
              type="button"
              className="btn btn-small"
              onClick={() => setShowOpenai((v) => !v)}
            >
              {showOpenai ? "Hide" : "Show"}
            </button>
            <button
              type="button"
              className="btn btn-small"
              disabled={!openaiKey.trim() || busy === "openai"}
              onClick={() => void save("openai", openaiKey)}
            >
              {busy === "openai" ? "…" : openaiOn ? "Replace" : "Save"}
            </button>
            {openaiOn ? (
              <button
                type="button"
                className="btn btn-small"
                disabled={busy === "rm-openai"}
                onClick={() => void remove("openai")}
              >
                Remove
              </button>
            ) : null}
          </div>
          <p className="ai-key-hint">platform.openai.com → API keys</p>
        </div>

        <div className="ai-key-block">
          <div className="ai-key-block-head">
            <div>
              <p className="ai-key-name">DeepSeek</p>
              <p className="ai-key-role">Chat · tools & dashboard</p>
            </div>
            <span className={`ai-key-status${deepseekOn ? " is-on" : ""}`}>
              {deepseekOn ? "Connected" : "Not set"}
            </span>
          </div>
          <div className="ai-key-row">
            <input
              type={showDeepseek ? "text" : "password"}
              value={deepseekKey}
              onChange={(e) => setDeepseekKey(e.target.value)}
              placeholder={deepseekOn ? "Paste a new key to replace…" : "sk-…"}
              className="settings-input"
              autoComplete="off"
            />
            <button
              type="button"
              className="btn btn-small"
              onClick={() => setShowDeepseek((v) => !v)}
            >
              {showDeepseek ? "Hide" : "Show"}
            </button>
            <button
              type="button"
              className="btn btn-small"
              disabled={!deepseekKey.trim() || busy === "deepseek"}
              onClick={() => void save("deepseek", deepseekKey)}
            >
              {busy === "deepseek" ? "…" : deepseekOn ? "Replace" : "Save"}
            </button>
            {deepseekOn ? (
              <button
                type="button"
                className="btn btn-small"
                disabled={busy === "rm-deepseek"}
                onClick={() => void remove("deepseek")}
              >
                Remove
              </button>
            ) : null}
          </div>
          <p className="ai-key-hint">platform.deepseek.com → API keys</p>
        </div>
      </div>

      {status ? (
        <p className="ai-keys-status" role="status">
          {status}
        </p>
      ) : null}
    </SettingsCard>
  );
}
