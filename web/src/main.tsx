import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import Atlas from "./pages/Atlas";
import Console from "./pages/Console";

import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route index element={<Navigate to="/atlas" replace />} />
        <Route path="atlas" element={<Atlas />} />
        <Route path="console" element={<Console />} />
        <Route path="*" element={<Navigate to="/atlas" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
