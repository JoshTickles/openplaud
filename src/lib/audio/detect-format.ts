/**
 * Detect audio format from buffer magic bytes.
 * Plaud stores audio as Opus but often names files with .mp3 extension.
 */

export interface AudioFormatInfo {
    contentType: string;
    extension: string;
}

export function detectAudioFormat(buffer: Buffer | Uint8Array): AudioFormatInfo {
    const bytes = buffer instanceof Buffer ? buffer : Buffer.from(buffer);

    // OGG/Opus: starts with "OggS" (0x4F 0x67 0x67 0x53)
    // Use .ogg extension — Azure and most APIs accept ogg but not opus as an extension
    if (bytes.length >= 4 && bytes[0] === 0x4F && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) {
        return { contentType: "audio/ogg", extension: ".ogg" };
    }

    // MP3: starts with ID3 tag (0x49 0x44 0x33) or MPEG sync word (0xFF 0xFB/0xFF 0xFA/0xFF 0xF3/0xFF 0xF2)
    if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
        return { contentType: "audio/mpeg", extension: ".mp3" };
    }
    if (bytes.length >= 2 && bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0) {
        return { contentType: "audio/mpeg", extension: ".mp3" };
    }

    // WAV: starts with "RIFF" (0x52 0x49 0x46 0x46)
    if (bytes.length >= 4 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
        return { contentType: "audio/wav", extension: ".wav" };
    }

    // FLAC: starts with "fLaC" (0x66 0x4C 0x61 0x43)
    if (bytes.length >= 4 && bytes[0] === 0x66 && bytes[1] === 0x4C && bytes[2] === 0x61 && bytes[3] === 0x43) {
        return { contentType: "audio/flac", extension: ".flac" };
    }

    // Default fallback: assume MP3 (legacy behavior)
    return { contentType: "audio/mpeg", extension: ".mp3" };
}
