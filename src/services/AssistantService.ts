/**
 * Routes dashboard/typed chat. Product default: DeepSeek.
 * Voice overlay uses OpenAI Realtime separately (not this route).
 */
import { modelById } from "../config/modelRegistry";
import { getPrefs } from "../stores/settingsStore";
import { deepseekChat } from "./DeepSeekService";
import { geminiChat } from "./GeminiService";
import type { ChatMessage } from "./chatTypes";
import {
  assistantSystemContext,
} from "./assistantTools";
import { handleOrchestratedRequest } from "../features/orchestration/IntentOrchestrator";
import { stripTrailingFiller } from "./stripFiller";
import { guardVisibleText } from "../features/capabilities/toolProtocolGuard";
import { navigate } from "../stores/appStore";
import { setVoiceStatus } from "../stores/voiceStore";
import {
  getOverlayState,
  setOverlayMode,
} from "../features/top-overlay/overlayStore";
import { invoke } from "@tauri-apps/api/core";
import type {
  ResponseAction,
  ResponseSource,
} from "../features/conversation/responsePlan";
import type { ResultItem } from "../features/conversation/conversationContext";

/**
 * Download extracted browser images via native Rust (no browser CORS) and write
 * them to Desktop\screenshot — same path chat uses, not a separate offline script.
 */
async function saveExtractedImagesToDesktop(
  images: string[],
  tag: string,
): Promise<void> {
  const stamp = Date.now().toString(36);
  let i = 0;
  for (const url of images.slice(0, 8)) {
    i += 1;
    try {
      let ext = "jpg";
      if (/\.png(\?|$)/i.test(url)) ext = "png";
      else if (/\.webp(\?|$)/i.test(url)) ext = "webp";
      else if (/\.gif(\?|$)/i.test(url)) ext = "gif";
      const filename = `chat_${tag}_${stamp}_${i}.${ext}`;
      // Native download — frontend fetch is blocked by CORS on many CDNs.
      await invoke<string>("save_desktop_image_from_url", {
        url,
        filename,
      });
    } catch {
      // Non-fatal QA side channel.
    }
  }
}

export interface AssistantReply {
  text: string;
  /**
   * Provider/model label. Developer diagnostics only — normal chat shows
   * `source` instead, because "DeepSeek · deepseek-v4-flash" tells a user
   * nothing about what actually happened.
   */
  sourceLabel: string;
  /** Friendly icon + label for the chat footer. */
  source?: ResponseSource;
  /** At most two structured follow-ups, ready to execute. */
  actions?: ResponseAction[];
  /** Structured results to render inline instead of opening a browser. */
  results?: ResultItem[];
  /** True when answered by a local deterministic tool (no LLM). */
  localTool?: string;
  /** Optional Connect action label for UI. */
  connectionActionLabel?: string;
  /**
   * Screenshot id produced by this turn. Without surfacing it the assistant
   * says "Here's the screenshot" and shows nothing — a claim it cannot back up.
   */
  captureId?: string;
  /** Browser-mode extracted images (thumbnails, og:image) to show under the reply. */
  images?: string[];
  /**
   * Watched applications this answer actually came from.
   *
   * Drives the source badge under the reply. Present only when the watched
   * context materially contributed — an application that merely happened to be
   * watched must not be credited, or the badge stops meaning anything.
   */
  watchedSources?: WatchedSource[];
}

/** One watched application credited under a reply. */
export interface WatchedSource {
  appCatalogId: string;
  displayName: string;
  /** Workspace or window, when it distinguishes this instance. */
  detail?: string;
}

export interface AssistantRouteInfo {
  provider: "deepseek" | "google" | "unsupported" | "none";
  displayName: string;
  modelName?: string;
}

/**
 * Dashboard / typed chat route.
 * Product rule: DeepSeek is the chat model. Voice overlay uses OpenAI Realtime
 * separately and must never appear here.
 */
export function getAssistantRoute(): AssistantRouteInfo {
  const role = modelById(getPrefs().models.roles.assistant);
  // Always prefer DeepSeek for chat when the role is empty, voice-only, or unknown.
  if (
    !role ||
    role.provider === "openai" ||
    role.contextType === "realtime" ||
    role.id === "gpt-realtime" ||
    (!role.supportsText && (role.supportsAudioInput || role.supportsAudioOutput))
  ) {
    return {
      provider: "deepseek",
      displayName: "DeepSeek V4 Flash",
      modelName: "deepseek-v4-flash",
    };
  }
  if (role.provider === "deepseek") {
    return {
      provider: "deepseek",
      displayName: role.displayName,
      modelName: role.modelName || "deepseek-v4-flash",
    };
  }
  if (role.id === "google-gemini" || role.provider === "google") {
    return {
      provider: "google",
      displayName: role.displayName,
      modelName:
        getPrefs().models.googleModel?.trim() ||
        role.modelName ||
        "gemini-3.5-flash",
    };
  }
  // Fallback chat model for any leftover role.
  return {
    provider: "deepseek",
    displayName: "DeepSeek V4 Flash",
    modelName: "deepseek-v4-flash",
  };
}

/** Short human line describing which connected service is being read. */
function orchestrationStatusFor(text: string): string {
  const q = text.toLowerCase();
  if (/\b(gmail|email|inbox|mail)\b/.test(q)) return "Reading your Gmail…";
  if (/\b(cal[ae]nd[ae]r|meeting|event|appointment)\b/.test(q)) {
    return "Checking your calendar…";
  }
  if (/\bdrive\b/.test(q)) return "Reading your Drive…";
  return "Checking your connected services…";
}

async function buildMessages(
  userText: string,
  guardCorrection?: string,
): Promise<ChatMessage[]> {
  // Pure chat path: redact raw URLs before cloud models (privacy / filter safety).
  const { wrapSensitiveForModel } = await import(
    "../features/capabilities/browserContext"
  );
  const safeUser = wrapSensitiveForModel(userText);
  const { currentConversationId } = await import(
    "../features/conversation/conversationContext"
  );
  return [
    {
      role: "system",
      // The request text narrows the watched block, and the conversation id is
      // what makes it *scoped* rather than relevance-ranked. Without the id a
      // generic question ("what can you do?") matches no watched application's
      // vocabulary, every one is dropped, and the model answers from the global
      // feature list — which is the reported failure.
      content: await assistantSystemContext(userText, currentConversationId()),
    },
    ...(guardCorrection
      ? [{ role: "system" as const, content: guardCorrection }]
      : []),
    { role: "user", content: safeUser },
  ];
}

/**
 * Dashboard Voice Action + top overlay both show Thinking while the model runs.
 * Always updates voice status; refreshes the overlay whenever that window is up.
 */
function signalAssistantThinking() {
  setVoiceStatus("thinking");
  const overlay = getOverlayState();
  if (
    overlay.visible ||
    (overlay.mode !== "hidden" && overlay.mode !== "closing")
  ) {
    setOverlayMode("thinking", {
      status: "Thinking...",
      expanded: false,
    });
  }
}

/**
 * Ask the configured assistant.
 * @param skipCapabilities — when true, skip the capability engine (overlay already ran it).
 *
 * Actions go through the capability engine so the model calls tools and remembers
 * results. Pure chat uses the selected model with session action memory.
 */
export interface AskAssistantOptions {
  /** Skip the capability engine (the overlay already ran it). */
  skipCapabilities?: boolean;
  /**
   * Correction from the watch-scope response guard, for one retry.
   *
   * Internal only. It names what the previous answer got wrong and
   * restates the watched application's real abilities, so the second
   * attempt has the facts rather than just the instruction.
   */
  guardCorrection?: string;
  /**
   * Skip IntentOrchestrator (Gmail/Calendar/Drive). Required for internal
   * presentation/rewrite prompts that mention email facts — otherwise the
   * orchestrator re-fetches and dumps raw text again.
   */
  skipOrchestration?: boolean;
  /**
   * What to classify and route on, when it differs from what the model is
   * sent. Composer modes prepend instructions to `userText`; classifying
   * those words misroutes the request (an essay prompt whose instruction
   * mentioned "reply" was routed to email drafting). Routing must only ever
   * consider what the user actually said.
   */
  intentText?: string;
  /**
   * Live progress for the UI. A connected-service read can take tens of
   * seconds; without this the chat shows a bare "Thinking" the whole time.
   */
  onStatus?: (status: string, capabilityId?: string) => void;
  /** Plain-chat only — called with each reply chunk as it streams in. */
  onChunk?: (delta: string) => void;
}

/**
 * Ask the assistant, and keep the conversation ledger honest while doing it.
 *
 * The ledger's two structural rules — the name cooldown and "don't re-announce
 * a discovery" — are both counted in turns, and **nothing in production was
 * counting turns**. `recordTurn` existed, its tests drove it directly, and the
 * running application never called it: `turnCounter` sat at 0 forever, so every
 * entity looked brand new on every follow-up.
 *
 * Internal prompts (presentation, clarification wording) are excluded. They are
 * the assistant talking to itself, and counting them would age the cooldown
 * against turns the user never saw.
 */
export async function askAssistant(
  userText: string,
  options?: AskAssistantOptions,
): Promise<AssistantReply> {
  const internal =
    Boolean(options?.skipCapabilities) && Boolean(options?.skipOrchestration);
  const { recordTurn } = await import(
    "../features/conversation/conversationContext"
  );
  if (!internal) {
    recordTurn("user", options?.intentText?.trim() || userText.trim());
  }
  // Provenance is opened here and closed below, so every turn starts with an
  // empty application-source list. The badge that used to follow Spotify around
  // an unrelated file conversation came from state that outlived its turn.
  const { beginWatchTurn, endWatchTurn } = await import(
    "../features/watch/watchProvenance"
  );
  if (!internal) beginWatchTurn();
  let reply = await askAssistantTurn(userText, options);
  if (!internal) {
    reply = await enforceWatchScope(userText, options, reply);
    endWatchTurn();
    recordTurn("assistant", reply.text);
  }
  // The last gate before the text is rendered. A tool call the provider
  // serialised as prose and no layer could recover was being shown verbatim —
  // `<|DSML|>` envelopes and invoke tags in a chat bubble. Applied to every
  // reply, internal turns included, because an internal turn's text is fed
  // back to the model and would carry the markup forward.
  const guarded = guardVisibleText(reply.text);
  return guarded === reply.text ? reply : { ...reply, text: guarded };
}

/**
 * Hold the answer to the watched application's real abilities.
 *
 * The shipped failure was a reply that began "I can do things on your PC — open
 * apps and websites, take screenshots…" in a conversation scoped to one watched
 * application. Every word of it is true about ArcSonare and none of it answers
 * what was asked. The system prompt forbids it; this catches the case where the
 * model does it anyway, and asks once more with the violations named.
 *
 * One retry, not a loop: a second failure means the model cannot satisfy the
 * constraint, and repeating would spend the user's time to produce the same
 * text. The credited sources are attached either way, so the badge tells the
 * truth about which application the answer came from.
 */
async function enforceWatchScope(
  userText: string,
  options: AskAssistantOptions | undefined,
  reply: AssistantReply,
): Promise<AssistantReply> {
  const [
    { getWatchScope },
    { checkWatchResponse },
    { currentConversationId },
    { turnContributors },
  ] = await Promise.all([
    import("../features/watch/watchScopeStore"),
    import("../features/watch/watchResponseGuard"),
    import("../features/conversation/conversationContext"),
    import("../features/watch/watchProvenance"),
  ]);

  const conversationId = currentConversationId();

  // An application the turn named but the user has not activated. The reply
  // says it needs activating; this is the button that does it. Attached
  // deterministically from the prompt trace rather than left to the model,
  // which described the requirement perfectly and offered no way to meet it.
  const { lastWatchPromptTrace } = await import(
    "../features/watch/watchPromptContext"
  );
  const awaiting = lastWatchPromptTrace()?.awaitingActivation ?? [];
  if (awaiting.length > 0) {
    reply = {
      ...reply,
      actions: [
        ...awaiting.slice(0, 2).map((app) => ({
          id: `watch-activate-${app.appCatalogId}`,
          label: `Activate ${app.displayName}`,
          capabilityId: "watch.activate_application",
          args: { app_catalog_id: app.appCatalogId },
        })),
        ...(reply.actions ?? []),
      ],
    };
  }

  const scope = getWatchScope(conversationId);
  if (scope.scope.entries.length === 0) return reply;

  // Credit comes from this turn's provenance ledger and nowhere else — not the
  // active scope, not the previous reply, not the shape of the question. An
  // application is credited only if its context reached this prompt or its
  // adapter ran during this turn.
  const contributed = turnContributors();
  if (contributed.length === 0) return reply;

  const routingText = options?.intentText?.trim() || userText;
  const sources = scope.scope.entries
    .filter((entry) => contributed.includes(entry.appCatalogId))
    .map((entry) => ({
    appCatalogId: entry.appCatalogId,
    displayName: entry.displayName,
    detail: entry.boundInstanceKey?.includes(":ws:")
      ? entry.boundInstanceKey.split(":ws:")[1]
      : undefined,
  }));

  const verdict = checkWatchResponse({
    responseText: reply.text,
    requestText: routingText,
    abilities: scope.abilities,
  });
  if (verdict.ok) {
    return { ...reply, watchedSources: sources };
  }

  console.warn(
    "[ArcSonare] watch-scope guard rejected a reply:",
    verdict.violations.join("; "),
  );
  const retry = await askAssistantTurn(userText, {
    ...options,
    guardCorrection: verdict.correction ?? undefined,
  });
  return { ...retry, watchedSources: sources };
}

async function askAssistantTurn(
  userText: string,
  options?: AskAssistantOptions,
): Promise<AssistantReply> {
  const text = userText.trim();
  if (!text) {
    throw new Error("Nothing to send.");
  }
  const routingText = options?.intentText?.trim() || text;
  const pureModel =
    Boolean(options?.skipCapabilities) && Boolean(options?.skipOrchestration);

  // Dashboard "Running apps" + watching flags — answer before capability routing.
  // Otherwise "what's running?" hits a raw process-list tool and loses context.
  // Internal model-only prompts must not be hijacked by desktop heuristics.
  if (!pureModel) {
    try {
      const { answerWatchQuestion } = await import(
        "../features/watch/watchQuestions"
      );
      const desktopAnswer = await answerWatchQuestion(routingText);
      if (desktopAnswer) {
        options?.onStatus?.("Writing the answer…");
        const { styleAssistantOutput } = await import("./styleAssistantOutput");
        const styled = await styleAssistantOutput({
          facts: desktopAnswer,
          userRequest: routingText,
          shape: "list",
          sourceHint: "Desktop",
        });
        return {
          text: styled.text,
          sourceLabel: styled.sourceHint,
          source: { iconKey: "system", label: "Running apps checked" },
        };
      }
    } catch (err) {
      console.error("[ArcSonare] running-apps answer failed:", err);
    }
  }

  if (!options?.skipCapabilities) {
    // Dynamic import avoids a static cycle with capabilityEngine → getAssistantRoute.
    const { handleCapabilityRequest } = await import(
      "../features/capabilities/capabilityEngine"
    );
    signalAssistantThinking();
    const capability = await handleCapabilityRequest(routingText, {
      origin: "chat",
      onProgress: (message, capabilityId) => {
        options?.onStatus?.(message, capabilityId);
        const overlay = getOverlayState();
        if (overlay.visible || (overlay.mode !== "hidden" && overlay.mode !== "closing")) {
          setOverlayMode(
            message.startsWith("Opening") ? "opening-app" : "thinking",
            { status: message.startsWith("Opening") ? message : "Thinking..." },
          );
        }
      },
    });
    // handled with a result — responseText may be empty when images are the reply
    if (capability.handled && (capability.result || capability.responseText != null)) {
      const route = getAssistantRoute();
      const modelOwned =
        capability.run?.route === "model-tool-call" ||
        capability.run?.route === "multi-step-plan";
      const data = capability.result?.data as
        | { capture_id?: string; images?: string[] }
        | undefined;
      const captureId = data?.capture_id;
      let images = Array.isArray(data?.images)
        ? data!.images!.filter((u) => typeof u === "string" && /^https?:\/\//i.test(u))
        : undefined;
      if (images?.length) {
        const { pickDisplayImages } = await import(
          "../features/capabilities/browserContext"
        );
        // Few real previews only — junk CDN dumps look like "false" images.
        images = pickDisplayImages(images, 3);
      }

      // Single style gate: structure (list/table) + AI presentation.
      // Short open/close/YouTube actions must NOT go through the model — it
      // turns failures into essays and sometimes mixes in unrelated turns.
      const capId = capability.result?.capabilityId ?? "";
      // Structure before wording: the plan decides name usage, whether this is
      // a discovery or a follow-up, what the user sees as the source, and which
      // follow-up actions exist. The model only writes the sentence.
      const { buildResponsePlan } = await import(
        "../features/conversation/responsePlan"
      );
      const plan = capability.result
        ? buildResponsePlan({
            capabilityId: capId,
            result: capability.result,
            facts: capability.responseText || capability.result.summary || "",
          })
        : undefined;
      // The engine's model loop already showed the model the verified result and
      // got a written reply back. Re-running the presenter over it would either
      // paraphrase a good sentence or, for these capabilities, replace it with a
      // template — which is exactly why "Opened X." was the answer to every
      // action no matter how it was asked.
      const resultItems = Array.isArray(
        (capability.result?.data as { items?: unknown } | undefined)?.items,
      )
        ? ((capability.result!.data as { items: ResultItem[] }).items)
        : undefined;

      if (
        capability.responseSource === "MODEL_GENERATED" &&
        capability.responseText?.trim()
      ) {
        const { stripGreetingName } = await import("./nameGreeting");
        const { userFirstName } = await import("./naturalReply");
        return {
          text: stripGreetingName(
            capability.responseText.trim(),
            plan?.mayUseName ? null : userFirstName(),
          ),
          sourceLabel: route.displayName,
          source: plan?.source,
          actions: plan?.actions,
          results: resultItems,
          localTool: capId || undefined,
          captureId,
          images: images?.length ? images : undefined,
        };
      }

      // Presentation shortcuts for paths the model loop did NOT finalize (voice
      // re-entry, resumed confirmations, failures). These are fallbacks now, not
      // the normal route.
      const shortAction =
        capId === "web.activate_listed_item" ||
        capId === "screen.click_target" ||
        capId === "applications.open" ||
        capId === "applications.close" ||
        capId === "applications.focus" ||
        capId === "web.search" ||
        capId === "web.open_url" ||
        capability.result?.status === "error";
      const pageOk =
        capId === "web.fetch_page" && capability.result?.status === "success";
      const pageFail = capId === "web.fetch_page" && capability.result?.status !== "success";

      const {
        isShowImageRequest,
        isModelRefusal,
        localBrowserReply,
        pageFactsForModel,
        rememberBrowserPage,
        wrapSensitiveForModel,
        wrapFactsForModel,
        extractUrl,
      } = await import("../features/capabilities/browserContext");
      const imageIntent = isShowImageRequest(routingText);
      const pageData = capability.result?.data as
        | { url?: string; title?: string; text?: string; chars?: number }
        | undefined;
      const pageUrl = pageData?.url ?? "";
      if (pageOk && pageData?.url) {
        rememberBrowserPage(pageData.url, pageData.title, images);
      }

      // Link fetch: extract locally; style with the selected assistant on redacted facts.
      if (capId === "web.fetch_page") {
        if (images?.length) {
          void saveExtractedImagesToDesktop(images, "chat").catch(() => undefined);
        }
        const localText = localBrowserReply({
          userRequest: routingText,
          title: pageData?.title,
          textSnippet: pageData?.text,
          imageCount: images?.length ?? 0,
          textChars: pageData?.chars ?? pageData?.text?.length,
          failed:
            !pageOk ||
            (imageIntent && !(images && images.length)),
          errorSummary:
            capability.result?.summary ||
            capability.result?.error?.message ||
            capability.responseText ||
            "Could not fetch that link.",
        });

        if (imageIntent) {
          return {
            text: localText,
            sourceLabel: route.displayName,
            source: { iconKey: "browser", label: "Web page read" },
            localTool: capId,
            images: images?.length ? images : undefined,
          };
        }

        if (pageOk) {
          options?.onStatus?.("Writing the answer…");
          const { styleAssistantOutput } = await import("./styleAssistantOutput");
          const facts = pageFactsForModel({
            title: pageData?.title,
            text: pageData?.text,
            imageCount: images?.length ?? 0,
          });
          const styled = await styleAssistantOutput({
            facts: wrapFactsForModel(facts, pageUrl),
            userRequest: wrapSensitiveForModel(routingText),
            capabilityId: capId,
            useModel: true,
            shape: "prose",
            sourceHint: route.displayName,
          });
          if (!isModelRefusal(styled.text) && styled.text.trim()) {
            return {
              text: styled.text.trim(),
              sourceLabel: styled.sourceHint || route.displayName,
              source: { iconKey: "browser", label: "Web page read" },
              localTool: capId,
              images: images?.length ? images : undefined,
            };
          }
        }

        return {
          text: localText,
          sourceLabel: route.displayName,
          source: { iconKey: "browser", label: "Web page read" },
          localTool: capId,
          images: images?.length ? images : undefined,
        };
      }

      // Non-page tools: style with the selected assistant when appropriate.
      options?.onStatus?.("Writing the answer…");
      const { styleAssistantOutput } = await import("./styleAssistantOutput");
      const useModel = pageFail ? false : !shortAction;
      const safeUserRequest = wrapSensitiveForModel(routingText);
      const safeFacts = wrapFactsForModel(
        capability.responseText || capability.result?.summary || "",
        pageUrl || extractUrl(routingText) || undefined,
      );
      const styled = await styleAssistantOutput({
        facts: safeFacts,
        userRequest: safeUserRequest,
        capabilityId: capId || undefined,
        useModel,
        shape: pageFail ? "prose" : undefined,
        sourceHint: modelOwned ? route.displayName : "ArcSonare tools",
        entityRef: plan?.entityRef,
        plan: plan && { mayUseName: plan.mayUseName, newlyDiscovered: plan.newlyDiscovered },
      });

      if (isModelRefusal(styled.text)) {
        return {
          text:
            capability.responseText ||
            capability.result?.summary ||
            "Done.",
          sourceLabel: route.displayName,
          source: plan?.source,
          actions: plan?.actions,
          localTool: capId || undefined,
          captureId,
          images: images?.length ? images : undefined,
        };
      }

      return {
        text: styled.text,
        sourceLabel: styled.sourceHint,
        source: plan?.source,
        actions: plan?.actions,
        results: resultItems,
        localTool: capability.result?.capabilityId,
        captureId,
        images: images?.length ? images : undefined,
      };
    }
  }

  // Last resort: if the user pasted a URL but nothing handled it, force local fetch
  // so the cloud model never gets a chance to refuse.
  {
    const {
      extractUrl,
      isShowImageRequest,
      localBrowserReply,
      pickDisplayImages,
    } = await import("../features/capabilities/browserContext");
    const forcedUrl = extractUrl(routingText);
    if (forcedUrl && !options?.skipCapabilities) {
      try {
        options?.onStatus?.("Fetching link…");
        const result = await invoke<{
          status?: string;
          summary?: string;
          data?: {
            url?: string;
            title?: string;
            text?: string;
            chars?: number;
            images?: string[];
          };
          error?: { message?: string };
        }>("capability_execute", {
          capabilityId: "web.fetch_page",
          args: { url: forcedUrl },
          runId: `force-fetch-${Date.now()}`,
          userRequestSummary: routingText.slice(0, 200),
          confirmationToken: null,
        });
        const ok = result?.status === "success";
        let images = Array.isArray(result?.data?.images)
          ? result!.data!.images!.filter(
              (u) => typeof u === "string" && /^https?:\/\//i.test(u),
            )
          : [];
        images = pickDisplayImages(images, 3);
        if (images.length) {
          void saveExtractedImagesToDesktop(images, "chat-force").catch(() => undefined);
        }
        const text = localBrowserReply({
          userRequest: routingText,
          title: result?.data?.title,
          textSnippet: result?.data?.text,
          imageCount: images.length,
          textChars: result?.data?.chars ?? result?.data?.text?.length,
          failed:
            !ok ||
            (isShowImageRequest(routingText) && images.length === 0),
          errorSummary: result?.summary || result?.error?.message,
        });
        return {
          text: text.trim() || result?.summary || "I fetched that page.",
          sourceLabel: getAssistantRoute().displayName,
          source: { iconKey: "browser", label: "Web page read" },
          localTool: "web.fetch_page",
          images: images.length ? images : undefined,
        };
      } catch (err) {
        console.error("[ArcSonare] forced local fetch failed:", err);
      }
    }
  }

  // Intent Precision — connected-service read/open before any model call.
  // Every orchestrated reply goes through styleAssistantOutput (no hardcoded dump).
  if (!options?.skipOrchestration) {
    // Announce a connected-service read only for a request that plausibly is
    // one. This used to fire on every turn before the orchestrator had decided
    // anything, so "what is the capital of Japan?" recorded "Checked your
    // connected services" as something that happened. It did not.
    const { classifyIntent, isOrchestratedDomain } = await import(
      "../features/orchestration/IntentClassifier"
    );
    if (isOrchestratedDomain(classifyIntent(routingText))) {
      options?.onStatus?.(orchestrationStatusFor(routingText));
    }
    const orchestrated = await handleOrchestratedRequest(routingText);
    if (orchestrated.handled) {
      if (orchestrated.navigatePage) {
        navigate(orchestrated.navigatePage);
      }

      options?.onStatus?.("Writing the answer…");
      const { styleAssistantOutput } = await import("./styleAssistantOutput");
      const styled = await styleAssistantOutput({
        facts: orchestrated.text,
        userRequest: routingText,
        capabilityId: orchestrated.capabilityId,
        sourceHint: getAssistantRoute().displayName,
      });
      const body = orchestrated.action
        ? `${styled.text}\n\n*${orchestrated.action.label}*`
        : styled.text;
      const { sourceForCapabilityId } = await import(
        "../features/conversation/responsePlan"
      );
      return {
        text: body,
        sourceLabel: styled.sourceHint,
        source: orchestrated.capabilityId
          ? sourceForCapabilityId(orchestrated.capabilityId)
          : { iconKey: "connection", label: "Connected services checked" },
        connectionActionLabel: orchestrated.action?.label,
      };
    }
  }

  const messages = await buildMessages(text, options?.guardCorrection);
  options?.onStatus?.("Thinking…");
  signalAssistantThinking();

  const route = getAssistantRoute();

  // Backend-enforced cloud gate from Settings → Data & Privacy.
  const allowCloud = getPrefs().dataPrivacy.allowCloud;
  const cloudBlocked =
    !allowCloud &&
    (route.provider === "deepseek" || route.provider === "google");

  if (route.provider === "deepseek" && !cloudBlocked) {
    const reply = await deepseekChat(messages, route.modelName);
    return {
      text: stripTrailingFiller(reply),
      sourceLabel: `DeepSeek · ${route.modelName ?? route.displayName}`,
    };
  }

  if (route.provider === "google" && !cloudBlocked) {
    const reply = await geminiChat(messages, route.modelName);
    return {
      text: stripTrailingFiller(reply),
      sourceLabel: `Google · ${route.modelName ?? route.displayName}`,
    };
  }

  if (cloudBlocked) {
    throw new Error(
      `${route.displayName} needs cloud processing, which is turned off. Turn on cloud in Settings → Data & Privacy.`,
    );
  }

  if (route.provider === "none") {
    throw new Error(
      "No DeepSeek key. Open Settings → Voice & AI keys and save your DeepSeek API key.",
    );
  }

  throw new Error(
    `${route.displayName} is not available for chat. Save a DeepSeek key in Settings → Voice & AI keys.`,
  );
}
