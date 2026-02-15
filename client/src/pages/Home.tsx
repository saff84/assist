import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";
import { FileText, MessageSquare, Settings, BarChart3, Zap, Users, HelpCircle } from "lucide-react";

export default function Home() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      <div className="container mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-2">AI Knowledge Assistant</h1>
          <p className="text-lg text-muted-foreground">
            Manage your knowledge base and configure the assistant
          </p>

          <p className="text-sm text-muted-foreground mt-2">
            Аккаунт: {user?.name ?? "Admin"} ({user?.email ?? "admin@localhost"})
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 mb-12">
          <Link href="/documents">
            <Card className="cursor-pointer hover:shadow-lg transition-shadow h-full">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-blue-500" />
                  <CardTitle>Documents</CardTitle>
                </div>
                <CardDescription>Manage your knowledge base</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Upload, organize, and manage PDF, Excel, and Word documents
                </p>
              </CardContent>
            </Card>
          </Link>

          <Link href="/prompt-editor">
            <Card className="cursor-pointer hover:shadow-lg transition-shadow h-full">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Settings className="w-5 h-5 text-green-500" />
                  <CardTitle>Prompt Editor</CardTitle>
                </div>
                <CardDescription>Configure assistant behavior</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Customize the system prompt to define assistant personality
                </p>
              </CardContent>
            </Card>
          </Link>

          <Link href="/test-panel">
            <Card className="cursor-pointer hover:shadow-lg transition-shadow h-full">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-purple-500" />
                  <CardTitle>Test Panel</CardTitle>
                </div>
                <CardDescription>Test the assistant</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Chat with the assistant and verify responses before deployment
                </p>
              </CardContent>
            </Card>
          </Link>

          <Link href="/statistics">
            <Card className="cursor-pointer hover:shadow-lg transition-shadow h-full">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-orange-500" />
                  <CardTitle>Statistics</CardTitle>
                </div>
                <CardDescription>Monitor performance</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  View usage statistics, popular questions, and performance metrics
                </p>
              </CardContent>
            </Card>
          </Link>

          <Link href="/faq-chunks">
            <Card className="cursor-pointer hover:shadow-lg transition-shadow h-full">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <HelpCircle className="w-5 h-5 text-emerald-500" />
                  <CardTitle>FAQ Chunks</CardTitle>
                </div>
                <CardDescription>Manual Q/A knowledge</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Create and edit “problem → answer” snippets (with images) for chat responses
                </p>
              </CardContent>
            </Card>
          </Link>

          <Link href="/users">
            <Card className="cursor-pointer hover:shadow-lg transition-shadow h-full">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-cyan-500" />
                  <CardTitle>Users</CardTitle>
                </div>
                <CardDescription>User management is simplified</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  View information about the built-in administrator account
                </p>
              </CardContent>
            </Card>
          </Link>
        </div>

        <div className="bg-card border rounded-lg p-8">
          <h2 className="text-2xl font-bold mb-6">Features</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex gap-3">
              <Zap className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-1" />
              <div>
                <p className="font-medium">RAG-Powered Responses</p>
                <p className="text-sm text-muted-foreground">
                  Answers based on your knowledge base documents
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <FileText className="w-5 h-5 text-blue-500 flex-shrink-0 mt-1" />
              <div>
                <p className="font-medium">Multi-Format Support</p>
                <p className="text-sm text-muted-foreground">
                  PDF, Excel, Word documents supported
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <MessageSquare className="w-5 h-5 text-purple-500 flex-shrink-0 mt-1" />
              <div>
                <p className="font-medium">Multiple Integrations</p>
                <p className="text-sm text-muted-foreground">
                  Website chat and Bitrix24 integration
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <BarChart3 className="w-5 h-5 text-orange-500 flex-shrink-0 mt-1" />
              <div>
                <p className="font-medium">Detailed Analytics</p>
                <p className="text-sm text-muted-foreground">
                  Track usage, performance, and popular questions
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
