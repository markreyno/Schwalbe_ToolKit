"""Pallet label rules and print document generation, owned by Python."""
from html import escape

STYLE = """
@page { size: 1.5in 1in; margin: 0; }
* { box-sizing: border-box; } html, body { margin: 0; padding: 0; }
.label { width: 1.5in; height: 1in; padding: .08in; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; font-family: Arial, sans-serif; break-after: page; overflow: hidden; }
.label:last-child { break-after: auto; }
.company { width: 100%; font-size: 14pt; font-weight: bold; overflow-wrap: anywhere; line-height: 1.1; }
.number { font-size: 20pt; font-weight: bold; line-height: 1.1; margin-top: .04in; }
"""


def prepare_labels(job, preview=False):
    if not isinstance(job, dict):
        raise ValueError("A label job is required.")
    company = job.get("company")
    if not isinstance(company, str) or not 1 <= len(company.strip()) <= 80:
        raise ValueError("Enter a company name of 1–80 characters.")
    total = job.get("total")
    if isinstance(total, bool) or not isinstance(total, (int, float)) or not 1 <= total <= 1000 or int(total) != total:
        raise ValueError("Enter a whole number from 1 to 1,000 for total pallets.")
    total = int(total)
    if not preview and (not isinstance(job.get("printerName"), str) or not job["printerName"].strip()):
        raise ValueError("Select a printer.")
    labels = [f"{number}/{total}" for number in range(1, total + 1) for _ in range(2)]
    result = {"company": company.strip(), "labels": labels[:6], "labelCount": len(labels), "lastLabel": labels[-1]}
    if preview:
        return result
    pages = ''.join(f'<section class="label"><div class="company">{escape(company.strip())}</div><div class="number">{label}</div></section>' for label in labels)
    result["html"] = '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>Pallet labels</title><style>' + STYLE + '</style></head><body>' + pages + '</body></html>'
    result["pageSize"] = {"width": 38100, "height": 25400}
    return result


def prepare_alignment(job):
    """One diagnostic label, independent of shipment fields and duplicate rules."""
    if not isinstance(job, dict) or not isinstance(job.get("printerName"), str) or not job["printerName"].strip():
        raise ValueError("Select a printer.")
    css = """
    .alignment { position: relative; }
    .frame { position: absolute; inset: .08in; border: .75pt solid black; }
    .horizontal { position: absolute; left: .55in; top: .5in; width: .4in; border-top: .75pt solid black; transform: translateY(-50%); }
    .vertical { position: absolute; left: .75in; top: .3in; height: .4in; border-left: .75pt solid black; transform: translateX(-50%); }
    .caption { position: absolute; left: .12in; right: .12in; text-align: center; font: bold 7pt Arial; }
    .top { top: .14in; } .bottom { bottom: .14in; font-size: 6pt; }
    """
    html = '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>Alignment test</title><style>' + STYLE + css + '</style></head><body><section class="label alignment"><div class="frame"></div><div class="horizontal"></div><div class="vertical"></div><div class="caption top">ALIGNMENT TEST</div><div class="caption bottom">1.5 × 1 in · ONE LABEL</div></section></body></html>'
    return {"html": html, "labelCount": 1, "pageSize": {"width": 38100, "height": 25400}}
