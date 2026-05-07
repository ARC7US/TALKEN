import { useState } from "react";
import { API_BASE } from "../App.js";

interface PublishTaskProps {
  agentId: string;
  onPublished: () => void;
}

const SKILLS = ["search", "code", "analyze", "image", "translate", "verify"];

export function PublishTask({ agentId, onPublished }: PublishTaskProps) {
  const [skill, setSkill] = useState("search");
  const [paramsText, setParamsText] = useState('{\n  "query": "example"\n}');
  const [complexity, setComplexity] = useState("1.0");
  const [fee, setFee] = useState("10");
  const [ttl, setTtl] = useState("300");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    let params: Record<string, unknown>;
    try {
      params = JSON.parse(paramsText);
    } catch {
      setError("Invalid JSON in params field");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/tasks`, {
        method: "POST",
        headers: {
          "X-Talken-Agent-Id": agentId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          skill,
          params,
          complexity: parseFloat(complexity),
          fee: parseFloat(fee),
          ttl: parseInt(ttl, 10),
        }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setSuccess(`Task created: ${data.task.id}`);
      setTimeout(() => onPublished(), 1500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-xl">
      <h2 className="text-2xl font-bold mb-6">Publish Task</h2>

      {error && (
        <div className="bg-red-900/30 border border-red-700 text-red-300 rounded p-3 mb-4 text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-emerald-900/30 border border-emerald-700 text-emerald-300 rounded p-3 mb-4 text-sm">
          {success}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Skill */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Skill
          </label>
          <select
            value={skill}
            onChange={(e) => setSkill(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
          >
            {SKILLS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {/* Params */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Params (JSON)
          </label>
          <textarea
            value={paramsText}
            onChange={(e) => setParamsText(e.target.value)}
            rows={5}
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-emerald-500"
          />
        </div>

        {/* Complexity & Fee */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Complexity
            </label>
            <input
              type="number"
              step="0.1"
              min="0.1"
              max="10"
              value={complexity}
              onChange={(e) => setComplexity(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Fee
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>

        {/* TTL */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            TTL (seconds)
          </label>
          <input
            type="number"
            min="10"
            max="3600"
            value={ttl}
            onChange={(e) => setTtl(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded font-medium"
        >
          {submitting ? "Publishing..." : "Publish Task"}
        </button>
      </form>
    </div>
  );
}
