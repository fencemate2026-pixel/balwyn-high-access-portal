import { NavLink } from "react-router-dom";
import { NAV_ITEMS } from "../../shared/constants";

export function NavMenu(){
  return (
    <aside className="nav-shell">
      <div className="brand-block">
        <span className="brand-chip">Magic Keys</span>
        <h1>3D Access Control Portal</h1>
        <p>Balwyn High School campus automation, safety, and gate visibility.</p>
      </div>
      <nav className="nav-menu" aria-label="Portal navigation">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.path} to={item.path} end={item.path === "/"} className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
            <strong>{item.label}</strong>
            <span>{item.description}</span>
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-footer">
        <strong>Live Operations</strong>
        <span>Pi relay bridge · PostgreSQL schema · AI assistance</span>
      </div>
    </aside>
  );
}
