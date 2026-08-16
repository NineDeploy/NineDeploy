import { useEffect, useState } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router";
import { Layout } from "./components/Layout";
import { Home } from "./pages/Home";
import { Features } from "./pages/Features";
import { DocsLayout, docPages, DocPage } from "./pages/Docs";
import { Changelog } from "./pages/Changelog";
import { Faq } from "./pages/Faq";
import { NotFound } from "./pages/NotFound";

function ScrollToTop() {
  const { pathname } = useLocation();
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on every route change
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export default function App() {
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  );

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem("nd-site-theme", theme);
    } catch {
      /* private mode */
    }
  }, [theme]);

  return (
    <Layout theme={theme} onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/features" element={<Features />} />
        <Route path="/changelog" element={<Changelog />} />
        <Route path="/faq" element={<Faq />} />
        <Route path="/docs" element={<DocsLayout />}>
          <Route index element={<Navigate to="/docs/introduction" replace />} />
          {docPages.map((d) => (
            <Route key={d.slug} path={d.slug} element={<DocPage doc={d} />} />
          ))}
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  );
}
