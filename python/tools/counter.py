"""In-memory counters. A new session always starts at zero."""
from uuid import uuid4


class Counter:
    def __init__(self):
        self.sessions = {}

    def open(self):
        session_id = str(uuid4())
        self.sessions[session_id] = 0
        return {"sessionId": session_id, "value": 0}

    def execute(self, operation, session_id):
        if not isinstance(session_id, str) or session_id not in self.sessions:
            raise ValueError("This counter session has ended. Open a fresh counter.")
        if operation == "counter.close":
            del self.sessions[session_id]
            return {"closed": True}
        self.sessions[session_id] += 1
        return {"sessionId": session_id, "value": self.sessions[session_id]}
