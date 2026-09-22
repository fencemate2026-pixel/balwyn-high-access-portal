import { useEffect, useRef } from "react";
import type { EmergencyState, GateStatus, WeatherSnapshot } from "../../shared/types";
import { buildCampusScene } from "../utils/sceneBuilder";

interface Scene3DProps {
  gates: GateStatus[];
  weather: WeatherSnapshot;
  emergency: EmergencyState;
}

export function Scene3D({ gates, weather, emergency }: Scene3DProps){
  const mountRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<ReturnType<typeof buildCampusScene> | null>(null);

  useEffect(() => {
    if (!mountRef.current) {
      return;
    }

    controllerRef.current = buildCampusScene(mountRef.current, gates, weather, emergency);
    return () => controllerRef.current?.destroy();
  }, []);

  useEffect(() => {
    controllerRef.current?.updateGates(gates);
  }, [gates]);

  useEffect(() => {
    controllerRef.current?.updateWeather(weather);
  }, [weather]);

  useEffect(() => {
    controllerRef.current?.updateEmergency(emergency);
  }, [emergency]);

  return <div ref={mountRef} className="scene-shell" aria-label="3D campus scene" />;
}
