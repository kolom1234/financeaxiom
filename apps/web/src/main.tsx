import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles/tokens.css";
import "./styles/theme.css";
import "./styles/motion.css";
import { ConsentProvider } from "./state/consent";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <ConsentProvider>
        <App />
      </ConsentProvider>
    </BrowserRouter>
  </React.StrictMode>
);

