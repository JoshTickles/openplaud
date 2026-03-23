"use client";

import { BookOpen, CheckCircle, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/use-settings";

interface ObsidianConfig {
    enabled: boolean;
    apiUrl: string;
    apiKey: string;
    vaultPath: string;
    autoExport: boolean;
}

const DEFAULT_CONFIG: ObsidianConfig = {
    enabled: false,
    apiUrl: "http://localhost:27123",
    apiKey: "",
    vaultPath: "",
    autoExport: false,
};

export function ObsidianSection() {
    const { isLoadingSettings, setIsLoadingSettings } = useSettings();
    const [config, setConfig] = useState<ObsidianConfig>(DEFAULT_CONFIG);
    const [isTesting, setIsTesting] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [testResult, setTestResult] = useState<"success" | "error" | null>(
        null,
    );
    const pendingChangesRef = useRef<Partial<ObsidianConfig>>({});

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const response = await fetch("/api/settings/obsidian");
                if (response.ok) {
                    const data = await response.json();
                    setConfig({
                        enabled: data.enabled ?? false,
                        apiUrl: data.apiUrl ?? DEFAULT_CONFIG.apiUrl,
                        apiKey: data.apiKey ?? "",
                        vaultPath: data.vaultPath ?? "",
                        autoExport: data.autoExport ?? false,
                    });
                }
            } catch (error) {
                console.error("Failed to fetch Obsidian settings:", error);
            } finally {
                setIsLoadingSettings(false);
            }
        };
        fetchSettings();
    }, [setIsLoadingSettings]);

    const saveConfig = async (updates: Partial<ObsidianConfig>) => {
        const previous = { ...config };
        const next = { ...config, ...updates };
        setConfig(next);
        pendingChangesRef.current = { ...pendingChangesRef.current, ...updates };
        setIsSaving(true);

        try {
            const response = await fetch("/api/settings/obsidian", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(next),
            });

            if (!response.ok) {
                throw new Error("Failed to save");
            }
            pendingChangesRef.current = {};
        } catch {
            setConfig(previous);
            pendingChangesRef.current = {};
            toast.error("Failed to save Obsidian settings. Changes reverted.");
        } finally {
            setIsSaving(false);
        }
    };

    const handleTestConnection = async () => {
        setIsTesting(true);
        setTestResult(null);

        try {
            const response = await fetch("/api/settings/obsidian/test", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    apiUrl: config.apiUrl,
                    apiKey: config.apiKey,
                }),
            });

            if (response.ok) {
                setTestResult("success");
                toast.success("Connected to Obsidian Local REST API");
            } else {
                setTestResult("error");
                const data = await response.json();
                toast.error(data.error || "Failed to connect to Obsidian");
            }
        } catch {
            setTestResult("error");
            toast.error("Could not reach Obsidian. Is the plugin running?");
        } finally {
            setIsTesting(false);
        }
    };

    if (isLoadingSettings) {
        return (
            <div className="flex items-center justify-center py-8">
                <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <h2 className="text-lg font-semibold flex items-center gap-2">
                <BookOpen className="w-5 h-5" />
                Obsidian Integration
            </h2>

            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <div className="space-y-0.5 flex-1">
                        <Label htmlFor="obsidian-enabled" className="text-base">
                            Enable Obsidian integration
                        </Label>
                        <p className="text-sm text-muted-foreground">
                            Export transcriptions directly to your Obsidian
                            vault via the Local REST API plugin
                        </p>
                    </div>
                    <Switch
                        id="obsidian-enabled"
                        checked={config.enabled}
                        onCheckedChange={(checked) =>
                            saveConfig({ enabled: checked })
                        }
                        disabled={isSaving}
                    />
                </div>

                {config.enabled && (
                    <div className="space-y-4 pl-4 border-l-2 border-primary/20">
                        <div className="space-y-2">
                            <Label htmlFor="obsidian-api-url">
                                API URL
                            </Label>
                            <Input
                                id="obsidian-api-url"
                                value={config.apiUrl}
                                onChange={(e) =>
                                    setConfig((prev) => ({
                                        ...prev,
                                        apiUrl: e.target.value,
                                    }))
                                }
                                onBlur={() =>
                                    saveConfig({ apiUrl: config.apiUrl })
                                }
                                placeholder="http://localhost:27123"
                                disabled={isSaving}
                            />
                            <p className="text-xs text-muted-foreground">
                                Default port is 27123 for HTTP or 27124 for
                                HTTPS. See the Obsidian Local REST API plugin
                                settings.
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="obsidian-api-key">
                                API Key
                            </Label>
                            <Input
                                id="obsidian-api-key"
                                type="password"
                                value={config.apiKey}
                                onChange={(e) =>
                                    setConfig((prev) => ({
                                        ...prev,
                                        apiKey: e.target.value,
                                    }))
                                }
                                onBlur={() =>
                                    saveConfig({ apiKey: config.apiKey })
                                }
                                placeholder="Your Obsidian REST API key"
                                disabled={isSaving}
                            />
                            <p className="text-xs text-muted-foreground">
                                Found in Obsidian → Settings → Local REST API
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="obsidian-vault-path">
                                Vault folder path
                            </Label>
                            <Input
                                id="obsidian-vault-path"
                                value={config.vaultPath}
                                onChange={(e) =>
                                    setConfig((prev) => ({
                                        ...prev,
                                        vaultPath: e.target.value,
                                    }))
                                }
                                onBlur={() =>
                                    saveConfig({ vaultPath: config.vaultPath })
                                }
                                placeholder="Plaud/Recordings"
                                disabled={isSaving}
                            />
                            <p className="text-xs text-muted-foreground">
                                Folder within your vault where notes will be
                                saved (e.g. "Plaud/Recordings")
                            </p>
                        </div>

                        <div className="flex items-center gap-3">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleTestConnection}
                                disabled={
                                    isTesting || !config.apiUrl || !config.apiKey
                                }
                            >
                                {isTesting ? "Testing..." : "Test connection"}
                            </Button>
                            {testResult === "success" && (
                                <span className="flex items-center gap-1.5 text-sm text-green-600">
                                    <CheckCircle className="w-4 h-4" />
                                    Connected
                                </span>
                            )}
                            {testResult === "error" && (
                                <span className="flex items-center gap-1.5 text-sm text-destructive">
                                    <XCircle className="w-4 h-4" />
                                    Connection failed
                                </span>
                            )}
                        </div>

                        <div className="flex items-center justify-between">
                            <div className="space-y-0.5 flex-1">
                                <Label
                                    htmlFor="obsidian-auto-export"
                                    className="text-base"
                                >
                                    Auto-export after transcription
                                </Label>
                                <p className="text-sm text-muted-foreground">
                                    Automatically export to Obsidian when a
                                    recording is transcribed
                                </p>
                            </div>
                            <Switch
                                id="obsidian-auto-export"
                                checked={config.autoExport}
                                onCheckedChange={(checked) =>
                                    saveConfig({ autoExport: checked })
                                }
                                disabled={isSaving}
                            />
                        </div>
                    </div>
                )}

                <div className="pt-4 border-t">
                    <p className="text-xs text-muted-foreground">
                        Requires the{" "}
                        <a
                            href="https://github.com/coddingtonbear/obsidian-local-rest-api"
                            target="_blank"
                            rel="noreferrer"
                            className="underline"
                        >
                            Obsidian Local REST API
                        </a>{" "}
                        community plugin to be installed and enabled in
                        Obsidian.
                    </p>
                </div>
            </div>
        </div>
    );
}
