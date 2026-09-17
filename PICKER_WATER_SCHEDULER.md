# Picker Water Scheduler

## Goal

Add an in-app tool for tracking when each named picker (forklift) needs to be watered.

## Planned behavior

- Add, rename, and remove pickers with custom names.
- Use a two-week watering interval by default, with a configurable interval.
- Record when a picker is watered and calculate its next due date.
- Show upcoming and overdue watering dates in a color-coded calendar.
- Show an in-app notification banner for pickers due for watering.
- Show the number of due watering tasks on the tool entry in the app.

## Implementation notes

Fit the tool into the existing navigation, state storage, and notification patterns in this repository. Verify the date calculations and the main user flow after implementation.
