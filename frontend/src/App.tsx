import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export default function App() {
  const [greeting, setGreeting] = useState<string>("");
  const [name, setName] = useState<string>("");

  async function handleGreet() {
    const msg = await invoke<string>("greet", { name });
    setGreeting(msg);
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 gap-6">
      <div className="text-center space-y-2">
        <h1 className="text-4xl font-bold tracking-tight">
          Atlas Assets Editor
        </h1>
        <p className="text-slate-400 max-w-xl">
          Bridging legacy OTB and modern appearances.dat into a single
          workspace for Tibia 15.x.
        </p>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          className="px-3 py-2 rounded bg-slate-800 border border-slate-700 focus:outline-none focus:border-slate-500"
        />
        <button
          type="button"
          onClick={handleGreet}
          className="px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-500 transition-colors font-medium"
        >
          Test IPC
        </button>
      </div>

      {greeting && (
        <div className="px-4 py-2 rounded bg-slate-800 text-slate-200">
          {greeting}
        </div>
      )}

      <footer className="mt-8 text-xs text-slate-500">
        v0.1.0 · Phase 0 bootstrap
      </footer>
    </main>
  );
}
