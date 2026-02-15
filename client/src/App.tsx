import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import DocumentsPage from "./pages/DocumentsPage";
import DocumentDetailsPage from "./pages/DocumentDetailsPage";
import DocumentAnnotationPage from "./pages/DocumentAnnotationPage";
import DocumentVisualizationPage from "./pages/DocumentVisualizationPage";
import PromptEditorPage from "./pages/PromptEditorPage";
import TestPanelPage from "./pages/TestPanelPage";
import StatisticsPage from "./pages/StatisticsPage";
import UsersPage from "./pages/UsersPage";
import FaqChunksPage from "./pages/FaqChunksPage";
import DashboardLayout from "./components/DashboardLayout";

function Router() {
  // make sure to consider if you need authentication for certain routes
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path="/documents">
        <DashboardLayout>
          <DocumentsPage />
        </DashboardLayout>
      </Route>
      <Route path="/documents/:id">
        <DashboardLayout>
          <DocumentDetailsPage />
        </DashboardLayout>
      </Route>
      <Route path="/documents/:id/annotate">
        <DashboardLayout>
          <DocumentAnnotationPage />
        </DashboardLayout>
      </Route>
      <Route path="/documents/:id/visualize">
        <DashboardLayout>
          <DocumentVisualizationPage />
        </DashboardLayout>
      </Route>
      <Route path="/prompt-editor">
        <DashboardLayout>
          <PromptEditorPage />
        </DashboardLayout>
      </Route>
      <Route path="/test-panel">
        <DashboardLayout>
          <TestPanelPage />
        </DashboardLayout>
      </Route>
      <Route path="/statistics">
        <DashboardLayout>
          <StatisticsPage />
        </DashboardLayout>
      </Route>
      <Route path="/faq-chunks">
        <DashboardLayout>
          <FaqChunksPage />
        </DashboardLayout>
      </Route>
      <Route path="/users">
        <UsersPage />
      </Route>
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
        // switchable
      >
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
