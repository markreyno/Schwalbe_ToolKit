"""Newline-delimited JSON backend. Stdout is exclusively for protocol replies."""
import json
import sys
from tools.counter import Counter
from tools.pallet_labels import prepare_labels, prepare_alignment


def dispatch(counter, request):
    if not isinstance(request, dict) or not isinstance(request.get("id"), str):
        raise ValueError("A string request ID is required.")
    operation = request.get("operation")
    if operation == "pallet.alignment":
        return prepare_alignment(request.get("payload"))
    if operation in ("pallet.prepare", "pallet.preview"):
        return prepare_labels(request.get("payload"), preview=operation == "pallet.preview")
    if operation == "counter.open":
        return counter.open()
    if operation not in ("counter.increment", "counter.close"):
        raise ValueError("Unsupported tool operation.")
    return counter.execute(operation, request.get("sessionId"))


def main():
    counter = Counter()
    for line in sys.stdin:
        request = None
        try:
            request = json.loads(line)
            result = dispatch(counter, request)
            reply = {"id": request["id"], "result": result}
        except (ValueError, TypeError) as error:
            reply = {"id": request.get("id") if isinstance(request, dict) else None,
                     "error": str(error)}
        except Exception:
            print("Unexpected backend error", file=sys.stderr, flush=True)
            reply = {"id": request.get("id") if isinstance(request, dict) else None,
                     "error": "The tool encountered an unexpected error."}
        print(json.dumps(reply), flush=True)


if __name__ == "__main__":
    main()
