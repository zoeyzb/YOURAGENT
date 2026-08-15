"use client";

import { useEffect, useRef, useState } from "react";

type DograhState = {
  workflowRunId?: number | null;
  connectionStatus?: string;
};

type DograhWidgetApi = {
  start: () => Promise<void> | void;
  end: () => Promise<void> | void;
  stop: () => Promise<void> | void;
  getState: () => DograhState;
  onReady: (callback: () => void) => void;
  onCallConnected: (callback: () => void) => void;
  onCallEnd: (callback: () => void) => void;
  onError: (callback: (error: unknown) => void) => void;
  onStatusChange: (callback: (status: string) => void) => void;
};

declare global {
  interface Window {
    DograhWidget?: DograhWidgetApi;
  }
}

type TestSessionResponse = {
  testSession: {
    id: string;
    expiresAt: string;
    scriptSrc: string;
  };
};

export function TestAgentButton({ agentId, disabled = false }: { agentId: string; disabled?: boolean }) {
  const [status, setStatus] = useState<"idle" | "preparing" | "ready" | "connecting" | "connected" | "ending" | "error">("idle");
  const [error, setError] = useState("");
  const sessionId = useRef<string | null>(null);
  const injectedScript = useRef<HTMLScriptElement | null>(null);
  const cleaning = useRef(false);

  async function archivePreview() {
    if (!sessionId.current || cleaning.current) return;
    cleaning.current = true;
    const id = sessionId.current;
    sessionId.current = null;
    try {
      await fetch(`/api/agents/${agentId}/test-session?sessionId=${encodeURIComponent(id)}`, { method: "DELETE" });
    } finally {
      cleaning.current = false;
    }
  }

  function removeWidgetArtifacts() {
    document.getElementById("dograh-widget-root")?.remove();
    document.getElementById("dograh-widget-styles")?.remove();
    document.getElementById("dograh-chat-styles")?.remove();
    injectedScript.current?.remove();
    injectedScript.current = null;
    delete window.DograhWidget;
  }

  async function reset() {
    try {
      await window.DograhWidget?.stop();
    } catch {
      // Runtime may already be disconnected.
    }
    await archivePreview();
    removeWidgetArtifacts();
  }

  useEffect(() => {
    return () => {
      void reset();
    };
    // Cleanup intentionally only runs on unmount; agentId is stable per page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startTest() {
    setStatus("preparing");
    setError("");

    try {
      await reset();
      const response = await fetch(`/api/agents/${agentId}/test-session`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not prepare test agent");

      const data = body as TestSessionResponse;
      sessionId.current = data.testSession.id;

      const script = document.createElement("script");
      script.src = data.testSession.scriptSrc;
      script.async = true;
      script.setAttribute("data-dograh-context", JSON.stringify({
        source: "youragent_test_console",
        agent_id: agentId,
      }));
      injectedScript.current = script;

      const ready = new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error("Dograh test widget did not initialize")), 15000);
        script.onerror = () => {
          window.clearTimeout(timeout);
          reject(new Error("Could not load Dograh test runtime"));
        };
        script.onload = () => {
          const widget = window.DograhWidget;
          if (!widget) {
            window.clearTimeout(timeout);
            reject(new Error("Dograh widget API is unavailable"));
            return;
          }
          widget.onReady(() => {
            window.clearTimeout(timeout);
            resolve();
          });
          widget.onStatusChange((next) => {
            if (next === "connecting") setStatus("connecting");
            if (next === "connected") setStatus("connected");
            if (next === "failed") setStatus("error");
          });
          widget.onCallConnected(() => setStatus("connected"));
          widget.onCallEnd(() => {
            setStatus("idle");
            void archivePreview();
          });
          widget.onError((cause) => {
            setError(cause instanceof Error ? cause.message : "Dograh test runtime failed");
            setStatus("error");
          });
        };
      });

      document.body.appendChild(script);
      await ready;
      setStatus("ready");
      await window.DograhWidget?.start();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Test agent failed");
      setStatus("error");
      await reset();
    }
  }

  async function endTest() {
    setStatus("ending");
    setError("");
    try {
      await window.DograhWidget?.end();
    } catch {
      // Cleanup still runs below.
    }
    await archivePreview();
    removeWidgetArtifacts();
    setStatus("idle");
  }

  const active = ["ready", "connecting", "connected", "ending"].includes(status);

  return (
    <div>
      {active ? (
        <button className="btn" onClick={endTest} disabled={status === "ending"}>
          {status === "ending" ? "Ending test…" : status === "connected" ? "End test call" : `Stop test · ${status}`}
        </button>
      ) : (
        <button className="btn" onClick={startTest} disabled={disabled || status === "preparing"}>
          {status === "preparing" ? "Preparing isolated test…" : "Test agent in browser"}
        </button>
      )}
      {status === "connected" ? <p style={{ color: "#bbf7d0", marginTop: 10 }}>Microphone connected to the isolated Dograh preview.</p> : null}
      {error ? <p style={{ color: "#fca5a5", marginTop: 10 }}>{error}</p> : null}
    </div>
  );
}
