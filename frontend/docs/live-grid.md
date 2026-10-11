# Live Grid

Live Grid is a project presentation route, `/projects/:projectId/grid`. Open it with **Open Grid**, beside **Open Kanban** in an orchestrator session, or from the project board. The board's existing task behavior is unchanged.

## Sessions and lifecycle

- Cell `[0, 0]` belongs to the project's orchestrator. A missing orchestrator leaves a reconnect placeholder; opening Grid never spawns one.
- Workers come from the same workspace query and CDC event transport as Kanban. Creation appends workers in stable creation order; streamed status updates do not sort panels.
- Archived, merged and terminated workers are hidden by default. **Show completed** reveals them. An unknown activity or connection failure does not count as completion.
- Chat uses the existing `SessionChatSurface` / `ChatWorkspace`, including reasoning, activities, history, approvals and its composer. TUI uses the existing `TerminalPane`, xterm and terminal mux. Grid never mounts `SessionView`'s automatic resume-on-open flow.
- Retained portals move the same Chat and terminal DOM between Grid and the session view. Parking preserves buffers, scroll and composer state. A hidden pane is inert and cannot consume input or steal focus. Authoritative session deletion, interface changes and existing terminal generation changes dispose the appropriate resources.
- Restoration is an explicit action through AO's existing restore controls. Viewing, resizing, ordering or changing routes does not call spawn, resume, kill or interface-transition APIs.

## Layout and controls

The layout enumerates readable column counts for the measured workspace, then minimizes a score combining cell aspect ratio (target 1.35), unused cells and required scrolling. Cells have minimum dimensions of **360 × 280 CSS pixels**. When all rows cannot fit, the workspace scrolls instead of compressing terminals. A narrow workspace may also scroll horizontally.

The orchestrator occupies the first cell in row order. Workers have stable keys and remain sibling components when the shape changes. Column and row dividers resize adjacent tracks while preserving their combined size and minimum dimensions. Window resizing redistributes saved proportions with a water-filling algorithm, clamping each track to its minimum.

Drag a worker's grip to another worker, or use its previous/next buttons. Double-click a header or click its expand button to maximize; restore returns to the saved grid. Divider arrow keys resize by 10 pixels, or 50 with Shift, when the divider itself has focus. Terminal keyboard shortcuts continue through xterm, including font zoom and its existing fullscreen action.

Order, the selected orchestrator, completed visibility and split proportions are saved per project in Electron local storage (`ao.live-grid.v1.*`). Splits are remembered separately for each grid shape. No database migration is required.

All local terminals share AO's existing mux socket. The WebGL pool remains capped at eight accelerated terminals; additional panes use xterm's interactive DOM renderer. Terminal fitting uses the existing resize coalescing. Chat conversations share the existing query cache and CDC connection.

## Separate macOS lab build

Build from an isolated checkout with its own dependencies:

```sh
cd frontend
npm ci
npm run build:daemon
npm run build:tmux
npm run browser-runtime:prepare
npm run build:acp-runtime
AO_BUILD_VARIANT=live-grid-lab npx electron-forge package --platform=darwin --arch=arm64
```

The bundle is named **Agent Orchestrator Live Grid.app**, with bundle ID `dev.agent-orchestrator.live-grid-lab`. It forces a separate data directory, run file, Electron profile and tmux socket, even if ordinary AO environment variables are inherited. Its default root is `~/.ao/live-grid-lab`, and its port is 32191. `AO_LIVE_GRID_LAB_ROOT` and `AO_LIVE_GRID_LAB_PORT` can select another isolated root and unused port.

This build disables updates, automatic relocation to Applications, stale-copy retirement and registration of the production deep-link protocol. Cloud state and the Browser runtime also use its isolated root. It does not attach to installed AO sessions. Open a disposable project in it; keep commercial projects in the installed version.

For the full native fixture check, run from the lab checkout:

```sh
AO_GRID_APP_PATH='/absolute/path/Agent Orchestrator Live Grid.app' node e2e/live-grid-desktop.mjs
```

The script creates a temporary Git project and a deterministic test provider, then uses the packaged preload, real daemon, SQLite, PTY and ACP runtimes. It rejects an occupied port and verifies the fixture provider before creating sessions. Cleanup addresses only its own recorded session IDs in its isolated daemon. Screenshots, provider PID evidence and a validation report remain in the reported temporary directory.

## Rollout

The lab bundle is for parallel evaluation and does not migrate production data. Do not copy a live AO database into another running daemon, replace the installed app, or point the lab at commercial workspaces. A production transition should use a reviewed, signed release containing this branch, during a planned update window with an AO data backup and the normal session restore procedure. This implementation changes presentation and requires no session or model configuration migration.

The initial Grid route covers local projects. Remote-host and cloud project navigation remains in the existing views. Platform packaging and notarization need the project's normal release infrastructure.
