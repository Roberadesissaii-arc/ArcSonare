import { useEffect, useMemo, useState } from "react";
import {
  Download,
  Trash2,
  Search,
  RefreshCw,
  FileText,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ShieldAlert,
  Settings2,
} from "lucide-react";
import {
  clearAllOverlayLogs,
  deleteOverlayLogSession,
  exportOverlayLogs,
  getOverlayLogSessionDetail,
  getOverlayLogSettings,
  getOverlayLogSummary,
  listOverlayLogSessions,
  updateOverlayLogSettings,
  type OverlayConversationSession,
  type OverlayLogSettings,
  type OverlayLogSummary,
  type SessionDetailView,
} from "../../features/overlay-log/overlayLogService";

export function ConversationLogsPage() {
  const [summary, setSummary] = useState<OverlayLogSummary | null>(null);
  const [settings, setSettings] = useState<OverlayLogSettings | null>(null);
  const [sessions, setSessions] = useState<OverlayConversationSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [surfaceFilter, setSurfaceFilter] = useState("all");
  const [errorOnly, setErrorOnly] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Detail view modal
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [sessionDetail, setSessionDetail] = useState<SessionDetailView | null>(null);
  const [expandedTurns, setExpandedTurns] = useState<Record<string, boolean>>({});

  // Export modal
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<"json" | "jsonl" | "markdown" | "zip">("zip");
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  // Clear modal
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [sumData, setData, sessData] = await Promise.all([
        getOverlayLogSummary(),
        getOverlayLogSettings(),
        listOverlayLogSessions(100),
      ]);
      setSummary(sumData);
      setSettings(setData);
      setSessions(sessData);
    } catch (err) {
      console.error("[ConversationLogs] Failed to load log data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    if (!selectedSessionId) {
      setSessionDetail(null);
      return;
    }
    void getOverlayLogSessionDetail(selectedSessionId).then((detail) => {
      setSessionDetail(detail);
      // Auto-expand all turns by default
      const map: Record<string, boolean> = {};
      detail.turns.forEach((t) => (map[t.id] = true));
      setExpandedTurns(map);
    });
  }, [selectedSessionId]);

  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => {
      if (statusFilter !== "all" && s.status !== statusFilter) return false;
      if (surfaceFilter !== "all" && s.surface !== surfaceFilter) return false;
      if (errorOnly && !s.hasError) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTranscript = s.firstUserTranscript?.toLowerCase().includes(q);
        const matchesId = s.id.toLowerCase().includes(q);
        if (!matchesTranscript && !matchesId) return false;
      }
      return true;
    });
  }, [sessions, statusFilter, surfaceFilter, errorOnly, searchQuery]);

  const handleUpdateSettings = async (patch: Partial<OverlayLogSettings>) => {
    if (!settings) return;
    const updated = { ...settings, ...patch };
    setSettings(updated);
    try {
      await updateOverlayLogSettings(updated);
      await loadData();
    } catch (err) {
      console.error("[ConversationLogs] Settings update failed:", err);
    }
  };

  const handleExecuteExport = async () => {
    setExporting(true);
    setExportNotice(null);
    try {
      const res = await exportOverlayLogs({
        format: exportFormat,
        sessionIds: selectedSessionId ? [selectedSessionId] : undefined,
        targetPath: undefined,
      });

      if (res.success) {
        setExportNotice(`Export saved successfully to: ${res.path}`);
        setTimeout(() => {
          setExportModalOpen(false);
          setExportNotice(null);
        }, 2500);
      }
    } catch (err) {
      console.error("[ConversationLogs] Export failed:", err);
      setExportNotice(`Export failed: ${String(err)}`);
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteSession = async (id: string) => {
    try {
      await deleteOverlayLogSession(id);
      if (selectedSessionId === id) setSelectedSessionId(null);
      await loadData();
    } catch (err) {
      console.error("[ConversationLogs] Delete session failed:", err);
    }
  };

  const handleClearAll = async () => {
    try {
      await clearAllOverlayLogs();
      setSelectedSessionId(null);
      setConfirmClearOpen(false);
      await loadData();
    } catch (err) {
      console.error("[ConversationLogs] Clear all logs failed:", err);
    }
  };

  const formatSize = (bytes?: number) => {
    if (!bytes) return "0 KB";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const formatDate = (ms?: number) => {
    if (!ms) return "N/A";
    return new Date(ms).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  return (
    <div className="conversation-logs-container">
      {/* Header */}
      <div className="clog-header">
        <div>
          <h2 className="clog-title">Conversation Logs</h2>
          <p className="clog-subtitle">
            Review and export speech-overlay conversations and diagnostics stored locally on this computer.
          </p>
        </div>
        <div className="clog-header-actions">
          <button
            type="button"
            className="btn-clog-secondary"
            onClick={() => setShowSettings((v) => !v)}
          >
            <Settings2 size={14} />
            Logging Settings
          </button>
          <button
            type="button"
            className="btn-clog-primary"
            onClick={() => setExportModalOpen(true)}
          >
            <Download size={14} />
            Export Logs
          </button>
        </div>
      </div>

      {/* Summary Area */}
      {summary ? (
        <div className="clog-summary-grid">
          <div className="clog-stat-card">
            <span className="clog-stat-label">Total Sessions</span>
            <strong className="clog-stat-value">{summary.totalSessions}</strong>
          </div>
          <div className="clog-stat-card">
            <span className="clog-stat-label">Total Turns</span>
            <strong className="clog-stat-value">{summary.totalTurns}</strong>
          </div>
          <div className="clog-stat-card">
            <span className="clog-stat-label">Failed Turns</span>
            <strong className={`clog-stat-value ${summary.failedTurns > 0 ? "is-error" : ""}`}>
              {summary.failedTurns}
            </strong>
          </div>
          <div className="clog-stat-card">
            <span className="clog-stat-label">Storage Size</span>
            <strong className="clog-stat-value">{formatSize(summary.storageSizeBytes)}</strong>
          </div>
          <div className="clog-stat-card">
            <span className="clog-stat-label">Retention Policy</span>
            <strong className="clog-stat-value">
              {summary.retentionDays === 0 ? "Keep forever" : `${summary.retentionDays} days`}
            </strong>
          </div>
        </div>
      ) : null}

      {/* Logging Settings Drawer/Panel */}
      {showSettings && settings ? (
        <div className="clog-settings-card">
          <div className="clog-settings-head">
            <h3>Logging & Diagnostic Settings</h3>
            <span className="clog-badge-privacy">100% Local & Account Isolated</span>
          </div>
          <div className="clog-settings-body">
            <label className="clog-toggle-row">
              <div>
                <strong>Save overlay conversation logs</strong>
                <p>Record speech-to-speech overlay sessions for diagnostic inspection</p>
              </div>
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(e) => handleUpdateSettings({ enabled: e.target.checked })}
              />
            </label>

            <label className="clog-select-row">
              <div>
                <strong>Retention period</strong>
                <p>Automatically purge conversation logs older than the retention threshold</p>
              </div>
              <select
                value={settings.retentionDays}
                onChange={(e) => handleUpdateSettings({ retentionDays: Number(e.target.value) })}
              >
                <option value={7}>7 days</option>
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
                <option value={0}>Keep until deleted</option>
              </select>
            </label>

            <label className="clog-toggle-row">
              <div>
                <strong>Include capability timeline</strong>
                <p>Record tools and native capability executions</p>
              </div>
              <input
                type="checkbox"
                checked={settings.includeCapabilityTimeline}
                onChange={(e) =>
                  handleUpdateSettings({ includeCapabilityTimeline: e.target.checked })
                }
              />
            </label>

            <label className="clog-toggle-row">
              <div>
                <strong>Include technical diagnostics</strong>
                <p>Record latencies, correlation IDs, and event timestamps</p>
              </div>
              <input
                type="checkbox"
                checked={settings.includeTechnicalDiagnostics}
                onChange={(e) =>
                  handleUpdateSettings({ includeTechnicalDiagnostics: e.target.checked })
                }
              />
            </label>

            <div className="clog-privacy-guarantee">
              <ShieldAlert size={15} />
              <span>
                Raw audio buffers, screenshots, API keys, passwords, and private credentials are <strong>never</strong> recorded.
              </span>
            </div>
          </div>
        </div>
      ) : null}

      {/* Controls & Search Filter Bar */}
      <div className="clog-toolbar">
        <div className="clog-search-wrap">
          <Search size={14} className="clog-search-icon" />
          <input
            type="text"
            className="clog-search-input"
            placeholder="Search transcript or response..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="clog-filter-group">
          <select
            className="clog-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All Statuses</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
            <option value="interrupted">Interrupted</option>
            <option value="failed">Failed</option>
          </select>

          <select
            className="clog-select"
            value={surfaceFilter}
            onChange={(e) => setSurfaceFilter(e.target.value)}
          >
            <option value="all">All Surfaces</option>
            <option value="voice-overlay">Voice Overlay</option>
            <option value="main-window-voice">Main Window Voice</option>
          </select>

          <label className="clog-checkbox-label">
            <input
              type="checkbox"
              checked={errorOnly}
              onChange={(e) => setErrorOnly(e.target.checked)}
            />
            Errors only
          </label>

          <button
            type="button"
            className="btn-clog-icon"
            onClick={loadData}
            title="Refresh logs"
          >
            <RefreshCw size={14} />
          </button>

          {sessions.length > 0 ? (
            <button
              type="button"
              className="btn-clog-danger"
              onClick={() => setConfirmClearOpen(true)}
            >
              <Trash2 size={14} />
              Clear All
            </button>
          ) : null}
        </div>
      </div>

      {/* Session List */}
      <div className="clog-list-wrap">
        {loading ? (
          <div className="clog-empty-state">Loading conversation logs...</div>
        ) : filteredSessions.length === 0 ? (
          <div className="clog-empty-state">
            <FileText size={24} />
            <p>No conversation logs found.</p>
            <span>Overlay conversations will appear here after you speak with ArcSonare.</span>
          </div>
        ) : (
          <div className="clog-session-list">
            {filteredSessions.map((sess) => (
              <div
                key={sess.id}
                className={`clog-session-row ${selectedSessionId === sess.id ? "is-selected" : ""}`}
                onClick={() => setSelectedSessionId(sess.id)}
              >
                <div className="clog-row-main">
                  <div className="clog-row-top">
                    <span className="clog-row-date">{formatDate(sess.startedAtMs)}</span>
                    <span className={`clog-status-badge is-${sess.status}`}>{sess.status}</span>
                    <span className="clog-surface-badge">{sess.surface}</span>
                  </div>
                  <p className="clog-row-excerpt">
                    {sess.firstUserTranscript ? `“${sess.firstUserTranscript}”` : "(No transcript)"}
                  </p>
                </div>

                <div className="clog-row-meta">
                  <span>{sess.turnCount} {sess.turnCount === 1 ? "turn" : "turns"}</span>
                  {sess.durationMs ? <span>{(sess.durationMs / 1000).toFixed(1)}s</span> : null}
                  {sess.hasError ? <span className="clog-error-tag"><AlertTriangle size={12} /> Error</span> : null}
                  <button
                    type="button"
                    className="btn-clog-icon-small"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDeleteSession(sess.id);
                    }}
                    title="Delete session"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Session Detail Modal */}
      {selectedSessionId && sessionDetail ? (
        <div className="clog-modal-backdrop" onClick={() => setSelectedSessionId(null)}>
          <div className="clog-modal-content clog-detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="clog-modal-header">
              <div>
                <h3>Session Details</h3>
                <p>{formatDate(sessionDetail.session.startedAtMs)} · {sessionDetail.session.surface}</p>
              </div>
              <button
                type="button"
                className="btn-clog-close"
                onClick={() => setSelectedSessionId(null)}
              >
                ×
              </button>
            </div>

            <div className="clog-detail-body">
              {sessionDetail.turns.length === 0 ? (
                <p className="clog-empty-turns">No turns recorded for this session.</p>
              ) : (
                sessionDetail.turns.map((turn, tIdx) => (
                  <div key={turn.id} className="clog-turn-card">
                    <div className="clog-turn-head">
                      <span className="clog-turn-label">Turn {tIdx + 1}</span>
                      <span className={`clog-status-badge is-${turn.status}`}>{turn.status}</span>
                      <span className="clog-corr-id">ID: {turn.correlationId}</span>
                    </div>

                    {/* Speech Turn Messages */}
                    <div className="clog-turn-messages">
                      {turn.userTranscript ? (
                        <div className="clog-msg clog-msg-user">
                          <strong>You:</strong>
                          <p>{turn.userTranscript}</p>
                        </div>
                      ) : null}

                      {turn.assistantResponse ? (
                        <div className="clog-msg clog-msg-assistant">
                          <strong>ArcSonare:</strong>
                          <p>{turn.assistantResponse}</p>
                        </div>
                      ) : null}
                    </div>

                    {/* Technical Timeline */}
                    <div className="clog-timeline-section">
                      <button
                        type="button"
                        className="clog-timeline-toggle"
                        onClick={() =>
                          setExpandedTurns((prev) => ({ ...prev, [turn.id]: !prev[turn.id] }))
                        }
                      >
                        {expandedTurns[turn.id] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        Technical Timeline ({turn.events.length} events)
                      </button>

                      {expandedTurns[turn.id] ? (
                        <div className="clog-timeline-events">
                          {turn.events.map((evt) => {
                            const offset = evt.timestampMs - turn.startedAtMs;
                            return (
                              <div key={evt.id} className="clog-event-item">
                                <span className="clog-event-time">+{offset}ms</span>
                                <span className="clog-event-type">{evt.eventType}</span>
                                {Object.keys(evt.safeMetadata).length > 0 ? (
                                  <pre className="clog-event-meta">
                                    {JSON.stringify(evt.safeMetadata)}
                                  </pre>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="clog-modal-footer">
              <button
                type="button"
                className="btn-clog-danger"
                onClick={() => void handleDeleteSession(sessionDetail.session.id)}
              >
                Delete Session
              </button>
              <button
                type="button"
                className="btn-clog-secondary"
                onClick={() => setSelectedSessionId(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Export Confirmation Modal */}
      {exportModalOpen ? (
        <div className="clog-modal-backdrop" onClick={() => setExportModalOpen(false)}>
          <div className="clog-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="clog-modal-header">
              <h3>Export Conversation Logs</h3>
              <button
                type="button"
                className="btn-clog-close"
                onClick={() => setExportModalOpen(false)}
              >
                ×
              </button>
            </div>

            <div className="clog-modal-body">
              <p className="clog-export-privacy-notice">
                This export includes your voice transcripts, ArcSonare replies, action timelines, and error diagnostics.
                <br />
                It does <strong>not</strong> include raw audio, screenshots, API keys, or passwords.
              </p>

              <div className="clog-format-options">
                <label className="clog-format-choice">
                  <input
                    type="radio"
                    name="format"
                    value="zip"
                    checked={exportFormat === "zip"}
                    onChange={() => setExportFormat("zip")}
                  />
                  <div>
                    <strong>ZIP Bundle (Recommended)</strong>
                    <span>Includes manifest.json, sessions.jsonl, conversation.md, and environment.json</span>
                  </div>
                </label>

                <label className="clog-format-choice">
                  <input
                    type="radio"
                    name="format"
                    value="markdown"
                    checked={exportFormat === "markdown"}
                    onChange={() => setExportFormat("markdown")}
                  />
                  <div>
                    <strong>Human-readable Markdown (.md)</strong>
                    <span>Formatted document suitable for reading or sharing bug reports</span>
                  </div>
                </label>

                <label className="clog-format-choice">
                  <input
                    type="radio"
                    name="format"
                    value="json"
                    checked={exportFormat === "json"}
                    onChange={() => setExportFormat("json")}
                  />
                  <div>
                    <strong>Structured JSON (.json)</strong>
                    <span>Complete structured dataset with metadata and event timelines</span>
                  </div>
                </label>
              </div>

              {exportNotice ? <div className="clog-export-notice">{exportNotice}</div> : null}
            </div>

            <div className="clog-modal-footer">
              <button
                type="button"
                className="btn-clog-secondary"
                onClick={() => setExportModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-clog-primary"
                disabled={exporting}
                onClick={handleExecuteExport}
              >
                {exporting ? "Exporting..." : "Export"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Clear All Confirmation Modal */}
      {confirmClearOpen ? (
        <div className="clog-modal-backdrop" onClick={() => setConfirmClearOpen(false)}>
          <div className="clog-modal-content clog-alert-modal" onClick={(e) => e.stopPropagation()}>
            <div className="clog-modal-header">
              <h3>Delete all conversation logs?</h3>
            </div>
            <div className="clog-modal-body">
              <p>This will permanently erase all local speech transcripts, turn records, and technical timelines. This action cannot be undone.</p>
            </div>
            <div className="clog-modal-footer">
              <button
                type="button"
                className="btn-clog-secondary"
                onClick={() => setConfirmClearOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-clog-danger"
                onClick={handleClearAll}
              >
                Delete All
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
