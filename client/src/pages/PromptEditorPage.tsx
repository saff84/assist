import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Save, RotateCcw } from "lucide-react";
import { toast } from "sonner";

export default function PromptEditorPage() {
  const [prompt, setPrompt] = useState("");
  const [originalPrompt, setOriginalPrompt] = useState("");
  const [hasChanges, setHasChanges] = useState(false);

  // Fetch current system prompt
  const { data: currentPrompt, isLoading } = trpc.document.getSystemPrompt.useQuery();

  // Update system prompt mutation
  const updatePromptMutation = trpc.document.updateSystemPrompt.useMutation({
    onSuccess: () => {
      toast.success("System prompt updated successfully");
      setOriginalPrompt(prompt);
      setHasChanges(false);
    },
    onError: (error) => {
      toast.error(error.message || "Failed to update system prompt");
    },
  });

  useEffect(() => {
    if (currentPrompt?.prompt) {
      setPrompt(currentPrompt.prompt);
      setOriginalPrompt(currentPrompt.prompt);
    }
  }, [currentPrompt]);

  const handlePromptChange = (value: string) => {
    setPrompt(value);
    setHasChanges(value !== originalPrompt);
  };

  const handleSave = () => {
    if (prompt.trim().length < 10) {
      toast.error("System prompt must be at least 10 characters long");
      return;
    }
    updatePromptMutation.mutate({ prompt });
  };

  const handleReset = () => {
    setPrompt(originalPrompt);
    setHasChanges(false);
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-96">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">System Prompt Editor</h1>
        <p className="text-muted-foreground">Customize how the AI assistant responds to queries</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Editor */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Edit System Prompt</CardTitle>
              <CardDescription>
                This prompt defines the assistant's behavior and response style
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                value={prompt}
                onChange={(e) => handlePromptChange(e.target.value)}
                placeholder="Enter system prompt..."
                className="min-h-96 font-mono text-sm"
              />

              <div className="flex gap-2">
                <Button
                  onClick={handleSave}
                  disabled={!hasChanges || updatePromptMutation.isPending}
                  className="gap-2"
                >
                  {updatePromptMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      Save Changes
                    </>
                  )}
                </Button>

                <Button
                  onClick={handleReset}
                  variant="outline"
                  disabled={!hasChanges}
                  className="gap-2"
                >
                  <RotateCcw className="w-4 h-4" />
                  Reset
                </Button>
              </div>

              {hasChanges && (
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-md text-sm text-yellow-800">
                  You have unsaved changes
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Preview & Tips */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tips</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-3 text-muted-foreground">
              <div>
                <p className="font-medium text-foreground mb-1">Be Specific</p>
                <p>Define the assistant's role and expertise clearly</p>
              </div>

              <div>
                <p className="font-medium text-foreground mb-1">Set Tone</p>
                <p>Specify the communication style (professional, friendly, etc.)</p>
              </div>

              <div>
                <p className="font-medium text-foreground mb-1">Provide Context</p>
                <p>Mention the documents or knowledge base the assistant uses</p>
              </div>

              <div>
                <p className="font-medium text-foreground mb-1">Set Boundaries</p>
                <p>Specify what the assistant should or shouldn't do</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Current Prompt</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm bg-muted p-3 rounded-md max-h-48 overflow-y-auto font-mono text-xs">
                {originalPrompt}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
