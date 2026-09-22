import { useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";
import type { PortalSnapshot } from "../shared/types";
import { NavMenu } from "./components/NavMenu";
import { Admin } from "./pages/Admin";
import { Portal } from "./pages/Portal";
import { Reports } from "./pages/Reports";
import { Settings } from "./pages/Settings";
import { createFallbackSnapshot, loadPortalSnapshot, sendEmergencyAction } from "./utils/api";
import { subscribeToGateSimulation } from "./utils/gateSimulator";
import { createWeatherSnapshot } from "./utils/weatherSystem";

export default function App(){
  const [snapshot, setSnapshot] = useState<PortalSnapshot>(() => createFallbackSnapshot());
  const [connection, setConnection] = useState<"online" | "degraded">("degraded");

  useEffect(() => {
    let active = true;
    const abortController = new AbortController();

    const hydrate = async () => {
      const result = await loadPortalSnapshot(abortController.signal);
      if (!active) {
        return;
      }
      setSnapshot(result.snapshot);
      setConnection(result.source === "api" ? "online" : "degraded");
    };

    void hydrate();
    const timer = window.setInterval(() => {
      void hydrate();
    }, 20000);

    return () => {
      active = false;
      abortController.abort();
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    return subscribeToGateSimulation((gates) => {
      setSnapshot((current) => ({
        ...current,
        gates,
        dashboard: {
          ...current.dashboard,
          openGates: gates.filter((gate) => gate.status === "open").length,
          alerts: gates.filter((gate) => gate.status === "issue").length,
        },
      }));
    }, snapshot.gates);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const step = Math.floor(Date.now() / 15000) % 4;
      setSnapshot((current) => ({ ...current, weather: createWeatherSnapshot(step) }));
    }, 15000);
    return () => window.clearInterval(timer);
  }, []);

  const handleEmergencyAction = (action: "lockdown" | "fire" | "normal") => {
    void sendEmergencyAction(action).then((emergency) => {
      setSnapshot((current) => ({ ...current, emergency }));
    });
  };

  return (
    <div className="app-shell">
      <NavMenu />
      <main className="content-shell">
        <header className="top-bar panel">
          <div>
            <span className="eyebrow">Magic Keys command centre</span>
            <h2>Balwyn High School access operations</h2>
          </div>
          <div className="top-bar-meta">
            <span className={`pill pill-${connection}`}>{connection}</span>
            <span>{new Date(snapshot.weather.updatedAt).toLocaleTimeString()} weather sync</span>
          </div>
        </header>
        <Routes>
          <Route
            path="/"
            element={<Portal gates={snapshot.gates} weather={snapshot.weather} emergency={snapshot.emergency} onEmergencyAction={handleEmergencyAction} />}
          />
          <Route
            path="/admin"
            element={<Admin dashboard={snapshot.dashboard} accessRules={snapshot.accessRules} schedules={snapshot.schedules} insights={snapshot.insights} />}
          />
          <Route path="/reports" element={<Reports gates={snapshot.gates} insights={snapshot.insights} schedules={snapshot.schedules} />} />
          <Route path="/settings" element={<Settings emergency={snapshot.emergency} hireBookings={snapshot.hireBookings} />} />
        </Routes>
      </main>
    </div>
  );
}
