/**
 * Enhanced Dashboard Header Component
 * Professional Balwyn High School Magic Keys Portal
 * Features: Premium branding, LED status indicators, 3D effects
 */

"use client";

import { LogOut, Menu, Bell, Settings, User } from "lucide-react";

interface DashboardHeaderProps {
  user?: {
    name?: string;
    email?: string;
    role?: string;
  };
  systemStatus?: "operational" | "maintenance" | "alert";
  onMenuClick?: () => void;
  onLogout?: () => void;
}

export default function EnhancedDashboardHeader({
  user,
  systemStatus = "operational",
  onMenuClick,
  onLogout,
}: DashboardHeaderProps) {
  return (
    <header className="portal-dashboard-header">
      {/* Left Section - Logo & Brand */}
      <div className="portal-dashboard-header-brand">
        <button
          onClick={onMenuClick}
          className="sidebar-toggle"
          aria-label="Toggle sidebar"
        >
          <Menu size={24} />
        </button>

        <div className="portal-dashboard-logo">
          🔐
        </div>

        <div>
          <h1 className="portal-dashboard-title">Magic Keys</h1>
          <p className="portal-dashboard-subtitle">Balwyn High School Access Portal</p>
        </div>
      </div>

      {/* Center Section - Status */}
      <div className="portal-dashboard-status">
        <div
          className={`status-dot ${
            systemStatus === "operational"
              ? "active"
              : systemStatus === "maintenance"
                ? "warning"
                : "inactive"
          }`}
        />
        <span>
          {systemStatus === "operational"
            ? "System Operational"
            : systemStatus === "maintenance"
              ? "Maintenance Mode"
              : "Alert - Action Required"}
        </span>
      </div>

      {/* Right Section - User Actions */}
      <div className="portal-dashboard-actions">
        <button className="action-button" aria-label="Notifications">
          <Bell size={20} />
          <span className="notification-badge">2</span>
        </button>

        <button className="action-button" aria-label="Settings">
          <Settings size={20} />
        </button>

        <div className="user-menu">
          <button className="user-button" aria-label="User menu">
            <div className="user-avatar">{user?.name?.charAt(0) || "J"}</div>
            <div className="user-info">
              <span className="user-name">{user?.name || "Jarrod Abdulais"}</span>
              <span className="user-role">{user?.role || "System Administrator"}</span>
            </div>
          </button>

          <button
            onClick={onLogout}
            className="logout-button"
            aria-label="Sign out"
          >
            <LogOut size={18} />
            Sign Out
          </button>
        </div>
      </div>
    </header>
  );
}

/* Enhanced Header Styles */
const headerStyles = `
.sidebar-toggle {
  background: transparent;
  border: none;
  color: #e9f6ff;
  cursor: pointer;
  padding: 0.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  transition: all 200ms;
}

.sidebar-toggle:hover {
  background: rgba(20, 117, 168, 0.15);
}

.portal-dashboard-actions {
  display: flex;
  align-items: center;
  gap: 1.5rem;
}

.action-button {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #e9f6ff;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 200ms;
  position: relative;
}

.action-button:hover {
  background: rgba(20, 117, 168, 0.2);
  border-color: rgba(99, 200, 255, 0.3);
}

.notification-badge {
  position: absolute;
  top: -8px;
  right: -8px;
  background: #c52836;
  color: white;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 12px rgba(197, 40, 54, 0.4);
  animation: ledFlash 1.2s ease-in-out infinite;
}

.user-menu {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.user-button {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 0.5rem 1rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  cursor: pointer;
  transition: all 200ms;
  color: #e9f6ff;
}

.user-button:hover {
  background: rgba(20, 117, 168, 0.2);
  border-color: rgba(99, 200, 255, 0.3);
}

.user-avatar {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: linear-gradient(135deg, #1475a8 0%, #0099ff 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 14px;
  flex-shrink: 0;
  box-shadow: 0 2px 8px rgba(20, 117, 168, 0.3);
}

.user-info {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  font-size: 12px;
}

.user-name {
  font-weight: 600;
  color: #ffffff;
}

.user-role {
  color: #99b8cc;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.logout-button {
  background: rgba(197, 40, 54, 0.2);
  border: 1px solid rgba(197, 40, 54, 0.3);
  color: #ff6b5b;
  padding: 0.625rem 1rem;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  font-weight: 500;
  font-size: 13px;
  transition: all 200ms;
}

.logout-button:hover {
  background: rgba(197, 40, 54, 0.3);
  border-color: rgba(197, 40, 54, 0.5);
  color: #ff8c7b;
}

@media (max-width: 768px) {
  .portal-dashboard-actions {
    gap: 1rem;
  }
  
  .user-info {
    display: none;
  }
  
  .user-button {
    padding: 0.5rem;
  }
}
`;

export { headerStyles };
