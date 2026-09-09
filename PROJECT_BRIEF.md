# Schwalbe ToolKit — Desktop Tool Hub

## Goal

Build a desktop application that provides one place to open different tools and programs. Each tool appears in the hub with its own logo and a clear function name, such as **Counter** or **Pallet Label Printer**.

The first working tool is a counter. Pressing its counter button adds one to the displayed number. Every time the counter tool opens, it starts at zero.

## Technology stack

- **Electron:** Desktop application shell and window management.
- **React with TypeScript:** Hub interface and tool screens.
- **TanStack Router:** Navigation between the hub and individual tools.
- **TanStack Query:** Manage asynchronous requests and mutations to Python tools where useful.
- **Python:** Implement tool logic using Python libraries and frameworks as needed.
- **Vite:** Develop and build the React interface.

Assumption: “turnstack” in the original request means **TanStack**.

## Hub interface

The home screen displays a grid of tool cards. Each card includes:

- A distinct logo or icon.
- The tool's name.
- A short description of its function.
- An action to open the tool.

The first available card is **Counter**, with a plus or tally icon and the description “A simple counter that starts fresh every time.”

**Pallet Label Printer** is an example of a future tool name; implementing label printing is outside the first release.

Tool screens provide a clear way to return to the hub. Use readable labels, visible keyboard focus, and accessible buttons. Icons must be accompanied by text.

## First tool: Counter

### Required behavior

1. Open Counter from the hub.
2. Create a new Python counter session with a value of `0`.
3. Display the current value prominently.
4. Press the large counter button to add exactly `1` through the Python backend.
5. Display the value returned by Python after each successful press.
6. Leave the counter and return to the hub to end that session.
7. Open Counter again to start a new session at `0`.

Restarting the desktop app also starts the next counter session at `0`. Counter values are not saved to disk or restored from a previous session. Normal React rerenders must not reset an active session.

### Interaction and errors

- Allow mouse and standard keyboard button activation.
- Show a loading state while a session is opening.
- Serialize increment requests so rapid presses cannot lose updates or display responses out of order.
- Prevent increments before initialization succeeds.
- Show a readable error if Python cannot start or a request fails.
- Do not display a successful increment unless Python confirms it.
- Do not automatically retry increment requests, because an uncertain response could otherwise increment twice.

## Application architecture

```text
React tool hub and tool screens
              |
       Typed preload API
              |
     Electron main process
              |
  JSON requests over stdin/stdout
              |
       Python tool backend
```

The React renderer handles presentation. Python owns each tool's functional logic, including counter state. Electron starts and supervises the Python process and routes requests through a narrow preload bridge.

Use Electron context isolation with renderer Node integration disabled. Expose only supported tool operations through the preload API. Validate request inputs in the main process and Python backend.

Use newline-delimited JSON for local process communication. Include a request ID in every request and response so Electron can match concurrent operations. Reserve Python stdout for protocol messages and write diagnostics to stderr.

### Suggested counter operations

| Operation | Behavior |
| --- | --- |
| `counter.open` | Create a new session and return its ID and value `0`. |
| `counter.increment` | Add one to the specified session and return its current value. |
| `counter.close` | Release the specified session. |

Session IDs prevent a late response from a closed counter from affecting a newly opened counter. Reject requests for unknown or closed sessions. Discard stale responses in the interface and clear cached counter data when closing the tool.

Stop the managed Python process when Electron exits. If Python stops unexpectedly, show a recovery action that opens a fresh session at zero.

## Adding future tools

Maintain a tool registry containing each tool's ID, name, description, icon, route, and availability. Keep each tool's Python logic in a separate module and each tool's React screen in its own folder.

Future tools can use specialized Python libraries without changing how users discover and open tools in the hub. Add dependencies only when a tool needs them.

## Suggested project structure

```text
Schwalbe_ToolKit/
  electron/
    main.ts
    preload.ts
    pythonBridge.ts
  src/
    app/
      router.tsx
      toolRegistry.ts
    components/
      ToolCard.tsx
    pages/
      ToolHub.tsx
    tools/
      counter/
        CounterPage.tsx
    assets/
      tool-icons/
  python/
    main.py
    tools/
      counter.py
    requirements.txt
  shared/
    protocol.ts
  package.json
  PROJECT_BRIEF.md
```

## Implementation sequence

1. Scaffold Electron, React, TypeScript, Vite, and TanStack navigation.
2. Build the hub and a reusable tool card with a Counter icon.
3. Implement Python process startup and the typed request/response bridge.
4. Implement Python counter sessions and increment operations.
5. Connect the Counter screen and its open/close lifecycle.
6. Verify counting, reopening, rapid presses, and failure recovery.
7. Package the desktop app with its Python backend so users do not need to install Python separately.

Windows is the initial packaging target based on the current workspace. Other desktop platforms can be added later with platform-specific builds.

## Acceptance criteria

- The application launches as an Electron desktop app.
- The React hub displays a Counter card with a logo and function name.
- Opening Counter displays `0`.
- Each accepted press performs one Python increment and displays the confirmed result.
- Ten accepted presses display `10`.
- Returning to the hub and reopening Counter displays `0`.
- Closing and relaunching the app does not restore a previous count.
- Ordinary rerenders preserve the current open session's value.
- Responses from an old session cannot change a newly opened counter.
- Python failures show a useful error without falsely reporting successful actions.
- A packaged Windows build runs without requiring a separate Python installation.

## First-release scope

Deliver the desktop hub, tool registry, Counter tool, Python integration, and Windows packaging. Accounts, cloud services, saved counter history, label printing, and additional tools are outside this initial scope.

## Pallet printer update

Pallet Label Printer is now implemented as the second available tool. Its current requirements are in PALLET_LABEL_PRINTER.md. Electron handles OS printer discovery and native job submission directly; the counter continues to use Python. This update extends the original first-release scope above.


## Python tool ownership

All tools implement their functional logic in Python under `python/tools`. Counter state, pallet input validation, paired sequences, preview data, and print document generation belong to Python. React presents the interface; Electron provides the narrow OS adapter for printer discovery, document rendering and fitting, and native print queue submission. New tools must follow this split.
