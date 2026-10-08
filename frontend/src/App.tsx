// Application root: the route table plus a simple nav header.
//
// Design mapping ("Routing" section):
//  - `/`          → redirect to `/dashboard` (Requirement 1.1).
//  - `/call`      → CallPage (Requirement 1.2).
//  - `/dashboard` → Dashboard (Requirement 1.3).
//
// A lightweight nav header with links to the two pages lets a tester move
// between surfaces during a demo. Providers (Router, React Query, Toast) are
// mounted in src/main.tsx so this component can assume they exist.

import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import CallPage from './pages/CallPage';
import Dashboard from './pages/Dashboard';
import styles from './App.module.css';

export default function App() {
  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <span className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">
            🎙
          </span>
          Voice Agent
        </span>
        <span className={styles.spacer} />
        <nav className={styles.nav} aria-label="Primary">
          <NavLink
            to="/dashboard"
            className={({ isActive }) =>
              isActive ? `${styles.link} ${styles.linkActive}` : styles.link
            }
          >
            Dashboard
          </NavLink>
          <NavLink
            to="/call"
            className={({ isActive }) =>
              isActive ? `${styles.link} ${styles.linkActive}` : styles.link
            }
          >
            Call
          </NavLink>
        </nav>
      </header>

      <Routes>
        {/* `/` redirects to the dashboard (Req 1.1). */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        {/* `/call` renders the Call page (Req 1.2). */}
        <Route path="/call" element={<CallPage />} />
        {/* `/dashboard` renders the Dashboard (Req 1.3). */}
        <Route path="/dashboard" element={<Dashboard />} />
      </Routes>
    </div>
  );
}
