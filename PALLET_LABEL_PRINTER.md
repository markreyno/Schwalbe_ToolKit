# Pallet Label Printer

## Purpose

Generate labels for every pallet in a shipment, numbered from 1 through the total pallet count, and print two identical copies of each pallet's label using a hardwired label printer.

## Label stock

- Stock identified by the user: **Uline S-11266 direct thermal labels**, **8/case**.
- Size: 1.5 inches wide × 1 inch high.
- Format: labels on a roll.
- Connection: printer connected by a physical cable; the connection type is to be confirmed.

## Primary printer

- Model identified by the user: **Zebra ZM400**.
- Use its installed OS printer queue as the primary hardware test target.
- Retain selection of other OS-installed printers.
- The app already generates 38.1 × 25.4 mm pages, matching the stated label dimensions.
- Physical compatibility, feed alignment, and driver configuration have not yet been verified on this printer with this stock.

## Inputs

- **Company:** company name to display on the label.
- **Total Pallets:** the total number of pallets in the shipment.

The program generates the pallet numbers automatically; the user does not enter individual pallet numbers.

## Printer selection

- Discover and offer the printers installed and available through the operating system.
- Allow the user to select a printer before submitting a print job and switch between available printers.
- Use the selected printer's operating-system driver and print queue; do not hardcode a specific printer model.
- Support different printer makes and models that can print the required 1.5 × 1-inch roll labels through their installed drivers.
- Allow refreshing the printer list after a printer is added or connected.
- If no printer is available, or the selected printer cannot accept the job, display a clear message and allow the user to select another printer or retry.
- Apply the required label size and preserve the adjacent duplicate order on the selected printer.

## Label layout

Display the company and the pallet number/total pallets on each label:

```text
       [Company]
 [Pallet Number]/[Total Pallets]
```

Example:

```text
       YMC
       1/10
```

## Printing behavior

- Generate the full sequence from pallet **1** through **Total Pallets**, inclusive.
- Print **two identical copies of each pallet's label**, keeping the pair together before moving to the next pallet.
- Matching copies must be adjacent on the roll, in this exact print order: `1/10, 1/10, 2/10, 2/10, 3/10, 3/10, …, 10/10, 10/10`. Each entry is a separate label containing the company name and pallet fraction.
- For company `YMC` and total `10`, print `YMC 1/10` twice, `YMC 2/10` twice, and continue through `YMC 10/10` twice.
- Each submission produces **2 × Total Pallets** physical labels (20 labels for 10 pallets).
- Print each copy on its own 1.5 × 1-inch label on the roll.
- Fit all content inside the printable area without clipping.
- Use clear, readable text with no browser headers or footers.

## Input validation

- Require a company name.
- Require Total Pallets to be a positive whole number.

## Details to confirm during hardware setup

- Hardwired connection type (for example, USB or Ethernet).
- Installed Zebra ZM400 driver and OS queue name.
- Printer resolution and driver media settings for the specified direct thermal stock.
- Actual printable margins and roll orientation supported by the printer.

## Acceptance criteria

- Entering company `YMC` and total `10` generates pallet labels `1/10` through `10/10`, each displaying `YMC`.
- Each pallet label prints twice in sequence, producing 20 physical labels with no missing or extra pallet numbers.
- Verify adjacent pairs in the output: `1/10, 1/10, 2/10, 2/10, …, 10/10, 10/10`.
- Entering total `1` produces two identical `1/1` labels.
- Each copy occupies one label, with readable text and no clipped content.
- Invalid or missing inputs prevent submission and show a clear error.
- The user can select between multiple OS-installed printers, and the job is sent to the selected printer's queue.
- Refreshing the printer list makes newly installed or connected printers available for selection.
- Missing or unavailable printers produce a clear message without falsely reporting a successful print.

## Implemented workflow

The app prints directly to the selected OS printer queue, using a custom 38.1 × 25.4 mm page size. Each duplicate is a separate page in a single job, with driver copies set to one to preserve paired order. Job submission is reported separately from physical completion.

Current limits are 1–1,000 pallets per job and 80 characters per company name. Long names shrink to fit and are rejected if they cannot remain legible. Printer-specific margins and roll feed still require hardware validation.

## Alignment test

Select an OS printer and click **Print alignment test**. Company and total pallets are not required. Python generates exactly one 1.5 × 1-inch diagnostic label with a border inset 0.08 inch from each edge and a cross at the label center. The test uses the same page size and print path as shipment labels, with one copy.

Inspect the physical label: the border should be complete, opposite margins equal, and the cross centered. This is a visual check, not automatic calibration or alignment detection. The app reports queue submission only. Check the OS queue before retrying an uncertain job.
