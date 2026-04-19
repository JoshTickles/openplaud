"use client";

import { Upload, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

const ACCEPTED_TYPES = [
    "audio/mpeg",
    "audio/mp3",
    "audio/mp4",
    "audio/m4a",
    "audio/x-m4a",
    "audio/aac",
    "audio/ogg",
    "audio/opus",
    "audio/wav",
    "audio/x-wav",
    "audio/wave",
    "audio/webm",
    "audio/flac",
    "audio/x-flac",
    "video/mp4",
];

const ACCEPTED_EXTENSIONS = ".mp3,.m4a,.aac,.ogg,.opus,.wav,.flac,.webm,.mp4";

interface UploadZoneProps {
    onUploadComplete: () => void;
}

export function UploadZone({ onUploadComplete }: UploadZoneProps) {
    const [isDragging, setIsDragging] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [uploadFileName, setUploadFileName] = useState("");
    const fileInputRef = useRef<HTMLInputElement>(null);

    const uploadFile = useCallback(
        async (file: File) => {
            if (
                file.type &&
                !ACCEPTED_TYPES.includes(file.type) &&
                !file.name.match(/\.(mp3|m4a|aac|ogg|opus|wav|flac|webm|mp4)$/i)
            ) {
                toast.error(`Unsupported file type: ${file.type || file.name}`);
                return;
            }

            const maxSize = 500 * 1024 * 1024;
            if (file.size > maxSize) {
                toast.error("File too large. Maximum size is 500MB.");
                return;
            }

            setIsUploading(true);
            setUploadFileName(file.name);
            setUploadProgress(10);

            try {
                const formData = new FormData();
                formData.append("file", file);

                setUploadProgress(30);

                const response = await fetch("/api/voice-memos/upload", {
                    method: "POST",
                    body: formData,
                });

                setUploadProgress(90);

                if (!response.ok) {
                    const data = await response.json();
                    throw new Error(data.error || "Upload failed");
                }

                const data = await response.json();
                setUploadProgress(100);
                toast.success(`Uploaded "${data.filename}"`);
                onUploadComplete();
            } catch (error) {
                toast.error(
                    error instanceof Error ? error.message : "Upload failed",
                );
            } finally {
                setTimeout(() => {
                    setIsUploading(false);
                    setUploadProgress(0);
                    setUploadFileName("");
                }, 500);
            }
        },
        [onUploadComplete],
    );

    const handleDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            setIsDragging(false);

            const files = Array.from(e.dataTransfer.files);
            if (files.length > 0) {
                uploadFile(files[0]);
            }
        },
        [uploadFile],
    );

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    }, []);

    const handleFileSelect = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const files = e.target.files;
            if (files && files.length > 0) {
                uploadFile(files[0]);
            }
            e.target.value = "";
        },
        [uploadFile],
    );

    if (isUploading) {
        return (
            <Card className="border-dashed border-2 border-primary/30">
                <CardContent className="flex flex-col items-center justify-center py-8 gap-3">
                    <Upload className="w-8 h-8 text-primary animate-pulse" />
                    <p className="text-sm font-medium">{uploadFileName}</p>
                    <Progress value={uploadProgress} className="w-48" />
                    <p className="text-xs text-muted-foreground">
                        Uploading...
                    </p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card
            className={cn(
                "border-dashed border-2 cursor-pointer transition-colors",
                isDragging
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50",
            )}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
        >
            <CardContent className="flex flex-col items-center justify-center py-8 gap-2">
                <Upload className="w-8 h-8 text-muted-foreground" />
                <p className="text-sm font-medium">
                    {isDragging
                        ? "Drop audio file here"
                        : "Drop audio file or click to upload"}
                </p>
                <p className="text-xs text-muted-foreground">
                    MP3, M4A, AAC, WAV, OGG, FLAC, WebM (max 500MB)
                </p>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPTED_EXTENSIONS}
                    onChange={handleFileSelect}
                    className="hidden"
                />
            </CardContent>
        </Card>
    );
}
