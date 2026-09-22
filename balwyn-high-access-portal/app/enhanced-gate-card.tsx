/**
 * Enhanced Gate Status Card Component
 * Features: 3D depth effects, animated LED indicators, real-life styling
 * Professional Balwyn High School Magic Keys Portal
 */

"use client";

import { ChevronRight, AlertTriangle, Clock, Lock, Unlock } from "lucide-react";
import type { Gate, GateVisualState } from "@/lib/portal-model";

interface EnhancedGateCardProps {
  gate: Gate;
  status: GateVisualState;
  lastUpdated?: Date;
  onRemoteOpen?: () => void;
  isLoading?: boolean;
}

const statusConfig = {
  open: {
    label: "Open",
    color: "open",
    icon: Unlock,
    bgColor: "rgba(8, 122, 85, 0.08)",
    textColor: "#087a55",
  },
  closed: {
    label: "Closed",
    color: "closed",
    icon: Lock,
    bgColor: "rgba(197, 40, 54, 0.08)",
    textColor: "#c52836",
  },
  moving: {
    label: "Moving",
    color: "open",
    icon: ChevronRight,
    bgColor: "rgba(244, 166, 0, 0.08)",
    textColor: "#f4a600",
  },
  unknown: {
    label: "Unknown",
    color: "issue",
    icon: AlertTriangle,
    bgColor: "rgba(244, 166, 0, 0.08)",
    textColor: "#f4a600",
  },
  issue: {
    label: "Issue",
    color: "issue",
    icon: AlertTriangle,
    bgColor: "rgba(244, 166, 0, 0.08)",
    textColor: "#f4a600",
  },
};

export default function EnhancedGateCard({
  gate,
  status,
  lastUpdated,
  onRemoteOpen,
  isLoading,
}: EnhancedGateCardProps) {
  const config = statusConfig[status];
  const Icon = config.icon;

  const timeAgo = lastUpdated
    ? Math.round((Date.now() - lastUpdated.getTime()) / 1000)
    : null;

  const formatTimeAgo = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  };

  return (
    <div className="gate-card atmospheric-glow portal-card-3d">
      {/* Card Header */}
      <div className="gate-card-header">
        {/* LED Indicator - Animated */}
        <div className={`gate-led-indicator ${config.color}`} />

        {/* Gate Name */}
        <span>{gate.name}</span>

        {/* Status Badge */}
        <div
          className="status-badge"
          style={{ backgroundColor: config.bgColor, color: config.textColor }}
        >
          <Icon size={14} />
          {config.label}
        </div>
      </div>

      {/* Status Information */}
      <div className="gate-card-status">
        <div className="status-item">
          <span className="status-label">Current State</span>
          <span className="status-value" style={{ color: config.textColor }}>
            {config.label}
          </span>
        </div>

        {timeAgo && (
          <div className="status-item">
            <Clock size={14} />
            <span className="status-time">{formatTimeAgo(timeAgo)}</span>
          </div>
        )}
      </div>

      {/* Gate Details Grid */}
      <div className="gate-card-info">
        <div className="gate-info-row">
          <span className="info-label">Gate ID</span>
          <span className="info-value">{gate.id}</span>
        </div>

        <div className="gate-info-row">
          <span className="info-label">Location</span>
          <span className="info-value">{gate.location || "Main Campus"}</span>
        </div>

        {gate.schedule && (
          <div className="gate-info-row">
            <span className="info-label">Schedule</span>
            <span className="info-value">{gate.schedule}</span>
          </div>
        )}

        {status === "issue" && (
          <div className="gate-info-error">
            <AlertTriangle size={16} />
            <span>Controller communication lost. Check ACB-004 board.</span>
          </div>
        )}
      </div>

      {/* Action Button - Remote Open */}
      {status !== "open" && (
        <button
          onClick={onRemoteOpen}
          disabled={isLoading || status === "issue"}
          className="remote-open-button"
          aria-label={`Open ${gate.name}`}
        >
          {isLoading ? (
            <>
              <span className="spinner" />
              Opening...
            </>
          ) : (
            <>
              <Unlock size={16} />
              Remote Open
            </>
          )}
        </button>
      )}

      {status === "open" && (
        <div className="gate-open-status">
          <CheckCircle size={16} />
          Gate is currently open
        </div>
      )}
    </div>
  );
}

// Icon helper - check circle
function CheckCircle({ size, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size || 24}
      height={size || 24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
    >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

/* ============================================================
   ENHANCED GATE CARD STYLES
   ============================================================ */

const gateCardStyles = `
.gate-card {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.gate-card-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid #e8eef5;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  margin-left: auto;
}

.gate-card-status {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  font-size: 13px;
}

.status-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #586d7a;
}

.status-value {
  font-weight: 600;
  font-family: "Outfit", sans-serif;
}

.status-time {
  font-size: 12px;
  color: #99b8cc;
}

.gate-card-info {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.gate-info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem;
  background: #f8fbfd;
  border-radius: 6px;
  font-size: 14px;
}

.info-label {
  color: #586d7a;
  font-weight: 500;
}

.info-value {
  color: #102c46;
  font-weight: 600;
  font-family: "Outfit", sans-serif;
}

.gate-info-error {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem;
  background: linear-gradient(135deg, #fde8e8 0%, #fff5f5 100%);
  border: 1px solid #ffd7d7;
  border-radius: 8px;
  color: #c52836;
  font-size: 13px;
  font-weight: 500;
}

.remote-open-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.875rem 1.5rem;
  background: linear-gradient(135deg, #c52836 0%, #a81f2a 100%);
  color: white;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  transition: all 200ms cubic-bezier(0.34, 1.56, 0.64, 1);
  box-shadow: 0 4px 12px rgba(197, 40, 54, 0.25);
  margin-top: 0.5rem;
}

.remote-open-button:hover:not(:disabled) {
  box-shadow: 0 8px 24px rgba(197, 40, 54, 0.35);
  transform: translateY(-2px);
}

.remote-open-button:active:not(:disabled) {
  transform: translateY(0);
}

.remote-open-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.gate-open-status {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.875rem 1.5rem;
  background: linear-gradient(135deg, #e8f5e9 0%, #d4edda 100%);
  border: 1px solid #087a55;
  border-radius: 8px;
  color: #087a55;
  font-weight: 600;
  text-align: center;
  justify-content: center;
}

.gate-open-status svg {
  color: #087a55;
}

/* 3D Hover Effect */
.gate-card:hover {
  box-shadow: 0 12px 36px rgba(20, 117, 168, 0.15),
              0 24px 72px rgba(20, 117, 168, 0.08);
}

/* Responsive */
@media (max-width: 768px) {
  .gate-card-header {
    flex-wrap: wrap;
  }
  
  .status-badge {
    margin-left: 0;
    margin-top: 0.5rem;
    width: 100%;
    justify-content: center;
  }
  
  .gate-info-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }
}
`;

export { gateCardStyles };
