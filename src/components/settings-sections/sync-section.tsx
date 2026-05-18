"use client";

import { KeyRound, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/use-settings";
import {
    PLAUD_SERVERS,
    type PlaudServerKey,
} from "@/lib/plaud/servers";

const syncIntervalPresets = [
    { label: "1 minute", value: 60 * 1000 },
    { label: "2 minutes", value: 2 * 60 * 1000 },
    { label: "5 minutes", value: 5 * 60 * 1000 },
    { label: "10 minutes", value: 10 * 60 * 1000 },
    { label: "15 minutes", value: 15 * 60 * 1000 },
    { label: "30 minutes", value: 30 * 60 * 1000 },
    { label: "1 hour", value: 60 * 60 * 1000 },
];

const getSyncIntervalLabel = (value: number) => {
    return (
        syncIntervalPresets.find((p) => p.value === value)?.label || "Custom"
    );
};

export function SyncSection() {
    const { isLoadingSettings, isSavingSettings, setIsLoadingSettings } =
        useSettings();
    const [syncInterval, setSyncInterval] = useState(300000);
    const [autoSyncEnabled, setAutoSyncEnabled] = useState(true);
    const [syncOnMount, setSyncOnMount] = useState(true);
    const [syncOnVisibilityChange, setSyncOnVisibilityChange] = useState(true);
    const [syncNotifications, setSyncNotifications] = useState(true);
    const [showReconnect, setShowReconnect] = useState(false);
    const [bearerToken, setBearerToken] = useState("");
    const [server, setServer] = useState<PlaudServerKey>("apac");
    const [isReconnecting, setIsReconnecting] = useState(false);
    const [connectedServer, setConnectedServer] = useState<string | null>(null);

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const [settingsRes, connectionRes] = await Promise.all([
                    fetch("/api/settings/user"),
                    fetch("/api/plaud/connection"),
                ]);
                if (settingsRes.ok) {
                    const data = await settingsRes.json();
                    setSyncInterval(data.syncInterval ?? 300000);
                    setAutoSyncEnabled(data.autoSyncEnabled ?? true);
                    setSyncOnMount(data.syncOnMount ?? true);
                    setSyncOnVisibilityChange(
                        data.syncOnVisibilityChange ?? true,
                    );
                    setSyncNotifications(data.syncNotifications ?? true);
                }
                if (connectionRes.ok) {
                    const conn = await connectionRes.json();
                    if (conn.server) {
                        setServer(conn.server);
                        setConnectedServer(conn.server);
                    }
                }
            } catch (error) {
                console.error("Failed to fetch settings:", error);
            } finally {
                setIsLoadingSettings(false);
            }
        };
        fetchSettings();
    }, [setIsLoadingSettings]);

    const handleReconnect = async () => {
        const token = bearerToken.trim().replace(/^Bearer\s+/i, "");
        if (!token) {
            toast.error("Please enter your bearer token");
            return;
        }
        setIsReconnecting(true);
        try {
            const response = await fetch("/api/plaud/connect", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ bearerToken: token, server }),
            });
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || "Failed to connect");
            }
            toast.success("Plaud reconnected successfully");
            setBearerToken("");
            setShowReconnect(false);
            setConnectedServer(server);
        } catch (error) {
            toast.error(
                error instanceof Error ? error.message : "Failed to reconnect",
            );
        } finally {
            setIsReconnecting(false);
        }
    };

    const handleSyncSettingChange = async (updates: {
        syncInterval?: number;
        autoSyncEnabled?: boolean;
        syncOnMount?: boolean;
        syncOnVisibilityChange?: boolean;
        syncNotifications?: boolean;
    }) => {
        const previousValues: Record<string, unknown> = {};
        if (updates.syncInterval !== undefined) {
            previousValues.syncInterval = syncInterval;
            setSyncInterval(updates.syncInterval);
        }
        if (updates.autoSyncEnabled !== undefined) {
            previousValues.autoSyncEnabled = autoSyncEnabled;
            setAutoSyncEnabled(updates.autoSyncEnabled);
        }
        if (updates.syncOnMount !== undefined) {
            previousValues.syncOnMount = syncOnMount;
            setSyncOnMount(updates.syncOnMount);
        }
        if (updates.syncOnVisibilityChange !== undefined) {
            previousValues.syncOnVisibilityChange = syncOnVisibilityChange;
            setSyncOnVisibilityChange(updates.syncOnVisibilityChange);
        }
        if (updates.syncNotifications !== undefined) {
            previousValues.syncNotifications = syncNotifications;
            setSyncNotifications(updates.syncNotifications);
        }

        try {
            const response = await fetch("/api/settings/user", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(updates),
            });

            if (!response.ok) {
                throw new Error("Failed to save settings");
            }
        } catch {
            if (updates.syncInterval !== undefined) {
                const prev = previousValues.syncInterval;
                if (typeof prev === "number") setSyncInterval(prev);
            }
            if (updates.autoSyncEnabled !== undefined) {
                const prev = previousValues.autoSyncEnabled;
                if (typeof prev === "boolean") setAutoSyncEnabled(prev);
            }
            if (updates.syncOnMount !== undefined) {
                const prev = previousValues.syncOnMount;
                if (typeof prev === "boolean") setSyncOnMount(prev);
            }
            if (updates.syncOnVisibilityChange !== undefined) {
                const prev = previousValues.syncOnVisibilityChange;
                if (typeof prev === "boolean") setSyncOnVisibilityChange(prev);
            }
            if (updates.syncNotifications !== undefined) {
                const prev = previousValues.syncNotifications;
                if (typeof prev === "boolean") setSyncNotifications(prev);
            }
            toast.error("Failed to save settings. Changes reverted.");
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
                <RefreshCw className="w-5 h-5" />
                Sync Settings
            </h2>
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <div className="space-y-0.5 flex-1">
                        <Label className="text-base">Plaud Connection</Label>
                        <p className="text-sm text-muted-foreground">
                            {connectedServer
                                ? `Connected via ${PLAUD_SERVERS[connectedServer as PlaudServerKey]?.label ?? connectedServer}`
                                : "Not connected"}
                        </p>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowReconnect(!showReconnect)}
                    >
                        <KeyRound className="w-4 h-4 mr-2" />
                        {showReconnect ? "Cancel" : "Update Token"}
                    </Button>
                </div>

                {showReconnect && (
                    <div className="space-y-3 rounded-lg border p-4">
                        <div className="space-y-2">
                            <Label htmlFor="reconnect-server">API Server</Label>
                            <Select
                                value={server}
                                onValueChange={(v) =>
                                    setServer(v as PlaudServerKey)
                                }
                            >
                                <SelectTrigger
                                    id="reconnect-server"
                                    disabled={isReconnecting}
                                >
                                    <SelectValue placeholder="Select API server" />
                                </SelectTrigger>
                                <SelectContent>
                                    {(
                                        Object.entries(PLAUD_SERVERS) as [
                                            PlaudServerKey,
                                            (typeof PLAUD_SERVERS)[PlaudServerKey],
                                        ][]
                                    ).map(([key, s]) => (
                                        <SelectItem key={key} value={key}>
                                            {s.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="reconnect-token">Bearer Token</Label>
                            <Input
                                id="reconnect-token"
                                type="text"
                                placeholder="Bearer ..."
                                value={bearerToken}
                                onChange={(e) => setBearerToken(e.target.value)}
                                disabled={isReconnecting}
                                className="font-mono text-sm"
                            />
                        </div>
                        <Button
                            onClick={handleReconnect}
                            disabled={isReconnecting}
                            className="w-full"
                        >
                            {isReconnecting ? "Connecting..." : "Reconnect"}
                        </Button>
                    </div>
                )}

                <div className="flex items-center justify-between">
                    <div className="space-y-0.5 flex-1">
                        <Label htmlFor="auto-sync" className="text-base">
                            Enable auto-sync
                        </Label>
                        <p className="text-sm text-muted-foreground">
                            Automatically sync recordings from your Plaud device
                            at regular intervals
                        </p>
                    </div>
                    <Switch
                        id="auto-sync"
                        checked={autoSyncEnabled}
                        onCheckedChange={(checked) => {
                            setAutoSyncEnabled(checked);
                            handleSyncSettingChange({
                                autoSyncEnabled: checked,
                            });
                        }}
                        disabled={isSavingSettings}
                    />
                </div>

                {autoSyncEnabled && (
                    <>
                        <div className="space-y-2">
                            <Label htmlFor="sync-interval">Sync interval</Label>
                            <Select
                                value={syncInterval.toString()}
                                onValueChange={(value) => {
                                    const interval = parseInt(value, 10);
                                    setSyncInterval(interval);
                                    handleSyncSettingChange({
                                        syncInterval: interval,
                                    });
                                }}
                                disabled={isSavingSettings}
                            >
                                <SelectTrigger
                                    id="sync-interval"
                                    className="w-full"
                                >
                                    <SelectValue>
                                        {getSyncIntervalLabel(syncInterval)}
                                    </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                    {syncIntervalPresets.map((preset) => (
                                        <SelectItem
                                            key={preset.value}
                                            value={preset.value.toString()}
                                        >
                                            {preset.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                How often to automatically sync recordings
                            </p>
                        </div>

                        <div className="flex items-center justify-between">
                            <div className="space-y-0.5 flex-1">
                                <Label
                                    htmlFor="sync-on-mount"
                                    className="text-base"
                                >
                                    Sync on app load
                                </Label>
                                <p className="text-sm text-muted-foreground">
                                    Automatically sync when the app first loads
                                </p>
                            </div>
                            <Switch
                                id="sync-on-mount"
                                checked={syncOnMount}
                                onCheckedChange={(checked) => {
                                    setSyncOnMount(checked);
                                    handleSyncSettingChange({
                                        syncOnMount: checked,
                                    });
                                }}
                                disabled={isSavingSettings}
                            />
                        </div>

                        <div className="flex items-center justify-between">
                            <div className="space-y-0.5 flex-1">
                                <Label
                                    htmlFor="sync-on-visibility"
                                    className="text-base"
                                >
                                    Sync on tab visibility
                                </Label>
                                <p className="text-sm text-muted-foreground">
                                    Sync when you return to the app tab
                                </p>
                            </div>
                            <Switch
                                id="sync-on-visibility"
                                checked={syncOnVisibilityChange}
                                onCheckedChange={(checked) => {
                                    setSyncOnVisibilityChange(checked);
                                    handleSyncSettingChange({
                                        syncOnVisibilityChange: checked,
                                    });
                                }}
                                disabled={isSavingSettings}
                            />
                        </div>
                    </>
                )}

                <div className="flex items-center justify-between">
                    <div className="space-y-0.5 flex-1">
                        <Label
                            htmlFor="sync-notifications"
                            className="text-base"
                        >
                            Show sync notifications
                        </Label>
                        <p className="text-sm text-muted-foreground">
                            Display notifications when sync completes
                        </p>
                    </div>
                    <Switch
                        id="sync-notifications"
                        checked={syncNotifications}
                        onCheckedChange={(checked) => {
                            setSyncNotifications(checked);
                            handleSyncSettingChange({
                                syncNotifications: checked,
                            });
                        }}
                        disabled={isSavingSettings}
                    />
                </div>
            </div>
        </div>
    );
}
