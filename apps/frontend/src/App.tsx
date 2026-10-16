import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import Layout from "./components/Layout";
import AiAssistant from "./pages/AiAssistant";
import Dashboard from "./pages/Dashboard";
import Databases from "./pages/Databases";
import ErDiagram from "./pages/ErDiagram";
import DataStorage from "./pages/DataStorage";
import Docs from "./pages/Docs";
import ImportData from "./pages/ImportData";
import Learn from "./pages/Learn";
import Login from "./pages/Login";
import Performance from "./pages/Performance";
import Projects from "./pages/Projects";
import QueryHistoryPage from "./pages/QueryHistory";
import SchemaCompare from "./pages/SchemaCompare";
import Settings from "./pages/Settings";
import Workbench from "./pages/Workbench";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/sql" element={<Workbench />} />
            <Route path="/workbench" element={<Navigate to="/sql" replace />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/databases" element={<Databases />} />
            <Route path="/history" element={<QueryHistoryPage />} />
            <Route path="/er" element={<ErDiagram />} />
            <Route path="/compare" element={<SchemaCompare />} />
            <Route path="/import" element={<ImportData />} />
            <Route path="/performance" element={<Performance />} />
            <Route path="/ai" element={<AiAssistant />} />
            <Route path="/learn" element={<Learn />} />
            <Route path="/docs" element={<Docs />} />
            <Route path="/docs/:slug" element={<Docs />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/storage" element={<DataStorage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

