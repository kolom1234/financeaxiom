import { NavLink, Route, Routes } from "react-router-dom";
import { HomePage } from "./routes/HomePage";
import { EntityPage } from "./routes/EntityPage";
import { IndicatorPage } from "./routes/IndicatorPage";
import { FilingPage } from "./routes/FilingPage";
import { GdeltSourcePage } from "./routes/GdeltSourcePage";
import { AlertsPage } from "./routes/AlertsPage";
import { LegalPage } from "./routes/LegalPage";
import { PrivacyPage } from "./routes/PrivacyPage";
import { TermsPage } from "./routes/TermsPage";
import { NotFoundPage } from "./routes/NotFoundPage";
import { ConsentBanner } from "./components/ConsentBanner";
import { DisclaimerBlock } from "./components/DisclaimerBlock";

export default function App(): JSX.Element {
  return (
    <div className="app-shell">
      <header className="topbar glass-panel">
        <div className="brand-wrap">
          <span className="brand-dot" aria-hidden />
          <span className="brand-title">Open Finance Pulse</span>
        </div>
        <nav className="nav-links" aria-label="Primary">
          <NavLink to="/" className="nav-link">
            Home
          </NavLink>
          <NavLink to="/alerts" className="nav-link">
            Alerts
          </NavLink>
          <NavLink to="/login" className="nav-link">
            Login
          </NavLink>
          <NavLink to="/signup" className="nav-link">
            Sign up
          </NavLink>
          <NavLink to="/legal" className="nav-link">
            Legal
          </NavLink>
          <NavLink to="/privacy" className="nav-link">
            Privacy
          </NavLink>
          <NavLink to="/terms" className="nav-link">
            Terms
          </NavLink>
        </nav>
      </header>

      <main className="main-shell">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/source/gdelt" element={<GdeltSourcePage />} />
          <Route path="/t/:slug" element={<EntityPage />} />
          <Route path="/i/:seriesId" element={<IndicatorPage />} />
          <Route path="/f/:accession" element={<FilingPage />} />
          <Route path="/alerts" element={<AlertsPage view="alerts" />} />
          <Route path="/login" element={<AlertsPage view="login" />} />
          <Route path="/signup" element={<AlertsPage view="signup" />} />
          <Route path="/forgot-password" element={<AlertsPage view="reset" />} />
          <Route path="/legal" element={<LegalPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>

      <footer className="footer-wrap">
        <DisclaimerBlock />
      </footer>
      <ConsentBanner />
    </div>
  );
}
