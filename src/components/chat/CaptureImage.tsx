import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * Renders a screenshot the assistant just took.
 *
 * Without this the reply said "Here's the screenshot." and showed nothing —
 * a claim the assistant could not back up. If the image cannot be loaded the
 * failure is stated plainly rather than left as an empty space.
 */
export function CaptureImage({ captureId }: { captureId: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDataUrl(null);
    setFailed(false);
    void invoke<string>("get_capture_data_url", {
      id: captureId,
      annotated: false,
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch((err) => {
        console.error("[ArcSonare] could not load capture:", err);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [captureId]);

  if (failed) {
    return (
      <p className="chat-capture-failed">
        The screenshot was taken but could not be loaded for preview.
      </p>
    );
  }
  if (!dataUrl) {
    return <div className="chat-capture-loading" aria-label="Loading screenshot" />;
  }
  return (
    <figure className="chat-capture">
      <img src={dataUrl} alt="Screenshot" />
    </figure>
  );
}
