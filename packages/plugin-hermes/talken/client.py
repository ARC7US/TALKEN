"""TALKEN HTTP client for Hermes Agent."""

from __future__ import annotations

import os
import time
from typing import Any, Dict, List, Optional
from urllib import request as urllib_request
from urllib.error import HTTPError, URLError
import json


class TalkenError(Exception):
    pass


class TalkenClient:
    """Lightweight HTTP client for TALKEN Task Market API."""

    def __init__(
        self,
        base_url: str | None = None,
        agent_id: str | None = None,
        skills: List[str] | None = None,
    ):
        self.base_url = (base_url or os.environ.get("TALKEN_URL", "http://localhost:3001")).rstrip("/")
        self.agent_id = agent_id or os.environ.get("TALKEN_AGENT_ID", f"hermes-agent-{int(time.time()):x}")
        self.skills = skills or (os.environ.get("TALKEN_SKILLS", "search,code,analyze").split(","))
        self._registered = False

    # ── HTTP helpers ────────────────────────────────────────────────────

    def _request(
        self,
        method: str,
        path: str,
        body: dict | None = None,
    ) -> dict:
        url = f"{self.base_url}{path}"
        headers = {
            "Content-Type": "application/json",
            "X-Talken-Agent-Id": self.agent_id,
        }
        data = json.dumps(body).encode() if body else None

        req = urllib_request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib_request.urlopen(req, timeout=30) as resp:
                raw = resp.read().decode()
                return json.loads(raw) if raw else {}
        except HTTPError as e:
            err_body = e.read().decode() if e.fp else ""
            try:
                err_data = json.loads(err_body)
                msg = err_data.get("error", {}).get("message", err_body)
            except Exception:
                msg = err_body or str(e)
            raise TalkenError(f"[{e.code}] {msg}") from e
        except URLError as e:
            raise TalkenError(f"Connection failed: {e.reason}") from e

    # ── Registration ────────────────────────────────────────────────────

    def ensure_registered(self) -> None:
        if self._registered:
            return
        try:
            self._request("POST", "/api/v1/agents", {
                "id": self.agent_id,
                "name": self.agent_id,
                "skills": self.skills,
            })
            self._registered = True
        except TalkenError:
            # Already registered is fine
            self._registered = True

    # ── Role ────────────────────────────────────────────────────────────

    def set_role(self, role: str) -> dict:
        self.ensure_registered()
        return self._request("PATCH", f"/api/v1/agents/{self.agent_id}", {
            "role": role,
        })

    # ── Tasks ───────────────────────────────────────────────────────────

    def publish_task(self, skill: str, description: str, fee: float, complexity: float | None = None) -> dict:
        self.ensure_registered()
        body: dict = {
            "skill": skill,
            "params": {"description": description},
            "fee": fee,
            "publisherId": self.agent_id,
        }
        if complexity is not None:
            body["complexity"] = complexity
        return self._request("POST", "/api/v1/tasks", body)

    def accept_task(self, task_id: str) -> dict:
        self.ensure_registered()
        return self._request("POST", f"/api/v1/tasks/{task_id}/accept", {
            "executorId": self.agent_id,
        })

    def submit_result(self, task_id: str, content: str) -> dict:
        self.ensure_registered()
        return self._request("POST", f"/api/v1/tasks/{task_id}/submit", {
            "executorId": self.agent_id,
            "result": {"content": content},
        })

    def list_tasks(self, status: str | None = None, limit: int = 10) -> list:
        self.ensure_registered()
        params = f"?limit={limit}"
        if status:
            params += f"&status={status}"
        resp = self._request("GET", f"/api/v1/tasks{params}")
        return resp.get("data", resp) if isinstance(resp, dict) else resp

    def get_task(self, task_id: str) -> dict:
        return self._request("GET", f"/api/v1/tasks/{task_id}")

    # ── Voting ──────────────────────────────────────────────────────────

    def vote(self, task_id: str, passed: bool) -> dict:
        self.ensure_registered()
        return self._request("POST", f"/api/v1/tasks/{task_id}/verify", {
            "validatorId": self.agent_id,
            "passed": passed,
        })

    # ── Profile ─────────────────────────────────────────────────────────

    def get_profile(self) -> dict:
        self.ensure_registered()
        resp = self._request("GET", f"/api/v1/agents/{self.agent_id}")
        return resp.get("data", resp)

    def get_balance(self) -> dict:
        return self.get_profile()

    # ── Staking ─────────────────────────────────────────────────────────

    def stake(self, amount: float) -> dict:
        self.ensure_registered()
        return self._request("POST", f"/api/v1/agents/{self.agent_id}/stake", {
            "amount": amount,
        })
