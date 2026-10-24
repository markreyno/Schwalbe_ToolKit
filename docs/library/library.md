# Library

The **Library** is the in-app documentation for Schwalbe ToolKit. Every tool has a guide you can read without leaving the desktop app.

## What it does

- Searchable list of tool guides in the sidebar
- Step-by-step usage, phone setup, and troubleshooting
- Markdown guides bundled with the app under `docs/library/`
- Works **offline** after the toolkit has been opened once (guides are compiled into the desktop UI)

## How to use

1. Open **Library** from the tool hub.
2. Type in **Search guides** to filter by tool name, category, or keywords.
3. Select a guide in the sidebar to read it.
4. Use **All tools** to return to the hub.

## Adding a new guide

When you add a tool to the registry:

1. Create `docs/library/<tool-id>.md` with Markdown content.
2. Add an entry to `libraryEntries` in `src/tools/library/libraryManifest.ts`.
3. Rebuild the app. No server is required for Library itself.

## Phone setup notes

Library is desktop-only. For phone workflows, see **Connect PWA**, **Freight Pictures**, or **PalletVision Data Collector**.

## Troubleshooting

**Guide missing or empty**

- Confirm the `.md` file id matches the manifest entry id.
- Run `npm run build` so Vite bundles the new file.

**Search shows no results**

- Clear the search field or try a broader keyword from the tool category.
