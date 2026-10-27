# Picker Water Scheduler

Track when pickers were last watered and who is due next.

## Desktop usage

1. Add pickers with name, interval (days), and last watered date.
2. Due or overdue pickers appear in the schedule, tool hub badge, and workspace banner.
3. Tap **Mark watered** when complete. Each mark appends a timestamp to that picker’s **Last watered** log (up to three entries, newest first, shown in local time).
4. Use the calendar view for upcoming dates.

## Connect PWA (phone)

Picker watering alerts on the phone hub are shown **only in the installed Connect PWA** (Add to Home Screen / installed app). In a normal mobile browser tab, the hub does not show watering notifications, badges, or push permission prompts.

When the installed hub is open:

- A **Picker watering** panel lists due/overdue pickers synced from the desktop when the hub is opened as an **installed PWA over HTTPS**. In the browser over HTTP, watering alerts still list in the hub when installed; push requires HTTPS.
- **Enable push alerts** appears only in the installed app after you tap it (required for permission on iOS). Subscriptions are stored on the desktop.

### Push support by platform

| Platform | In-app list (installed PWA) | Web Push |
| --- | --- | --- |
| Android (Chrome installed PWA) | Yes | Yes, after user taps **Enable push alerts** and grants permission |
| iPhone (Safari, installed to Home Screen, iOS 16.4+) | Yes | Yes, only from the installed PWA and only after a user gesture grants notification permission |
| Mobile browser tab (not installed) | No | No (UI and subscription are not offered) |

The hub **Test notification** demo on the desktop tool hub is separate; it does not change picker schedules.
