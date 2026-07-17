# Graph Report - .  (2026-07-16)

## Corpus Check
- 332 files · ~171,181 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 662 nodes · 1395 edges · 32 communities (31 shown, 1 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 12 edges (avg confidence: 0.83)
- Token cost: 90,037 input · 0 output

## Community Hubs (Navigation)
- App Shell & Voice State
- Icons & Command UI
- Settings UI & Types
- Dashboard & Demo Data
- Preferences Store
- Task Management
- Package Dependencies
- Native Settings (Rust)
- Global Shortcuts (Rust)
- Tauri App Config
- TypeScript Config
- Capture Storage (Rust)
- Screen Capture (Rust)
- Project Docs & Concepts
- Tauri Window Permissions
- Window Panels (Rust)
- Screen Context Core (Rust)
- Overlay Window (Rust)
- Capture Edge Overlay (Rust)
- Dashboard Design Mockup
- Window Positioning (Rust)
- Data Usage & Notifications
- Monitor Enumeration (Rust)
- AI Model Registry
- Provider Credentials (Rust)
- System Tray (Rust)
- Slider Component

## God Nodes (most connected - your core abstractions)
1. `base()` - 42 edges
2. `compilerOptions` - 16 edges
3. `Settings` - 15 edges
4. `navigate()` - 15 edges
5. `useAppState()` - 15 edges
6. `useSettings()` - 13 edges
7. `addActivity()` - 13 edges
8. `Settings` - 13 edges
9. `capture_inner()` - 11 edges
10. `GlobalVoiceOverlay()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `ArcSonare HTML Entry Point` --references--> `React + TypeScript Frontend`  [INFERRED]
  index.html → README.md
- `ArcSonare HTML Entry Point` --references--> `ArcSonare`  [EXTRACTED]
  index.html → README.md
- `CaptureResult` --references--> `CaptureMeta`  [EXTRACTED]
  src-tauri/src/screen_context/capture.rs → src-tauri/src/screen_context/storage.rs
- `CommandPalette()` --calls--> `addActivity()`  [EXTRACTED]
  src/components/command/CommandPalette.tsx → src/stores/appStore.ts
- `UrgentCard()` --calls--> `navigate()`  [EXTRACTED]
  src/components/dashboard/UrgentCard.tsx → src/stores/appStore.ts

## Import Cycles
- 1-file cycle: `src-tauri/src/tray.rs -> src-tauri/src/tray.rs`

## Hyperedges (group relationships)
- **ArcSonare Native Window Set** — readme_command_center, readme_sonare_overlay, readme_sonare_quick_menu [EXTRACTED 1.00]
- **Main Window useSyncExternalStore Stores** — readme_voicestore, readme_taskstore, readme_appstore [EXTRACTED 1.00]
- **ArcSonare Command Center Dashboard Layout** — chatgpt_image_jul_16__2026__11_40_54_am_focus_card, chatgpt_image_jul_16__2026__11_40_54_am_voice_action_card, chatgpt_image_jul_16__2026__11_40_54_am_connected_tools, chatgpt_image_jul_16__2026__11_40_54_am_orbital_visualization, chatgpt_image_jul_16__2026__11_40_54_am_up_next_panel, chatgpt_image_jul_16__2026__11_40_54_am_urgent_panel, chatgpt_image_jul_16__2026__11_40_54_am_command_input [EXTRACTED 1.00]
- **Voice Interaction Flow (assistant listening, voice action, command input)** — chatgpt_image_jul_16__2026__11_40_54_am_arcsonare_assistant, chatgpt_image_jul_16__2026__11_40_54_am_voice_action_card, chatgpt_image_jul_16__2026__11_40_54_am_command_input [INFERRED 0.85]

## Communities (32 total, 1 thin omitted)

### Community 0 - "App Shell & Voice State"
Cohesion: 0.05
Nodes (59): App(), AppHeader(), AppHeaderProps, matchesFilter(), NOTIFICATION_FILTERS, NotificationFilter, relativeTime(), SOURCE_LABELS (+51 more)

### Community 1 - "Icons & Command UI"
Cohesion: 0.10
Nodes (50): CommandPaletteProps, ComposerMode, MODES, QUICK_ACTIONS, ArrowRightIcon(), ArrowUpIcon(), base(), BellIcon() (+42 more)

### Community 2 - "Settings UI & Types"
Cohesion: 0.08
Nodes (39): Dropdown(), DropdownOption, DropdownProps, AboutPage(), ACKNOWLEDGEMENTS, AppearancePage(), AppearancePageProps, GeneralPage() (+31 more)

### Community 3 - "Dashboard & Demo Data"
Cohesion: 0.06
Nodes (40): ArcSonareLogo(), ArcSonareLogoProps, ConnectGrid(), ArcSonareCore(), CommandComposer(), FocusCard(), OrbitActionChip(), OrbitActionChipProps (+32 more)

### Community 4 - "Preferences Store"
Cohesion: 0.06
Nodes (38): AccentMode, CaptureTarget, CostPreference, DataRetention, DEFAULT_PREFS, Density, EdgeStyle, FollowUpWindow (+30 more)

### Community 5 - "Task Management"
Cohesion: 0.11
Nodes (28): PRIORITY_LABEL, UrgentCard(), AGENT_OPTIONS, CreateTaskModal(), CreateTaskModalProps, PRIORITIES, DEMO_TASKS, FILTERS (+20 more)

### Community 6 - "Package Dependencies"
Cohesion: 0.07
Nodes (29): dependencies, react, react-dom, @tauri-apps/api, devDependencies, @tauri-apps/cli, @types/react, @types/react-dom (+21 more)

### Community 7 - "Native Settings (Rust)"
Cohesion: 0.18
Nodes (23): Default, Self, apply(), clear_local_data(), current(), get_settings(), initialize(), load() (+15 more)

### Community 8 - "Global Shortcuts (Rust)"
Cohesion: 0.20
Nodes (26): HashMap, Settings, Shortcut, apply_shortcut(), check_internal_conflict(), dispatch(), forward(), init() (+18 more)

### Community 9 - "Tauri App Config"
Cohesion: 0.08
Nodes (23): icons/128x128@2x.png, icons/128x128.png, icons/32x32.png, icons/icon.icns, icons/icon.ico, nsis, app, security (+15 more)

### Community 10 - "TypeScript Config"
Cohesion: 0.09
Nodes (21): DOM, DOM.Iterable, ES2021, src, compilerOptions, allowImportingTsExtensions, isolatedModules, jsx (+13 more)

### Community 11 - "Capture Storage (Rust)"
Cohesion: 0.32
Nodes (21): apply_retention(), CaptureMeta, captures_dir(), clear(), clear_capture_history(), delete(), delete_capture(), dir_size_bytes() (+13 more)

### Community 12 - "Screen Capture (Rust)"
Cohesion: 0.29
Nodes (18): RgbaImage, capture_inner(), capture_monitor_image(), capture_screen(), CaptureResult, foreground_window(), get_capture_data_url(), new_capture_id() (+10 more)

### Community 13 - "Project Docs & Concepts"
Cohesion: 0.15
Nodes (18): ArcSonare HTML Entry Point, appStore (page, palette, activity log), ArcSonare, Command Center (main window), Ctrl+K Command Palette, Demo Data (demoData.ts), Global Shortcut Routing, Icon Registry (iconRegistry.ts) (+10 more)

### Community 14 - "Tauri Window Permissions"
Cohesion: 0.12
Nodes (16): core:default, core:window:allow-hide, core:window:allow-is-maximized, core:window:allow-minimize, core:window:allow-start-dragging, core:window:allow-toggle-maximize, main, sonare-annotate (+8 more)

### Community 15 - "Window Panels (Rust)"
Cohesion: 0.29
Nodes (16): get_window(), hide_main(), hide_main_window(), hide_quick_menu(), hide_window(), open_settings(), quit_app(), AppHandle (+8 more)

### Community 16 - "Screen Context Core (Rust)"
Cohesion: 0.33
Nodes (13): broadcast_status(), AppHandle, Mutex, Result, String, Vec, screen_context_status(), ScreenContextState (+5 more)

### Community 17 - "Overlay Window (Rust)"
Cohesion: 0.38
Nodes (12): close_overlay(), force_hide(), is_open(), open_overlay(), overlay_hidden(), OverlayState, reposition_if_visible(), request_close() (+4 more)

### Community 18 - "Capture Edge Overlay (Rust)"
Cohesion: 0.27
Nodes (12): close_annotation(), edge_label(), exclude_from_capture(), open_annotation(), remove_all_edge_overlays(), AppHandle, Option, Result (+4 more)

### Community 19 - "Dashboard Design Mockup"
Cohesion: 0.27
Nodes (11): ArcSonare Assistant Voice Bar (listening state with waveform), Ask ArcSonare Command Input (quick actions: Summarize updates, Draft email, Find insights, Create task; Smart mode), Connected Tools Panel (Notion, Slack, Google Drive, Outlook integrations), ArcSonare Command Center Dashboard Mockup, Focus Card (Launch briefing in 32 min, subtask progress dots), Global Search / Ask Bar with Cmd+K shortcut and status icons, Top Navigation Tabs (Dashboard / Tasks / Agent / Connect), Central Orbital Visualization with Orbiting Chips (Strategy deck, Market scan, Client sync) (+3 more)

### Community 20 - "Window Positioning (Rust)"
Cohesion: 0.45
Nodes (10): move_and_size(), pick_monitor(), position_overlay(), position_quick_menu(), AppHandle, Monitor, PhysicalPosition, Result (+2 more)

### Community 21 - "Data Usage & Notifications"
Cohesion: 0.40
Nodes (9): Path, DataUsage, file_size(), get_data_usage(), open_data_folder(), AppHandle, Result, String (+1 more)

### Community 22 - "Monitor Enumeration (Rust)"
Cohesion: 0.51
Nodes (9): all(), by_id(), describe(), list_monitors(), MonitorInfo, Monitor, Result, String (+1 more)

### Community 23 - "AI Model Registry"
Cohesion: 0.28
Nodes (8): MODEL_ROLE_INFO, modelById(), ModelInfo, MODELS, providerById(), ProviderId, ProviderInfo, PROVIDERS

### Community 24 - "Provider Credentials (Rust)"
Cohesion: 0.67
Nodes (6): delete_provider_key(), entry(), has_provider_key(), Result, String, set_provider_key()

### Community 25 - "System Tray (Rust)"
Cohesion: 0.83
Nodes (3): create_tray(), AppHandle, Result

## Knowledge Gaps
- **156 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+151 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Settings` connect `Settings UI & Types` to `App Shell & Voice State`, `Preferences Store`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **Why does `useSettings()` connect `App Shell & Voice State` to `Icons & Command UI`, `Settings UI & Types`, `Preferences Store`?**
  _High betweenness centrality (0.006) - this node is a cross-community bridge._
- **Why does `shortcutKeys()` connect `Settings UI & Types` to `App Shell & Voice State`, `Icons & Command UI`?**
  _High betweenness centrality (0.005) - this node is a cross-community bridge._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _156 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `App Shell & Voice State` be split into smaller, more focused modules?**
  _Cohesion score 0.0502497796062298 - nodes in this community are weakly interconnected._
- **Should `Icons & Command UI` be split into smaller, more focused modules?**
  _Cohesion score 0.09675324675324676 - nodes in this community are weakly interconnected._
- **Should `Settings UI & Types` be split into smaller, more focused modules?**
  _Cohesion score 0.07966457023060797 - nodes in this community are weakly interconnected._