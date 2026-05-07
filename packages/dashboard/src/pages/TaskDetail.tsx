import { useState, useEffect, useCallback } from "react";
import { API_BASE } from "../App.js";
import type { Task, VerificationVote, Settlement } from "@talken/shared";

interface TaskDetailProps {
  taskId: string;
  agentId: string;
  onBack: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  published: "bg-blue-600",
  accepted: "bg-yellow-600",
  submitted: "bg-purple-600",
  verified: "bg-indigo-600",
  confirmed: "bg-emerald-600",
  settled: "bg-green-700",
  expired: "bg-gray-600",
  rejected: "bg-red-600",
};

const TIMELINE_STATUSES = [
  "published",
  "accepted",
  "submitted",
  "verified",
  "confirmed",
  "settled",
];

export function TaskDetail({ taskId, agentId, onBack }: TaskDetailProps) {
  const [task, setTask] = useState<Task | null>(null);
  const [votes, setVotes] = useState<VerificationVote[]>([]);
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/tasks/${taskId}`, {
        headers: { "X-Talken-Agent-Id": agentId },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTask(data.task);
      setVotes(data.task.verificationVotes ?? []);
      setSettlement(data.task.settlement ?? null);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to fetch task");
    } finally {
      setLoading(false);
    }
  }, [taskId, agentId]);

  useEffect(() => {
    fetchDetail();
    const interval = setInterval(fetchDetail, 3000);
    return () => clearInterval(interval);
  }, [fetchDetail]);

  const handleVote = async (passed: boolean) => {
    try {
      const res = await fetch(`${API_BASE}/tasks/${taskId}/verify`, {
        method: "POST",
        headers: {
          "X-Talken-Agent-Id": agentId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ passed }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      await fetchDetail();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Vote failed");
    }
  };

  const handleConfirm = async () => {
    try {
      const res = await fetch(`${API_BASE}/tasks/${taskId}/confirm`, {
        method: "POST",
        headers: { "X-Talken-Agent-Id": agentId },
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      await fetchDetail();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Confirm failed");
    }
  };

  const handleReject = async () => {
    const reason = prompt("Rejection reason (optional):");
    try {
      const res = await fetch(`${API_BASE}/tasks/${taskId}/reject`, {
        method: "POST",
        headers: {
          "X-Talken-Agent-Id": agentId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reason: reason ?? undefined }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      await fetchDetail();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Reject failed");
    }
  };

  if (loading) return <p className="text-gray-400">Loading task detail...</p>;
  if (error)
    return (
      <div>
        <button onClick={onBack} className="text-emerald-400 hover:underline mb-4 text-sm">
          &larr; Back to Market
        </button>
        <p className="text-red-400">{error}</p>
      </div>
    );
  if (!task) return null;

  const currentIdx = TIMELINE_STATUSES.indexOf(task.status);

  return (
    <div>
      <button
        onClick={onBack}
        className="text-emerald-400 hover:underline mb-4 text-sm"
      >
        &larr; Back to Market
      </button>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <span className="text-xs font-mono text-gray-400">{task.id}</span>
          <h2 className="text-2xl font-bold capitalize mt-1">{task.skill}</h2>
        </div>
        <span
          className={`px-3 py-1.5 rounded-full text-sm font-medium text-white ${STATUS_COLORS[task.status] ?? "bg-gray-600"}`}
        >
          {task.status}
        </span>
      </div>

      {/* Timeline */}
      <div className="bg-gray-800 rounded-lg p-5 mb-6 border border-gray-700">
        <h3 className="text-sm font-semibold text-gray-400 mb-4">Lifecycle</h3>
        <div className="flex items-center gap-1">
          {TIMELINE_STATUSES.map((s, i) => (
            <div key={s} className="flex items-center flex-1">
              <div className="flex flex-col items-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                    i <= currentIdx
                      ? "bg-emerald-600 text-white"
                      : "bg-gray-700 text-gray-500"
                  }`}
                >
                  {i + 1}
                </div>
                <span className="text-xs mt-1 text-gray-400">{s}</span>
              </div>
              {i < TIMELINE_STATUSES.length - 1 && (
                <div
                  className={`flex-1 h-0.5 mx-1 ${
                    i < currentIdx ? "bg-emerald-600" : "bg-gray-700"
                  }`}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Task info grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          ["Fee", task.fee],
          ["Complexity", task.complexity],
          ["Publisher", task.publisherId],
          ["Executor", task.executorId ?? "—"],
          ["TTL", `${task.ttl}s`],
          ["Quality Score", task.qualityScore ?? "—"],
          ["Consensus", task.consensusResult === null ? "—" : task.consensusResult ? "Pass" : "Fail"],
          ["Created", new Date(task.createdAt).toLocaleString()],
        ].map(([label, value]) => (
          <div key={label as string} className="bg-gray-800 rounded p-3 border border-gray-700">
            <span className="text-xs text-gray-400">{label as string}</span>
            <p className="font-medium mt-1 text-sm">{String(value)}</p>
          </div>
        ))}
      </div>

      {/* Params */}
      <div className="bg-gray-800 rounded-lg p-5 mb-6 border border-gray-700">
        <h3 className="text-sm font-semibold text-gray-400 mb-2">Params</h3>
        <pre className="text-sm text-gray-300 bg-gray-900 rounded p-3 overflow-auto">
          {JSON.stringify(task.params, null, 2)}
        </pre>
      </div>

      {/* Result */}
      {task.result && (
        <div className="bg-gray-800 rounded-lg p-5 mb-6 border border-gray-700">
          <h3 className="text-sm font-semibold text-gray-400 mb-2">Result</h3>
          <pre className="text-sm text-gray-300 bg-gray-900 rounded p-3 overflow-auto">
            {JSON.stringify(task.result, null, 2)}
          </pre>
        </div>
      )}

      {/* Votes */}
      {votes.length > 0 && (
        <div className="bg-gray-800 rounded-lg p-5 mb-6 border border-gray-700">
          <h3 className="text-sm font-semibold text-gray-400 mb-3">
            Verification Votes
          </h3>
          <div className="space-y-2">
            {votes.map((v) => (
              <div
                key={v.id}
                className="flex items-center justify-between bg-gray-900 rounded p-3"
              >
                <span className="font-mono text-sm">{v.validatorId}</span>
                <span
                  className={`px-2 py-0.5 rounded text-xs font-medium ${
                    v.passed
                      ? "bg-green-800 text-green-200"
                      : "bg-red-800 text-red-200"
                  }`}
                >
                  {v.passed ? "PASS" : "FAIL"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Settlement */}
      {settlement && (
        <div className="bg-gray-800 rounded-lg p-5 mb-6 border border-emerald-800">
          <h3 className="text-sm font-semibold text-emerald-400 mb-3">
            Settlement
          </h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-gray-400">Fee Transfer</span>
              <p>{settlement.feeTransfer}</p>
            </div>
            <div>
              <span className="text-gray-400">Mint Reward</span>
              <p>{settlement.mintReward}</p>
            </div>
            <div>
              <span className="text-gray-400">Tx Hash</span>
              <p className="font-mono text-xs break-all">{settlement.txHash}</p>
            </div>
            <div>
              <span className="text-gray-400">Settled At</span>
              <p>{new Date(settlement.settledAt).toLocaleString()}</p>
            </div>
          </div>
          {Object.keys(settlement.validatorRewards).length > 0 && (
            <div className="mt-3">
              <span className="text-gray-400 text-sm">Validator Rewards</span>
              <div className="mt-1 space-y-1">
                {Object.entries(settlement.validatorRewards).map(([vid, amt]) => (
                  <div key={vid} className="flex justify-between text-sm">
                    <span className="font-mono">{vid}</span>
                    <span>{amt}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-3">
        {task.status === "submitted" && (
          <>
            <button
              onClick={() => handleVote(true)}
              className="px-5 py-2.5 bg-green-600 hover:bg-green-500 rounded font-medium"
            >
              Vote Pass
            </button>
            <button
              onClick={() => handleVote(false)}
              className="px-5 py-2.5 bg-red-600 hover:bg-red-500 rounded font-medium"
            >
              Vote Fail
            </button>
          </>
        )}
        {task.status === "verified" && task.publisherId === agentId && (
          <>
            <button
              onClick={handleConfirm}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 rounded font-medium"
            >
              Confirm
            </button>
            <button
              onClick={handleReject}
              className="px-5 py-2.5 bg-red-600 hover:bg-red-500 rounded font-medium"
            >
              Reject
            </button>
          </>
        )}
      </div>
    </div>
  );
}
