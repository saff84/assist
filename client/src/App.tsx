import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/_core/hooks/useAuth";
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
import LlmSettingsPage from "./pages/LlmSettingsPage";
import LoginPage from "./pages/LoginPage";
import ChangePasswordPage from "./pages/ChangePasswordPage";
import DashboardLayout from "./components/DashboardLayout";
import { Loader2 } from "lucide-react";

function AuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading, user } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  if (user?.mustChangePassword) {
    return <ChangePasswordPage />;
  }

  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/change-password" component={ChangePasswordPage} />
      <Route path={"/"}>
        <AuthGate>
          <Home />
        </AuthGate>
      </Route>
      <Route path="/documents">
        <AuthGate>
          <DashboardLayout>
            <DocumentsPage />
          </DashboardLayout>
        </AuthGate>
      </Route>
      <Route path="/documents/:id">
        <AuthGate>
          <DashboardLayout>
            <DocumentDetailsPage />
          </DashboardLayout>
        </AuthGate>
      </Route>
      <Route path="/documents/:id/annotate">
        <AuthGate>
          <DashboardLayout>
            <DocumentAnnotationPage />
          </DashboardLayout>
        </AuthGate>
      </Route>
      <Route path="/documents/:id/visualize">
        <AuthGate>
          <DashboardLayout>
            <DocumentVisualizationPage />
          </DashboardLayout>
        </AuthGate>
      </Route>
      <Route path="/prompt-editor">
        <AuthGate>
          <DashboardLayout>
            <PromptEditorPage />
          </DashboardLayout>
        </AuthGate>
      </Route>
      <Route path="/llm-settings">
        <AuthGate>
          <DashboardLayout>
            <LlmSettingsPage />
          </DashboardLayout>
        </AuthGate>
      </Route>
      <Route path="/test-panel">
        <AuthGate>
          <DashboardLayout>
            <TestPanelPage />
          </DashboardLayout>
        </AuthGate>
      </Route>
      <Route path="/statistics">
        <AuthGate>
          <DashboardLayout>
            <StatisticsPage />
          </DashboardLayout>
        </AuthGate>
      </Route>
      <Route path="/faq-chunks">
        <AuthGate>
          <DashboardLayout>
            <FaqChunksPage />
          </DashboardLayout>
        </AuthGate>
      </Route>
      <Route path="/users">
        <AuthGate>
          <UsersPage />
        </AuthGate>
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
